-- Local review migration. No courier API, automatic payment, refund or collection.
-- Existing rows are preserved. Review legacy data and integrate the new fields before rollout.
begin;

insert into public.categories (id, name, sort_order)
values ('balls', 'Billiard Ball Sets', 85) on conflict (id) do nothing;

alter table public.products add column shipping_class text
  check (shipping_class in ('small_items', 'cue', 'ball_set'));
comment on column public.products.shipping_class is
  'Staff-assigned shipping class. NULL requires review; category does not imply shipping size.';
alter table public.order_items add column shipping_class text
  check (shipping_class in ('small_items','cue','ball_set'));
comment on column public.order_items.shipping_class is 'Shipping class snapshot at checkout; NULL requires staff review.';

create table public.shipping_rates (
  id text primary key,
  courier text not null check (courier in ('j&t','lalamove','philpost')),
  region text not null check (region in ('Luzon','Visayas','Mindanao','Asia','Outside Asia')),
  shipping_class text not null check (shipping_class in ('small_items','cue','ball_set','any')),
  amount numeric(12,2) not null check (amount >= 0 and amount <> 'NaN'::numeric),
  is_estimate boolean not null,
  collection_method text not null check (collection_method in ('website','rider_on_delivery')),
  application_basis text not null default 'staff_confirmation_required'
    check (application_basis = 'staff_confirmation_required'),
  unique (courier, region, shipping_class),
  check (
    (courier = 'j&t' and region in ('Luzon','Visayas','Mindanao') and shipping_class <> 'any'
      and not is_estimate and collection_method = 'website') or
    (courier = 'lalamove' and region = 'Luzon' and shipping_class = 'any' and amount = 0
      and not is_estimate and collection_method = 'rider_on_delivery') or
    (courier = 'philpost' and region in ('Asia','Outside Asia') and shipping_class = 'any'
      and is_estimate and collection_method = 'website')
  )
);
insert into public.shipping_rates
  (id,courier,region,shipping_class,amount,is_estimate,collection_method) values
  ('jnt_luzon_small','j&t','Luzon','small_items',75,false,'website'),
  ('jnt_visayas_small','j&t','Visayas','small_items',100,false,'website'),
  ('jnt_mindanao_small','j&t','Mindanao','small_items',100,false,'website'),
  ('jnt_luzon_cue','j&t','Luzon','cue',300,false,'website'),
  ('jnt_visayas_cue','j&t','Visayas','cue',300,false,'website'),
  ('jnt_mindanao_cue','j&t','Mindanao','cue',300,false,'website'),
  ('jnt_luzon_balls','j&t','Luzon','ball_set',500,false,'website'),
  ('jnt_visayas_balls','j&t','Visayas','ball_set',500,false,'website'),
  ('jnt_mindanao_balls','j&t','Mindanao','ball_set',500,false,'website'),
  ('lalamove_luzon','lalamove','Luzon','any',0,false,'rider_on_delivery'),
  ('philpost_asia','philpost','Asia','any',3100,true,'website'),
  ('philpost_outside_asia','philpost','Outside Asia','any',4100,true,'website');
alter table public.shipping_rates enable row level security;
revoke all on public.shipping_rates from public, anon, authenticated;
grant select on public.shipping_rates to anon, authenticated;
grant insert, update, delete on public.shipping_rates to authenticated;
create policy "Read shipping reference rates" on public.shipping_rates
  for select to anon, authenticated using (true);
create policy "Admins manage shipping reference rates" on public.shipping_rates
  for all to authenticated using ((select private.is_hushley_admin()))
  with check ((select private.is_hushley_admin()));
comment on table public.shipping_rates is
  'Reference rates in PHP, not a cart calculator. Mixed-cart combination, quantity/parcel basis and country-to-Asia mapping remain undecided. Staff must confirm each quote.';

alter table public.orders
  add column shipping_region text check (shipping_region in ('Luzon','Visayas','Mindanao','Asia','Outside Asia')),
  add column shipping_pricing_kind text not null default 'unconfirmed'
    check (shipping_pricing_kind in ('unconfirmed','fixed','estimate','pay_rider','manual_quote')),
  add column shipping_rate_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(shipping_rate_snapshot) = 'array'),
  add column shipping_quote_note text,
  add column shipping_confirmed_by uuid references auth.users(id) on delete set null,
  add column shipping_confirmed_at timestamptz,
  add column estimated_shipping_fee numeric(12,2)
    check (estimated_shipping_fee >= 0 and estimated_shipping_fee <> 'NaN'::numeric),
  add column actual_shipping_fee numeric(12,2)
    check (actual_shipping_fee >= 0 and actual_shipping_fee <> 'NaN'::numeric),
  add column shipping_adjustment_amount numeric(12,2)
    generated always as (actual_shipping_fee - estimated_shipping_fee) stored,
  add column shipping_receipt_reference text,
  add column shipping_customer_emailed_at timestamptz,
  add column shipping_adjustment_note text,
  add column shipping_adjustment_settled_at timestamptz;
