-- Sales Portal, Phase 3a follow-up: target the weekly lead import by state region (for example
-- Southeast Minnesota) instead of only ZIP + radius. Requires 20270109101000_sales_lead_import.sql.
-- Safe to re-run.
--
-- * Each region is a fixed county list. Minnesota uses DEED's six planning regions; Iowa uses the nine
--   USDA agricultural statistics districts (Northwest, Southwest, ...). Each region also carries the ZIP
--   codes whose land is mostly in its counties (US Census 2020 ZCTA-county file), because the Minnesota
--   license download has no county column.
-- * Each state with a region list has one free public license download the weekly agent works through
--   (sales_lead_sources). States without a free download (Wisconsin, South Dakota, North Dakota) have
--   no regions yet.
-- * ZIP + radius stays as the second option.
-- * Every run reports how far through the download it got (a cursor), and the next run resumes after it,
--   so the same businesses are never checked twice. Progress is kept per target (state + region + trade,
--   or ZIP + radius + trade); the owner can start a target over from the Hub.

create table if not exists public.sales_lead_sources (
  state text primary key check (state ~ '^[A-Z]{2}$'),
  state_name text not null,
  name text not null,
  url text not null,
  format text not null,
  -- How a row is placed in a region: by its county column, or by its ZIP (when the file has no county).
  match_by text not null check (match_by in ('county', 'zip')),
  -- Column names in the download (null when the file has none).
  county_field text, zip_field text not null, state_field text, name_field text not null,
  phone_field text, email_field text, status_field text, active_status text[],
  start_date_field text, trade_field text,
  -- Rows are worked in ascending order of this column; the cursor is its last value checked.
  cursor_field text not null,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_lead_regions (
  state text not null references public.sales_lead_sources (state) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z-]{1,30}$'),
  name text not null,
  sort integer not null default 0,
  counties text[] not null,
  zips text[] not null default '{}',
  primary key (state, slug)
);

