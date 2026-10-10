begin;

create function public.modexa_valid_images(images jsonb, owner uuid)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(images) <> 'array' then false
    when jsonb_array_length(images) not between 1 and 10 then false
    else not exists (
      select 1 from jsonb_array_elements(images) item
      where item->>'path' is null or split_part(item->>'path', '/', 1) <> owner::text
      or item->>'path' like '%..%'
    ) end;
$$;

create table public.models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  reference text not null check (length(trim(reference)) between 1 and 40),
  category text not null check (category in ('Robes','Complets filles','Complets garçons','Jupes','Autres')),
  subcategory text not null check(length(subcategory) between 1 and 80),
  favorite boolean not null default false,
  images jsonb not null check (public.modexa_valid_images(images,user_id)),
  created_at timestamptz not null default now()
);
create unique index models_owner_reference on public.models(user_id,lower(reference));
create index models_owner_recent on public.models(user_id,created_at desc);

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inactive' check (status in ('active','inactive')),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_transaction_id bigint unique,
  amount integer not null default 7000 check (amount=7000),
  currency text not null default 'XOF' check(currency='XOF'),
  status text not null default 'pending' check(status in ('pending','approved','failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index payments_owner on public.payments(user_id,created_at desc);
alter table public.models enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;

revoke all on public.models,public.subscriptions,public.payments from anon,authenticated;
grant select,insert,update,delete on public.models to authenticated;
grant select on public.subscriptions,public.payments to authenticated;
grant all on public.models,public.subscriptions,public.payments to service_role;

create policy models_read on public.models for select to authenticated using(user_id=(select auth.uid()));
create policy models_insert on public.models for insert to authenticated with check(user_id=(select auth.uid()));
create policy models_update on public.models for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy models_delete on public.models for delete to authenticated using(user_id=(select auth.uid()));
create policy subscriptions_read on public.subscriptions for select to authenticated using(user_id=(select auth.uid()));
create policy payments_read on public.payments for select to authenticated using(user_id=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('model-images','model-images',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy model_images_read on storage.objects for select to authenticated
using(bucket_id='model-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy model_images_insert on storage.objects for insert to authenticated
with check(bucket_id='model-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy model_images_delete on storage.objects for delete to authenticated
using(bucket_id='model-images' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- Called only from a server function after signature and provider verification.
-- Row locks and paid_at prevent duplicate callbacks from adding a second month.
create function public.modexa_confirm_payment(transaction_id bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare p public.payments%rowtype;
begin
  select * into p from public.payments where provider_transaction_id=transaction_id for update;
  if not found then raise exception 'Unknown payment'; end if;
  if p.paid_at is not null then return; end if;
  insert into public.subscriptions(user_id,status,current_period_end)
  values(p.user_id,'active',now()+interval '1 month')
  on conflict(user_id) do update set status='active',
    current_period_end=greatest(now(),public.subscriptions.current_period_end)+interval '1 month',updated_at=now();
  update public.payments set status='approved',paid_at=now() where id=p.id;
end;
$$;
revoke all on function public.modexa_confirm_payment(bigint) from public,anon,authenticated;
grant execute on function public.modexa_confirm_payment(bigint) to service_role;

commit;
