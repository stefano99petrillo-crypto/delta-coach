-- Dati dal PT al cliente: il PT pubblica in shared_docs (coll 'dalpt', id = uid del cliente) quello che registra
-- per un cliente abbinato. Scrive solo un PT attivo e solo per un cliente che si è collegato a lui con il codice;
-- legge solo il cliente stesso, finché resta collegato a quel PT.

create or replace function public.dc_is_my_client(cli text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shared_docs d where d.coll = 'condivisi' and d.id = cli and d.data->>'pt' = (select auth.uid())::text);
$$;
revoke all on function public.dc_is_my_client(text) from public, anon;
grant execute on function public.dc_is_my_client(text) to authenticated;

drop policy if exists sd_insert on public.shared_docs;
create policy sd_insert on public.shared_docs for insert to authenticated with check (
  (owner = (select auth.uid())) and (
    ((coll = 'condivisi') and (id = ((select auth.uid()))::text))
    or ((coll = 'prenotazioni') and ((data->>'cliente') = ((select auth.uid()))::text))
    or ((coll = 'staff') and (id = ((select auth.uid()))::text) and (select public.dc_is_staff((select auth.uid()))))
    or ((coll = 'codici_pt') and ((data->>'pt') = ((select auth.uid()))::text) and (select public.dc_is_staff((select auth.uid()))))
    or ((coll = 'approvazioni') and ((data->>'autore') = ((select auth.uid()))::text) and (select public.dc_is_staff((select auth.uid()))))
    or ((coll = 'config') and (select public.dc_is_admin()))
    or ((coll = 'dalpt') and ((data->>'pt') = ((select auth.uid()))::text) and ((data->>'cliente') = id) and (select public.dc_is_staff((select auth.uid()))) and public.dc_is_my_client(id))
  )
);

drop policy if exists sd_update on public.shared_docs;
create policy sd_update on public.shared_docs for update to authenticated using (
  ((owner = (select auth.uid())) and (coll = any (array['condivisi','prenotazioni','staff','codici_pt','approvazioni','dalpt'])))
  or ((coll = 'prenotazioni') and ((data->>'pt') = ((select auth.uid()))::text) and (select public.dc_is_staff((select auth.uid()))))
  or ((coll = any (array['approvazioni','config'])) and (select public.dc_is_admin()))
) with check (
  ((owner = (select auth.uid())) and (
    ((coll = 'condivisi') and (id = ((select auth.uid()))::text))
    or ((coll = 'prenotazioni') and ((data->>'cliente') = ((select auth.uid()))::text))
    or ((coll = any (array['staff','codici_pt','approvazioni'])) and (select public.dc_is_staff((select auth.uid()))))
    or ((coll = 'dalpt') and ((data->>'pt') = ((select auth.uid()))::text) and ((data->>'cliente') = id) and (select public.dc_is_staff((select auth.uid()))) and public.dc_is_my_client(id))
  ))
  or ((coll = 'prenotazioni') and ((data->>'pt') = ((select auth.uid()))::text) and (select public.dc_is_staff((select auth.uid()))))
  or ((coll = any (array['approvazioni','config'])) and (select public.dc_is_admin()))
);

drop policy if exists sd_select on public.shared_docs;
create policy sd_select on public.shared_docs for select to authenticated using (
  (owner = (select auth.uid()))
  or (coll = any (array['staff','codici_pt','config']))
  or ((coll = any (array['condivisi','prenotazioni'])) and ((data->>'pt') = ((select auth.uid()))::text) and (select public.dc_is_staff((select auth.uid()))))
  or ((coll = 'prenotazioni') and (((data->>'cliente') = ((select auth.uid()))::text) or ((data->>'pt') = (select public.dc_my_pt()))))
  or ((coll = 'approvazioni') and (select public.dc_is_admin()))
  or ((coll = 'dalpt') and (id = ((select auth.uid()))::text) and (owner::text = (select public.dc_my_pt())))
);
