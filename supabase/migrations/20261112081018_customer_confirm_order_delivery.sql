begin;

-- Only the owner may confirm receipt after staff have marked the order shipped.
-- Lock the order so concurrent status changes cannot bypass the check.
create function public.customer_confirm_order_delivery(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select * into v_order from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status not in ('shipped', 'in_transit') then
    raise exception 'Only shipped orders can be confirmed as received';
  end if;
  update public.orders set status = 'delivered' where id = v_order.id;
end;
$$;
revoke all on function public.customer_confirm_order_delivery(uuid) from public, anon;
grant execute on function public.customer_confirm_order_delivery(uuid) to authenticated;

commit;
