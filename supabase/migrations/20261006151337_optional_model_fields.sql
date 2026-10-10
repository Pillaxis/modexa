begin;

-- Classification, reference and photos are optional. Owner isolation is unchanged.
create or replace function public.modexa_valid_images(images jsonb, owner uuid)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(images) <> 'array' then false
    when jsonb_array_length(images) not between 0 and 10 then false
    else not exists (
      select 1 from jsonb_array_elements(images) item
      where item->>'path' is null or split_part(item->>'path', '/', 1) <> owner::text
      or item->>'path' like '%..%'
    ) end;
$$;

alter table public.models
  alter column name set default 'Modèle sans catégorie',
  alter column reference drop not null,
  alter column category drop not null,
  alter column subcategory drop not null,
  alter column images set default '[]'::jsonb;

commit;
