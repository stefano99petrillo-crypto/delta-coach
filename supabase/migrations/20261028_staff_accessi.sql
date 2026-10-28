-- Delta Coach · accessi staff verificati sul server e dati condivisi visibili solo a chi spettano.
-- Lo staff (PT, GT, manager) entra con un codice segreto e resta "in attesa" finché un admin non lo approva.

create table if not exists public.dc_members (
  uid uuid primary key references auth.users(id) on delete cascade,
  ruolo text not null check (ruolo in ('pt', 'gt', 'manager')),
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'attivo', 'revocato')),
  admin boolean not null default false,
  nome text,
  creato timestamptz not null default now(),
  deciso timestamptz
);
create table if not exists public.dc_codes (
  ruolo text primary key check (ruolo in ('pt', 'gt', 'manager')),
  codice text not null unique
);
alter table public.dc_members enable row level security;
alter table public.dc_codes enable row level security;
-- nessuna policy: si leggono e scrivono solo con le funzioni qui sotto
revoke all on public.dc_members, public.dc_codes from anon, authenticated;

create or replace function public.dc_new_code(p_ruolo text) returns text language sql volatile set search_path = '' as $$
  select (case p_ruolo when 'pt' then 'PT' when 'gt' then 'GT' else 'MGR' end) || '-' ||
    string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

create or replace function public.dc_is_staff(u uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dc_members m where m.uid = u and m.stato = 'attivo');
$$;
create or replace function public.dc_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dc_members m where m.uid = (select auth.uid()) and m.stato = 'attivo' and (m.admin or m.ruolo = 'manager'));
$$;
-- il PT a cui è collegato il cliente che chiama (serve per vedere gli orari già occupati)
create or replace function public.dc_my_pt() returns text language sql stable security definer set search_path = '' as $$
  select d.data->>'pt' from public.shared_docs d where d.coll = 'condivisi' and d.id = (select auth.uid())::text;
$$;

create or replace function public.dc_me() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('ruolo', m.ruolo, 'stato', m.stato, 'admin', m.admin or m.ruolo = 'manager', 'nome', m.nome)
    from public.dc_members m where m.uid = (select auth.uid())), 'null'::jsonb);
$$;

create or replace function public.dc_join_staff(p_code text, p_nome text) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r text; m public.dc_members;
begin
  if auth.uid() is null then raise exception 'not_logged' using errcode = '42501'; end if;
  select c.ruolo into r from public.dc_codes c where upper(c.codice) = upper(trim(coalesce(p_code, '')));
  if r is null then raise exception 'codice_non_valido' using errcode = 'P0001'; end if;
  select * into m from public.dc_members where uid = auth.uid();
  if m.uid is null then
    insert into public.dc_members (uid, ruolo, nome) values (auth.uid(), r, left(trim(p_nome), 60)) returning * into m;
  elsif m.stato = 'in_attesa' then
    update public.dc_members set ruolo = r, nome = left(trim(p_nome), 60), creato = now() where uid = auth.uid() returning * into m;
  end if;
  return jsonb_build_object('ruolo', m.ruolo, 'stato', m.stato, 'admin', m.admin or m.ruolo = 'manager', 'nome', m.nome);
end $$;

create or replace function public.dc_admin_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.dc_is_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  return jsonb_build_object(
    'codici', (select coalesce(jsonb_object_agg(c.ruolo, c.codice), '{}'::jsonb) from public.dc_codes c),
    'membri', (select coalesce(jsonb_agg(jsonb_build_object('uid', m.uid, 'ruolo', m.ruolo, 'stato', m.stato, 'admin', m.admin, 'nome', m.nome,
        'email', u.email, 'creato', m.creato, 'deciso', m.deciso,
        'codice', (select s.data->>'codice' from public.shared_docs s where s.coll = 'staff' and s.id = m.uid::text),
        'clienti', (select count(*) from public.shared_docs s where s.coll = 'condivisi' and s.data->>'pt' = m.uid::text)) order by m.creato), '[]'::jsonb)
      from public.dc_members m join auth.users u on u.id = m.uid));
end $$;

create or replace function public.dc_admin_set(p_uid uuid, p_stato text) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.dc_is_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  if p_uid = auth.uid() then raise exception 'non_su_te_stesso' using errcode = 'P0001'; end if;
  if p_stato = 'rifiutato' then delete from public.dc_members where uid = p_uid and stato = 'in_attesa'; return; end if;
  if p_stato not in ('attivo', 'revocato') then raise exception 'stato_non_valido' using errcode = 'P0001'; end if;
  update public.dc_members set stato = p_stato, deciso = now() where uid = p_uid;
  -- un PT disattivato non può più ricevere nuovi clienti
  if p_stato = 'revocato' then delete from public.shared_docs where coll = 'codici_pt' and data->>'pt' = p_uid::text; end if;
