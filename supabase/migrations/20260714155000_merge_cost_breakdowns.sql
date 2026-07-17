create or replace function public.merge_cost_breakdowns(
  p_project_id bigint,
  p_parent_cost_id uuid,
  p_cost_ids uuid[],
  p_name text,
  p_cost_date date default null
)
returns public.cost_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_ids uuid[];
  parent_row public.cost_versions;
  merged_row public.cost_versions;
  selected_count integer;
  merged_amount numeric(12,2);
  merged_date date;
  merged_attachments jsonb;
begin
  if not private.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to manage this project';
  end if;

  select array_agg(distinct selected_id order by selected_id)
  into normalized_ids
  from unnest(coalesce(p_cost_ids, array[]::uuid[])) selected_id;

  if coalesce(cardinality(normalized_ids), 0) < 2 then
    raise exception 'Select at least two breakdowns to merge';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Enter a name for the merged breakdown';
  end if;

  select * into parent_row
  from public.cost_versions
  where project_id = p_project_id and cost_id = p_parent_cost_id
  order by version desc
  limit 1;

  if parent_row.id is null or parent_row.deleted_at is not null or parent_row.parent_cost_id is not null then
    raise exception 'The selected parent cost is not active';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(selected_id::text, 0))
  from unnest(normalized_ids) selected_id
  order by selected_id;

  with latest as (
    select distinct on (cost_id) *
    from public.cost_versions
    where project_id = p_project_id and cost_id = any(normalized_ids)
    order by cost_id, version desc
  )
  select count(*), sum(amount), max(cost_date)
  into selected_count, merged_amount, merged_date
  from latest
  where deleted_at is null and parent_cost_id = p_parent_cost_id;

  if selected_count <> cardinality(normalized_ids) then
    raise exception 'All selected breakdowns must be active and belong to the same parent';
  end if;

  with latest as (
    select distinct on (cost_id) *
    from public.cost_versions
    where project_id = p_project_id and cost_id = any(normalized_ids)
    order by cost_id, version desc
  )
  select coalesce(jsonb_agg(attachment.value), '[]'::jsonb)
  into merged_attachments
  from latest
  cross join lateral jsonb_array_elements(latest.attachments) attachment(value)
  where latest.deleted_at is null and latest.parent_cost_id = p_parent_cost_id;

  insert into public.cost_versions (
    cost_id, parent_cost_id, project_id, owner_id, version, name, amount,
    phase, cost_date, attachments, deleted_at
  ) values (
    gen_random_uuid(), p_parent_cost_id, p_project_id, parent_row.owner_id, 1,
    trim(p_name), merged_amount, parent_row.phase, coalesce(p_cost_date, merged_date),
    coalesce(merged_attachments, '[]'::jsonb), null
  ) returning * into merged_row;

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
    cost_id, parent_cost_id, project_id, owner_id, version + 1, name, amount,
    phase, cost_date, attachments, now()
  from latest;

  update public.documents
  set cost_id = merged_row.cost_id
  where project_id = p_project_id and cost_id = any(normalized_ids);

  return merged_row;
end;
$$;

grant execute on function public.merge_cost_breakdowns(bigint, uuid, uuid[], text, date)
  to authenticated;

revoke all on function public.merge_cost_breakdowns(bigint, uuid, uuid[], text, date)
  from public, anon;
