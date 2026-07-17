alter table public.cost_versions
  add column if not exists parent_cost_id uuid;

alter table public.cost_versions
  drop constraint if exists cost_versions_not_own_parent;

alter table public.cost_versions
  add constraint cost_versions_not_own_parent
  check (parent_cost_id is null or parent_cost_id <> cost_id);

create index if not exists cost_versions_parent_cost_id_idx
  on public.cost_versions(project_id, parent_cost_id)
  where parent_cost_id is not null;

create or replace function public.create_cost_version_v2(
  p_project_id bigint,
  p_cost_id uuid,
  p_parent_cost_id uuid,
  p_owner_id bigint,
  p_name text,
  p_amount numeric,
  p_phase text,
  p_cost_date date,
  p_attachments jsonb default '[]'::jsonb,
  p_deleted boolean default false
)
returns public.cost_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_version integer;
  result public.cost_versions;
begin
  if not private.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to manage this project';
  end if;

  if p_parent_cost_id is not null and not exists (
    select 1
    from public.cost_versions parent
    where parent.project_id = p_project_id
      and parent.cost_id = p_parent_cost_id
      and parent.parent_cost_id is null
  ) then
    raise exception 'The parent cost does not exist in this project';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cost_id::text, 0));
  select coalesce(max(version), 0) + 1 into next_version
  from public.cost_versions
  where cost_id = p_cost_id and project_id = p_project_id;

  insert into public.cost_versions (
    cost_id, parent_cost_id, project_id, owner_id, version, name, amount,
    phase, cost_date, attachments, deleted_at
  ) values (
    p_cost_id, p_parent_cost_id, p_project_id, p_owner_id, next_version,
    trim(p_name), p_amount, p_phase, p_cost_date,
    coalesce(p_attachments, '[]'::jsonb),
    case when p_deleted then now() else null end
  ) returning * into result;

  return result;
end;
$$;

grant execute on function public.create_cost_version_v2(bigint, uuid, uuid, bigint, text, numeric, text, date, jsonb, boolean)
  to authenticated;

revoke all on function public.create_cost_version_v2(bigint, uuid, uuid, bigint, text, numeric, text, date, jsonb, boolean)
  from public, anon;
