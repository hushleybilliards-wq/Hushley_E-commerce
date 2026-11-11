begin;

alter table public.orders
  add column customer_cancel_reason text
    check (customer_cancel_reason is null or customer_cancel_reason in ('Changed my mind','Ordered the wrong item','Duplicate order','Other')),
  add column customer_cancelled_at timestamptz;

-- Customers cannot update orders directly. The order lock serializes this action
-- with proof submission and staff review, and the existing trigger releases stock.
create function public.customer_cancel_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if p_reason is null or p_reason not in ('Changed my mind','Ordered the wrong item','Duplicate order','Other') then
    raise exception 'Choose a cancellation reason';
  end if;
  select * into v_order from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'pending_payment' then raise exception 'This order can no longer be cancelled here'; end if;
  if exists (select 1 from public.payments where order_id = v_order.id) then
    raise exception 'Contact the shop to discuss cancellation after submitting payment proof';
  end if;
  update public.orders set status = 'cancelled', customer_cancel_reason = p_reason, customer_cancelled_at = now()
    where id = v_order.id;
end;
$$;
revoke all on function public.customer_cancel_order(uuid,text) from public, anon;
grant execute on function public.customer_cancel_order(uuid,text) to authenticated;

commit;
