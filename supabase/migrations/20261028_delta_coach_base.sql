-- Applicata al progetto Supabase il 28/10/2026 (copia di riferimento).
create table public.user_docs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null, data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(),
  primary key (user_id, id));
alter table public.user_docs enable row level security;
create policy "user_docs_select_own" on public.user_docs for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_docs_insert_own" on public.user_docs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_docs_update_own" on public.user_docs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_docs_delete_own" on public.user_docs for delete to authenticated using ((select auth.uid()) = user_id);

create table public.shared_docs (
  coll text not null, id text not null, data jsonb not null default '{}'::jsonb,
  owner uuid default auth.uid() references auth.users(id) on delete set null, updated_at timestamptz not null default now(),
  primary key (coll, id));
create index shared_docs_data_gin on public.shared_docs using gin (data jsonb_path_ops);
create index shared_docs_owner_idx on public.shared_docs (owner);
alter table public.shared_docs enable row level security;
create policy "shared_docs_select_auth" on public.shared_docs for select to authenticated using (true);
create policy "shared_docs_insert_auth" on public.shared_docs for insert to authenticated with check ((select auth.uid()) = owner);
create policy "shared_docs_update_auth" on public.shared_docs for update to authenticated using (true) with check (true);
create policy "shared_docs_delete_owner" on public.shared_docs for delete to authenticated using ((select auth.uid()) = owner);

create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade, day date not null default current_date, n integer not null default 0,
  primary key (user_id, day));
alter table public.ai_usage enable row level security;
create policy "ai_usage_select_own" on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger user_docs_touch before update on public.user_docs for each row execute function public.touch_updated_at();
create trigger shared_docs_touch before update on public.shared_docs for each row execute function public.touch_updated_at();

create or replace function public.ai_bump(uid uuid, lim integer) returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  insert into public.ai_usage (user_id, day, n) values (uid, current_date, 1)
  on conflict (user_id, day) do update set n = public.ai_usage.n + 1 returning n into v;
  return v;
end; $$;
revoke all on function public.ai_bump(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_bump(uuid, integer) to service_role;
