create extension if not exists pgcrypto;

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  status text not null default 'atencao'
    check (status in ('preservado', 'atencao', 'critico')),
  impact text,
  description text,
  latitude double precision,
  longitude double precision,
  image_url text,
  polygon_coords jsonb,
  last_occurrence_id uuid,
  last_status_review_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.areas
  add column if not exists last_occurrence_id uuid,
  add column if not exists last_status_review_at timestamptz;

create table if not exists public.occurrences (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  impact text not null,
  description text not null,
  latitude double precision,
  longitude double precision,
  image_url text,
  previous_status text check (previous_status is null or previous_status in ('preservado', 'atencao', 'critico')),
  new_status text check (new_status is null or new_status in ('preservado', 'atencao', 'critico')),
  status_updated boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.area_status_history (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  occurrence_id uuid not null references public.occurrences(id) on delete cascade,
  previous_status text not null check (previous_status in ('preservado', 'atencao', 'critico')),
  new_status text not null check (new_status in ('preservado', 'atencao', 'critico')),
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists occurrences_area_id_created_at_idx
on public.occurrences (area_id, created_at desc);

create index if not exists area_status_history_area_id_changed_at_idx
on public.area_status_history (area_id, changed_at desc);

create or replace function public.register_occurrence_with_status(
  p_area_id uuid,
  p_impact text,
  p_description text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_image_url text default null,
  p_update_status boolean default false,
  p_new_status text default null,
  p_changed_by uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area public.areas%rowtype;
  v_occurrence public.occurrences%rowtype;
  v_previous_status text;
  v_status_changed boolean;
begin
  select *
  into v_area
  from public.areas
  where id = p_area_id
  for update;

  if not found then
    raise exception 'Area % not found', p_area_id;
  end if;

  if p_update_status and p_new_status is null then
    raise exception 'New status is required when updating area status';
  end if;

  if p_new_status is not null and p_new_status not in ('preservado', 'atencao', 'critico') then
    raise exception 'Invalid status: %', p_new_status;
  end if;

  v_previous_status := v_area.status;
  v_status_changed := p_update_status
    and p_new_status is not null
    and p_new_status <> v_previous_status;

  insert into public.occurrences (
    area_id,
    impact,
    description,
    latitude,
    longitude,
    image_url,
    previous_status,
    new_status,
    status_updated,
    created_by
  )
  values (
    p_area_id,
    p_impact,
    p_description,
    p_latitude,
    p_longitude,
    p_image_url,
    case when v_status_changed then v_previous_status else null end,
    case when v_status_changed then p_new_status else null end,
    v_status_changed,
    p_changed_by
  )
  returning * into v_occurrence;

  if v_status_changed then
    update public.areas
    set
      status = p_new_status,
      impact = p_impact,
      description = p_description,
      image_url = coalesce(p_image_url, image_url),
      last_occurrence_id = v_occurrence.id,
      last_status_review_at = now()
    where id = p_area_id
    returning * into v_area;

    insert into public.area_status_history (
      area_id,
      occurrence_id,
      previous_status,
      new_status,
      changed_by
    )
    values (
      p_area_id,
      v_occurrence.id,
      v_previous_status,
      p_new_status,
      p_changed_by
    );
  end if;

  return jsonb_build_object(
    'occurrence_id', v_occurrence.id,
    'area', to_jsonb(v_area),
    'status_changed', v_status_changed,
    'previous_status', v_previous_status,
    'new_status', case when v_status_changed then p_new_status else v_previous_status end
  );
end;
$$;

alter table public.areas enable row level security;
alter table public.occurrences enable row level security;
alter table public.area_status_history enable row level security;

drop policy if exists "Permitir leitura publica de areas" on public.areas;
create policy "Permitir leitura publica de areas"
on public.areas for select
to anon, authenticated
using (true);

drop policy if exists "Permitir cadastro publico de areas" on public.areas;
create policy "Permitir cadastro publico de areas"
on public.areas for insert
to anon, authenticated
with check (true);

drop policy if exists "Permitir atualizacao publica de areas" on public.areas;
create policy "Permitir atualizacao publica de areas"
on public.areas for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Permitir leitura publica de ocorrencias" on public.occurrences;
create policy "Permitir leitura publica de ocorrencias"
on public.occurrences for select
to anon, authenticated
using (true);

drop policy if exists "Permitir cadastro publico de ocorrencias" on public.occurrences;
create policy "Permitir cadastro publico de ocorrencias"
on public.occurrences for insert
to anon, authenticated
with check (true);

drop policy if exists "Permitir leitura publica de historico de status" on public.area_status_history;
create policy "Permitir leitura publica de historico de status"
on public.area_status_history for select
to anon, authenticated
using (true);

grant execute on function public.register_occurrence_with_status(
  uuid,
  text,
  text,
  double precision,
  double precision,
  text,
  boolean,
  text,
  uuid
) to anon, authenticated;
