create or replace view public.active_costs
with (security_invoker = true)
as
select latest.*
from (
  select distinct on (cost_id) *
  from public.cost_versions
  order by cost_id, version desc
) latest
where latest.deleted_at is null;

grant select on public.active_costs to authenticated;
