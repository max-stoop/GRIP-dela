-- Wat het datamodel (grip.sql) verwacht: auth.uid(), de rol authenticated en de tabellen users en regios.
-- Volgorde: dit bestand, dan grip.sql, dan live.sql. De app voert ze zelf uit bij een nieuwe versie.

create schema if not exists auth;

-- De app zet grip.uid per transactie op het oid van het werkaccount (lib/server/postgres.ts).
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('grip.uid', true), '')::uuid $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not pg_has_role(current_user, 'authenticated', 'member') then
    execute format('grant authenticated to %I', current_user);
  end if;
end $$;

create table if not exists regios (
  id bigint generated always as identity primary key,
  naam text not null unique
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique,
  email text not null,
  naam text,
  rol text not null default 'Uitvaartverzorger/Leider',
  regios bigint[] not null default '{}'
);
create unique index if not exists users_email on users (lower(email));

alter table users enable row level security;
alter table regios enable row level security;
drop policy if exists users_eigen on users;
create policy users_eigen on users for select using (auth_id = (select auth.uid()));
drop policy if exists regios_lezen on regios;
create policy regios_lezen on regios for select using (true);

-- Een nieuwe database krijgt de 25 regio's.
insert into regios (naam)
select r from unnest(array[
  'Friesland', 'Groningen', 'Noord-Oost', 'Twente/Achterhoek', 'Veluwe-IJssel',
  'Amsterdam', 'Noord-Holland', 'Noord-Holland Midden', 'Spaarne-Rijnland',
  'Arnhem', 'Midden Nederland', 'Nijmegen', 'Utrecht',
  'Haaglanden', 'Rotterdam', 'West Brabant/Zeeland', 'Zuid Holland Zuid',
  'Kempenland', 'Midden Limburg', 'Oost Brabant', 'Zuid Limburg',
  'Breda', 'Den Bosch', 'Eindhoven', 'Tilburg'
]) r
where not exists (select 1 from regios);

create table if not exists grip_installatie (
  id int primary key default 1 check (id = 1),
  sql_hash text not null,
  bijgewerkt timestamptz not null default now()
);
alter table grip_installatie enable row level security;