comment on column public.orders.shipping_adjustment_amount is
  'PHP actual minus original estimate: negative = refund due; positive = balance due. Settled manually outside website, never added to order total.';
comment on column public.orders.shipping_receipt_reference is
  'Private receipt identifier or private Storage path, never a publicly shared receipt URL.';
comment on column public.orders.shipping_customer_emailed_at is
  'Staff records when receipt and adjustment instructions were emailed; this field does not send email.';

-- Restrict capabilities as well as RLS. GRANT ALL included TRUNCATE, which bypasses RLS.
revoke all on public.categories, public.products, public.orders, public.order_items,
  public.payments, public.inventory_transactions from public, anon, authenticated;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name,phone) on public.profiles to authenticated;
grant select on public.categories, public.products to anon, authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant select on public.orders, public.order_items, public.payments, public.inventory_transactions to authenticated;
grant update (status,tracking_number,shipping_fee,total,shipping_confirmed,
  shipping_region,shipping_quote_note) on public.orders to authenticated;
drop policy "Customers create own orders" on public.orders;
drop policy "Customers add items to own orders" on public.order_items;
drop policy "Customers create own payment records" on public.payments;
drop policy "Admins manage payments" on public.payments;
drop policy "Admins manage order items" on public.order_items;
drop policy "Admins create inventory history" on public.inventory_transactions;
create index payments_order_idx on public.payments(order_id);
create index order_items_product_idx on public.order_items(product_id);
create unique index payments_one_active_per_order_idx on public.payments(order_id)
  where status in ('pending','approved');

