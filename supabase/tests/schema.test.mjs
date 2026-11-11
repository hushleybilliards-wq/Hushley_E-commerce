// Offline PostgreSQL regression tests. Auth/Storage helpers are minimal test doubles.
// Uses PGlite, never reads .env and never connects to a Supabase project.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.HUSHLEY_TEST_DEPENDENCIES
  ? resolve(process.env.HUSHLEY_TEST_DEPENDENCIES, 'package.json') : import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const db = new PGlite({ extensions: { pgcrypto } });
let checks = 0;
const query = (sql, params = []) => db.query(sql, params);
const value = async (sql, params = []) => Object.values((await query(sql, params)).rows[0])[0];
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
async function fails(sql, params = [], pattern = /./) {
  await assert.rejects(query(sql, params), pattern); checks++;
}
const customer = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const admin = '10000000-0000-0000-0000-000000000003';
async function asUser(id, isAdmin = false) {
  await db.exec('reset role');
  await query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, app_metadata: { role: isAdmin ? 'admin' : 'customer' } })]);
  await db.exec('set role authenticated');
}
const migrations = resolve(fileURLToPath(new URL('../migrations/', import.meta.url)));
try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
  `);
  for (const name of ['20261108031340_hushley_commerce_auth.sql','20261109105526_hushley_shipping_options_payment_guards.sql']) {
    await db.exec(await readFile(resolve(migrations, name), 'utf8'));
  }
  await query('insert into auth.users(id) values ($1),($2),($3)', [customer, other, admin]);
  const products = {};
  for (const [key, category, options] of [
    ['small_items', 'tips', [{name:'Hardness',values:['Soft','Medium','Hard']}]],
    ['cue', 'cues', []], ['ball_set', 'balls', []],
  ]) {
    products[key] = await value(`insert into public.products(category_id,slug,name,price,stock_quantity,is_active,options,shipping_class)
      values ($1,$2,$2,100,200,true,$3,$2) returning id`, [category,key,JSON.stringify(options)]);
  }
  async function place({ courier = 'j&t', region = 'Luzon', country = 'Philippines', items, method = 'gcash' } = {}) {
    return value(`select public.place_order('Test','test@example.invalid','123','Street','City','Province','1000',
      $1,$2,$3,$4::jsonb,null,$5)`, [country,courier,method,JSON.stringify(items ?? [{product_id:products.cue,quantity:1,options:{}}]),region]);
  }
  const confirm = (id,region,fee,note = 'Staff reviewed item combination and parcel basis') => query(
    'select public.admin_confirm_order_shipping($1,$2,$3,$4)', [id,region,fee,note]);
  async function upload(path) {
    await query("insert into storage.objects(bucket_id,name) values ('payment-proofs',$1)",[path]);
  }
  await asUser(customer);
  equal(await value('select count(*)::int from public.shipping_rates'), 12);
  equal(await value("select has_table_privilege('authenticated','public.orders','TRUNCATE')"), false);
  equal(await value("select has_table_privilege('anon','public.products','TRUNCATE')"), false);
  equal((await query('update public.shipping_rates set amount = 1 returning id')).rows.length,0);
  // RLS UPDATE silently affects zero rows, so verify actual data stayed unchanged.
  equal(await value("select amount::text from public.shipping_rates where id='jnt_luzon_cue'"),'300.00');
  await assert.rejects(place({items:[{product_id:products.small_items,quantity:1}]}), /Choose an option/); checks++;
  await assert.rejects(place({items:[{product_id:products.small_items,quantity:1,options:{Hardness:'Unknown'}}]}), /Invalid choice/); checks++;
  await assert.rejects(place({items:[{product_id:products.cue,quantity:1,options:{Color:'Red'}}]}), /Unknown option/); checks++;
  await assert.rejects(place({items:[{product_id:products.cue,quantity:1,options:null}]}), /Options must/); checks++;
  await assert.rejects(place({items:[]}), /Cart is empty/); checks++;
  await assert.rejects(place({items:[{product_id:products.cue,quantity:0}]}), /quantity/); checks++;
  await assert.rejects(place({method:'cash'}), /Unsupported payment/); checks++;
  for (const region of ['Luzon','Visayas','Mindanao']) {
    for (const key of ['small_items','cue','ball_set']) {
      await asUser(customer);
      const opts = key === 'small_items' ? {Hardness:'Soft'} : {};
      const id = await place({region,items:[{product_id:products[key],quantity:1,options:opts}]});
      equal(await value('select selected_options from public.order_items where order_id=$1',[id]),opts);
      await asUser(admin,true);
      const fee = key === 'cue' ? 300 : key === 'ball_set' ? 500 : region === 'Luzon' ? 75 : 100;
      await assert.rejects(confirm(id,region,fee+1), /configured class rate/); checks++;
      await confirm(id,region,fee);
      equal(await value('select total::text from public.orders where id=$1',[id]),`${100+fee}.00`);
      equal(await value('select shipping_pricing_kind from public.orders where id=$1',[id]),'fixed');
    }
  }
  await asUser(customer);
  const order = await place();
  await fails('select public.admin_confirm_order_shipping($1,$2,$3,$4)',[order,'Luzon',300,'Customer attempted quote'],/Administrator/);
  await fails('update public.payments set status=\'approved\'',[],/permission denied/);
  await fails('update public.order_items set unit_price=0',[],/permission denied/);
  await fails('insert into public.orders default values',[],/permission denied/);
  await fails('truncate public.orders cascade',[],/permission denied/);
  await asUser(other);
  equal(await value('select count(*)::int from public.orders where id=$1',[order]),0);
  equal(await value('select count(*)::int from public.order_items where order_id=$1',[order]),0);
  await fails('select public.submit_payment_proof($1,$2)',[order,`${other}/proof.pdf`],/Order not found/);
  await asUser(admin,true);
  await fails("update public.orders set status='processing' where id=$1",[order],/approve payment/);
  await assert.rejects(confirm(order,'Luzon',300,''), /quote basis/); checks++;
  await confirm(order,'Luzon',300);
  await asUser(customer);
  await fails('select public.submit_payment_proof($1,null)',[order],/Upload a valid/);
  await fails('select public.submit_payment_proof($1,$2)',[order,`${customer}/missing.pdf`],/Upload a valid/);
  await upload(`${customer}/first.pdf`);
  const payment = await value('select public.submit_payment_proof($1,$2)',[order,`${customer}/first.pdf`]);
  equal(await value('select status from public.orders where id=$1',[order]),'payment_verification');
  await fails('select public.admin_review_payment($1,true)',[payment],/Administrator/);
  await asUser(admin,true);
  await fails('update public.orders set shipping_fee=350 where id=$1',[order],/cannot change/);
  await fails('select public.admin_review_payment($1,null)',[payment],/explicitly/);
  await query('select public.admin_review_payment($1,false)',[payment]);
  equal(await value('select status from public.orders where id=$1',[order]),'payment_rejected');
  await fails("update public.orders set status='pending_payment' where id=$1",[order],/resubmission/);
  await asUser(customer);
  const second = await value('select public.submit_payment_proof($1,$2)',[order,`${customer}/first.pdf`]);
  await asUser(admin,true);
  await query('select public.admin_review_payment($1,true)',[second]);
  equal(await value('select status from public.orders where id=$1',[order]),'payment_confirmed');
  await fails('select public.admin_review_payment($1,true)',[second],/not awaiting/);
  const reserved = await value('select reserved_quantity from public.products where id=$1',[products.cue]);
  await query("update public.orders set status='cancelled' where id=$1",[order]);
  equal(await value('select reserved_quantity from public.products where id=$1',[products.cue]),reserved);
  await fails("update public.orders set status='processing' where id=$1",[order],/closed order/);
  await asUser(customer);
  const local = await place({courier:'lalamove'});
  await assert.rejects(place({courier:'lalamove',region:'Visayas'}), /unavailable/); checks++;
  await asUser(admin,true);
  await assert.rejects(confirm(local,'Luzon',20), /website shipping must be zero/); checks++;
  await confirm(local,'Luzon',0);
  equal(await value('select shipping_pricing_kind from public.orders where id=$1',[local]),'pay_rider');
  await asUser(customer);
  const international = await place({courier:'philpost',region:'Outside Asia',country:'Canada'});
  await assert.rejects(place({courier:'philpost',region:'Asia'}), /outside the Philippines/); checks++;
  await asUser(admin,true);
  await confirm(international,'Outside Asia',4100,'Staff confirmed one parcel for this order; country zone reviewed');
  equal(await value('select estimated_shipping_fee::text from public.orders where id=$1',[international]),'4100.00');
  await asUser(customer);
  await value('select public.submit_payment_proof($1,$2)',[international,`${customer}/first.pdf`]);
  await fails('select public.admin_record_shipping_actual($1,4000,$2)',[international,'private/receipt'],/Administrator/);
  await asUser(admin,true);
  await fails('select public.admin_record_shipping_actual($1,4000,null)',[international],/receipt reference/);
  await query('select public.admin_record_shipping_actual($1,4000,$2)',[international,'private/receipt']);
  equal(await value('select shipping_adjustment_amount::text from public.orders where id=$1',[international]),'-100.00');
  equal(await value('select total::text from public.orders where id=$1',[international]),'4200.00');
  await query("select public.admin_record_shipping_actual($1,4300,'private/receipt',now(),'Staff recorded external balance payment',now())",[international]);
  equal(await value('select shipping_adjustment_amount::text from public.orders where id=$1',[international]),'200.00');
  equal(await value('select total::text from public.orders where id=$1',[international]),'4200.00');
  await asUser(other);
  equal(await value('select count(*)::int from public.payments'),0);
  // An unquoted, unpaid legacy order can use the newly confirmed product-first flow.
  await asUser(customer);
  const legacyUnquoted = await place();
  // Preserve established legacy terms while enabling product-only payment for new orders.
  await db.exec('reset role');
  await db.exec(await readFile(resolve(migrations, '20261111165241_product_payment_separate_shipping.sql'), 'utf8'));
  equal(await value('select payment_scope from public.orders where id=$1', [international]), 'order_total');
  equal(await value('select payment_scope from public.orders where id=$1', [legacyUnquoted]), 'products_only');
  await asUser(customer);
  const productFirst = await place();
  equal(await value('select payment_scope from public.orders where id=$1', [productFirst]), 'products_only');
  const proofPath = `${customer}/new-product-proof.png`;
  await upload(proofPath);
  const paymentId = await value('select public.submit_payment_proof($1,$2)', [productFirst, proofPath]);
  equal(await value('select amount::text from public.payments where id=$1', [paymentId]), '100.00');
  await fails('select public.admin_record_separate_shipping($1,300,$2)', [productFirst,'one cue'], /Administrator/);
  await asUser(admin,true);
  await fails('select public.admin_record_separate_shipping($1,300,$2)', [productFirst,'one cue'], /Approve product payment/);
  await query('select public.admin_review_payment($1,true)', [paymentId]);
  await fails('select public.admin_review_payment($1,true)', [paymentId], /not awaiting|Pending payment/);
  await fails('select public.admin_record_separate_shipping($1,301,$2)', [productFirst,'one cue'], /configured rate/);
  await query('select public.admin_record_separate_shipping($1,300,$2)', [productFirst,'one cue to Luzon']);
  equal(await value('select total::text from public.orders where id=$1', [productFirst]), '100.00');
  equal(await value('select separate_shipping_quote::text from public.orders where id=$1', [productFirst]), '300.00');
  await fails('select public.admin_confirm_order_shipping($1,$2,$3,$4)', [productFirst,'Luzon',300,'one cue'], /Shipping is recorded separately|cannot change/);
  await asUser(customer);
  const internationalFirst = await place({courier:'philpost',region:'Outside Asia',country:'Canada'});
  const internationalProof = `${customer}/international-product-proof.png`;
  await upload(internationalProof);
  const internationalPayment = await value('select public.submit_payment_proof($1,$2)', [internationalFirst, internationalProof]);
  await asUser(admin,true);
  await query('select public.admin_review_payment($1,true)', [internationalPayment]);
  await query("select public.admin_record_separate_shipping($1,4100,'one parcel',4000,'receipt',now(),'refund arranged',now())", [internationalFirst]);
  equal(await value('select separate_shipping_adjustment::text from public.orders where id=$1', [internationalFirst]), '-100.00');
  equal(await value('select total::text from public.orders where id=$1', [internationalFirst]), '100.00');
  await fails("select public.admin_record_separate_shipping($1,4200,'one parcel',4000,'receipt')", [internationalFirst], /original estimate/);
  await asUser(customer);
  const riderOrder = await place({courier:'lalamove'});
  const riderProof = `${customer}/rider-product-proof.png`;
  await upload(riderProof);
  const riderPayment = await value('select public.submit_payment_proof($1,$2)', [riderOrder, riderProof]);
  await asUser(admin,true);
  await query('select public.admin_review_payment($1,true)', [riderPayment]);
  await fails("select public.admin_record_separate_shipping($1,50,'rider')", [riderOrder], /paid to the rider/);
  await query("select public.admin_record_separate_shipping($1,0,'rider paid directly')", [riderOrder]);
  await db.exec('reset role');
  await db.exec(await readFile(resolve(migrations, '20261111173322_admin_order_guard_and_date_reference.sql'), 'utf8'));
  await query("update auth.users set raw_app_meta_data = '{\"role\":\"admin\"}'::jsonb where id = $1", [admin]);
  await asUser(customer);
  const datedOrder = await place();
  assert.match(await value('select order_number from public.orders where id=$1', [datedOrder]), /^HUS-\d{8}-[0-9A-F]{12}$/); checks++;
  await fails('select * from public.admin_customer_profiles()', [], /Administrator/);
  await asUser(admin,true);
  await assert.rejects(place(), /Administrator accounts cannot place customer orders/); checks++;
  equal(await value('select count(*)::int from public.admin_customer_profiles() where id=$1', [admin]), 0);
  equal(await value('select count(*)::int from public.admin_customer_profiles() where id=$1', [customer]), 1);
  await db.exec('reset role');
  await db.exec(await readFile(resolve(migrations, '20261111173648_admin_order_guard_live_role.sql'), 'utf8'));
  await asUser(admin,false);
  await assert.rejects(place(), /Administrator accounts cannot place customer orders/); checks++;
  await asUser(customer);
  await place(); checks++;
  await db.exec('reset role');
  await db.exec(await readFile(resolve(migrations, '20261111184421_customer_unpaid_order_cancellation.sql'), 'utf8'));
  await asUser(other);
  await fails('select public.customer_cancel_order($1,$2)', [datedOrder, 'Changed my mind'], /Order not found/);
  await asUser(customer);
  await fails('select public.customer_cancel_order($1,$2)', [datedOrder, 'Invalid reason'], /Choose a cancellation reason/);
  const reservedBefore = await value('select reserved_quantity from public.products where id=$1', [products.cue]);
  await query('select public.customer_cancel_order($1,$2)', [datedOrder, 'Changed my mind']);
  equal(await value('select status from public.orders where id=$1', [datedOrder]), 'cancelled');
  equal(await value('select customer_cancel_reason from public.orders where id=$1', [datedOrder]), 'Changed my mind');
  equal(await value('select reserved_quantity from public.products where id=$1', [products.cue]), reservedBefore - 1);
  await fails('select public.customer_cancel_order($1,$2)', [datedOrder, 'Other'], /no longer be cancelled/);
  await fails('select public.customer_cancel_order($1,$2)', [productFirst, 'Other'], /no longer be cancelled/);
  const proofOrder = await place();
  const cancellationProof = `${customer}/proof-before-cancel.png`;
  await upload(cancellationProof);
  await query('select public.submit_payment_proof($1,$2)', [proofOrder, cancellationProof]);
  await fails('select public.customer_cancel_order($1,$2)', [proofOrder, 'Other'], /no longer be cancelled/);
  await asUser(admin,true);
  const pendingProofId = await value('select id from public.payments where order_id=$1', [proofOrder]);
  await query('select public.admin_review_payment($1,false)', [pendingProofId]);
  await asUser(customer);
  await fails('select public.customer_cancel_order($1,$2)', [proofOrder, 'Other'], /no longer be cancelled/);
  await db.exec('reset role; set role anon');
  await fails('select public.customer_cancel_order($1,$2)', [datedOrder, 'Other'], /permission denied/);
  equal(await value('select count(*)::int from public.shipping_rates'),12);
  await fails('select public.admin_review_payment($1,true)',[second],/permission denied/);
  await fails('select * from public.orders',[],/permission denied/);
  await db.exec('reset role');
  await db.exec(await readFile(resolve(migrations, '20261111192722_gmail_signup_restriction.sql'), 'utf8'));
  equal(await value("select has_function_privilege('anon','public.hushley_gmail_signup_hook(jsonb)','execute')"), false);
  equal(await value("select has_function_privilege('authenticated','public.hushley_gmail_signup_hook(jsonb)','execute')"), false);
  equal(await value("select has_function_privilege('supabase_auth_admin','public.hushley_gmail_signup_hook(jsonb)','execute')"), true);
  await db.exec('set role supabase_auth_admin');
  equal(await value("select public.hushley_gmail_signup_hook('{\"user\":{\"email\":\"Player12@GMAIL.COM\"}}')"), {});
  for (const email of ['person+1@gmail.com', 'person@yahoo.com', 'person@gmail.com.evil.com', '']) {
    equal(await value("select public.hushley_gmail_signup_hook(jsonb_build_object('user',jsonb_build_object('email',$1::text)))->'error'->>'http_code'", [email]), '403');
  }
  await db.exec('reset role');
  await db.exec(await readFile(resolve(migrations, '20261111193342_unique_customer_contact_phone.sql'), 'utf8'));
  await query('update public.profiles set phone=$1 where id=$2', ['+639171234567', customer]);
  await fails('update public.profiles set phone=$1 where id=$2', ['09171234567', other], /profiles_unique_ph_contact_phone_idx/);
  await query('update public.profiles set phone=$1 where id=$2', ['09171234568', other]);
  console.log(`PASS: commerce migrations applied; ${checks} PostgreSQL assertions passed.`);
} finally {
  await db.close();
}