-- How far each target has got through its download.
create table if not exists public.sales_lead_progress (
  target_key text primary key check (char_length(target_key) <= 200),
  cursor text check (cursor is null or char_length(cursor) <= 200),
  checked integer not null default 0,
  added integer not null default 0,
  runs integer not null default 0,
  exhausted boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.sales_lead_sources enable row level security;
alter table public.sales_lead_regions enable row level security;
alter table public.sales_lead_progress enable row level security;
revoke all on public.sales_lead_sources, public.sales_lead_regions, public.sales_lead_progress from public, anon, authenticated;
grant all on public.sales_lead_sources, public.sales_lead_regions, public.sales_lead_progress to service_role;

alter table public.sales_settings add column if not exists lead_target_mode text not null default 'zip' check (lead_target_mode in ('zip', 'region'));
alter table public.sales_settings add column if not exists lead_target_state text check (lead_target_state is null or lead_target_state ~ '^[A-Z]{2}$');
alter table public.sales_settings add column if not exists lead_target_region text check (lead_target_region is null or char_length(lead_target_region) <= 31);

alter table public.sales_lead_batches add column if not exists target_mode text;
alter table public.sales_lead_batches add column if not exists target_state text;
alter table public.sales_lead_batches add column if not exists target_region text;
alter table public.sales_lead_batches add column if not exists target_key text;
alter table public.sales_lead_batches add column if not exists progress_cursor text;
alter table public.sales_lead_batches add column if not exists progress_checked integer;

-- Sources. Minnesota: DLI residential contractor licenses (no county column, so regions match by ZIP).
-- Iowa: Division of Labor active construction contractor registrations (has a county column).
insert into public.sales_lead_sources (state, state_name, name, url, format, match_by, county_field, zip_field, state_field, name_field, phone_field, email_field,
                                       status_field, active_status, start_date_field, trade_field, cursor_field, notes)
values
  ('MN', 'Minnesota', 'Minnesota DLI residential contractor licenses',
   'https://secure.doli.state.mn.us/ccld/data/MNDLILicRegCertExport_Residential_Contractors.csv', 'csv', 'zip',
   null, 'Zip', 'St', 'Name', 'Phone_No', 'Email_Address', 'Status', array['Issued'], 'Orig_Date', 'License_Subtype', 'Lic_Number',
   'About 12 MB, free, updated daily. Use rows with Bus_Pers = Business, St = MN and Status = Issued. DBA_Name is the trading name when set. Orig_Date (MM/DD/YYYY) is the license date. Phone_No and Email_Address are often blank; find them on the business''s own site. A ZIP not in the region list (usually a PO box) may be used when City is plainly inside the region; otherwise skip it.'),
  ('IA', 'Iowa', 'Iowa active construction contractor registrations',
   'https://idh-be.iowa.gov/api/v1/datasets/1052/rows.csv', 'zip (one csv inside)', 'county',
   'county', 'zip_code', 'state', 'business_name', null, null, null, null, 'issue_date', 'primary_activity', 'registration_number',
   'About 3 MB zip with one CSV, free (data.iowa.gov dataset 1052, CC BY 4.0), active registrations only. county is upper case (POTTAWATTAMIE); use rows with state = IA. first_name + last_name is the registered person. No phone or email in the file; find them on the business''s own site. issue_date is the current registration''s date, not always the founding date.')
on conflict (state) do update set state_name = excluded.state_name, name = excluded.name, url = excluded.url, format = excluded.format, match_by = excluded.match_by,
  county_field = excluded.county_field, zip_field = excluded.zip_field, state_field = excluded.state_field, name_field = excluded.name_field,
  phone_field = excluded.phone_field, email_field = excluded.email_field, status_field = excluded.status_field, active_status = excluded.active_status,
  start_date_field = excluded.start_date_field, trade_field = excluded.trade_field, cursor_field = excluded.cursor_field, notes = excluded.notes, updated_at = now();

insert into public.sales_lead_regions (state, slug, name, sort, counties, zips) values
  ('MN', 'metro', 'Twin Cities Metro (7 counties)', 1, array['Anoka', 'Carver', 'Dakota', 'Hennepin', 'Ramsey', 'Scott', 'Washington']::text[],
   array['55001', '55003', '55005', '55011', '55014', '55016', '55020', '55024', '55025', '55031', '55033', '55038', '55042', '55043', '55044', '55047', '55054', '55055', '55065', '55068', '55070', '55071', '55073', '55075', '55076', '55077', '55082', '55085', '55090', '55092', '55101', '55102', '55103', '55104', '55105', '55106', '55107', '55108', '55109', '55110', '55111', '55112', '55113', '55114', '55115', '55116', '55117', '55118', '55119', '55120', '55121', '55122', '55123', '55124', '55125', '55126', '55127', '55128', '55129', '55130', '55150', '55155', '55303', '55304', '55305', '55306', '55311', '55315', '55316', '55317', '55318', '55322', '55327', '55331', '55337', '55339', '55340', '55343', '55344', '55345', '55346', '55347', '55352', '55356', '55357', '55359', '55360', '55364', '55367', '55368', '55369', '55372', '55373', '55374', '55375', '55378', '55379', '55384', '55386', '55387', '55388', '55391', '55397', '55401', '55402', '55403', '55404', '55405', '55406', '55407', '55408', '55409', '55410', '55411', '55412', '55413', '55414', '55415', '55416', '55417', '55418', '55419', '55420', '55421', '55422', '55423', '55424', '55425', '55426', '55427', '55428', '55429', '55430', '55431', '55432', '55433', '55434', '55435', '55436', '55437', '55438', '55439', '55441', '55442', '55443', '55444', '55445', '55446', '55447', '55448', '55449', '55450', '55454', '55455', '56011']::text[]),
  ('MN', 'central', 'Central Minnesota', 2, array['Benton', 'Chisago', 'Isanti', 'Kanabec', 'Kandiyohi', 'McLeod', 'Meeker', 'Mille Lacs', 'Pine', 'Renville', 'Sherburne', 'Stearns', 'Wright']::text[],
   array['55006', '55007', '55008', '55012', '55013', '55017', '55029', '55030', '55032', '55036', '55037', '55040', '55045', '55051', '55056', '55063', '55069', '55072', '55074', '55079', '55080', '55084', '55301', '55302', '55308', '55309', '55310', '55312', '55313', '55314', '55319', '55320', '55321', '55324', '55325', '55328', '55329', '55330', '55332', '55333', '55336', '55341', '55342', '55349', '55350', '55353', '55354', '55355', '55358', '55362', '55363', '55370', '55371', '55376', '55381', '55382', '55385', '55389', '55390', '55395', '55398', '55704', '55712', '55735', '55756', '55783', '55795', '56201', '56209', '56216', '56228', '56230', '56243', '56251', '56253', '56270', '56273', '56277', '56279', '56281', '56282', '56284', '56285', '56288', '56289', '56301', '56303', '56304', '56307', '56310', '56312', '56313', '56320', '56321', '56325', '56329', '56330', '56331', '56335', '56340', '56352', '56353', '56356', '56357', '56358', '56359', '56362', '56363', '56367', '56368', '56369', '56371', '56374', '56375', '56376', '56377', '56378', '56379', '56386', '56387']::text[]),
  ('MN', 'northeast', 'Northeast Minnesota', 3, array['Aitkin', 'Carlton', 'Cook', 'Itasca', 'Koochiching', 'Lake', 'St. Louis']::text[],
   array['55601', '55602', '55603', '55604', '55605', '55606', '55607', '55609', '55612', '55613', '55614', '55615', '55616', '55702', '55703', '55705', '55706', '55707', '55708', '55709', '55710', '55711', '55713', '55716', '55717', '55718', '55719', '55720', '55721', '55722', '55723', '55724', '55725', '55726', '55731', '55732', '55733', '55734', '55736', '55738', '55741', '55742', '55744', '55746', '55748', '55749', '55750', '55751', '55752', '55753', '55757', '55758', '55760', '55763', '55764', '55765', '55767', '55768', '55769', '55771', '55772', '55775', '55779', '55780', '55781', '55782', '55784', '55785', '55786', '55787', '55790', '55792', '55793', '55796', '55797', '55798', '55802', '55803', '55804', '55805', '55806', '55807', '55808', '55810', '55811', '55812', '55814', '56342', '56350', '56431', '56469', '56627', '56628', '56629', '56636', '56637', '56639', '56649', '56653', '56654', '56657', '56658', '56659', '56660', '56661', '56668', '56669', '56680', '56681', '56688']::text[]),
  ('MN', 'northwest', 'Northwest Minnesota', 4, array['Becker', 'Beltrami', 'Cass', 'Clay', 'Clearwater', 'Crow Wing', 'Douglas', 'Grant', 'Hubbard', 'Kittson', 'Lake of the Woods', 'Mahnomen', 'Marshall', 'Morrison', 'Norman', 'Otter Tail', 'Pennington', 'Polk', 'Pope', 'Red Lake', 'Roseau', 'Stevens', 'Todd', 'Traverse', 'Wadena', 'Wilkin']::text[],
   array['56207', '56219', '56221', '56226', '56235', '56236', '56244', '56248', '56267', '56274', '56296', '56308', '56309', '56311', '56314', '56315', '56316', '56318', '56319', '56323', '56324', '56326', '56327', '56328', '56332', '56334', '56336', '56338', '56339', '56343', '56345', '56347', '56349', '56354', '56355', '56360', '56361', '56364', '56373', '56381', '56382', '56384', '56385', '56389', '56401', '56425', '56433', '56434', '56435', '56437', '56438', '56440', '56441', '56442', '56443', '56444', '56446', '56447', '56448', '56449', '56450', '56452', '56453', '56455', '56458', '56461', '56464', '56465', '56466', '56467', '56468', '56470', '56472', '56473', '56474', '56475', '56477', '56479', '56481', '56482', '56484', '56501', '56510', '56511', '56514', '56515', '56516', '56517', '56518', '56519', '56520', '56521', '56522', '56523', '56524', '56525', '56527', '56528', '56529', '56531', '56533', '56534', '56535', '56536', '56537', '56540', '56541', '56542', '56543', '56544', '56545', '56546', '56547', '56548', '56549', '56550', '56551', '56552', '56553', '56554', '56556', '56557', '56560', '56562', '56563', '56565', '56566', '56567', '56568', '56569', '56570', '56571', '56572', '56573', '56574', '56575', '56576', '56578', '56579', '56580', '56581', '56583', '56584', '56585', '56586', '56587', '56588', '56589', '56590', '56591', '56592', '56594', '56601', '56621', '56623', '56626', '56630', '56633', '56634', '56641', '56644', '56646', '56647', '56650', '56651', '56652', '56655', '56662', '56663', '56666', '56667', '56670', '56671', '56672', '56673', '56676', '56678', '56683', '56684', '56685', '56686', '56701', '56710', '56711', '56713', '56714', '56715', '56716', '56720', '56721', '56722', '56723', '56724', '56725', '56726', '56727', '56728', '56729', '56731', '56732', '56733', '56734', '56735', '56736', '56737', '56738', '56742', '56744', '56748', '56750', '56751', '56754', '56755', '56756', '56757', '56758', '56759', '56760', '56761', '56762', '56763', '58030', '58225']::text[]),
  ('MN', 'southeast', 'Southeast Minnesota', 5, array['Dodge', 'Fillmore', 'Freeborn', 'Goodhue', 'Houston', 'Mower', 'Olmsted', 'Rice', 'Steele', 'Wabasha', 'Winona']::text[],
   array['55009', '55018', '55019', '55021', '55026', '55027', '55041', '55046', '55049', '55052', '55053', '55057', '55060', '55066', '55087', '55088', '55089', '55901', '55902', '55903', '55904', '55905', '55906', '55909', '55910', '55912', '55917', '55918', '55919', '55920', '55921', '55922', '55923', '55924', '55925', '55926', '55927', '55929', '55931', '55932', '55933', '55934', '55935', '55936', '55939', '55940', '55941', '55943', '55944', '55945', '55946', '55947', '55949', '55950', '55951', '55952', '55953', '55954', '55955', '55956', '55957', '55959', '55960', '55961', '55962', '55963', '55964', '55965', '55967', '55968', '55969', '55970', '55971', '55972', '55973', '55974', '55975', '55976', '55977', '55979', '55981', '55982', '55983', '55985', '55987', '55990', '55991', '55992', '56007', '56009', '56016', '56020', '56026', '56029', '56032', '56035', '56036', '56042', '56043', '56045', '56046', '56089']::text[]),
  ('MN', 'southwest', 'Southwest Minnesota', 6, array['Big Stone', 'Blue Earth', 'Brown', 'Chippewa', 'Cottonwood', 'Faribault', 'Jackson', 'Lac qui Parle', 'Le Sueur', 'Lincoln', 'Lyon', 'Martin', 'Murray', 'Nicollet', 'Nobles', 'Pipestone', 'Redwood', 'Rock', 'Sibley', 'Swift', 'Waseca', 'Watonwan', 'Yellow Medicine']::text[],
   array['55307', '55334', '55335', '55338', '55366', '55396', '56001', '56003', '56010', '56013', '56014', '56017', '56019', '56021', '56022', '56023', '56024', '56025', '56027', '56028', '56030', '56031', '56033', '56034', '56037', '56039', '56041', '56044', '56048', '56050', '56051', '56052', '56054', '56055', '56056', '56057', '56058', '56060', '56062', '56063', '56065', '56068', '56069', '56071', '56072', '56073', '56074', '56075', '56078', '56080', '56081', '56082', '56083', '56085', '56087', '56088', '56090', '56091', '56093', '56096', '56097', '56098', '56101', '56110', '56111', '56113', '56114', '56115', '56116', '56117', '56118', '56119', '56120', '56121', '56122', '56123', '56125', '56127', '56128', '56129', '56131', '56132', '56134', '56136', '56137', '56138', '56139', '56140', '56141', '56142', '56143', '56144', '56145', '56146', '56147', '56149', '56150', '56151', '56152', '56153', '56155', '56156', '56157', '56158', '56159', '56160', '56161', '56162', '56164', '56165', '56166', '56167', '56168', '56169', '56170', '56171', '56172', '56173', '56174', '56175', '56176', '56178', '56180', '56181', '56183', '56185', '56186', '56187', '56208', '56210', '56211', '56212', '56214', '56215', '56218', '56220', '56222', '56223', '56224', '56225', '56227', '56229', '56231', '56232', '56237', '56239', '56240', '56241', '56245', '56249', '56252', '56255', '56256', '56257', '56258', '56260', '56262', '56263', '56264', '56265', '56266', '56271', '56276', '56278', '56280', '56283', '56287', '56291', '56292', '56293', '56294', '56295', '56297', '57026', '57030', '57068']::text[]),
  ('IA', 'northwest', 'Northwest Iowa', 7, array['Buena Vista', 'Cherokee', 'Clay', 'Dickinson', 'Emmet', 'Lyon', 'O''Brien', 'Osceola', 'Palo Alto', 'Plymouth', 'Pocahontas', 'Sioux']::text[],
   array['50510', '50514', '50515', '50527', '50528', '50531', '50536', '50540', '50541', '50546', '50554', '50562', '50565', '50568', '50571', '50573', '50574', '50576', '50578', '50581', '50585', '50588', '50592', '50593', '50597', '51001', '51002', '51003', '51005', '51008', '51009', '51011', '51012', '51014', '51022', '51023', '51024', '51027', '51028', '51029', '51031', '51033', '51035', '51036', '51037', '51038', '51041', '51045', '51046', '51047', '51049', '51050', '51058', '51061', '51062', '51108', '51109', '51201', '51230', '51231', '51232', '51234', '51235', '51237', '51238', '51239', '51240', '51241', '51242', '51243', '51244', '51245', '51246', '51247', '51248', '51249', '51250', '51301', '51331', '51333', '51334', '51338', '51340', '51341', '51342', '51343', '51345', '51346', '51347', '51350', '51351', '51354', '51355', '51357', '51358', '51360', '51363', '51364', '51365', '51366', '57034']::text[]),
  ('IA', 'north-central', 'North Central Iowa', 8, array['Butler', 'Cerro Gordo', 'Floyd', 'Franklin', 'Hancock', 'Humboldt', 'Kossuth', 'Mitchell', 'Winnebago', 'Worth', 'Wright']::text[],
   array['50041', '50071', '50101', '50227', '50401', '50420', '50421', '50423', '50424', '50426', '50427', '50428', '50430', '50431', '50432', '50433', '50434', '50435', '50436', '50438', '50439', '50440', '50441', '50444', '50446', '50447', '50448', '50449', '50450', '50451', '50452', '50453', '50454', '50455', '50456', '50457', '50458', '50459', '50460', '50461', '50464', '50465', '50467', '50468', '50469', '50470', '50471', '50472', '50473', '50475', '50476', '50477', '50478', '50479', '50480', '50482', '50483', '50484', '50511', '50517', '50519', '50520', '50522', '50525', '50529', '50533', '50539', '50542', '50545', '50548', '50556', '50558', '50559', '50560', '50570', '50577', '50582', '50590', '50591', '50598', '50599', '50601', '50602', '50604', '50605', '50608', '50611', '50616', '50619', '50620', '50625', '50633', '50636', '50649', '50653', '50660', '50665', '50670']::text[]),
  ('IA', 'northeast', 'Northeast Iowa', 9, array['Allamakee', 'Black Hawk', 'Bremer', 'Buchanan', 'Chickasaw', 'Clayton', 'Delaware', 'Dubuque', 'Fayette', 'Howard', 'Winneshiek']::text[],
   array['50466', '50603', '50606', '50607', '50613', '50622', '50623', '50626', '50628', '50629', '50630', '50631', '50634', '50641', '50643', '50644', '50645', '50647', '50648', '50650', '50651', '50654', '50655', '50658', '50659', '50662', '50664', '50666', '50667', '50668', '50671', '50674', '50676', '50677', '50681', '50682', '50701', '50702', '50703', '50707', '52001', '52002', '52003', '52032', '52035', '52036', '52038', '52039', '52040', '52041', '52042', '52043', '52044', '52045', '52046', '52047', '52048', '52049', '52050', '52052', '52053', '52056', '52057', '52065', '52066', '52068', '52072', '52073', '52076', '52077', '52078', '52101', '52132', '52133', '52134', '52135', '52136', '52140', '52141', '52142', '52144', '52146', '52147', '52151', '52154', '52155', '52156', '52157', '52158', '52159', '52160', '52161', '52162', '52163', '52164', '52165', '52166', '52168', '52169', '52170', '52171', '52172', '52175', '52210', '52223', '52237', '52326', '52329', '52330']::text[]),
  ('IA', 'west-central', 'West Central Iowa', 10, array['Audubon', 'Calhoun', 'Carroll', 'Crawford', 'Greene', 'Guthrie', 'Harrison', 'Ida', 'Monona', 'Sac', 'Shelby', 'Woodbury']::text[],
   array['50002', '50025', '50026', '50029', '50042', '50048', '50050', '50058', '50064', '50076', '50107', '50110', '50115', '50117', '50128', '50129', '50164', '50216', '50217', '50235', '50277', '50535', '50538', '50551', '50552', '50561', '50563', '50567', '50575', '50579', '50583', '50586', '51004', '51006', '51007', '51010', '51015', '51016', '51018', '51019', '51020', '51025', '51026', '51030', '51034', '51039', '51040', '51044', '51048', '51051', '51052', '51053', '51054', '51055', '51056', '51060', '51063', '51101', '51103', '51104', '51105', '51106', '51111', '51401', '51430', '51431', '51432', '51433', '51436', '51439', '51440', '51441', '51442', '51443', '51444', '51445', '51446', '51447', '51448', '51449', '51450', '51451', '51452', '51453', '51454', '51455', '51458', '51459', '51460', '51461', '51462', '51463', '51465', '51466', '51467', '51520', '51523', '51527', '51528', '51529', '51530', '51531', '51537', '51543', '51545', '51546', '51550', '51555', '51556', '51557', '51558', '51562', '51563', '51564', '51565', '51570', '51572', '51578', '51579']::text[]),
  ('IA', 'central', 'Central Iowa', 11, array['Boone', 'Dallas', 'Grundy', 'Hamilton', 'Hardin', 'Jasper', 'Marshall', 'Polk', 'Poweshiek', 'Story', 'Tama', 'Webster']::text[],
   array['50003', '50005', '50006', '50007', '50009', '50010', '50012', '50013', '50014', '50021', '50023', '50028', '50031', '50032', '50034', '50035', '50036', '50038', '50039', '50040', '50046', '50051', '50054', '50055', '50056', '50063', '50066', '50069', '50073', '50075', '50078', '50102', '50105', '50106', '50109', '50111', '50112', '50120', '50122', '50124', '50126', '50127', '50130', '50131', '50132', '50134', '50135', '50137', '50141', '50142', '50146', '50148', '50152', '50153', '50154', '50156', '50157', '50158', '50161', '50162', '50167', '50168', '50169', '50170', '50171', '50173', '50201', '50206', '50208', '50212', '50220', '50223', '50226', '50228', '50230', '50231', '50232', '50233', '50234', '50236', '50237', '50239', '50242', '50243', '50244', '50246', '50247', '50248', '50249', '50251', '50258', '50263', '50265', '50266', '50269', '50271', '50276', '50278', '50309', '50310', '50311', '50312', '50313', '50314', '50315', '50316', '50317', '50319', '50320', '50321', '50322', '50323', '50324', '50325', '50327', '50501', '50516', '50518', '50521', '50523', '50524', '50530', '50532', '50543', '50544', '50557', '50566', '50569', '50594', '50595', '50609', '50612', '50621', '50624', '50627', '50632', '50635', '50638', '50642', '50652', '50657', '50669', '50672', '50673', '50675', '50680', '52211', '52215', '52217', '52221', '52222', '52225', '52232', '52339', '52342', '52348']::text[]),
  ('IA', 'east-central', 'East Central Iowa', 12, array['Benton', 'Cedar', 'Clinton', 'Iowa', 'Jackson', 'Johnson', 'Jones', 'Linn', 'Muscatine', 'Scott']::text[],
   array['52030', '52031', '52033', '52037', '52054', '52060', '52064', '52069', '52070', '52071', '52074', '52075', '52079', '52202', '52203', '52205', '52206', '52207', '52208', '52209', '52212', '52213', '52214', '52216', '52218', '52219', '52220', '52224', '52227', '52228', '52229', '52233', '52235', '52236', '52240', '52241', '52242', '52245', '52246', '52247', '52249', '52251', '52252', '52253', '52254', '52255', '52257', '52301', '52302', '52305', '52306', '52307', '52308', '52309', '52310', '52312', '52313', '52314', '52315', '52316', '52317', '52318', '52320', '52321', '52322', '52323', '52324', '52325', '52328', '52332', '52333', '52334', '52336', '52337', '52338', '52340', '52341', '52344', '52345', '52346', '52347', '52349', '52351', '52352', '52354', '52358', '52361', '52362', '52401', '52402', '52403', '52404', '52405', '52411', '52701', '52720', '52721', '52722', '52726', '52727', '52728', '52729', '52730', '52731', '52732', '52742', '52745', '52746', '52747', '52748', '52749', '52750', '52751', '52753', '52754', '52755', '52756', '52757', '52758', '52759', '52760', '52761', '52765', '52766', '52767', '52768', '52769', '52771', '52772', '52773', '52774', '52776', '52777', '52778', '52801', '52802', '52803', '52804', '52806', '52807']::text[]),
  ('IA', 'southwest', 'Southwest Iowa', 13, array['Adair', 'Adams', 'Cass', 'Fremont', 'Mills', 'Montgomery', 'Page', 'Pottawattamie', 'Taylor']::text[],
   array['50020', '50022', '50250', '50274', '50833', '50836', '50837', '50839', '50840', '50841', '50843', '50846', '50847', '50848', '50849', '50851', '50853', '50857', '50858', '50859', '50862', '50864', '51501', '51503', '51510', '51521', '51525', '51526', '51532', '51533', '51534', '51535', '51536', '51540', '51541', '51542', '51544', '51548', '51549', '51551', '51552', '51553', '51554', '51559', '51560', '51561', '51566', '51571', '51573', '51575', '51576', '51577', '51601', '51630', '51631', '51632', '51636', '51637', '51638', '51639', '51640', '51645', '51646', '51647', '51648', '51649', '51650', '51651', '51652', '51653', '51654', '51656']::text[]),
  ('IA', 'south-central', 'South Central Iowa', 14, array['Appanoose', 'Clarke', 'Decatur', 'Lucas', 'Madison', 'Marion', 'Monroe', 'Ringgold', 'Union', 'Warren', 'Wayne']::text[],
   array['50001', '50008', '50033', '50044', '50047', '50049', '50052', '50057', '50060', '50061', '50062', '50065', '50067', '50068', '50070', '50072', '50074', '50103', '50108', '50116', '50118', '50119', '50123', '50125', '50133', '50138', '50139', '50140', '50144', '50145', '50147', '50149', '50150', '50151', '50155', '50160', '50163', '50165', '50166', '50174', '50210', '50211', '50213', '50214', '50218', '50219', '50222', '50225', '50229', '50238', '50240', '50241', '50252', '50254', '50256', '50257', '50261', '50262', '50264', '50272', '50273', '50275', '50801', '50830', '50831', '50835', '50842', '50845', '50854', '50860', '50861', '50863', '52531', '52544', '52549', '52555', '52569', '52571', '52572', '52574', '52581', '52583', '52590', '52593', '52594']::text[]),
  ('IA', 'southeast', 'Southeast Iowa', 15, array['Davis', 'Des Moines', 'Henry', 'Jefferson', 'Keokuk', 'Lee', 'Louisa', 'Mahaska', 'Van Buren', 'Wapello', 'Washington']::text[],
   array['50027', '50104', '50136', '50143', '50207', '50255', '50268', '52201', '52231', '52248', '52327', '52335', '52353', '52355', '52356', '52359', '52501', '52530', '52533', '52534', '52535', '52536', '52537', '52540', '52542', '52543', '52548', '52550', '52551', '52552', '52553', '52554', '52556', '52557', '52560', '52561', '52562', '52563', '52565', '52566', '52567', '52568', '52570', '52573', '52576', '52577', '52580', '52584', '52585', '52586', '52588', '52591', '52595', '52601', '52619', '52620', '52621', '52623', '52624', '52625', '52626', '52627', '52630', '52631', '52632', '52635', '52637', '52638', '52639', '52640', '52641', '52644', '52645', '52646', '52647', '52649', '52650', '52651', '52652', '52653', '52654', '52655', '52656', '52657', '52658', '52659', '52660', '52737', '52738', '52739', '52752']::text[])

on conflict (state, slug) do update set name = excluded.name, sort = excluded.sort, counties = excluded.counties, zips = excluded.zips;

-- The progress key for a target: region:MN:southeast:roofing, or zip:55901:50:any.
create or replace function public.sales_lead_target_key(p_mode text, p_zip text, p_radius integer, p_state text, p_region text, p_trade text) returns text
language sql immutable set search_path = public as $$
  select case when p_mode = 'region' then 'region:' || coalesce(p_state, '') || ':' || coalesce(p_region, '') || ':' || coalesce(p_trade, 'any')
              else 'zip:' || coalesce(p_zip, '') || ':' || coalesce(p_radius, 50) || ':' || coalesce(p_trade, 'any') end
$$;

-- Every batch remembers which target it was run for (whatever the owner changes afterwards).
create or replace function public.sales_lead_batches_target() returns trigger
language plpgsql security definer set search_path = public as $$
declare st public.sales_settings;
begin
  select * into st from public.sales_settings where id;
  if found then
    new.target_mode := coalesce(new.target_mode, st.lead_target_mode);
    new.target_state := coalesce(new.target_state, case when st.lead_target_mode = 'region' then st.lead_target_state end);
    new.target_region := coalesce(new.target_region, case when st.lead_target_mode = 'region' then st.lead_target_region end);
    new.target_key := coalesce(new.target_key, public.sales_lead_target_key(st.lead_target_mode, st.lead_target_zip, st.lead_target_radius_miles, st.lead_target_state, st.lead_target_region, st.lead_target_trade));
    if st.lead_target_mode = 'region' then new.target_zip := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists sales_lead_batches_target on public.sales_lead_batches;
create trigger sales_lead_batches_target before insert on public.sales_lead_batches for each row execute function public.sales_lead_batches_target();

-- The weekly run's target, for the agent (service role only, via the import route). The ZIP fields are
-- unchanged for ZIP mode; region mode adds the region (counties + ZIPs), its download, and where to resume.
create or replace function public.sales_import_target() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mode', s.lead_target_mode,
    'zip', case when s.lead_target_mode = 'zip' then s.lead_target_zip end,
    'radius_miles', s.lead_target_radius_miles,
    'state', case when s.lead_target_mode = 'region' then s.lead_target_state end,
    'trade', s.lead_target_trade, 'count', s.lead_target_count,
    'paused', s.lead_target_paused or case when s.lead_target_mode = 'region' then r.slug is null else s.lead_target_zip is null end,
    'region', case when s.lead_target_mode = 'region' and r.slug is not null then
      jsonb_build_object('state', r.state, 'slug', r.slug, 'name', r.name, 'counties', to_jsonb(r.counties), 'zips', to_jsonb(r.zips)) end,
    'source', case when s.lead_target_mode = 'region' and src.state is not null then to_jsonb(src) - 'updated_at' end,
    'resume', jsonb_build_object('key', k.key, 'cursor', p.cursor, 'checked', coalesce(p.checked, 0), 'added', coalesce(p.added, 0),
                                 'runs', coalesce(p.runs, 0), 'exhausted', coalesce(p.exhausted, false), 'updated_at', p.updated_at))
  from public.sales_settings s
  cross join lateral (select public.sales_lead_target_key(s.lead_target_mode, s.lead_target_zip, s.lead_target_radius_miles, s.lead_target_state, s.lead_target_region, s.lead_target_trade) as key) k
  left join public.sales_lead_regions r on r.state = s.lead_target_state and r.slug = s.lead_target_region
  left join public.sales_lead_sources src on src.state = s.lead_target_state
  left join public.sales_lead_progress p on p.target_key = k.key
  where s.id
