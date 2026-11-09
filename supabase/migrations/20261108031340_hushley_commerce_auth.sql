create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id text primary key,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.categories (id, name, sort_order) values
  ('cues', 'Billiard Cues', 10),
  ('shafts', 'Carbon Shafts', 20),
  ('chalk', 'Billiard Chalk', 30),
  ('tips', 'Billiard Tips', 40),
  ('ferrules', 'Ferrules', 50),
  ('cases', 'Cue Cases', 60),
  ('grips-leather', 'Cue Grips and Leather', 70),
  ('gloves', 'Billiard Gloves', 80),
  ('accessories', 'Cue Accessories', 90),
  ('other', 'Other Billiard Products', 100)
on conflict (id) do nothing;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id text not null references public.categories(id),
  slug text not null unique,
  name text not null,
  description text not null default '',
  sku text unique,
  price numeric(12,2) not null check (price >= 0),
  compare_at_price numeric(12,2) check (compare_at_price is null or compare_at_price >= price),
  stock_quantity int not null default 0 check (stock_quantity >= 0),
  reserved_quantity int not null default 0 check (reserved_quantity >= 0),
  low_stock_threshold int not null default 5 check (low_stock_threshold >= 0),
  weight_grams int check (weight_grams is null or weight_grams >= 0),
  specifications jsonb not null default '{}'::jsonb,
  options jsonb not null default '[]'::jsonb,
  image_urls text[] not null default '{}',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_active_idx on public.products(category_id, is_active);
create index products_stock_idx on public.products(stock_quantity, reserved_quantity);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('HUS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  customer_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  email text not null,
  mobile text not null,
  address_line text not null,
  city text not null,
  province text not null,
  postal_code text not null,
  country text not null default 'Philippines',
  courier text,
  payment_method text not null check (payment_method in ('gcash','maribank','paypal','pnb')),
  status text not null default 'pending_payment' check (status in ('pending_payment','payment_verification','payment_confirmed','processing','ready_to_ship','shipped','in_transit','delivered','cancelled','payment_rejected')),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  shipping_fee numeric(12,2) not null default 0 check (shipping_fee >= 0),
  shipping_confirmed boolean not null default false,
  total numeric(12,2) not null default 0 check (total >= 0),
  tracking_number text,
  customer_note text,
  hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index orders_status_created_idx on public.orders(status, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text,
  selected_options jsonb not null default '{}'::jsonb,
  quantity int not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items(order_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method text not null check (method in ('gcash','maribank','paypal','pnb')),
  amount numeric(12,2) not null check (amount >= 0),
  proof_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index payments_status_created_idx on public.payments(status, created_at desc);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  quantity_delta int not null check (quantity_delta <> 0),
  reason text not null,
  note text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function private.is_hushley_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt()->'app_metadata'->>'role', '') = 'admin';
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.is_hushley_admin() from public, anon;
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_hushley_admin() to authenticated;

create trigger auth_user_profile_created
after insert on auth.users
for each row execute function private.handle_new_user();

create trigger profiles_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger products_updated_at before update on public.products
for each row execute function private.set_updated_at();
create trigger orders_updated_at before update on public.orders
for each row execute function private.set_updated_at();

create or replace function private.release_order_reservation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
begin
  if new.status in ('payment_rejected', 'cancelled') and old.status not in ('payment_rejected', 'cancelled', 'delivered') then
    for v_item in select product_id, quantity from public.order_items where order_id = new.id loop
      update public.products set reserved_quantity = greatest(0, reserved_quantity - v_item.quantity) where id = v_item.product_id;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.release_order_reservation() from public, anon, authenticated;
create trigger release_order_reservation_after_status_change
after update of status on public.orders
for each row execute function private.release_order_reservation();

create or replace function private.protect_paid_order_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.shipping_fee is distinct from old.shipping_fee or new.total is distinct from old.total)
    and exists (select 1 from public.payments where order_id = new.id) then
    raise exception 'Shipping and total cannot change after payment proof has been submitted';
  end if;
  if new.subtotal is distinct from old.subtotal or new.shipping_fee is distinct from old.shipping_fee then
    new.total := new.subtotal + new.shipping_fee;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_paid_order_total() from public, anon, authenticated;
create trigger protect_paid_order_total_before_update
before update on public.orders
for each row execute function private.protect_paid_order_total();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_transactions enable row level security;

grant select on public.categories, public.products to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.orders, public.order_items to authenticated;
grant select on public.payments to authenticated;
grant select on public.inventory_transactions to authenticated;
grant all on public.categories, public.products, public.orders, public.order_items, public.payments, public.inventory_transactions to authenticated;

create policy "Anyone can read active categories" on public.categories
for select to anon, authenticated using (is_active);
create policy "Admins manage categories" on public.categories
for all to authenticated using ((select private.is_hushley_admin())) with check ((select private.is_hushley_admin()));

create policy "Anyone can read active products" on public.products
for select to anon, authenticated using (is_active);
create policy "Admins manage products" on public.products
for all to authenticated using ((select private.is_hushley_admin())) with check ((select private.is_hushley_admin()));

create policy "Customers read own profile" on public.profiles
for select to authenticated using (id = (select auth.uid()) or (select private.is_hushley_admin()));
create policy "Customers update own contact info" on public.profiles
for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Customers read own orders and admins read all" on public.orders
for select to authenticated using (customer_id = (select auth.uid()) or (select private.is_hushley_admin()));
create policy "Customers create own orders" on public.orders
for insert to authenticated with check (customer_id = (select auth.uid()));
create policy "Admins update orders" on public.orders
for update to authenticated using ((select private.is_hushley_admin())) with check ((select private.is_hushley_admin()));

create policy "Customers read own order items and admins read all" on public.order_items
for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or (select private.is_hushley_admin())))
);
create policy "Customers add items to own orders" on public.order_items
for insert to authenticated with check ((select private.is_hushley_admin()));
create policy "Admins manage order items" on public.order_items
for all to authenticated using ((select private.is_hushley_admin())) with check ((select private.is_hushley_admin()));

