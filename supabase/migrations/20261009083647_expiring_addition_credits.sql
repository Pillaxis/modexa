begin;
alter table public.subscriptions add column plan text not null default 'pro' check(plan in ('pro','business')),
 add column ever_paid boolean not null default false;
update public.subscriptions set plan=case when business_until>now() then 'business' else 'pro' end,
 ever_paid=(status='active' or exists(select 1 from public.payments p where p.user_id=subscriptions.user_id and p.paid_at is not null));
alter table public.payments add column kind text not null default 'subscription' check(kind in ('subscription','topup')),
 add column credits integer not null default 100 check(credits>0);
update public.payments set credits=(case plan when 'pro' then 100 else 1000 end)*months;
alter table public.payments drop constraint payments_offer_amount;
alter table public.payments add constraint payments_offer_amount check(
 (kind='subscription' and credits=(case plan when 'pro' then 100 else 1000 end)*months
  and amount=(case plan when 'pro' then 7000 else 15000 end)*months*(case months when 3 then 90 when 12 then 70 else 100 end)/100)
 or (kind='topup' and months=1 and ((plan='pro' and ((credits=50 and amount=3600) or (credits=100 and amount=7000)))
 or (plan='business' and ((credits=500 and amount=7600) or (credits=1000 and amount=15000))))));

create table public.model_credits(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 payment_id uuid unique references public.payments(id),kind text not null check(kind in ('subscription','topup','legacy')),
 total integer not null check(total>0),used integer not null default 0 check(used>=0 and used<=total),
 starts_at timestamptz not null default now(),expires_at timestamptz not null check(expires_at>starts_at));
create index model_credits_owner_expiry on public.model_credits(user_id,expires_at);
alter table public.model_credits enable row level security;
revoke all on public.model_credits from public,anon,authenticated;
grant select on public.model_credits to authenticated;
grant all on public.model_credits to service_role;
create policy model_credits_read on public.model_credits for select to authenticated using(user_id=(select auth.uid()));
grant usage on schema private to service_role;
grant all on private.modexa_usage to service_role;
-- Preserve any old paid entitlements; never remove existing catalogue entries.
insert into public.model_credits(user_id,kind,total,used,expires_at)
 select s.user_id,'legacy',case s.plan when 'business' then 1000 else 100 end,
 least((select count(*) from public.models m where m.user_id=s.user_id),case s.plan when 'business' then 1000 else 100 end),s.current_period_end
 from public.subscriptions s where s.ever_paid and s.status='active' and s.current_period_end>now();

create or replace function private.modexa_check_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid;s public.subscriptions%rowtype;grant_id uuid;catalog_used integer;
begin
 owner:=case when TG_OP='DELETE' then OLD.user_id else NEW.user_id end;
 if auth.uid() is not null and auth.uid()<>owner then raise exception 'Access denied' using errcode='42501'; end if;
 if TG_OP='UPDATE' then
  if NEW.user_id<>OLD.user_id then raise exception 'Owner cannot change' using errcode='42501'; end if;return NEW;
 end if;
 insert into private.modexa_usage(user_id) values(owner) on conflict do nothing;
 select used into catalog_used from private.modexa_usage where user_id=owner for update;
 if TG_OP='DELETE' then
  update private.modexa_usage set used=greatest(0,used-1) where user_id=owner;return OLD;
 end if;
 select * into s from public.subscriptions where user_id=owner;
 if coalesce(s.ever_paid,false) then
  if s.status<>'active' or s.current_period_end is null or s.current_period_end<=now() then
   raise exception 'MODEXA_SUBSCRIPTION_EXPIRED' using errcode='PT402';
  end if;
  select id into grant_id from public.model_credits where user_id=owner and starts_at<=now() and expires_at>now() and used<total order by expires_at,id limit 1 for update;
  if grant_id is null then raise exception 'MODEXA_QUOTA_REACHED' using errcode='PT402';end if;
  update public.model_credits set used=used+1 where id=grant_id;
 else
  if catalog_used>=10 then raise exception 'MODEXA_QUOTA_REACHED' using errcode='PT402';end if;
 end if;
 update private.modexa_usage set used=used+1 where user_id=owner;return NEW;
end $$;
revoke all on function private.modexa_check_capacity() from public,anon,authenticated;

create or replace function public.modexa_billing_state() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('server_at',statement_timestamp(),'user_id',auth.uid(),'used',(select count(*) from public.models where user_id=auth.uid()),
 'subscription',(select to_jsonb(s) from public.subscriptions s where user_id=auth.uid()),
 'quota',jsonb_build_object('version',2,'ever_paid',coalesce((select ever_paid from public.subscriptions where user_id=auth.uid()),false),
 'active',coalesce((select status='active' and current_period_end>now() from public.subscriptions where user_id=auth.uid()),false),
 'end',(select current_period_end from public.subscriptions where user_id=auth.uid()),
 'grants',coalesce((select jsonb_agg(to_jsonb(c) order by c.expires_at,c.id) from public.model_credits c where c.user_id=auth.uid() and c.expires_at>now()),'[]'::jsonb)));
