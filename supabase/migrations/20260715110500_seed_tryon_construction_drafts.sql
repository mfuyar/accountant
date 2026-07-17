insert into public.construction_cost_drafts (project_id, name, sort_order, source_label)
select projects.id, items.name, items.sort_order, 'IMG_3363.HEIC · Construction Cost Sheet · 7/15/2026'
from public.projects projects
cross join (values
  (1, 'Lot Cost'),
  (2, 'Permit'),
  (3, 'Surveying'),
  (4, 'Lot Clearing'),
  (5, 'Footing / Foundation / Slab'),
  (6, 'Termite Treatment'),
  (7, 'Framing Materials'),
  (8, 'Framing Trusses'),
  (9, 'Framing Labor'),
  (10, 'Plumbing'),
  (11, 'Plumbing Fixtures'),
  (12, 'Electrical Work'),
  (13, 'Light Fixtures'),
  (14, 'HVAC'),
  (15, 'Windows and Doors'),
  (16, 'Fireplace and Surrounds'),
  (17, 'Insulation'),
  (18, 'Permanent Roof'),
  (19, 'Siding and Boxing Materials'),
  (20, 'Siding and Boxing Labor'),
  (21, 'Painting'),
  (22, 'Drywall'),
  (23, 'Tile'),
  (24, 'Cabinets and Tops'),
  (25, 'Interior Trim and Doors'),
  (26, 'Interior Trim Labor'),
  (27, 'Floor Covering'),
  (28, 'Exterior Concrete / Driveway'),
  (29, 'Hardware'),
  (30, 'Appliances'),
  (31, 'Garage Door'),
  (32, 'Fine Grading'),
  (33, 'Landscaping'),
  (34, 'Trash Removal'),
  (35, 'Final Cleaning'),
  (36, 'Port-o-John')
) as items(sort_order, name)
where lower(projects.name) = 'tryon rd'
on conflict (project_id, lower(name)) do update
set sort_order = excluded.sort_order,
    source_label = excluded.source_label,
    updated_at = now();
