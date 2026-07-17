select
  users.id as auth_user_id,
  users.email as auth_email,
  profiles.id as profile_id,
  profiles.is_global_admin,
  members.project_id as membership_project_id,
  member_projects.name as membership_project_name,
  members.role as membership_role,
  invitations.id as invitation_id,
  invitations.project_id as invitation_project_id,
  invitation_projects.name as invitation_project_name,
  invitations.accepted_at
from auth.users users
left join public.profiles profiles on profiles.id = users.id
left join public.project_members members on members.user_id = users.id
left join public.projects member_projects on member_projects.id = members.project_id
left join public.project_invitations invitations on lower(invitations.email) = lower(users.email)
left join public.projects invitation_projects on invitation_projects.id = invitations.project_id
where lower(users.email) = 'mfuyar+gfadmin@gmail.com';
