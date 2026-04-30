create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('management', 'operator')),
  created_at timestamptz not null default now()
);

create table if not exists price_ranges (
  id bigint generated always as identity primary key,
  category text not null,
  caliber_range text not null,
  minimum_price numeric(10, 2) not null,
  target_price numeric(10, 2) not null,
  breakeven_price numeric(10, 2) not null default 0,
  cost numeric(10, 2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (category, caliber_range)
);

alter table price_ranges add column if not exists breakeven_price numeric(10, 2) not null default 0;
alter table price_ranges add column if not exists cost numeric(10, 2) not null default 0;

create table if not exists stock_items (
  id bigint generated always as identity primary key,
  container text not null,
  pallet_code text not null,
  caliber text not null,
  category text not null,
  caliber_range text not null,
  boxes numeric(12, 2) not null check (boxes >= 0),
  kilos numeric(12, 2) not null check (kilos >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (container, pallet_code, caliber)
);

create table if not exists upload_batches (
  id uuid primary key default gen_random_uuid(),
  batch_type text not null check (batch_type in ('stock', 'sales')),
  file_name text,
  rows_count integer not null default 0,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists sales (
  id bigint generated always as identity primary key,
  batch_id uuid references upload_batches(id) on delete cascade,
  sale_date date not null,
  container text not null,
  pallet_code text not null,
  caliber text not null,
  boxes numeric(12, 2) not null check (boxes > 0),
  kilos numeric(12, 2) not null check (kilos > 0),
  sale_price numeric(10, 2) not null check (sale_price > 0),
  client text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant usage on schema public to authenticated;
grant select on profiles to authenticated;
grant select, update on price_ranges to authenticated;
grant select, insert, update, delete on stock_items to authenticated;
grant select, insert, update, delete on sales to authenticated;
grant select, insert, update, delete on upload_batches to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table profiles enable row level security;
alter table price_ranges enable row level security;
alter table stock_items enable row level security;
alter table upload_batches enable row level security;
alter table sales enable row level security;

drop policy if exists "profiles read own" on profiles;
create policy "profiles read own"
on profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles admin insert" on profiles;
create policy "profiles admin insert"
on profiles for insert
to authenticated
with check (false);

drop policy if exists "prices read authenticated" on price_ranges;
create policy "prices read authenticated"
on price_ranges for select
to authenticated
using (true);

drop policy if exists "prices operator write" on price_ranges;
create policy "prices operator write"
on price_ranges for all
to authenticated
using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'operator'))
with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'operator'));

drop policy if exists "stock read authenticated" on stock_items;
create policy "stock read authenticated"
on stock_items for select
to authenticated
using (true);

drop policy if exists "stock operator write" on stock_items;
create policy "stock operator write"
on stock_items for all
to authenticated
using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'operator'))
with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'operator'));

drop policy if exists "sales read authenticated" on sales;
create policy "sales read authenticated"
on sales for select
to authenticated
using (true);

drop policy if exists "sales operator write" on sales;
create policy "sales operator write"
on sales for all
to authenticated
using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'operator'))
with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'operator'));

drop policy if exists "batches read operator" on upload_batches;
create policy "batches read operator"
on upload_batches for select
to authenticated
using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'operator'));

drop policy if exists "batches operator write" on upload_batches;
create policy "batches operator write"
on upload_batches for all
to authenticated
using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'operator'))
with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'operator'));

insert into price_ranges (category, caliber_range, minimum_price, target_price, breakeven_price, cost)
values
  ('CAT 1*', 'C12-18', 2.32, 3.00, 0, 0),
  ('CAT 1*', 'C20-24', 2.18, 2.70, 0, 0),
  ('CAT 1*', 'C26-28', 1.90, 2.00, 0, 0),
  ('CAT 1*', 'C30-32', 1.69, 2.00, 0, 0),
  ('CAT 1', 'C12-18', 2.52, 3.30, 0, 0),
  ('CAT 1', 'C20-24', 2.38, 2.93, 0, 0),
  ('CAT 1', 'C26-28', 2.10, 2.10, 0, 0),
  ('CAT 1', 'C30-32', 1.89, 2.10, 0, 0)
on conflict (category, caliber_range) do update
set
  minimum_price = excluded.minimum_price,
  target_price = excluded.target_price,
  breakeven_price = excluded.breakeven_price,
  cost = excluded.cost,
  updated_at = now();
