begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3887556-2b4f-47cd-aea2-f17f1c71e9d2', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select jsonb_build_object(
  'projects', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name)) from public.projects), '[]'::jsonb),
  'owners_count', (select count(*) from public.owners),
  'active_costs_count', (select count(*) from public.active_costs),
  'top_level_costs_count', (select count(*) from public.active_costs where parent_cost_id is null)
) as access_result;

rollback;
