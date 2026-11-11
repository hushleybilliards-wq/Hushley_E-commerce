-- New orders take product payment first; legacy orders retain their original payment terms.
begin;
alter table public.orders add column payment_scope text not null default 'order_total' check (payment_scope in ('order_total','products_only'));
alter table public.orders alter column payment_scope set default 'products_only';
-- Unquoted, unpaid orders with no proof have not yet established a shipping-inclusive total.
-- Move only those orders to the newly confirmed product-first process; leave all others alone.
update public.orders o set payment_scope = 'products_only'
where o.status = 'pending_payment' and not o.shipping_confirmed and o.shipping_fee = 0
  and not exists (select 1 from public.payments p where p.order_id = o.id);
alter table public.orders add column separate_shipping_quote numeric(12,2) check (separate_shipping_quote >= 0 and separate_shipping_quote <> 'NaN'::numeric),
  add column separate_shipping_quote_note text,
  add column separate_shipping_actual numeric(12,2) check (separate_shipping_actual >= 0 and separate_shipping_actual <> 'NaN'::numeric),
  add column separate_shipping_receipt text,
  add column separate_shipping_contacted_at timestamptz,
  add column separate_shipping_settlement_note text,
  add column separate_shipping_settled_at timestamptz,
  add column separate_shipping_adjustment numeric(12,2) generated always as (separate_shipping_actual - separate_shipping_quote) stored;

create function private.guard_product_only_order() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.payment_scope is distinct from old.payment_scope then raise exception 'Payment terms cannot be changed'; end if;
  if new.payment_scope = 'products_only' and (new.shipping_fee <> 0 or new.shipping_confirmed) then
    raise exception 'Shipping is recorded separately for this order';
  end if;
  return new;
end; $$;
revoke all on function private.guard_product_only_order() from public, anon, authenticated;
create trigger guard_product_only_order before update on public.orders for each row execute function private.guard_product_only_order();

create or replace function public.submit_payment_proof(p_order_id uuid, p_proof_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_payment_id uuid; v_item record; v_product public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select * into v_order from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status not in ('pending_payment','payment_rejected') then raise exception 'Payment can no longer be submitted for this order'; end if;
  if v_order.payment_scope = 'order_total' and not v_order.shipping_confirmed then raise exception 'Wait for the shop to confirm your shipping fee before paying'; end if;
  if p_proof_path is null or split_part(p_proof_path,'/',1) <> auth.uid()::text or not exists (
    select 1 from storage.objects where bucket_id = 'payment-proofs' and name = p_proof_path
  ) then raise exception 'Upload a valid proof file to your private payment-proofs folder first'; end if;
  if v_order.status = 'pending_payment' and v_order.hold_expires_at < now() then raise exception 'The payment hold has expired'; end if;
  if v_order.status = 'payment_rejected' then
    for v_item in select product_id,sum(quantity)::int quantity from public.order_items
      where order_id = p_order_id group by product_id order by product_id loop
      select * into v_product from public.products where id = v_item.product_id and is_active for update;
      if not found or v_product.stock_quantity-v_product.reserved_quantity < v_item.quantity then
        raise exception 'A product in this order is no longer available';
      end if;
      update public.products set reserved_quantity = reserved_quantity+v_item.quantity where id = v_product.id;
    end loop;
    update public.orders set status = 'pending_payment',hold_expires_at = now()+interval '2 hours' where id = p_order_id;
  end if;
  insert into public.payments (order_id,method,amount,proof_path)
    values (p_order_id,v_order.payment_method,v_order.total,p_proof_path) returning id into v_payment_id;
  update public.orders set status = 'payment_verification' where id = p_order_id;
  return v_payment_id;
end;
$$;

-- Staff records a separately collected fee; no refund, payment collection or email is automated.
create function public.admin_record_separate_shipping(p_order_id uuid, p_quote numeric, p_note text,
  p_actual numeric default null, p_receipt text default null, p_contacted_at timestamptz default null,
  p_settlement_note text default null, p_settled_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; v_units bigint; v_class text; v_rate numeric;
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Administrator access required'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.payment_scope <> 'products_only' then raise exception 'Product-first order not found'; end if;
  if not exists (select 1 from public.payments where order_id = o.id and status = 'approved' and amount = o.total and method = o.payment_method) then
    raise exception 'Approve product payment before recording shipping';
  end if;
  if p_quote is null or p_quote < 0 or p_quote = 'NaN'::numeric or coalesce(btrim(p_note),'') = '' then raise exception 'Enter shipping amount and explanation'; end if;
  if o.shipping_region is null then raise exception 'Shipping destination is required'; end if;
  if o.courier = 'lalamove' and p_quote <> 0 then raise exception 'Lalamove is paid to the rider; website fee must be zero'; end if;
  select sum(quantity), min(shipping_class) into v_units, v_class from public.order_items where order_id = o.id;
  if o.courier = 'j&t' and v_units = 1 and v_class is not null then
    select amount into v_rate from public.shipping_rates where courier = o.courier and region = o.shipping_region and shipping_class = v_class;
    if v_rate is null or p_quote <> v_rate then raise exception 'Single-item J&T shipping must match the configured rate'; end if;
  end if;
  if o.courier <> 'philpost' and p_actual is not null then raise exception 'Actual international cost is for PhilPost orders'; end if;
  if p_actual is not null and (p_actual < 0 or p_actual = 'NaN'::numeric or coalesce(btrim(p_receipt),'') = '') then raise exception 'Enter a valid actual cost and receipt reference'; end if;
  if p_settled_at is not null and (p_actual is null or p_contacted_at is null or coalesce(btrim(p_settlement_note),'') = '') then raise exception 'Record actual cost, customer contact and settlement details'; end if;
  if o.separate_shipping_actual is not null and p_quote is distinct from o.separate_shipping_quote then raise exception 'The original estimate cannot change after actual cost is recorded'; end if;
  if o.separate_shipping_actual is not null and p_actual is null then raise exception 'Actual shipping cost cannot be cleared'; end if;
  if o.separate_shipping_contacted_at is not null and p_contacted_at is null then raise exception 'Customer contact cannot be cleared'; end if;
  if o.separate_shipping_settled_at is not null and p_settled_at is null then raise exception 'Settlement record cannot be cleared'; end if;
  update public.orders set separate_shipping_quote = p_quote, separate_shipping_quote_note = p_note,
    separate_shipping_actual = p_actual, separate_shipping_receipt = p_receipt,
    separate_shipping_contacted_at = p_contacted_at, separate_shipping_settlement_note = p_settlement_note,
    separate_shipping_settled_at = p_settled_at where id = p_order_id;
end; $$;
revoke all on function public.admin_record_separate_shipping(uuid,numeric,text,numeric,text,timestamptz,text,timestamptz) from public, anon;
grant execute on function public.admin_record_separate_shipping(uuid,numeric,text,numeric,text,timestamptz,text,timestamptz) to authenticated;
commit;
