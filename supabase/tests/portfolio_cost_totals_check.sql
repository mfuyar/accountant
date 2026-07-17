with latest as (
  select distinct on (cost_id)
    project_id,
    cost_id,
    parent_cost_id,
    amount,
    deleted_at
  from public.cost_versions
  order by cost_id, version desc
), active as (
  select * from latest where deleted_at is null
)
select
  projects.id as project_id,
  projects.name as project_name,
  coalesce(sum(active.amount) filter (where active.parent_cost_id is null), 0) as correct_parent_total,
  coalesce(sum(active.amount) filter (where active.parent_cost_id is not null), 0) as breakdown_total_excluded,
  coalesce(sum(active.amount), 0) as previous_inflated_total
from public.projects
left join active on active.project_id = projects.id
group by projects.id, projects.name
order by projects.id;
