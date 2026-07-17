drop policy if exists cost_versions_project_admin_access on public.cost_versions;

create policy cost_versions_project_admin_select on public.cost_versions
  for select to authenticated
  using (private.can_manage_project(project_id));

create policy cost_versions_project_admin_insert on public.cost_versions
  for insert to authenticated
  with check (private.can_manage_project(project_id));

revoke update, delete on public.cost_versions from authenticated;