-- Product-specific option definitions: [{"name":"Hardness","values":["Soft","Medium","Hard"],"required":true}].
-- Missing required defaults to true. Empty [] means this product has no selectable options.
create function private.valid_product_options(p_options jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_option jsonb; v_names text[] := '{}'; v_name text;
begin
  if jsonb_typeof(p_options) is distinct from 'array' then return false; end if;
  for v_option in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(v_option) is distinct from 'object' then return false; end if;
    v_name := v_option->>'name';
    if jsonb_typeof(v_option->'name') is distinct from 'string'
      or btrim(v_name) = '' or v_name = any(v_names)
      or jsonb_typeof(v_option->'values') is distinct from 'array' then return false; end if;
    if jsonb_array_length(v_option->'values') = 0 or exists (
      select 1 from jsonb_array_elements(v_option->'values') v
      where jsonb_typeof(v) <> 'string' or btrim(v #>> '{}') = ''
    ) then return false; end if;
    if v_option ? 'required' and jsonb_typeof(v_option->'required') <> 'boolean' then return false; end if;
    v_names := array_append(v_names, v_name);
  end loop;
  return true;
end;
$$;
revoke all on function private.valid_product_options(jsonb) from public, anon;
grant execute on function private.valid_product_options(jsonb) to authenticated;
-- NOT VALID preserves legacy catalog entries; new writes must use the documented shape.
alter table public.products add constraint products_options_shape
  check (private.valid_product_options(options)) not valid;
alter table public.products add constraint products_specs_object
  check (jsonb_typeof(specifications) = 'object') not valid;
alter table public.order_items add constraint order_items_options_object
  check (jsonb_typeof(selected_options) = 'object') not valid;
alter table public.products add constraint products_reservation_within_stock
  check (reserved_quantity <= stock_quantity) not valid;
alter table public.products add constraint products_finite_price
  check (price <> 'NaN'::numeric and (compare_at_price is null or compare_at_price <> 'NaN'::numeric)) not valid;
alter table public.orders add constraint orders_finite_amounts
  check (subtotal <> 'NaN'::numeric and shipping_fee <> 'NaN'::numeric and total <> 'NaN'::numeric) not valid;
alter table public.payments add constraint payments_finite_amount
  check (amount <> 'NaN'::numeric) not valid;

create function private.validate_selected_options(p_definitions jsonb, p_selected jsonb)
returns void language plpgsql set search_path = '' as $$
declare v_option jsonb; v_key text;
begin
  if not private.valid_product_options(p_definitions) then
    raise exception 'Product options need staff configuration';
  end if;
  if jsonb_typeof(p_selected) is distinct from 'object' then raise exception 'Options must be an object'; end if;
  for v_key in select jsonb_object_keys(p_selected) loop
    if not exists (select 1 from jsonb_array_elements(p_definitions) d where d->>'name' = v_key) then
      raise exception 'Unknown option: %', v_key;
    end if;
  end loop;
  for v_option in select value from jsonb_array_elements(p_definitions) loop
    v_key := v_option->>'name';
    if not (p_selected ? v_key) then
      if coalesce((v_option->>'required')::boolean, true) then raise exception 'Choose an option for %', v_key; end if;
    elsif jsonb_typeof(p_selected->v_key) is distinct from 'string'
      or not ((v_option->'values') @> jsonb_build_array(p_selected->v_key)) then
      raise exception 'Invalid choice for %', v_key;
    end if;
  end loop;
end;
$$;
revoke all on function private.validate_selected_options(jsonb,jsonb) from public, anon, authenticated;

-- Maintain the old named arguments; a new optional region argument supports structured destinations.
drop function public.place_order(text,text,text,text,text,text,text,text,text,text,jsonb,text);
create function public.place_order(
  p_customer_name text, p_email text, p_mobile text, p_address_line text,
  p_city text, p_province text, p_postal_code text, p_country text,
  p_courier text, p_payment_method text, p_items jsonb,
  p_customer_note text default null, p_shipping_region text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_customer_id uuid := auth.uid(); v_order_id uuid; v_item jsonb;
  v_product public.products%rowtype; v_quantity int; v_options jsonb;
  v_subtotal numeric(12,2) := 0;
begin
  if v_customer_id is null then raise exception 'Sign in is required to place an order'; end if;
  if coalesce(btrim(p_customer_name),'') = '' or coalesce(btrim(p_email),'') = ''
    or coalesce(btrim(p_mobile),'') = '' or coalesce(btrim(p_address_line),'') = ''
    or coalesce(btrim(p_city),'') = '' or coalesce(btrim(p_country),'') = '' then
    raise exception 'Name, contact details and delivery address are required';
  end if;
  if p_payment_method is null or p_payment_method not in ('gcash','maribank','paypal','pnb') then
    raise exception 'Unsupported payment method';
  end if;
  if p_courier is null or p_courier not in ('j&t','lalamove','philpost') then raise exception 'Choose a supported courier'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Cart must be an array'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;
  insert into public.orders (customer_id,customer_name,email,mobile,address_line,city,province,
    postal_code,country,courier,payment_method,customer_note,hold_expires_at,shipping_region)
  values (v_customer_id,btrim(p_customer_name),lower(btrim(p_email)),btrim(p_mobile),
    btrim(p_address_line),btrim(p_city),btrim(p_province),btrim(p_postal_code),btrim(p_country),
    p_courier,p_payment_method,p_customer_note,now() + interval '2 hours',p_shipping_region)
  returning id into v_order_id;
  -- Consistent product lock order also handles multiple variant lines of the same product.
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or coalesce(v_item->>'quantity','') !~ '^[0-9]+$' then raise exception 'Invalid cart item'; end if;
    v_quantity := (v_item->>'quantity')::int;
    if v_quantity < 1 or v_quantity > 25 then raise exception 'Invalid item quantity'; end if;
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and is_active for update;
    if not found then raise exception 'A product in this cart is unavailable'; end if;
    if v_product.stock_quantity - v_product.reserved_quantity < v_quantity then
      raise exception 'Not enough stock for %', v_product.name;
    end if;
    v_options := coalesce(v_item->'options','{}'::jsonb);
    perform private.validate_selected_options(v_product.options, v_options);
    update public.products set reserved_quantity = reserved_quantity + v_quantity where id = v_product.id;
    insert into public.order_items (order_id,product_id,product_name,sku,selected_options,quantity,unit_price,shipping_class)
    values (v_order_id,v_product.id,v_product.name,v_product.sku,v_options,v_quantity,v_product.price,v_product.shipping_class);
    v_subtotal := v_subtotal + v_product.price * v_quantity;
  end loop;
  update public.orders set subtotal = v_subtotal,total = v_subtotal where id = v_order_id;
  return v_order_id;
end;
$$;
revoke all on function public.place_order(text,text,text,text,text,text,text,text,text,text,jsonb,text,text) from public, anon;
grant execute on function public.place_order(text,text,text,text,text,text,text,text,text,text,jsonb,text,text) to authenticated;

create function private.guard_order_shipping()
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
      if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Staff must confirm shipping'; end if;
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
revoke all on function private.guard_order_shipping() from public, anon, authenticated;
create trigger guard_order_shipping before insert or update on public.orders
  for each row execute function private.guard_order_shipping();

create function public.admin_confirm_order_shipping(
  p_order_id uuid, p_region text, p_fee numeric, p_quote_note text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Administrator access required'; end if;
  if p_region is null or p_fee is null then raise exception 'Region and shipping fee are required'; end if;
  update public.orders set shipping_region = p_region,shipping_fee = p_fee,
    shipping_quote_note = p_quote_note,shipping_confirmed = true where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
end;
$$;
revoke all on function public.admin_confirm_order_shipping(uuid,text,numeric,text) from public, anon;
grant execute on function public.admin_confirm_order_shipping(uuid,text,numeric,text) to authenticated;

create function public.admin_record_shipping_actual(
  p_order_id uuid, p_actual_fee numeric, p_receipt_reference text,
  p_customer_emailed_at timestamptz default null, p_note text default null,
  p_settled_at timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Administrator access required'; end if;
  if p_actual_fee is null then raise exception 'Actual shipping cost is required'; end if;
  update public.orders set actual_shipping_fee = p_actual_fee,
    shipping_receipt_reference = nullif(btrim(p_receipt_reference),''),
    shipping_customer_emailed_at = p_customer_emailed_at, shipping_adjustment_note = p_note,
    shipping_adjustment_settled_at = p_settled_at where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
end;
$$;
revoke all on function public.admin_record_shipping_actual(uuid,numeric,text,timestamptz,text,timestamptz) from public, anon;
grant execute on function public.admin_record_shipping_actual(uuid,numeric,text,timestamptz,text,timestamptz) to authenticated;

-- Never derive paid status from an admin dropdown or customer proof upload alone.
create function private.guard_order_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status in ('cancelled','delivered') then raise exception 'A closed order cannot be reopened'; end if;
  if new.status in ('payment_confirmed','processing','ready_to_ship','shipped','in_transit','delivered') then
    if not exists (select 1 from public.payments p where p.order_id = new.id and p.status = 'approved'
      and p.reviewed_at is not null and p.amount = new.total and p.method = new.payment_method) then
      raise exception 'Staff must approve payment before fulfillment';
    end if;
  elsif new.status = 'payment_verification' then
    if old.status <> 'pending_payment' or not exists (
      select 1 from public.payments p where p.order_id = new.id and p.status = 'pending'
    ) then raise exception 'Payment proof must be submitted before review'; end if;
  elsif new.status = 'payment_rejected' then
    if old.status <> 'payment_verification' or not exists (
      select 1 from public.payments p where p.order_id = new.id and p.status = 'rejected'
    ) or exists (select 1 from public.payments p where p.order_id = new.id and p.status in ('pending','approved')) then
      raise exception 'Staff must reject the pending payment first';
    end if;
  elsif new.status = 'pending_payment' then
    -- Only the security-definer resubmission flow may reacquire stock and reopen a rejection.
    if old.status <> 'payment_rejected' or current_user in ('authenticated','anon') then
      raise exception 'Use the payment proof resubmission flow';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_order_status() from public, anon, authenticated;
create trigger guard_order_status before update of status on public.orders
  for each row execute function private.guard_order_status();

create or replace function private.release_order_reservation()
returns trigger language plpgsql set search_path = '' as $$
declare v_item record;
begin
  -- Paid orders already consumed their reservation; cancellation must not release another order's hold.
  if new.status in ('payment_rejected','cancelled') and old.status in ('pending_payment','payment_verification') then
    for v_item in select product_id, sum(quantity)::int quantity from public.order_items
      where order_id = new.id group by product_id order by product_id loop
      update public.products set reserved_quantity = greatest(0,reserved_quantity-v_item.quantity) where id = v_item.product_id;
    end loop;
  end if;
  return new;
end;
$$;

create or replace function private.protect_paid_order_total()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.subtotal is distinct from old.subtotal or new.shipping_fee is distinct from old.shipping_fee
    or new.total is distinct from old.total) and exists (select 1 from public.payments where order_id = new.id) then
    raise exception 'Shipping and total cannot change after payment proof has been submitted';
  end if;
  new.total := new.subtotal + new.shipping_fee;
  return new;
end;
$$;

create or replace function public.submit_payment_proof(p_order_id uuid, p_proof_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_payment_id uuid; v_item record; v_product public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select * into v_order from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status not in ('pending_payment','payment_rejected') then raise exception 'Payment can no longer be submitted for this order'; end if;
  if not v_order.shipping_confirmed then raise exception 'Wait for the shop to confirm your shipping fee before paying'; end if;
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

create or replace function public.admin_review_payment(p_payment_id uuid, p_approved boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype; v_item record; v_order_id uuid;
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Administrator access required'; end if;
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

commit;
