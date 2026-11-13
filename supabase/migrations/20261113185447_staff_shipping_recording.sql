-- Allow verified, active staff to record shipping using the existing guarded RPCs.
begin;
create or replace function private.guard_order_shipping()
returns trigger language plpgsql set search_path = '' as $$
declare v_units bigint; v_class text; v_rate numeric;
begin
  if new.shipping_fee = 'NaN'::numeric then raise exception 'Shipping fee must be finite'; end if;
  if new.courier = 'lalamove' and new.shipping_fee <> 0 then
    raise exception 'Lalamove delivery is paid directly to the rider; website shipping must be zero';
  end if;
  if new.shipping_region is not null and not exists (
    select 1 from public.shipping_rates where courier = new.courier and region = new.shipping_region
  ) then raise exception 'Courier is unavailable for this destination region'; end if;
  if new.shipping_region in ('Luzon','Visayas','Mindanao') and lower(btrim(new.country)) not in ('philippines','ph','phl') then
    raise exception 'Domestic shipping requires a Philippine destination';
  end if;
  if new.shipping_region in ('Asia','Outside Asia') and lower(btrim(new.country)) in ('philippines','ph','phl') then
    raise exception 'International shipping requires a destination outside the Philippines';
  end if;
  if tg_op = 'UPDATE' then
    if exists (select 1 from public.payments where order_id = new.id) and (
      new.shipping_fee is distinct from old.shipping_fee
      or new.courier is distinct from old.courier or new.shipping_region is distinct from old.shipping_region
      or new.shipping_confirmed is distinct from old.shipping_confirmed
      or new.estimated_shipping_fee is distinct from old.estimated_shipping_fee
      or new.shipping_pricing_kind is distinct from old.shipping_pricing_kind
      or new.shipping_rate_snapshot is distinct from old.shipping_rate_snapshot
      or new.shipping_quote_note is distinct from old.shipping_quote_note
    ) then raise exception 'Shipping quote cannot change after payment proof submission'; end if;
    if new.shipping_confirmed and (not old.shipping_confirmed
      or new.shipping_fee is distinct from old.shipping_fee
      or new.shipping_region is distinct from old.shipping_region) then
      if auth.uid() is null or (not private.is_hushley_admin() and not private.is_active_staff()) then raise exception 'Staff must confirm shipping'; end if;
      if new.shipping_region is null then raise exception 'Staff must set the shipping region before confirmation'; end if;
      if coalesce(btrim(new.shipping_quote_note),'') = '' then
        raise exception 'Record the quote basis, item combination and parcel assumptions before confirmation';
      end if;
      select sum(quantity),min(shipping_class) into v_units,v_class
        from public.order_items where order_id = new.id;
      if new.courier = 'j&t' and v_units = 1 and v_class is not null then
        select amount into v_rate from public.shipping_rates
          where courier = new.courier and region = new.shipping_region and shipping_class = v_class;
        if v_rate is null or new.shipping_fee <> v_rate then
          raise exception 'Single-item domestic shipping must match its configured class rate';
        end if;
      end if;
      select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) into new.shipping_rate_snapshot
        from public.shipping_rates r where r.courier = new.courier and r.region = new.shipping_region;
      new.shipping_pricing_kind := case new.courier
        when 'lalamove' then 'pay_rider' when 'philpost' then 'estimate'
        else case when v_units = 1 and v_class is not null then 'fixed' else 'manual_quote' end end;
      new.estimated_shipping_fee := case when new.courier = 'philpost' then new.shipping_fee else null end;
      new.shipping_confirmed_by := auth.uid(); new.shipping_confirmed_at := now();
    end if;
  end if;
  if new.actual_shipping_fee is not null then
    if new.courier <> 'philpost' or new.estimated_shipping_fee is null or not new.shipping_confirmed then
      raise exception 'Actual shipping adjustments require a confirmed international estimate';
    end if;
    if coalesce(btrim(new.shipping_receipt_reference),'') = '' then raise exception 'Record the official shipping receipt reference'; end if;
  end if;
  if new.shipping_customer_emailed_at is not null and new.actual_shipping_fee is null then
    raise exception 'Record actual shipping cost before customer communication';
  end if;
  if new.shipping_adjustment_settled_at is not null and (
    new.actual_shipping_fee is null or new.shipping_customer_emailed_at is null
    or coalesce(btrim(new.shipping_adjustment_note),'') = ''
  ) then raise exception 'Record receipt email and external settlement details first'; end if;
  return new;
end;
$$;

create or replace function public.admin_confirm_order_shipping(
  p_order_id uuid, p_region text, p_fee numeric, p_quote_note text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (not private.is_hushley_admin() and not private.is_active_staff()) then raise exception 'Active staff or administrator access required'; end if;
  if p_region is null or p_fee is null then raise exception 'Region and shipping fee are required'; end if;
  update public.orders set shipping_region = p_region,shipping_fee = p_fee,
    shipping_quote_note = p_quote_note,shipping_confirmed = true where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
end;
$$;

create or replace function public.admin_record_shipping_actual(
  p_order_id uuid, p_actual_fee numeric, p_receipt_reference text,
  p_customer_emailed_at timestamptz default null, p_note text default null,
  p_settled_at timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (not private.is_hushley_admin() and not private.is_active_staff()) then raise exception 'Active staff or administrator access required'; end if;
  if p_actual_fee is null then raise exception 'Actual shipping cost is required'; end if;
  update public.orders set actual_shipping_fee = p_actual_fee,
    shipping_receipt_reference = nullif(btrim(p_receipt_reference),''),
    shipping_customer_emailed_at = p_customer_emailed_at, shipping_adjustment_note = p_note,
    shipping_adjustment_settled_at = p_settled_at where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
end;
$$;

create or replace function public.admin_record_separate_shipping(p_order_id uuid, p_quote numeric, p_note text,
  p_actual numeric default null, p_receipt text default null, p_contacted_at timestamptz default null,
  p_settlement_note text default null, p_settled_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; v_units bigint; v_class text; v_rate numeric;
begin
  if auth.uid() is null or (not private.is_hushley_admin() and not private.is_active_staff()) then raise exception 'Active staff or administrator access required'; end if;
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

commit;
