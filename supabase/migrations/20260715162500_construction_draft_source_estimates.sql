alter table public.construction_cost_drafts
  add column if not exists source_estimates jsonb not null default '{}'::jsonb
  check (jsonb_typeof(source_estimates) = 'object');

update public.construction_cost_drafts drafts
set source_estimates = jsonb_strip_nulls(jsonb_build_object(
      'lot_3', estimates.lot_3,
      'lot_2', estimates.lot_2,
      'lot_1', estimates.lot_1,
      'lot_4', estimates.lot_4
    )),
    updated_at = now()
from public.projects projects
join (values
  ('Lot Cost',                         null::numeric, null::numeric, null::numeric, null::numeric),
  ('Permit',                           null,          null,          null,          null),
  ('Surveying',                        1600.00,       1600.00,       1600.00,       1600.00),
  ('Lot Clearing',                     0.00,          0.00,          0.00,          0.00),
  ('Footing / Foundation / Slab',      25000.00,      25000.00,      null,          null),
  ('Termite Treatment',                450.00,        450.00,        450.00,        450.00),
  ('Framing Materials',                80000.00,      80000.00,      null,          null),
  ('Framing Trusses',                  25353.97,      25353.97,      22064.74,      22068.08),
  ('Framing Labor',                    53271.50,      53271.50,      48805.00,      50678.00),
  ('Plumbing',                         37750.00,      37750.00,      null,          null),
  ('Plumbing Fixtures',                3500.00,       3500.00,       null,          null),
  ('Electrical Work',                  33600.00,      33600.00,      32000.00,      32000.00),
  ('Light Fixtures',                   3600.00,       3600.00,       3600.00,       3600.00),
  ('HVAC',                             38500.00,      38500.00,      null,          null),
  ('Windows and Doors',                12500.00,      12500.00,      10051.65,      11597.30),
  ('Fireplace and Surrounds',          2500.00,       2500.00,       null,          null),
  ('Insulation',                       10000.00,      10000.00,      8000.00,       8000.00),
  ('Permanent Roof',                   20000.00,      20000.00,      null,          null),
  ('Siding and Boxing Materials',      21260.35,      21260.35,      null,          null),
  ('Siding and Boxing Labor',          15000.00,      15000.00,      null,          null),
  ('Painting',                         15000.00,      15000.00,      null,          null),
  ('Drywall',                          14615.00,      14615.00,      null,          null),
  ('Tile',                             12000.00,      12000.00,      null,          null),
  ('Cabinets and Tops',                12000.00,      12000.00,      null,          null),
  ('Interior Trim and Doors',          8500.00,       8500.00,       null,          null),
  ('Interior Trim Labor',              12600.00,      12600.00,      null,          null),
  ('Floor Covering',                   14000.00,      14000.00,      null,          null),
  ('Exterior Concrete / Driveway',     5000.00,       5000.00,       5000.00,       5000.00),
  ('Hardware',                         1200.00,       1200.00,       1100.00,       1100.00),
  ('Appliances',                       3600.00,       3600.00,       3600.00,       3600.00),
  ('Garage Door',                      2000.00,       2000.00,       2000.00,       2000.00),
  ('Fine Grading',                     1500.00,       1500.00,       1500.00,       1500.00),
  ('Landscaping',                      2500.00,       2500.00,       2500.00,       2500.00),
  ('Trash Removal',                    1200.00,       1200.00,       1200.00,       1200.00),
  ('Final Cleaning',                   400.00,        400.00,        350.00,        350.00),
  ('Port-o-John',                      160.00,        160.00,        160.00,        160.00)
) as estimates(name, lot_3, lot_2, lot_1, lot_4) on true
where drafts.project_id = projects.id
  and lower(projects.name) = 'tryon rd'
  and lower(drafts.name) = lower(estimates.name);
