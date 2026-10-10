begin;
alter table public.subscriptions add column pro_until timestamptz, add column business_until timestamptz;
update public.subscriptions set pro_until=current_period_end where status='active';
alter table public.payments drop constraint payments_amount_check;
alter table public.payments add column plan text not null default 'pro' check(plan in ('pro','business')),
  add column months integer not null default 1 check(months in (1,3,12)),
  add column checkout_url text, add column checkout_expires_at timestamptz;
alter table public.payments add constraint payments_offer_amount check(amount=(case plan when 'pro' then 7000 else 15000 end)*months*(case months when 3 then 90 when 12 then 70 else 100 end)/100);

-- Private counter serializes concurrent inserts on multiple devices. Users cannot edit it.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.modexa_usage(user_id uuid primary key references auth.users(id) on delete cascade, used integer not null default 0 check(used>=0));
alter table private.modexa_usage enable row level security;
insert into private.modexa_usage select user_id,count(*) from public.models group by user_id;
create function private.modexa_check_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid; capacity integer:=10; s public.subscriptions%rowtype;
begin
  owner:=case when TG_OP='DELETE' then OLD.user_id else NEW.user_id end;
  if auth.uid() is not null and auth.uid()<>owner then raise exception 'Access denied' using errcode='42501'; end if;
  if TG_OP='DELETE' then update private.modexa_usage set used=greatest(0,used-1) where user_id=owner; return OLD; end if;
  if TG_OP='UPDATE' then
    if NEW.user_id<>OLD.user_id then raise exception 'Owner cannot change' using errcode='42501'; end if;
    return NEW;
  end if;
  select * into s from public.subscriptions where user_id=owner;
  if s.status='active' then
    if s.business_until>now() then capacity:=1000; elsif s.pro_until>now() then capacity:=100; end if;
  end if;
  insert into private.modexa_usage(user_id) values(owner) on conflict do nothing;
  update private.modexa_usage set used=used+1 where user_id=owner and used<capacity;
  if not found then raise exception 'MODEXA_QUOTA_REACHED' using errcode='PT402',detail=capacity::text; end if;
  return NEW;
end $$;
revoke all on function private.modexa_check_capacity() from public,anon,authenticated;
create trigger models_capacity before insert or update of user_id or delete on public.models for each row execute function private.modexa_check_capacity();

-- Ownership comes from the JWT, not a caller-supplied user id. RLS still applies.
create function public.modexa_billing_state() returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('used',(select count(*) from public.models where user_id=auth.uid()),'subscription',(select to_jsonb(s) from public.subscriptions s where user_id=auth.uid()));
$$;
revoke all on function public.modexa_billing_state() from public,anon;
grant execute on function public.modexa_billing_state() to authenticated;

create function public.modexa_begin_checkout(owner_id uuid,offer_plan text,offer_months integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.payments%rowtype; total integer;
begin
  if offer_plan not in ('pro','business') or offer_months not in (1,3,12) or offer_plan is null or offer_months is null then raise exception 'Invalid offer'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':checkout',0));
  select * into p from public.payments where user_id=owner_id and plan=offer_plan and months=offer_months and status='pending' and created_at>now()-interval '10 minutes' order by created_at desc limit 1;
  if found then return jsonb_build_object('payment',to_jsonb(p),'created',false); end if;
  total:=(case offer_plan when 'pro' then 7000 else 15000 end)*offer_months*(case offer_months when 3 then 90 when 12 then 70 else 100 end)/100;
  insert into public.payments(user_id,plan,months,amount) values(owner_id,offer_plan,offer_months,total) returning * into p;
  return jsonb_build_object('payment',to_jsonb(p),'created',true);
end $$;
revoke all on function public.modexa_begin_checkout(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.modexa_begin_checkout(uuid,text,integer) to service_role;

create or replace function public.modexa_confirm_payment(transaction_id bigint) returns void language plpgsql security invoker set search_path='' as $$
declare p public.payments%rowtype; s public.subscriptions%rowtype; start_at timestamptz;
begin
  select * into p from public.payments where provider_transaction_id=transaction_id for update;
  if not found then raise exception 'Unknown payment'; end if;
  if p.paid_at is not null then return; end if;
  -- Serialize different payments for the same account before extending periods.
  insert into public.subscriptions(user_id) values(p.user_id) on conflict do nothing;
  select * into s from public.subscriptions where user_id=p.user_id for update;
  if p.plan='business' then
    start_at:=greatest(now(),s.business_until);
    s.business_until:=start_at+make_interval(months=>p.months);
  else
    -- A Pro purchase while Business is active starts after Business, without wasting paid days.
    start_at:=greatest(now(),s.pro_until,s.business_until);
    s.pro_until:=start_at+make_interval(months=>p.months);
  end if;
  update public.subscriptions set status='active',pro_until=s.pro_until,business_until=s.business_until,
    current_period_end=greatest(s.pro_until,s.business_until),updated_at=now() where user_id=p.user_id;
  update public.payments set status='approved',paid_at=now(),checkout_url=null where id=p.id;
end $$;
revoke all on function public.modexa_confirm_payment(bigint) from public,anon,authenticated;
grant execute on function public.modexa_confirm_payment(bigint) to service_role;
commit;