$$;

-- ZIP mode (unchanged arguments; now also switches the mode back to ZIP).
create or replace function public.admin_sales_import_target_save(p_caller uuid, p_zip text, p_trade text, p_radius integer, p_count integer, p_paused boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_zip text := substring(coalesce(p_zip, '') from '^\s*([0-9]{5})\s*$');
begin
  perform public.sales_require_admin(p_caller);
  if v_zip is null then raise exception 'invalid_zip'; end if;
  insert into public.sales_settings (id) values (true) on conflict (id) do nothing;
  update public.sales_settings set lead_target_mode = 'zip', lead_target_zip = v_zip, lead_target_trade = left(nullif(lower(btrim(p_trade)), ''), 40),
    lead_target_radius_miles = least(greatest(coalesce(p_radius, 50), 5), 250), lead_target_count = least(greatest(coalesce(p_count, 50), 1), 200),
    lead_target_paused = coalesce(p_paused, false), updated_at = now(), updated_by = p_caller
  where id;
  perform public.sales_audit(p_caller, 'sales.lead_target_set', 'sales_settings', null, jsonb_build_object('mode', 'zip', 'zip', v_zip, 'trade', p_trade, 'radius', p_radius, 'count', p_count, 'paused', p_paused));
  return public.sales_import_target();
end $$;

-- Region mode. p_restart clears this target's progress so the next run starts from the top of the list.
create or replace function public.admin_sales_import_target_save_region(p_caller uuid, p_state text, p_region text, p_trade text, p_count integer, p_paused boolean, p_restart boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_region text := lower(btrim(coalesce(p_region, '')));
  v_trade text := left(nullif(lower(btrim(p_trade)), ''), 40);
begin
  perform public.sales_require_admin(p_caller);
  if not exists (select 1 from public.sales_lead_regions where state = v_state and slug = v_region) then raise exception 'invalid_region'; end if;
  insert into public.sales_settings (id) values (true) on conflict (id) do nothing;
  update public.sales_settings set lead_target_mode = 'region', lead_target_state = v_state, lead_target_region = v_region, lead_target_trade = v_trade,
    lead_target_count = least(greatest(coalesce(p_count, 50), 1), 200), lead_target_paused = coalesce(p_paused, false), updated_at = now(), updated_by = p_caller
  where id;
  if coalesce(p_restart, false) then
    delete from public.sales_lead_progress where target_key = public.sales_lead_target_key('region', null, null, v_state, v_region, v_trade);
  end if;
  perform public.sales_audit(p_caller, 'sales.lead_target_set', 'sales_settings', null,
    jsonb_build_object('mode', 'region', 'state', v_state, 'region', v_region, 'trade', v_trade, 'count', p_count, 'paused', p_paused, 'restart', coalesce(p_restart, false)));
  return public.sales_import_target();
end $$;

-- The region picker for the Hub: states with a free download and their regions, plus progress per region.
create or replace function public.admin_sales_lead_regions(p_caller uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sales_require_admin(p_caller);
  return coalesce((select jsonb_agg(jsonb_build_object('state', src.state, 'state_name', src.state_name, 'source', src.name, 'url', src.url,
      'regions', (select coalesce(jsonb_agg(jsonb_build_object('slug', r.slug, 'name', r.name, 'counties', to_jsonb(r.counties), 'zip_count', cardinality(r.zips)) order by r.sort), '[]'::jsonb)
                  from public.sales_lead_regions r where r.state = src.state)) order by src.state_name)
    from public.sales_lead_sources src), '[]'::jsonb);
end $$;

-- After a run posts its leads: record how far it got (service role only, via the import route). Applied
-- once per batch (a retried batch changes nothing) and to the target the batch was run for.
create or replace function public.sales_import_progress_save(p_batch text, p_cursor text, p_checked integer, p_exhausted boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.sales_lead_batches; p public.sales_lead_progress;
begin
  select * into b from public.sales_lead_batches where external_id = btrim(coalesce(p_batch, '')) for update;
  if not found then raise exception 'batch_not_found'; end if;
  if b.target_key is null then raise exception 'no_target'; end if;
  if b.progress_cursor is not null then
    select * into p from public.sales_lead_progress where target_key = b.target_key;
    return to_jsonb(p) || jsonb_build_object('replayed', true);
  end if;
  update public.sales_lead_batches set progress_cursor = left(btrim(p_cursor), 200), progress_checked = greatest(coalesce(p_checked, 0), 0) where id = b.id;
  insert into public.sales_lead_progress as x (target_key, cursor, checked, added, runs, exhausted, updated_at)
  values (b.target_key, left(btrim(p_cursor), 200), greatest(coalesce(p_checked, 0), 0), b.added, 1, coalesce(p_exhausted, false), now())
  on conflict (target_key) do update set cursor = excluded.cursor, checked = x.checked + excluded.checked, added = x.added + excluded.added,
    runs = x.runs + 1, exhausted = excluded.exhausted, updated_at = now()
  returning * into p;
  return to_jsonb(p) || jsonb_build_object('replayed', false);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.sales_lead_target_key(text, text, integer, text, text, text)', 'public.sales_lead_batches_target()', 'public.sales_import_target()',
                               'public.admin_sales_import_target_save(uuid, text, text, integer, integer, boolean)',
                               'public.admin_sales_import_target_save_region(uuid, text, text, text, integer, boolean, boolean)',
                               'public.admin_sales_lead_regions(uuid)', 'public.sales_import_progress_save(text, text, integer, boolean)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
