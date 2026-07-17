begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b853b92f-db09-4a8f-a862-a35ad3e5a11b', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  root_id uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  third_id uuid := gen_random_uuid();
  group_row public.cost_versions;
  latest_group public.cost_versions;
  active_child_count integer;
  active_child_total numeric;
begin
  perform public.create_cost_version_v2(2, root_id, null, 9, 'Group smoke root', 100, 'development', current_date);
  perform public.create_cost_version_v2(2, first_id, root_id, 9, 'Group smoke first', 10, 'development', current_date);
  perform public.create_cost_version_v2(2, second_id, root_id, 9, 'Group smoke second', 20, 'development', current_date);
  perform public.create_cost_version_v2(2, third_id, root_id, 9, 'Group smoke third', 30, 'development', current_date);

  select * into group_row
  from public.merge_cost_breakdowns(2, root_id, array[first_id, second_id], 'Group smoke merged');

  select * into latest_group
  from public.add_costs_to_breakdown_group(2, group_row.cost_id, array[third_id]);

  if latest_group.amount <> 60 then
    raise exception 'Expected expanded group total 60, received %', latest_group.amount;
  end if;

  with latest as (
    select distinct on (cost_id) *
    from public.cost_versions
    where project_id = 2
    order by cost_id, version desc
  )
  select count(*), sum(amount)
  into active_child_count, active_child_total
  from latest
  where parent_cost_id = group_row.cost_id and deleted_at is null;

  if active_child_count <> 3 or active_child_total <> 60 then
    raise exception 'Expected three retained group items totaling 60';
  end if;

  perform public.unmerge_cost_breakdown_group(2, group_row.cost_id);

  with latest as (
    select distinct on (cost_id) *
    from public.cost_versions
    where project_id = 2
    order by cost_id, version desc
  )
  select count(*), sum(amount)
  into active_child_count, active_child_total
  from latest
  where parent_cost_id = root_id and deleted_at is null;

  if active_child_count <> 3 or active_child_total <> 60 then
    raise exception 'Expected three original items totaling 60 after unmerge';
  end if;

  select * into latest_group
  from public.cost_versions
  where project_id = 2 and cost_id = group_row.cost_id
  order by version desc
  limit 1;

  if latest_group.deleted_at is null then
    raise exception 'Expected the group summary to be soft deleted after unmerge';
  end if;
end;
$$;

rollback;
