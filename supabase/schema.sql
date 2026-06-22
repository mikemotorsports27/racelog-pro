create table if not exists public.app_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_state_updated_at on public.app_state;

create trigger set_app_state_updated_at
before update on public.app_state
for each row
execute function public.set_updated_at();

alter table public.app_state enable row level security;

drop policy if exists "Allow public read app state" on public.app_state;
drop policy if exists "Allow public insert app state" on public.app_state;
drop policy if exists "Allow public update app state" on public.app_state;

create policy "Allow public read app state"
on public.app_state
for select
to anon, authenticated
using (true);

create policy "Allow public insert app state"
on public.app_state
for insert
to anon, authenticated
with check (true);

create policy "Allow public update app state"
on public.app_state
for update
to anon, authenticated
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end $$;