end $$;

create or replace function public.dc_admin_regen(p_ruolo text) returns text language plpgsql volatile security definer set search_path = '' as $$
declare c text;
begin
  if not public.dc_is_admin() then raise exception 'solo_admin' using errcode = '42501'; end if;
  c := public.dc_new_code(p_ruolo);
  insert into public.dc_codes (ruolo, codice) values (p_ruolo, c) on conflict (ruolo) do update set codice = excluded.codice;
  return c;
end $$;

revoke all on function public.dc_new_code(text), public.dc_is_staff(uuid), public.dc_is_admin(), public.dc_my_pt(), public.dc_me(),
  public.dc_join_staff(text, text), public.dc_admin_overview(), public.dc_admin_set(uuid, text), public.dc_admin_regen(text) from public, anon;
grant execute on function public.dc_is_staff(uuid), public.dc_is_admin(), public.dc_my_pt(), public.dc_me(),
  public.dc_join_staff(text, text), public.dc_admin_overview(), public.dc_admin_set(uuid, text), public.dc_admin_regen(text) to authenticated;

-- codici iniziali (casuali, diversi da quelli scritti nel codice dell'app)
insert into public.dc_codes (ruolo, codice) select r, public.dc_new_code(r) from unnest(array['pt', 'gt', 'manager']) r on conflict do nothing;

-- ---------- regole di shared_docs ----------
drop policy if exists "shared_docs_select_auth" on public.shared_docs;
drop policy if exists "shared_docs_insert_auth" on public.shared_docs;
drop policy if exists "shared_docs_update_auth" on public.shared_docs;
drop policy if exists "shared_docs_delete_owner" on public.shared_docs;

create policy "sd_select" on public.shared_docs for select to authenticated using (
  owner = (select auth.uid())
  or coll in ('staff', 'codici_pt', 'config')
  or (coll in ('condivisi', 'prenotazioni') and data->>'pt' = (select auth.uid())::text and (select public.dc_is_staff((select auth.uid()))))
  or (coll = 'prenotazioni' and (data->>'cliente' = (select auth.uid())::text or data->>'pt' = (select public.dc_my_pt())))
  or (coll = 'approvazioni' and (select public.dc_is_admin()))
);
create policy "sd_insert" on public.shared_docs for insert to authenticated with check (
  owner = (select auth.uid()) and (
    (coll = 'condivisi' and id = (select auth.uid())::text)
    or (coll = 'prenotazioni' and data->>'cliente' = (select auth.uid())::text)
    or (coll = 'staff' and id = (select auth.uid())::text and (select public.dc_is_staff((select auth.uid()))))
    or (coll = 'codici_pt' and data->>'pt' = (select auth.uid())::text and (select public.dc_is_staff((select auth.uid()))))
    or (coll = 'approvazioni' and data->>'autore' = (select auth.uid())::text and (select public.dc_is_staff((select auth.uid()))))
    or (coll = 'config' and (select public.dc_is_admin()))
  )
);
create policy "sd_update" on public.shared_docs for update to authenticated
  using (
    (owner = (select auth.uid()) and coll in ('condivisi', 'prenotazioni', 'staff', 'codici_pt', 'approvazioni'))
    or (coll = 'prenotazioni' and data->>'pt' = (select auth.uid())::text and (select public.dc_is_staff((select auth.uid()))))
    or (coll in ('approvazioni', 'config') and (select public.dc_is_admin()))
  )
  with check (
    (owner = (select auth.uid()) and (
      (coll = 'condivisi' and id = (select auth.uid())::text)
      or (coll = 'prenotazioni' and data->>'cliente' = (select auth.uid())::text)
      or (coll in ('staff', 'codici_pt', 'approvazioni') and (select public.dc_is_staff((select auth.uid()))))
    ))
    or (coll = 'prenotazioni' and data->>'pt' = (select auth.uid())::text and (select public.dc_is_staff((select auth.uid()))))
    or (coll in ('approvazioni', 'config') and (select public.dc_is_admin()))
  );
create policy "sd_delete" on public.shared_docs for delete to authenticated using (owner = (select auth.uid()));

-- Stefano: PT e admin
insert into public.dc_members (uid, ruolo, stato, admin, nome, deciso)
select id, 'pt', 'attivo', true, 'Stefano', now() from auth.users where email = 'stefano99petrillo@gmail.com'
on conflict (uid) do update set stato = 'attivo', admin = true;
