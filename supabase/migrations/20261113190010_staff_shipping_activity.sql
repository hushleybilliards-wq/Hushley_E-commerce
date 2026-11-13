-- Record staff shipping changes in the same transaction as the order update.
begin;

create function private.log_staff_shipping_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_detail text := '';
begin
  select display_name into v_name from private.staff_accounts
    where user_id = auth.uid() and active;
  if v_name is null then return new; end if;

  if new.separate_shipping_quote is distinct from old.separate_shipping_quote then
    v_detail := format('Shipping fee: %s → %s',
      coalesce('₱' || old.separate_shipping_quote::text, 'not set'),
      coalesce('₱' || new.separate_shipping_quote::text, 'not set'));
  elsif new.shipping_fee is distinct from old.shipping_fee
    or (new.shipping_confirmed and not old.shipping_confirmed) then
    v_detail := format('Shipping fee: %s → ₱%s',
      case when old.shipping_confirmed then '₱' || old.shipping_fee::text else 'not set' end,
      new.shipping_fee::text);
  end if;

  if new.separate_shipping_actual is distinct from old.separate_shipping_actual then
    v_detail := concat_ws(' · ', nullif(v_detail, ''), format('Actual cost: %s → %s',
      coalesce('₱' || old.separate_shipping_actual::text, 'not set'),
      coalesce('₱' || new.separate_shipping_actual::text, 'not set')));
  elsif new.actual_shipping_fee is distinct from old.actual_shipping_fee then
    v_detail := concat_ws(' · ', nullif(v_detail, ''), format('Actual cost: %s → %s',
      coalesce('₱' || old.actual_shipping_fee::text, 'not set'),
      coalesce('₱' || new.actual_shipping_fee::text, 'not set')));
  end if;

  if v_detail <> '' then
    insert into private.staff_activity(actor_id, actor_name, action, subject, detail)
    values (auth.uid(), v_name, 'Shipping fee updated', new.order_number, v_detail);
  end if;
  return new;
end; $$;

revoke all on function private.log_staff_shipping_change() from public, anon, authenticated;
create trigger log_staff_shipping_change after update on public.orders
  for each row execute function private.log_staff_shipping_change();

commit;
