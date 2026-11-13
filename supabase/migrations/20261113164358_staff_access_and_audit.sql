begin;

-- This registry is separate from JWT claims so revocation takes effect immediately.
create table private.staff_accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
revoke all on private.staff_accounts from public, anon, authenticated;

create table private.staff_activity (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  actor_name text not null,
  action text not null,
  subject text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index staff_activity_created_idx on private.staff_activity(created_at desc, id desc);
revoke all on private.staff_activity from public, anon, authenticated;

create function private.is_active_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.staff_accounts where user_id = (select auth.uid()) and active);
$$;
revoke all on function private.is_active_staff() from public, anon;
grant execute on function private.is_active_staff() to authenticated;
create function public.staff_current_access() returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_staff();
$$;
revoke all on function public.staff_current_access() from public, anon;
grant execute on function public.staff_current_access() to authenticated;

create function public.owner_staff_accounts()
returns table(user_id uuid, display_name text, email text, active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Owner access required'; end if;
  return query select s.user_id, s.display_name, s.email, s.active, s.created_at from private.staff_accounts s order by s.created_at desc;
end; $$;
revoke all on function public.owner_staff_accounts() from public, anon;
grant execute on function public.owner_staff_accounts() to authenticated;

create function public.owner_staff_activity()
returns table(id bigint, actor_name text, action text, subject text, detail text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Owner access required'; end if;
  return query select a.id, a.actor_name, a.action, a.subject, a.detail, a.created_at from private.staff_activity a order by a.created_at desc, a.id desc;
end; $$;
revoke all on function public.owner_staff_activity() from public, anon;
grant execute on function public.owner_staff_activity() to authenticated;

create function public.owner_set_staff_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Owner access required'; end if;
  if p_active is null then raise exception 'Active status required'; end if;
  update private.staff_accounts set active = p_active where user_id = p_user_id;
  if not found then raise exception 'Staff account not found'; end if;
end; $$;
revoke all on function public.owner_set_staff_active(uuid,boolean) from public, anon;
grant execute on function public.owner_set_staff_active(uuid,boolean) to authenticated;

-- Only the trusted account-provisioning function can register an Auth user.
create function public.register_staff_account(p_user_id uuid, p_name text, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = lower(trim(p_email)) and u.raw_app_meta_data->>'role' = 'staff') then
    raise exception 'Staff identity not found';
  end if;
  insert into private.staff_accounts(user_id, display_name, email) values (p_user_id, trim(p_name), lower(trim(p_email)));
end; $$;
revoke all on function public.register_staff_account(uuid,text,text) from public, anon, authenticated;
grant execute on function public.register_staff_account(uuid,text,text) to service_role;

-- Log changes in the same transaction, retaining only operational details.
create function private.log_staff_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_subject text; v_detail text; v_action text;
begin
  select display_name into v_name from private.staff_accounts where user_id = auth.uid() and active;
  if v_name is null then return coalesce(new,old); end if;
  if tg_table_name = 'orders' then
    if new.status is not distinct from old.status then return new; end if;
    v_subject := new.order_number; v_action := 'Order status updated'; v_detail := old.status || ' → ' || new.status;
  elsif tg_table_name = 'payments' then
    if new.status is not distinct from old.status then return new; end if;
    select order_number into v_subject from public.orders where id = new.order_id;
    v_action := 'Payment ' || new.status;
  elsif tg_table_name = 'products' then
    v_subject := coalesce(new.name, old.name); v_action := case when tg_op = 'INSERT' then 'Product added' else 'Product updated' end;
  else
    v_subject := coalesce(new.name, old.name); v_action := case when tg_op = 'INSERT' then 'Category added' else 'Category updated' end;
  end if;
  insert into private.staff_activity(actor_id,actor_name,action,subject,detail) values (auth.uid(),v_name,v_action,coalesce(v_subject,'Unknown'),v_detail);
  return coalesce(new,old);
end; $$;
revoke all on function private.log_staff_change() from public, anon, authenticated;
create trigger log_staff_orders after update on public.orders for each row execute function private.log_staff_change();
create trigger log_staff_payments after update on public.payments for each row execute function private.log_staff_change();
create trigger log_staff_products after insert or update on public.products for each row execute function private.log_staff_change();
create trigger log_staff_categories after insert or update on public.categories for each row execute function private.log_staff_change();

create policy "Staff read categories" on public.categories for select to authenticated using ((select private.is_active_staff()));
create policy "Staff add categories" on public.categories for insert to authenticated with check ((select private.is_active_staff()));
create policy "Staff update categories" on public.categories for update to authenticated using ((select private.is_active_staff())) with check ((select private.is_active_staff()));
create policy "Staff read products" on public.products for select to authenticated using ((select private.is_active_staff()));
create policy "Staff add products" on public.products for insert to authenticated with check ((select private.is_active_staff()));
create policy "Staff update products" on public.products for update to authenticated using ((select private.is_active_staff())) with check ((select private.is_active_staff()));
create policy "Staff read orders" on public.orders for select to authenticated using ((select private.is_active_staff()));
create policy "Staff update orders" on public.orders for update to authenticated using ((select private.is_active_staff())) with check ((select private.is_active_staff()));
create policy "Staff read order items" on public.order_items for select to authenticated using ((select private.is_active_staff()));
create policy "Staff read payments" on public.payments for select to authenticated using ((select private.is_active_staff()));
create policy "Staff read inventory" on public.inventory_transactions for select to authenticated using ((select private.is_active_staff()));
create policy "Staff read proof" on storage.objects for select to authenticated using (bucket_id = 'payment-proofs' and (select private.is_active_staff()));
create policy "Staff upload product images" on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and (select private.is_active_staff()));
drop policy "Signed-in customers can read GCash payment details" on public.gcash_payment_details;
create policy "Customers and owner read GCash payment details" on public.gcash_payment_details for select to authenticated
  using (coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'staff');

-- A direct staff update may change only order status. Payment review functions
-- execute as their owner and keep their existing transactional validations.
create function private.guard_staff_order_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and private.is_active_staff() then
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Staff may update order status only';
    end if;
    if new.status not in ('processing','ready_to_ship','shipped','in_transit','delivered','cancelled') then
      raise exception 'Use payment review to change payment status';
    end if;
  end if;
  return new;
end; $$;
revoke all on function private.guard_staff_order_update() from public, anon, authenticated;
create trigger guard_staff_order_update before update on public.orders for each row execute function private.guard_staff_order_update();

create function private.guard_staff_product_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and private.is_active_staff() then
    if (tg_op = 'INSERT' and new.reserved_quantity <> 0) or (tg_op = 'UPDATE' and new.reserved_quantity is distinct from old.reserved_quantity) then
      raise exception 'Reserved stock cannot be edited';
    end if;
    if new.stock_quantity < new.reserved_quantity then raise exception 'Stock cannot be below reserved stock'; end if;
  end if;
  return new;
end; $$;
revoke all on function private.guard_staff_product_update() from public, anon, authenticated;
create trigger guard_staff_product_update before insert or update on public.products for each row execute function private.guard_staff_product_update();

create or replace function private.prevent_admin_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (private.is_hushley_admin() or coalesce(auth.jwt()->'app_metadata'->>'role','') = 'staff' or exists (
    select 1 from auth.users u where u.id = auth.uid() and u.raw_app_meta_data->>'role' in ('admin', 'staff')
  )) then
    raise exception 'Shop management accounts cannot place customer orders';
  end if;
  return new;
end; $$;

create or replace function public.admin_customer_profiles()
returns table (id uuid, full_name text, phone text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Administrator access required'; end if;
  return query select p.id, p.full_name, p.phone, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    where coalesce(u.raw_app_meta_data->>'role', '') not in ('admin', 'staff') and p.id <> auth.uid();
end; $$;

create or replace function public.admin_review_payment(p_payment_id uuid, p_approved boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype; v_item record; v_order_id uuid;
begin
  if auth.uid() is null or (not private.is_hushley_admin() and not private.is_active_staff()) then raise exception 'Administrator access required'; end if;
  if p_approved is null then raise exception 'Approve or reject explicitly'; end if;
  select order_id into v_order_id from public.payments where id = p_payment_id;
  -- Lock order first, consistently with proof submission and shipping/status updates.
  select * into v_order from public.orders where id = v_order_id for update;
  if not found or v_order.status <> 'payment_verification' then raise exception 'This order is not awaiting payment review'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status <> 'pending' then raise exception 'Pending payment not found'; end if;
  if v_payment.amount <> v_order.total or v_payment.method <> v_order.payment_method then
    raise exception 'Payment does not match the order';
  end if;
  if p_approved then
    if v_payment.proof_path is null or not exists (
      select 1 from storage.objects where bucket_id = 'payment-proofs' and name = v_payment.proof_path
    ) then raise exception 'Payment proof file is missing'; end if;
    for v_item in select product_id,sum(quantity)::int quantity from public.order_items
      where order_id = v_order.id group by product_id order by product_id loop
      update public.products set stock_quantity = stock_quantity-v_item.quantity,
        reserved_quantity = reserved_quantity-v_item.quantity
        where id = v_item.product_id and stock_quantity >= v_item.quantity and reserved_quantity >= v_item.quantity;
      if not found then raise exception 'Stock reservation changed before payment approval'; end if;
      insert into public.inventory_transactions(product_id,order_id,quantity_delta,reason,actor_id)
        values (v_item.product_id,v_order.id,-v_item.quantity,'payment_confirmed',auth.uid());
    end loop;
  end if;
  update public.payments set status = case when p_approved then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(),reviewed_at = now(),review_note = p_note where id = p_payment_id;
  update public.orders set status = case when p_approved then 'payment_confirmed' else 'payment_rejected' end where id = v_order.id;
end;
$$;

create or replace function public.admin_set_product_stock(p_product_id uuid, p_quantity int, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_delta int;
begin
  if (not private.is_hushley_admin() and not private.is_active_staff()) then raise exception 'Administrator access required'; end if;
  if p_quantity < 0 then raise exception 'Stock cannot be negative'; end if;
  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if p_quantity < v_product.reserved_quantity then raise exception 'Stock cannot be less than units reserved for orders'; end if;
  v_delta := p_quantity - v_product.stock_quantity;
  if v_delta = 0 then return; end if;
  update public.products set stock_quantity = p_quantity where id = p_product_id;
  insert into public.inventory_transactions(product_id, quantity_delta, reason, note, actor_id)
  values (p_product_id, v_delta, 'manual_stock_adjustment', p_note, auth.uid());
end;
$$;

commit;
