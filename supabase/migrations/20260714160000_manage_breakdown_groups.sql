create or replace function public.add_costs_to_breakdown_group(
  p_project_id bigint,
  p_group_cost_id uuid,
  p_cost_ids uuid[]
)
returns public.cost_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_ids uuid[];
  group_row public.cost_versions;
  updated_group public.cost_versions;
  selected_count integer;
  added_amount numeric(12,2);
  latest_added_date date;
begin
  if not private.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to manage this project';
  end if;

  select array_agg(distinct selected_id order by selected_id)
  into normalized_ids
  from unnest(coalesce(p_cost_ids, array[]::uuid[])) selected_id;

  if coalesce(cardinality(normalized_ids), 0) < 1 then
    raise exception 'Select at least one breakdown to add';
  end if;

  select * into group_row
  from public.cost_versions
  where project_id = p_project_id and cost_id = p_group_cost_id
  order by version desc
  limit 1;

  if group_row.id is null or group_row.deleted_at is not null or group_row.parent_cost_id is null then
    raise exception 'The selected breakdown group is not active';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(selected_id::text, 0))
  from unnest(array_append(normalized_ids, p_group_cost_id)) selected_id
  order by selected_id;

  with latest as (
    select distinct on (cost_id) *
    from public.cost_versions
    where project_id = p_project_id and cost_id = any(normalized_ids)
    order by cost_id, version desc
  ), active_children as (
    select distinct on (cost_id) *
    from public.cost_versions
    where project_id = p_project_id
    order by cost_id, version desc
  )
  select count(*), sum(selected.amount), max(selected.cost_date)
  into selected_count, added_amount, latest_added_date
  from latest selected
  where selected.deleted_at is null
    and selected.parent_cost_id = group_row.parent_cost_id
    and not exists (
      select 1 from active_children child
      where child.parent_cost_id = selected.cost_id and child.deleted_at is null
    );

  if selected_count <> cardinality(normalized_ids) then
    raise exception 'Selected items must be active, ungrouped siblings without child items';
  end if;

  insert into public.cost_versions (
    cost_id, parent_cost_id, project_id, owner_id, version, name, amount,
    phase, cost_date, attachments, deleted_at
  ) values (
    group_row.cost_id, group_row.parent_cost_id, group_row.project_id,
    group_row.owner_id, group_row.version + 1, group_row.name,
    group_row.amount + added_amount, group_row.phase,
    greatest(group_row.cost_date, latest_added_date), group_row.attachments, null
  ) returning * into updated_group;

  with latest as (
    select distinct on (cost_id) *
    from public.cost_versions
    where project_id = p_project_id and cost_id = any(normalized_ids)
    order by cost_id, version desc
  )
  insert into public.cost_versions (
    cost_id, parent_cost_id, project_id, owner_id, version, name, amount,
    phase, cost_date, attachments, deleted_at
  )
  select
    cost_id, p_group_cost_id, project_id, owner_id, version + 1, name, amount,
    phase, cost_date, attachments, null
  from latest;

  return updated_group;
end;
$$;

create or replace function public.unmerge_cost_breakdown_group(
  p_project_id bigint,
  p_group_cost_id uuid
)
returns public.cost_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  group_row public.cost_versions;
  deleted_group public.cost_versions;
  child_ids uuid[];
begin
  if not private.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to manage this project';
  end if;

  select * into group_row
  from public.cost_versions
  where project_id = p_project_id and cost_id = p_group_cost_id
  order by version desc
  limit 1;

  if group_row.id is null or group_row.deleted_at is not null or group_row.parent_cost_id is null then
    raise exception 'The selected breakdown group is not active';
  end if;

  with latest as (
    select distinct on (cost_id) *
    from public.cost_versions
    where project_id = p_project_id
    order by cost_id, version desc
  )
  select array_agg(cost_id order by cost_id)
  into child_ids
  from latest
  where parent_cost_id = p_group_cost_id and deleted_at is null;

  if coalesce(cardinality(child_ids), 0) < 1 then
    raise exception 'This group has no active items to unmerge';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(selected_id::text, 0))
  from unnest(array_append(child_ids, p_group_cost_id)) selected_id
  order by selected_id;

  with latest as (
    select distinct on (cost_id) *
    from public.cost_versions
    where project_id = p_project_id and cost_id = any(child_ids)
    order by cost_id, version desc
  )
  insert into public.cost_versions (
    cost_id, parent_cost_id, project_id, owner_id, version, name, amount,
    phase, cost_date, attachments, deleted_at
  )
  select
    cost_id, group_row.parent_cost_id, project_id, owner_id, version + 1,
    name, amount, phase, cost_date, attachments, null
  from latest;

  insert into public.cost_versions (
    cost_id, parent_cost_id, project_id, owner_id, version, name, amount,
    phase, cost_date, attachments, deleted_at
  ) values (
    group_row.cost_id, group_row.parent_cost_id, group_row.project_id,
    group_row.owner_id, group_row.version + 1, group_row.name, group_row.amount,
    group_row.phase, group_row.cost_date, group_row.attachments, now()
  ) returning * into deleted_group;

  return deleted_group;
end;
$$;

grant execute on function public.add_costs_to_breakdown_group(bigint, uuid, uuid[])
  to authenticated;
grant execute on function public.unmerge_cost_breakdown_group(bigint, uuid)
  to authenticated;

revoke all on function public.add_costs_to_breakdown_group(bigint, uuid, uuid[])
  from public, anon;
revoke all on function public.unmerge_cost_breakdown_group(bigint, uuid)
  from public, anon;