$$;
revoke all on function public.modexa_billing_state() from public,anon;
grant execute on function public.modexa_billing_state() to authenticated;

drop function public.modexa_begin_checkout(uuid,text,integer);
create function public.modexa_begin_checkout(owner_id uuid,offer_plan text,offer_months integer,offer_kind text default 'subscription',offer_credits integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.payments%rowtype;s public.subscriptions%rowtype;total integer;quantity integer;available integer;
begin
 if offer_plan is null or offer_plan not in ('pro','business') or offer_kind is null or offer_kind not in ('subscription','topup') then raise exception 'Invalid offer';end if;
 insert into private.modexa_usage(user_id) values(owner_id) on conflict do nothing;
 perform 1 from private.modexa_usage where user_id=owner_id for update;
 if offer_kind='subscription' then
  if offer_months is null or offer_months not in (1,3,12) then raise exception 'Invalid duration';end if;
  quantity:=(case offer_plan when 'pro' then 100 else 1000 end)*offer_months;
  total:=(case offer_plan when 'pro' then 7000 else 15000 end)*offer_months*(case offer_months when 3 then 90 when 12 then 70 else 100 end)/100;
 else
  if offer_months<>1 or offer_months is null then raise exception 'Invalid duration';end if;
  quantity:=offer_credits;
  total:=case when offer_plan='pro' and quantity=50 then 3600 when offer_plan='pro' and quantity=100 then 7000 when offer_plan='business' and quantity=500 then 7600 when offer_plan='business' and quantity=1000 then 15000 else null end;
  if total is null then raise exception 'Invalid topup';end if;
  select * into s from public.subscriptions where user_id=owner_id;
  if s.user_id is null or s.status<>'active' or s.current_period_end<=now() or s.plan<>offer_plan then raise exception 'MODEXA_RENEW_REQUIRED' using errcode='PT409';end if;
  select coalesce(sum(c.total-c.used),0) into available from public.model_credits c where user_id=owner_id and starts_at<=now() and expires_at>now();
  if available>0 then raise exception 'MODEXA_CREDITS_REMAIN' using errcode='PT409';end if;
 end if;
 select * into p from public.payments where user_id=owner_id and kind=offer_kind and status='pending' and created_at>now()-interval '10 minutes'
 and (offer_kind='topup' or (plan=offer_plan and months=offer_months)) order by created_at desc limit 1;
 if found then
  if p.plan<>offer_plan or p.credits<>quantity then raise exception 'MODEXA_CHECKOUT_PENDING' using errcode='PT409';end if;
  return jsonb_build_object('payment',to_jsonb(p),'created',false);
 end if;
 insert into public.payments(user_id,plan,months,amount,kind,credits) values(owner_id,offer_plan,offer_months,total,offer_kind,quantity) returning * into p;
 return jsonb_build_object('payment',to_jsonb(p),'created',true);
end $$;
revoke all on function public.modexa_begin_checkout(uuid,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.modexa_begin_checkout(uuid,text,integer,text,integer) to service_role;

create or replace function public.modexa_confirm_payment(transaction_id bigint) returns void language plpgsql security invoker set search_path='' as $$
declare p public.payments%rowtype;s public.subscriptions%rowtype;expiry timestamptz;
begin
 select * into p from public.payments where provider_transaction_id=transaction_id for update;
 if not found then raise exception 'Unknown payment';end if;
 if p.paid_at is not null then return;end if;
 insert into private.modexa_usage(user_id) values(p.user_id) on conflict do nothing;
 perform 1 from private.modexa_usage where user_id=p.user_id for update;
 if p.kind='subscription' then
  insert into public.subscriptions(user_id) values(p.user_id) on conflict do nothing;
  select * into s from public.subscriptions where user_id=p.user_id for update;
  expiry:=greatest(now(),s.current_period_end)+make_interval(days=>30*p.months);
  update public.subscriptions set status='active',ever_paid=true,plan=p.plan,current_period_end=expiry,
   pro_until=case when p.plan='pro' then expiry else null end,business_until=case when p.plan='business' then expiry else null end,updated_at=now() where user_id=p.user_id;
 else
  -- Always honour a verified payment, even if the main subscription expired while checking out.
  -- Its credits remain unusable until the principal subscription is renewed.
  expiry:=now()+interval '30 days';
 end if;
 insert into public.model_credits(user_id,payment_id,kind,total,expires_at) values(p.user_id,p.id,p.kind,p.credits,expiry);
 update public.payments set status='approved',paid_at=now(),checkout_url=null where id=p.id;
end $$;
revoke all on function public.modexa_confirm_payment(bigint) from public,anon,authenticated;
grant execute on function public.modexa_confirm_payment(bigint) to service_role;
commit;
