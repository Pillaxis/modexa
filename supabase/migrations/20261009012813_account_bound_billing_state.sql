create or replace function public.modexa_billing_state() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('user_id',auth.uid(),
    'used',(select count(*) from public.models where user_id=auth.uid()),
    'subscription',(select to_jsonb(s) from public.subscriptions s where user_id=auth.uid()));
$$;
revoke all on function public.modexa_billing_state() from public,anon;
grant execute on function public.modexa_billing_state() to authenticated;