create policy "Customers read own payments and admins read all" on public.payments
for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or (select private.is_hushley_admin())))
);
create policy "Customers create own payment records" on public.payments
for insert to authenticated with check (
  exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()))
);
create policy "Admins manage payments" on public.payments
for all to authenticated using ((select private.is_hushley_admin())) with check ((select private.is_hushley_admin()));

create policy "Admins read inventory history" on public.inventory_transactions
for select to authenticated using ((select private.is_hushley_admin()));
create policy "Admins create inventory history" on public.inventory_transactions
for insert to authenticated with check ((select private.is_hushley_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "Public can read product images" on storage.objects
for select to anon, authenticated using (bucket_id = 'product-images');
create policy "Admins manage product images" on storage.objects
for all to authenticated using (bucket_id = 'product-images' and (select private.is_hushley_admin()))
with check (bucket_id = 'product-images' and (select private.is_hushley_admin()));
create policy "Customers upload own payment proofs" on storage.objects
for insert to authenticated with check (
  bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "Customers and admins read payment proofs" on storage.objects
for select to authenticated using (
  bucket_id = 'payment-proofs' and (
    (storage.foldername(name))[1] = (select auth.uid())::text or
    (select private.is_hushley_admin())
  )
);
create policy "Admins manage payment proofs" on storage.objects
for delete to authenticated using (bucket_id = 'payment-proofs' and (select private.is_hushley_admin()));

-- Orders and payment records are written through transactional RPCs so prices and stock holds
-- are calculated from server-side catalog data rather than trusted from the browser.
revoke insert on public.orders, public.order_items, public.payments from authenticated;

create or replace function public.place_order(
  p_customer_name text,
  p_email text,
  p_mobile text,
  p_address_line text,
  p_city text,
  p_province text,
  p_postal_code text,
  p_country text,
  p_courier text,
  p_payment_method text,
  p_items jsonb,
  p_customer_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_order_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity int;
  v_subtotal numeric(12,2) := 0;
begin
  if v_customer_id is null then raise exception 'Sign in is required to place an order'; end if;
  if coalesce(trim(p_customer_name), '') = '' or coalesce(trim(p_email), '') = '' or coalesce(trim(p_mobile), '') = '' then
    raise exception 'Name, email and mobile number are required';
  end if;
  if p_payment_method not in ('gcash','maribank','paypal','pnb') then raise exception 'Unsupported payment method'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;

  insert into public.orders (
    customer_id, customer_name, email, mobile, address_line, city, province, postal_code,
    country, courier, payment_method, customer_note, hold_expires_at
  ) values (
    v_customer_id, trim(p_customer_name), lower(trim(p_email)), trim(p_mobile), trim(p_address_line),
    trim(p_city), trim(p_province), trim(p_postal_code), coalesce(nullif(trim(p_country), ''), 'Philippines'),
    nullif(trim(p_courier), ''), p_payment_method, p_customer_note, now() + interval '2 hours'
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::int;
    if v_quantity < 1 or v_quantity > 25 then raise exception 'Invalid item quantity'; end if;
    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and is_active = true
      for update;
    if not found then raise exception 'A product in this cart is unavailable'; end if;
    if v_product.stock_quantity - v_product.reserved_quantity < v_quantity then
      raise exception 'Not enough stock for %', v_product.name;
    end if;
    update public.products set reserved_quantity = reserved_quantity + v_quantity where id = v_product.id;
    insert into public.order_items (order_id, product_id, product_name, sku, selected_options, quantity, unit_price)
    values (v_order_id, v_product.id, v_product.name, v_product.sku, coalesce(v_item->'options', '{}'::jsonb), v_quantity, v_product.price);
    v_subtotal := v_subtotal + v_product.price * v_quantity;
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal + shipping_fee where id = v_order_id;
  return v_order_id;
end;
$$;
revoke all on function public.place_order(text,text,text,text,text,text,text,text,text,text,jsonb,text) from public, anon;
grant execute on function public.place_order(text,text,text,text,text,text,text,text,text,text,jsonb,text) to authenticated;

create or replace function public.submit_payment_proof(p_order_id uuid, p_proof_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_payment_id uuid;
  v_item record;
  v_product public.products%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status not in ('pending_payment','payment_rejected') then raise exception 'Payment can no longer be submitted for this order'; end if;
  if not v_order.shipping_confirmed then raise exception 'Wait for the shop to confirm your shipping fee before paying'; end if;
  if split_part(p_proof_path, '/', 1) <> auth.uid()::text then raise exception 'Invalid proof file path'; end if;
  if v_order.status = 'pending_payment' and v_order.hold_expires_at < now() then raise exception 'The payment hold has expired'; end if;
  if v_order.status = 'payment_rejected' then
    for v_item in select product_id, quantity from public.order_items where order_id = p_order_id loop
      select * into v_product from public.products where id = v_item.product_id and is_active = true for update;
      if not found or v_product.stock_quantity - v_product.reserved_quantity < v_item.quantity then
        raise exception 'A product in this order is no longer available';
      end if;
      update public.products set reserved_quantity = reserved_quantity + v_item.quantity where id = v_product.id;
    end loop;
    update public.orders set status = 'pending_payment', hold_expires_at = now() + interval '2 hours' where id = p_order_id;
  end if;
  insert into public.payments (order_id, method, amount, proof_path)
  values (p_order_id, v_order.payment_method, v_order.total, p_proof_path) returning id into v_payment_id;
  update public.orders set status = 'payment_verification' where id = p_order_id;
  return v_payment_id;
end;
$$;
revoke all on function public.submit_payment_proof(uuid,text) from public, anon;
grant execute on function public.submit_payment_proof(uuid,text) to authenticated;

create or replace function public.admin_review_payment(p_payment_id uuid, p_approved boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_item record;
begin
  if not private.is_hushley_admin() then raise exception 'Administrator access required'; end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status <> 'pending' then raise exception 'Pending payment not found'; end if;
  if not exists (select 1 from public.orders where id = v_payment.order_id and status = 'payment_verification') then
    raise exception 'This order is not awaiting payment review';
  end if;

  if p_approved then
    for v_item in
      select product_id, quantity from public.order_items where order_id = v_payment.order_id
    loop
      update public.products
        set stock_quantity = stock_quantity - v_item.quantity,
            reserved_quantity = greatest(0, reserved_quantity - v_item.quantity)
        where id = v_item.product_id and stock_quantity >= v_item.quantity;
      if not found then raise exception 'Stock changed before payment approval'; end if;
      insert into public.inventory_transactions (product_id, order_id, quantity_delta, reason, actor_id)
      values (v_item.product_id, v_payment.order_id, -v_item.quantity, 'payment_confirmed', auth.uid());
    end loop;
    update public.payments set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note where id = p_payment_id;
    update public.orders set status = 'payment_confirmed' where id = v_payment.order_id;
  else
    update public.payments set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note where id = p_payment_id;
    update public.orders set status = 'payment_rejected' where id = v_payment.order_id;
  end if;
end;
$$;
revoke all on function public.admin_review_payment(uuid,boolean,text) from public, anon;
grant execute on function public.admin_review_payment(uuid,boolean,text) to authenticated;

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
  if not private.is_hushley_admin() then raise exception 'Administrator access required'; end if;
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
revoke all on function public.admin_set_product_stock(uuid,int,text) from public, anon;
grant execute on function public.admin_set_product_stock(uuid,int,text) to authenticated;
