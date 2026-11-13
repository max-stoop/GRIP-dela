-- ============================================================================
-- GRIP: het datamodel
--
-- Alle tabellen, functies, triggers en toegangsregels (RLS) van GRIP in één bestand. De app voert het zelf uit, na
-- azure/database/basis.sql en voor live.sql. Mag vaker worden uitgevoerd. Getest op Postgres in __tests__/database.
--
-- Uitgangspunten
--   * Alle tabellen en functies beginnen met rp_. Daarnaast gebruikt de app de tabellen users (wie mag inloggen, met
--     rol en regio's) en regios uit basis.sql. Daaraan voegt dit bestand alleen de regio NBD en een trigger toe die
--     rol en regio's bewaakt.
--   * Inloggen gaat met het werkaccount (Entra ID) en users. Rollen: users.rol 'Planner' = beheerder, 'Regio Manager' (en
--     clustermanager) = regiomanager, overige '* Planner' / '* Manager' = planner, de rest = medewerker (zie
--     lib/sessie.ts en lib/rechten.ts).
--   * We roosteren per maand: de planner maakt het maandrooster, geeft er een advies bij (groen, oranje of rood) en
--     biedt het aan; de regiomanager keurt rooster en verlof goed (§ 5.1).
--   * Regio's zijn tekst (de 25 regionamen, en NBD voor de nabestaandendesk), zoals in het model. De NBD telt niet
--     mee in de regelplekken van de 25 regio's.
--   * RLS staat aan op elke tabel; de server (de dagelijkse voorspelling) werkt als eigenaar, zonder RLS.
--   * Diensten volgens roosterbeleid 1.3 met de wijzigingen voor 2027: 1, 1M, 2, 1B (telt als regelplek, gewogen 2
--     uur), DG1 (4 uur, 1 voorgang), DG2 (8 uur, 2 voorgangen), O, OR, VMS, TD, V (verlof), Z (ziek) en N (een
--     NBD-dienst met eigen tijden).
--   * De normen komen uit de vastgestelde regelplekken 2027 (rp_norm_regio en rp_instelling 'normen'); de app rekent
--     ze precies zoals de Excel.
--   * Veilig opslaan: alles van één bewaarmoment gaat in één transactie (rp_bewaar), en elke rij heeft een
--     versienummer (rij_versie), zodat niemand ongemerkt de wijziging van een ander overschrijft.
-- ============================================================================

-- ── Rol en regio's van wie is ingelogd ─────────────────────────────────────

create or replace function rp_rol() returns text
language sql stable security definer set search_path = public as $$
  select case
    when u.rol::text in ('Planner', 'Beheerder') then 'beheerder'
    when u.rol::text ilike '%regio%manager%' or u.rol::text ilike '%cluster%manager%' then 'regiomanager'
    when u.rol::text ilike '%planner%' or u.rol::text ilike '%manager%' then 'planner'
    else 'medewerker'
  end
  from users u where u.auth_id = auth.uid()
$$;

-- Regio's waar de gebruiker bij mag. Een planner plant landelijk: altijd alle regio's, wat er ook in users.regios staat
-- (de lege lijst; zie rp_mag_alle). Ook de beheerder. Een regiomanager en een medewerker houden precies hun eigen
-- regio's: een lege lijst, of id's die naar geen regio wijzen, is voor hen geen enkele regio, nooit alle. "Alle regio's"
-- is voor een regiomanager een bewuste keuze: alle regio's staan dan in users.regios.
create or replace function rp_regios() returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when rp_rol() in ('beheerder', 'planner') then '{}'::text[]
    else coalesce((
      select array_agg(r.naam)
      from users u join regios r on r.id = any(u.regios)
      where u.auth_id = auth.uid()
    ), '{}')
  end
$$;

-- Voor de toegangsregels: alleen de beheerder en de planner mogen alle regio's; een regiomanager altijd alleen de regio's
-- uit rp_regios_mag(), ook als die lijst leeg is.
create or replace function rp_mag_alle() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rp_rol() in ('beheerder', 'planner'), false)
$$;
create or replace function rp_regios_mag() returns text[]
language sql stable security definer set search_path = public as $$
  select case when rp_rol() in ('beheerder', 'regiomanager', 'planner') then rp_regios() else '{}'::text[] end
$$;

-- De rol, de regio's en de koppeling met het inlogaccount in users wijzigt alleen de beheerder (of de server, zonder
-- ingelogde gebruiker). Zo kan niemand zichzelf een andere rol geven, ook niet als er op users een regel staat waarmee je je
-- eigen profiel mag bijwerken.
create or replace function rp_users_bewaken() returns trigger
language plpgsql as $$
begin
  -- de server en een beheerder met psql hebben geen ingelogde gebruiker; de beheerder mag het ook
  if auth.uid() is null or rp_rol() = 'beheerder' then return new; end if;
  if tg_op = 'INSERT' then raise exception 'Gebruikers voegt de beheerder toe'; end if;
  if (new.rol, new.regios, new.auth_id, new.email) is distinct from (old.rol, old.regios, old.auth_id, old.email) then
    raise exception 'Rol, regio''s, e-mailadres en account wijzigt alleen de beheerder';
  end if;
  return new;
end $$;
create or replace trigger rp_users_bewaken before insert or update on users for each row execute function rp_users_bewaken();

-- ── Normen, schoolvakanties en instellingen ────────────────────────────────

-- Per regio de getallen uit de Excel. De landelijke parameters (seizoen, weekdagindex, dekkingsgraden, uren per
-- dienst) staan als JSON in rp_instelling onder 'normen'.
create table if not exists rp_norm_regio (
  regio        text primary key,
  cluster      text not null check (cluster in ('N', 'NW', 'O', 'W', 'ZO', 'ZW')),
  natura       double precision not null,
  cbs          double precision not null,
  vrije_markt  double precision not null,
  amplitude    double precision not null,
  voorgangen   smallint not null default 4,
  fte          numeric(6,3)[] not null check (cardinality(fte) = 4),   -- per kwartaal
  correctie    double precision not null default 1,
  bijgewerkt   timestamptz not null default now(),
  rij_versie   bigint not null default 1
);

-- De beheerder en de planner (landelijk) openen een vakantieronde voor elk cluster; een regiomanager voor een cluster
-- waar een van de eigen regio's in valt.
create or replace function rp_mag_cluster(p_cluster text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rp_rol() in ('beheerder', 'planner'), false) or (rp_rol() = 'regiomanager' and exists (
    select 1 from rp_norm_regio n where (p_cluster = 'NL' or n.cluster = p_cluster) and n.regio = any(rp_regios())
  ))
$$;

-- Schoolvakanties per regio (noord, midden, zuid), opgehaald bij rijksoverheid.nl of handmatig.
create table if not exists rp_schoolvakantie (
  id          text primary key,
  naam        text not null,
  regio       text not null check (regio in ('noord', 'midden', 'zuid', 'alle')),
  van         date not null,
  tot         date not null check (tot >= van),
  bron        text not null default 'handmatig' check (bron in ('rijksoverheid', 'indicatief', 'handmatig')),
  rij_versie  bigint not null default 1
);

-- Losse instellingen: beleid, normen, roosterbasis, klimaatnormaal, backtest, de dagelijkse voorspelling.
create table if not exists rp_instelling (
  sleutel     text primary key,
  waarde      jsonb not null,
  gewijzigd   timestamptz not null default now(),
  rij_versie  bigint not null default 1
);

-- ── Model: meldingen, bronnen, voorspellingen ──────────────────────────────

create table if not exists rp_meldingen (
  datum   date    not null,
  regio   text    not null,
  aantal  integer not null check (aantal >= 0),
  primary key (datum, regio)
);

-- Externe bronnen per bron (weer, lucht, seizoen, riool, cbs): variabele -> regio of NL -> datum -> waarde.
-- Eén rij per bron, omdat de app een bron altijd in zijn geheel ververst en gebruikt.
create table if not exists rp_extern (
  bron        text primary key,
  data        jsonb not null,
  opgehaald   timestamptz not null default now(),
  rij_versie  bigint not null default 1
);

create table if not exists rp_bron_status (
  bron        text primary key,
  opgehaald   timestamptz not null,
  ok          boolean not null,
  melding     text not null default '',
  rijen       integer not null default 0,
  rij_versie  bigint not null default 1
);

create table if not exists rp_handmatig (
  variabele   text not null,             -- flu_ili
  datum       date not null,
  waarde      double precision not null,
  rij_versie  bigint not null default 1,
  primary key (variabele, datum)
);

create table if not exists rp_run (
  id          text primary key,        -- bijv. 2026-10-05_060012
  soort       text not null,           -- dagelijks, handmatig, na upload, na kalibratie
  uitgegeven  date not null,
  gemaakt     timestamptz not null default now(),
  info        jsonb not null,          -- notes, mom7, level28, cbs, covid, flu, data_end, coef
  data        jsonb not null,          -- de voorspelling zelf: dagen, regio's, verwachting, basis en factoren (lib/model/types.ts RunData)
  rij_versie  bigint not null default 1
);
create index if not exists rp_run_uitgegeven on rp_run (uitgegeven desc);

create table if not exists rp_coef (
  naam        text primary key,        -- heat, cold, pm25, ... (zie lib/model/config.ts)
  waarde      double precision not null,
  se          double precision not null,
  dagen       integer not null,
  bijgewerkt  timestamptz not null default now(),
  rij_versie  bigint not null default 1
);

-- ── Team ────────────────────────────────────────────────────────────────────

-- Verlofrecht en verlofsaldo staan bewust niet in GRIP: die lopen via de personeelsadministratie.
create table if not exists rp_medewerker (
  id            uuid primary key default gen_random_uuid(),
  regio         text not null,
  naam          text not null,
  contract      numeric(4,1) not null check (contract between 4 and 40),
  -- maximale inzet per week: bij een variabel rooster meer uren dan het contract (leeg = het contract)
  max_uren      numeric(4,1) check (max_uren is null or max_uren between 4 and 60),
  voorkeur      char(1) not null default 'O' check (voorkeur in ('O', 'M')),
  -- om de hoeveel weekenden iemand werkt (1 = elk weekend, 2 = om het weekend, 3 = 1 op 3, 4 = 1 op 4), en welk
  -- weekend in die cadans: A, B, C of D (0 t/m 3)
  weekendgroep  smallint not null default 0 check (weekendgroep between 0 and 3),
  weekend_cadans smallint not null default 2 check (weekend_cadans between 1 and 4),
  functie       text not null default 'UV' check (functie in ('UV', 'UL')),   -- uitvaartverzorger of uitvaartleider
  afstandsverklaring boolean not null default false,                       -- CAO: 26 vrije weekenden geldt dan niet
  extern        boolean not null default false,                            -- externe kracht of ZZP'er: niet in de formatie
  email         text,
  user_id       uuid references users (id) on delete set null,
  actief        boolean not null default true,
  -- de volgorde in het rooster: de planner schuift namen omhoog en omlaag. Leeg = op naam, met de uitvaartverzorgers
  -- bovenaan en de uitvaartleiders onderaan.
  volgorde      integer check (volgorde is null or volgorde between 1 and 10000),
  -- de woonplaats als postcode (4 cijfers): daar begint de reis naar het eerste gesprek bij het verdelen
  postcode      text check (postcode is null or postcode ~ '^[1-9][0-9]{3}$'),
  aangemaakt    timestamptz not null default now(),
  rij_versie    bigint not null default 1
);
create index if not exists rp_medewerker_regio on rp_medewerker (regio) where actief;

-- ── Rooster en diensttijden ─────────────────────────────────────────────────

create table if not exists rp_rooster (
  medewerker_id  uuid not null references rp_medewerker (id) on delete cascade,
  datum          date not null,
  regio          text not null,
  dienst         text not null check (dienst in ('1', '1M', '2', '1B', 'DG1', 'DG2', 'O', 'O4', 'OR', 'VMS', 'TD', 'V', 'Z', 'N')),
  gewijzigd      timestamptz not null default now(),
  gewijzigd_door text,
  rij_versie     bigint not null default 1,
  primary key (medewerker_id, datum)
);
create index if not exists rp_rooster_regio_datum on rp_rooster (regio, datum);

-- Vastgelegde begin- en eindtijden (ATW: 4 dagen vooraf bekend; bij Dg later vastgelegd).
create table if not exists rp_tijd (
  medewerker_id  uuid not null references rp_medewerker (id) on delete cascade,
  datum          date not null,
  regio          text not null,
  dienst         text not null,                      -- de dienst waarvoor de tijd geldt
  begin_uur      numeric(4,2) not null check (begin_uur >= 0 and begin_uur < 24),
  eind_uur       numeric(4,2) not null check (eind_uur > begin_uur and eind_uur <= 24 and eind_uur - begin_uur <= 12),
  -- pauze: zit in de dienst, telt niet als werktijd (minuten, en het begin; leeg = in het midden)
  pauze_min      smallint not null default 0,
  pauze_begin    numeric(4,2),
  -- taken in een dienst van de nabestaandendesk: [{"soort": "training" | "klachten" | "maandstart", "van": 13,
  -- "tot": 14.5}]. Tijdens een taak zit de medewerker niet aan de telefoon; de tijd telt wel als werktijd.
  taken          jsonb check (taken is null or jsonb_typeof(taken) = 'array'),
  gewijzigd      timestamptz not null default now(),
  gewijzigd_door text,
  rij_versie     bigint not null default 1,
  primary key (medewerker_id, datum),
  constraint rp_tijd_pauze_check
    check (pauze_min between 0 and 120
           and (pauze_begin is null or (pauze_begin >= begin_uur and pauze_begin + pauze_min / 60.0 <= eind_uur)))
);

-- ── Vaststelling per maand ──────────────────────────────────────────────────

-- Vaststelling van het rooster per regio per kalendermaand (§ 5.1). De planner toetst, geeft een advies (groen,
-- oranje of rood) en biedt aan; de regiomanager keurt goed of af. Wat vastgesteld is, blijft vastgesteld: ziekte,
-- verlof, ruilen en aanpassingen in die maand vragen geen nieuw advies.
create table if not exists rp_goedkeuring (
  regio        text not null,
  maand        text not null check (maand ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- 'JJJJ-MM', zoals in de app
  status       text not null check (status in ('ter_goedkeuring', 'goedgekeurd', 'afgekeurd')),
  versie       text not null,                      -- vingerafdruk van het rooster bij advies en goedkeuring (ter informatie)
  cijfer       numeric(3,1) not null,
  hard         integer not null default 0 check (hard = 0 or status = 'afgekeurd'),
  aangevraagd  timestamptz not null default now(),
  door         text not null,
  beoordeeld   timestamptz,
  beoordeelaar text,
  reden        text,
  -- het advies van de planner, verplicht bij elk maandrooster (§ 5.1): groen, oranje of rood
  advies              text not null check (advies in ('groen', 'oranje', 'rood')),
  advies_toelichting  text,
  advies_voorstel     text check (advies_voorstel in ('groen', 'oranje', 'rood')),   -- wat GRIP uit de toets voorstelde
  advies_door         text not null,
  advies_op           timestamptz not null default now(),
  rij_versie          bigint not null default 1,
  check (advies = 'groen' or length(trim(coalesce(advies_toelichting, ''))) >= 10),
  -- afkeuren, en goedkeuren tegen een rood advies in, vraagt een toelichting van de regiomanager
  check (status <> 'afgekeurd' or length(trim(coalesce(reden, ''))) > 0),
  check (not (status = 'goedgekeurd' and advies = 'rood' and length(trim(coalesce(reden, ''))) = 0)),
  primary key (regio, maand)
);
-- wie het advies gaf (het werkaccount): die keurt dezelfde maand niet zelf goed of af (vier ogen, § 5.1). De database
-- zet het zelf (rp_goedkeuring_bewaken); de app stuurt het niet mee.
alter table rp_goedkeuring add column if not exists advies_uid uuid;

-- Elke stap van de vaststelling: elk advies van de planner en elk besluit van de regiomanager. De database legt dit
-- zelf vast (rp_goedkeuring_stap_vastleggen); niemand kan de geschiedenis aanpassen of weghalen.
create table if not exists rp_goedkeuring_stap (
  id          bigint generated always as identity primary key,
  regio       text not null,
  maand       text not null,
  soort       text not null check (soort in ('advies', 'goedgekeurd', 'afgekeurd')),
  op          timestamptz not null default now(),
  door        text not null,
  kleur       text check (kleur in ('groen', 'oranje', 'rood')),
  toelichting text,
  cijfer      numeric(3,1),
  reden       text,
  foreign key (regio, maand) references rp_goedkeuring (regio, maand),
  check (soort <> 'advies' or kleur is not null)
);
create index if not exists rp_goedkeuring_stap_maand on rp_goedkeuring_stap (regio, maand, id);

-- Bewaakt de stappen: een maand begint met een advies (groen, oranje of rood), alleen een aangeboden maand wordt
-- beoordeeld, een vastgestelde maand verandert niet meer, het advies is van de planner (of de beheerder), en een
-- voorbije maand bied je niet aan. Lopende zaken in een aangeboden maand (goedgekeurd verlof, ziekte, ruilen,
-- bijsturen) verwerken ook de regiomanager en de beheerder: wie niet plant, verandert dan alleen de versie. Vier ogen:
-- wie het advies gaf, keurt die maand niet zelf goed of af, ook niet als beheerder. De service role valt hier buiten.
create or replace function rp_goedkeuring_bewaken() returns trigger
language plpgsql as $$
declare
  nieuw_advies boolean;
begin
  if auth.uid() is null then return new; end if;
  if new.status = 'ter_goedkeuring' and new.advies is null then raise exception 'Bij het aanbieden hoort een advies: groen, oranje of rood'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'ter_goedkeuring' then raise exception 'Een maand begint met het advies van de planner'; end if;
  else
    if old.status = 'goedgekeurd' then raise exception 'Deze maand is al vastgesteld; wat vastgesteld is, blijft vastgesteld'; end if;
    if new.status <> 'ter_goedkeuring' and old.status <> 'ter_goedkeuring' then raise exception 'Alleen een aangeboden maand kan worden beoordeeld'; end if;
    if rp_rol() not in ('planner', 'beheerder') and (new.advies, new.advies_toelichting, new.advies_voorstel, new.advies_door, new.cijfer)
       is distinct from (old.advies, old.advies_toelichting, old.advies_voorstel, old.advies_door, old.cijfer) then
      raise exception 'Alleen de planner geeft het advies';
    end if;
    -- wie niet plant, verandert aan een aangeboden maand alleen de versie (lopende zaken)
    if rp_rol() not in ('planner', 'beheerder') and new.status = 'ter_goedkeuring' and (old.status <> 'ter_goedkeuring'
       or (new.hard, new.aangevraagd, new.door, new.beoordeeld, new.beoordeelaar, new.reden, new.advies_op)
          is distinct from (old.hard, old.aangevraagd, old.door, old.beoordeeld, old.beoordeelaar, old.reden, old.advies_op)) then
      raise exception 'Alleen de planner biedt een maand aan';
    end if;
  end if;
  nieuw_advies := new.status = 'ter_goedkeuring' and (tg_op = 'INSERT' or old.status <> 'ter_goedkeuring'
    or (new.advies, new.advies_toelichting, new.advies_op) is distinct from (old.advies, old.advies_toelichting, old.advies_op));
  -- alleen een nieuw aanbod van een voorbije maand mag niet; lopende zaken in een aangeboden maand (de versie) wel
  if nieuw_advies and new.maand ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     and to_date(new.maand || '-01', 'YYYY-MM-DD') + interval '1 month' <= current_date then
    raise exception 'Deze maand is al voorbij';
  end if;
  if nieuw_advies then
    new.advies_uid := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.advies_uid := old.advies_uid;
    if new.status in ('goedgekeurd', 'afgekeurd') and new.status is distinct from old.status and old.advies_uid = auth.uid() then
      raise exception 'GRIP_VIER_OGEN Wie het advies gaf, keurt deze maand niet zelf goed of af';
    end if;
  end if;
  return new;
end $$;
create or replace trigger rp_goedkeuring_bewaken before insert or update on rp_goedkeuring for each row execute function rp_goedkeuring_bewaken();

create or replace function rp_goedkeuring_stap_vastleggen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nieuw_advies boolean;
  besluit boolean;
begin
  if tg_op = 'INSERT' then
    nieuw_advies := new.status = 'ter_goedkeuring';
    besluit := new.status <> 'ter_goedkeuring';
  else
    nieuw_advies := new.status = 'ter_goedkeuring' and (old.status <> 'ter_goedkeuring'
      or (new.advies, new.advies_toelichting, new.advies_op) is distinct from (old.advies, old.advies_toelichting, old.advies_op));
    besluit := new.status <> 'ter_goedkeuring' and new.status is distinct from old.status;
  end if;
  if nieuw_advies then
    insert into rp_goedkeuring_stap (regio, maand, soort, door, kleur, toelichting, cijfer)
    values (new.regio, new.maand, 'advies', new.advies_door, new.advies, new.advies_toelichting, new.cijfer);
  elsif besluit then
    insert into rp_goedkeuring_stap (regio, maand, soort, door, reden)
    values (new.regio, new.maand, new.status, coalesce(new.beoordeelaar, 'onbekend'), new.reden);
  end if;
  return new;
end $$;
create or replace trigger rp_goedkeuring_stap_vastleggen after insert or update on rp_goedkeuring for each row execute function rp_goedkeuring_stap_vastleggen();

-- ── Publiceren ──────────────────────────────────────────────────────────────

create table if not exists rp_publicatie (
  regio       text primary key,
  op          timestamptz not null default now(),
  door        text not null,
  van         date not null,
  tot         date not null,
  vorige      jsonb,                   -- vorige versie (op, cellen), zodat medewerkers zien wat er veranderd is
  rij_versie  bigint not null default 1
);

-- Publiceren kan alleen voor vastgestelde maanden (§ 5.1): elke maand die er nieuw bij komt, ook als de publicatie
-- aan het begin wordt uitgebreid. Tenzij de beheerder de goedkeuring uitzet (rp_instelling 'beleid' ->
-- goedkeuringVerplicht). Opnieuw publiceren binnen wat al online stond kan altijd.
create or replace function rp_publicatie_bewaken() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  van date[];
  tot date[];
  i int;
  m date;
begin
  if auth.uid() is null
     or not coalesce((select (waarde ->> 'goedkeuringVerplicht')::boolean from rp_instelling where sleutel = 'beleid'), true) then
    return new;
  end if;
  -- de dagen die er nieuw bij komen (vanaf vandaag): alles bij een nieuwe publicatie, en bij een wijziging wat vóór
  -- het oude begin of na het oude einde valt
  if tg_op = 'INSERT' then
    van := array[greatest(current_date, new.van)];
    tot := array[new.tot];
  else
    van := array[greatest(current_date, new.van), greatest(current_date, new.van, old.tot + 1)];
    tot := array[least(new.tot, old.van - 1), new.tot];
  end if;
  for i in 1 .. array_length(van, 1) loop
    if van[i] > tot[i] then continue; end if;
    for m in select generate_series(date_trunc('month', van[i]), date_trunc('month', tot[i]), interval '1 month')::date loop
      if not exists (select 1 from rp_goedkeuring g where g.regio = new.regio and g.maand = to_char(m, 'YYYY-MM') and g.status = 'goedgekeurd') then
        raise exception 'Het rooster van % is nog niet vastgesteld: eerst een advies van de planner en goedkeuring van de regiomanager', to_char(m, 'YYYY-MM');
      end if;
    end loop;
  end loop;
  return new;
end $$;
create or replace trigger rp_publicatie_bewaken before insert or update on rp_publicatie for each row execute function rp_publicatie_bewaken();

-- Wat medewerkers zien: een kopie van het rooster op het moment van publiceren.
create table if not exists rp_rooster_gepubliceerd (
  medewerker_id  uuid not null references rp_medewerker (id) on delete cascade,
  datum          date not null,
  regio          text not null,
  dienst         text not null check (dienst in ('1', '1M', '2', '1B', 'DG1', 'DG2', 'O', 'O4', 'OR', 'VMS', 'TD', 'V', 'Z', 'N')),
  rij_versie     bigint not null default 1,
  primary key (medewerker_id, datum)
);

-- ── Voorkeuren ──────────────────────────────────────────────────────────────

-- Vaste voorkeuren die een medewerker zelf invult (weekpatroon, ochtend/middag/avond, 1B, max dagen per week).
create table if not exists rp_voorkeurprofiel (
  medewerker_id     uuid primary key references rp_medewerker (id) on delete cascade,
  dagen             text[] not null default '{neutraal,neutraal,neutraal,neutraal,neutraal,neutraal,neutraal}'
                      check (cardinality(dagen) = 7 and dagen <@ array['graag', 'neutraal', 'liever_niet', 'niet']),
  dienst            text not null default 'geen' check (dienst in ('ochtend', 'middag', 'avond', 'geen')),   -- avond: de NBD is tot 22:30 open
  beschikbaarheid   text not null default 'neutraal' check (beschikbaarheid in ('graag', 'neutraal', 'liever_niet')),
  -- de dubbele dienst (2)
  twee              text not null default 'neutraal' check (twee in ('graag', 'neutraal', 'liever_niet', 'niet')),
  max_dagen_per_week smallint check (max_dagen_per_week between 1 and 7),
  -- voorkeuren per uur (NBD): {"even": [...7 dagen], "oneven": [...]}, per dag (zondag eerst) één teken per tijdvak
  -- van de desk (7:00-8:00 ... 22:00-22:30): g = graag, n = kan niet, . = geen voorkeur. Leeg = geen voorkeuren per uur.
  uren              jsonb check (uren is null or (jsonb_typeof(uren) = 'object' and jsonb_typeof(uren -> 'even') = 'array' and jsonb_typeof(uren -> 'oneven') = 'array')),
  opmerking         text,
  bijgewerkt        timestamptz not null default now(),
  rij_versie        bigint not null default 1
);
-- korte Dg-dagen (DG1) om de uren over meer dagen te spreiden; even of oneven weekenden; regelplekken per weekend
alter table rp_voorkeurprofiel add column if not exists korte_dagen text not null default 'neutraal' check (korte_dagen in ('graag', 'neutraal', 'liever_niet'));
alter table rp_voorkeurprofiel add column if not exists weekend text check (weekend in ('even', 'oneven'));
alter table rp_voorkeurprofiel add column if not exists weekend_plekken smallint check (weekend_plekken in (2, 3));

-- Voorkeurenronde voor een maand (van en tot zijn de eerste en laatste dag): het team geeft voorkeuren en wensen op
-- voordat het maandrooster wordt gemaakt.
create table if not exists rp_voorkeurronde (
  id          uuid primary key default gen_random_uuid(),
  regio       text not null,
  van         date not null,
  tot         date not null check (tot >= van),
  deadline    date not null,
  status      text not null default 'open' check (status in ('open', 'gesloten')),
  geopend     timestamptz not null default now(),
  door        text not null,
  rij_versie  bigint not null default 1
);
create unique index if not exists rp_voorkeurronde_een_open on rp_voorkeurronde (regio) where status = 'open';

create table if not exists rp_voorkeurronde_ingediend (
  ronde_id       uuid not null references rp_voorkeurronde (id) on delete cascade,
  medewerker_id  uuid not null references rp_medewerker (id) on delete cascade,
  ingediend      timestamptz not null default now(),
  rij_versie     bigint not null default 1,
  primary key (ronde_id, medewerker_id)
);

-- ── Verlof en vakantierondes ────────────────────────────────────────────────

-- Vakantieronde (roosterbeleid § 4.1): aanvragen, analyse, advies, gesprek en besluit voor een periode.
create table if not exists rp_vakantieronde (
  id               uuid primary key default gen_random_uuid(),
  naam             text not null,
  cluster          text not null check (cluster in ('NL', 'N', 'NW', 'O', 'W', 'ZO', 'ZW')),
  van              date not null,
  tot              date not null check (tot >= van),
  datum_aanvragen  date not null,
  datum_analyse    date not null,
  datum_advies     date not null,
  datum_gesprek    date not null,
  datum_besluit    date not null,
  fase             text not null default 'planning' check (fase in ('planning', 'analyse', 'advies', 'gesprek', 'besloten')),
  gemaakt          timestamptz not null default now(),
  door             text not null,
  rij_versie       bigint not null default 1
);

create table if not exists rp_verlof (
  id             uuid primary key default gen_random_uuid(),
  medewerker_id  uuid not null references rp_medewerker (id) on delete cascade,
  regio          text not null,
  van            date not null,
  tot            date not null check (tot >= van),
  soort          text not null check (soort in ('vakantie', 'adv', 'bijzonder', 'overig')),
  opmerking      text,
  status         text not null default 'aangevraagd' check (status in ('aangevraagd', 'goedgekeurd', 'afgewezen', 'ingetrokken')),
  aangevraagd    timestamptz not null default now(),
  beoordeeld     timestamptz,
  beoordeelaar   text,
  reden          text,
  vervangen      jsonb,                 -- diensten die bij goedkeuren door V zijn vervangen
  ronde_id       uuid references rp_vakantieronde (id) on delete set null,
  rij_versie     bigint not null default 1
);
create index if not exists rp_verlof_regio_status on rp_verlof (regio, status);

-- Een medewerker trekt een eigen aanvraag in; de rest van de aanvraag blijft gelijk. Wie plant of besluit en de
-- server vallen hierbuiten.
create or replace function rp_verlof_bewaken() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or rp_rol() in ('beheerder', 'regiomanager', 'planner') then return new; end if;
  if (new.id, new.medewerker_id, new.regio, new.van, new.tot, new.soort, new.opmerking, new.aangevraagd, new.reden, new.vervangen, new.ronde_id)
     is distinct from (old.id, old.medewerker_id, old.regio, old.van, old.tot, old.soort, old.opmerking, old.aangevraagd, old.reden, old.vervangen, old.ronde_id) then
    raise exception 'Een aanvraag kun je alleen intrekken';
  end if;
  return new;
end $$;
create or replace trigger rp_verlof_bewaken before update on rp_verlof for each row execute function rp_verlof_bewaken();

-- Elke regiomanager besluit voor de eigen regio's. Staat er in de hele ronde niets meer open (advies of gesprek),
-- dan is de ronde besloten, ook als niemand alle regio's ziet.
create or replace function rp_vakantieronde_afronden() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.ronde_id is not null and old.status = 'aangevraagd' and new.status <> 'aangevraagd'
     and not exists (select 1 from rp_verlof v where v.ronde_id = old.ronde_id and v.status = 'aangevraagd') then
    update rp_vakantieronde set fase = 'besloten' where id = old.ronde_id and fase in ('advies', 'gesprek');
  end if;
  return null;
end $$;
create or replace trigger rp_vakantieronde_afronden after update on rp_verlof for each row execute function rp_vakantieronde_afronden();

-- ── Ziekte, wensen, ruilen en het logboek ───────────────────────────────────

create table if not exists rp_ziekmelding (
  id             uuid primary key default gen_random_uuid(),
  medewerker_id  uuid not null references rp_medewerker (id) on delete cascade,
  regio          text not null,
  van            date not null,
  tot            date check (tot >= van),
  gemeld         timestamptz not null default now(),
  door           text not null,
  vervangen      jsonb not null default '{}',  -- diensten die door Z zijn vervangen, voor herstel
  voor           jsonb not null default '{}',  -- bezetting per dag vóór de melding: herstel zet een overgenomen dienst niet dubbel terug
  status         text not null default 'ziek' check (status in ('ziek', 'hersteld')),
  rij_versie     bigint not null default 1
);
create index if not exists rp_ziekmelding_regio on rp_ziekmelding (regio, status);

create table if not exists rp_wens (
  id             uuid primary key default gen_random_uuid(),
  medewerker_id  uuid not null references rp_medewerker (id) on delete cascade,
  regio          text not null,
  datum          date not null,
  soort          text not null check (soort in ('vrij', 'ochtend', 'middag', 'avond', 'werken', 'neutraal', 'overig8', 'overig4')),
  opmerking      text,
  gemaakt        timestamptz not null default now(),
  rij_versie     bigint not null default 1,
  unique (medewerker_id, datum)
);
-- "neutraal" (uitdrukkelijk geen voorkeur) en "overig8"/"overig4" (de medewerker heeft die dag al een overige dienst
-- van 8 of 4 uur) kwamen er later bij: ook op een bestaande tabel
alter table rp_wens drop constraint if exists rp_wens_soort_check;
alter table rp_wens add constraint rp_wens_soort_check check (soort in ('vrij', 'ochtend', 'middag', 'avond', 'werken', 'neutraal', 'overig8', 'overig4'));
-- de korte overige dienst (O4, 4 uur) kwam er later bij: ook op bestaande tabellen
alter table rp_rooster drop constraint if exists rp_rooster_dienst_check;
alter table rp_rooster add constraint rp_rooster_dienst_check check (dienst in ('1', '1M', '2', '1B', 'DG1', 'DG2', 'O', 'O4', 'OR', 'VMS', 'TD', 'V', 'Z', 'N'));
alter table rp_rooster_gepubliceerd drop constraint if exists rp_rooster_gepubliceerd_dienst_check;
alter table rp_rooster_gepubliceerd add constraint rp_rooster_gepubliceerd_dienst_check check (dienst in ('1', '1M', '2', '1B', 'DG1', 'DG2', 'O', 'O4', 'OR', 'VMS', 'TD', 'V', 'Z', 'N'));

-- Een afspraak in een cluster: in een periode doet de ene regio zoveel regelplekken minder en de andere zoveel meer.
create table if not exists rp_verschuiving (
  id             uuid primary key default gen_random_uuid(),
  van_regio      text not null,
  naar_regio     text not null,
  van            date not null,
  tot            date not null,
  plekken        smallint not null default 1 check (plekken between 1 and 5),
  opmerking      text,
  door           text not null,
  gemaakt        timestamptz not null default now(),
  rij_versie     bigint not null default 1,
  check (van_regio <> naar_regio and tot >= van)
);

create table if not exists rp_ruil (
  id             uuid primary key default gen_random_uuid(),
  regio          text not null,
  soort          text not null check (soort in ('aanbieden', 'ruilen', 'verlof')),
  aanbieder_id   uuid not null references rp_medewerker (id) on delete cascade,
  datum          date not null,
  dienst         text not null,
  ontvanger_id   uuid references rp_medewerker (id) on delete cascade,
  tegen_datum    date,
  tegen_dienst   text,
  verlof_id       uuid references rp_verlof (id) on delete cascade,   -- verlof ruilen: verlof van de aanbieder
  tegen_verlof_id uuid references rp_verlof (id) on delete cascade,   -- en dat van de collega
  tot            date,                                               -- periodes zoals ze bij het verzoek waren
  tegen_tot      date,
  opmerking      text,
  status         text not null default 'open' check (status in ('open', 'wacht_planner', 'goedgekeurd', 'afgewezen', 'ingetrokken', 'verlopen')),  -- verlopen: dag voorbij of dienst intussen gewijzigd
  gemaakt        timestamptz not null default now(),
  geaccepteerd   timestamptz,
  beoordeeld     timestamptz,
  beoordeelaar   text,
  reden          text,
  toets          jsonb,                 -- uitkomst van de ruiltoets op het moment van accepteren
  rij_versie     bigint not null default 1,
  check (soort <> 'verlof' or (verlof_id is not null and tegen_verlof_id is not null and ontvanger_id is not null))
);
create index if not exists rp_ruil_regio_status on rp_ruil (regio, status);

create table if not exists rp_activiteit (
  id      uuid primary key default gen_random_uuid(),
  moment  timestamptz not null default now(),
  soort   text not null,
  tekst   text not null,
  regio   text,
  voor    uuid references rp_medewerker (id) on delete cascade,
  regio_breed boolean not null default false,   -- bericht voor alle medewerkers van de regio
  door    text
);
create index if not exists rp_activiteit_moment on rp_activiteit (moment desc);
-- Bewaartermijn ruim een jaar, net als in de app (LOGBOEK in lib/store/store.ts); de dagelijkse taak ruimt op
-- (rp_opruimen, hieronder).

-- ── Verdelen ────────────────────────────────────────────────────────────────

-- Per dag de meldingen en wie ze doet, als één JSON: per melding alleen de postcode (4 cijfers), de regio en
-- eventueel een afgesproken tijd; geen adres en geen naam van de familie. Alleen de planningsrollen lezen en schrijven
-- het; de verdeling is landelijk (een melding kan naar een andere regio).
create table if not exists rp_verdeling (
  datum       date primary key,
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  gewijzigd   timestamptz not null default now(),
  rij_versie  bigint not null default 1
);

create or replace function rp_verdeling_gewijzigd() returns trigger
language plpgsql as $$
begin
  new.gewijzigd := now();
  return new;
end $$;
create or replace trigger rp_verdeling_gewijzigd before update on rp_verdeling for each row execute function rp_verdeling_gewijzigd();

-- ── Wie is ingelogd: de eigen medewerker, regio en collega's ───────────────

-- De medewerker-regel die bij de ingelogde gebruiker hoort: eerst de koppeling via het account, dan op e-mailadres,
-- en verder altijd dezelfde.
create or replace function rp_mijn_medewerker() returns uuid
language sql stable security definer set search_path = public as $$
  select m.id from rp_medewerker m join users u on (m.user_id = u.id or lower(m.email) = lower(u.email))
  where u.auth_id = auth.uid() and m.actief
  order by (m.user_id is not distinct from u.id) desc, m.id
  limit 1
$$;

-- Regio van de ingelogde medewerker (security definer, zodat de regels op rp_medewerker niet recursief worden).
create or replace function rp_mijn_regio() returns text
language sql stable security definer set search_path = public as $$
  select m.regio from rp_medewerker m where m.id = rp_mijn_medewerker()
$$;

-- De collega's in de eigen regio, zonder e-mailadres en zonder afstandsverklaring (een persoonlijke afspraak met de
-- werkgever; leeg): een medewerker leest uit rp_medewerker alleen de eigen regel. Het contract blijft: de ruiltoets
-- rekent ermee.
create or replace function rp_collegas()
returns table (id uuid, regio text, naam text, contract numeric, max_uren numeric, voorkeur char(1), weekendgroep smallint, weekend_cadans smallint,
               functie text, afstandsverklaring boolean, extern boolean, actief boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.regio, m.naam, m.contract, m.max_uren, m.voorkeur, m.weekendgroep, m.weekend_cadans, m.functie, null::boolean, m.extern, m.actief
  from rp_medewerker m
  where m.regio = (select rp_mijn_regio()) and m.id <> (select rp_mijn_medewerker())
  order by m.id
$$;

-- Verlof van de collega's in de eigen regio (goedgekeurd en aangevraagd, vanaf vorig jaar): wie en wanneer, voor de
-- verlofruimte per week en om verlof te ruilen. Soort, opmerking en reden blijven privé.
create or replace function rp_verlof_team() returns table (id uuid, medewerker_id uuid, regio text, van date, tot date, status text)
language sql stable security definer set search_path = public as $$
  select v.id, v.medewerker_id, v.regio, v.van, v.tot, v.status from rp_verlof v
  where v.regio = (select rp_mijn_regio()) and v.medewerker_id <> (select rp_mijn_medewerker())
    and v.status in ('goedgekeurd', 'aangevraagd')
    and v.tot >= make_date(extract(year from current_date)::int - 1, 1, 1)
  order by v.id
$$;

-- Hoeveel collega's in de eigen regio per dag een wens hebben opgegeven: wil werken (ook een dagdeel), liever vrij,
-- geen voorkeur of al een overige dienst. Alleen aantallen, vanaf vandaag: wie wat wenst en de opmerking erbij blijven privé. Zonder de eigen
-- wens (die leest de medewerker zelf) en zonder ZZP'ers en wie uit dienst is.
drop function if exists rp_wensen_team();
create function rp_wensen_team() returns table (datum date, werken int, vrij int, neutraal int, overig int)
language sql stable security definer set search_path = public as $$
  select w.datum,
    (count(*) filter (where w.soort in ('werken', 'ochtend', 'middag', 'avond')))::int,
    (count(*) filter (where w.soort = 'vrij'))::int,
    (count(*) filter (where w.soort = 'neutraal'))::int,
    (count(*) filter (where w.soort in ('overig8', 'overig4')))::int
  from rp_wens w join rp_medewerker m on m.id = w.medewerker_id
  where w.regio = (select rp_mijn_regio()) and m.regio = w.regio and m.actief and not m.extern
    and w.medewerker_id <> (select rp_mijn_medewerker()) and w.datum >= current_date
  group by w.datum
  order by w.datum
$$;

-- Wie besluit over verlof: de regiomanager en de beheerder, en de planner als de beheerder in de instellingen "Ook de
-- planner besluit over verlof" aanzet (rp_instelling 'beleid', die alleen de beheerder wijzigt).
create or replace function rp_besluit_verlof() returns boolean
language sql stable security definer set search_path = public as $$
  select rp_rol() in ('regiomanager', 'beheerder')
    or (rp_rol() = 'planner' and coalesce((
      select case when jsonb_typeof(i.waarde -> 'plannerBesluitVerlof') = 'boolean' then (i.waarde ->> 'plannerBesluitVerlof')::boolean end
      from rp_instelling i where i.sleutel = 'beleid'
    ), false))
$$;

-- ── Bewaken wat een medewerker zelf doet ────────────────────────────────────

-- Een medewerker zet alleen de eigen stap in een ruil: de collega accepteert (wacht_planner) of weigert (afgewezen),
-- de aanbieder trekt in. De rest van de ruil blijft gelijk; wie weigert of intrekt, staat er met de eigen naam bij.
-- Planners en de server vallen hierbuiten (rp_ruil_planner).
create or replace function rp_ruil_bewaken() returns trigger
language plpgsql as $$
declare
  ik uuid;
  naam text;
begin
  if auth.uid() is null or rp_rol() in ('beheerder', 'regiomanager', 'planner') then return new; end if;
  ik := rp_mijn_medewerker();
  if (new.id, new.regio, new.soort, new.aanbieder_id, new.datum, new.dienst, new.tegen_datum, new.tegen_dienst,
      new.verlof_id, new.tegen_verlof_id, new.tot, new.tegen_tot, new.opmerking, new.gemaakt)
     is distinct from (old.id, old.regio, old.soort, old.aanbieder_id, old.datum, old.dienst, old.tegen_datum, old.tegen_dienst,
      old.verlof_id, old.tegen_verlof_id, old.tot, old.tegen_tot, old.opmerking, old.gemaakt) then
    raise exception 'Alleen de status van een ruil kan veranderen';
  end if;
  select m.naam into naam from rp_medewerker m where m.id = ik;
  if new.status = 'ingetrokken' and old.aanbieder_id = ik and old.status in ('open', 'wacht_planner')
     and new.ontvanger_id is not distinct from old.ontvanger_id then
    new.toets := old.toets; new.geaccepteerd := old.geaccepteerd; new.reden := old.reden;
    new.beoordeeld := now(); new.beoordeelaar := coalesce(naam, 'medewerker');
    return new;
  end if;
  if new.status = 'afgewezen' and old.status = 'open' and old.soort <> 'aanbieden' and old.ontvanger_id = ik
     and new.ontvanger_id is not distinct from old.ontvanger_id then
    new.toets := old.toets; new.geaccepteerd := old.geaccepteerd;
    new.beoordeeld := now(); new.beoordeelaar := coalesce(naam, 'medewerker'); new.reden := 'Geweigerd door ' || coalesce(naam, 'collega');
    return new;
  end if;
  if new.status = 'wacht_planner' and old.status = 'open' and new.ontvanger_id = ik and ik <> old.aanbieder_id
     and (old.soort = 'aanbieden' or old.ontvanger_id = ik) then
    -- de toets is ter informatie: de planner toetst bij het goedkeuren opnieuw
    new.geaccepteerd := now(); new.beoordeeld := old.beoordeeld; new.beoordeelaar := old.beoordeelaar; new.reden := old.reden;
    return new;
  end if;
  raise exception 'Deze stap in de ruil mag je niet zetten';
end $$;
create or replace trigger rp_ruil_bewaken before update on rp_ruil for each row execute function rp_ruil_bewaken();

-- "Kan niet" bij de dubbele dienst (2) is een harde grens voor het rooster: die zet de planner of regiomanager, niet de
-- medewerker zelf. Een medewerker die het eigen profiel opslaat, houdt wat de planner koos.
create or replace function rp_profiel_bewaken() returns trigger
language plpgsql as $$
declare
  was text;
begin
  if auth.uid() is null or rp_rol() in ('beheerder', 'regiomanager', 'planner') then return new; end if;
  -- bij opslaan met "on conflict" komt eerst de invoeging langs: vergelijk dan met wat er al staat
  if tg_op = 'INSERT' then
    select p.twee into was from rp_voorkeurprofiel p where p.medewerker_id = new.medewerker_id;
  else
    was := old.twee;
  end if;
  if (new.twee = 'niet') is distinct from (coalesce(was, 'neutraal') = 'niet') then
    raise exception 'Kan niet bij de dubbele dienst zet de planner of regiomanager';
  end if;
  return new;
end $$;
create or replace trigger rp_profiel_bewaken before insert or update on rp_voorkeurprofiel for each row execute function rp_profiel_bewaken();

-- Een medewerker schrijft in het logboek altijd op eigen naam en met de tijd van nu.
create or replace function rp_activiteit_bewaken() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or rp_rol() in ('beheerder', 'regiomanager', 'planner') then return new; end if;
  new.moment := now();
  new.door := coalesce(
    (select nullif(trim(u.naam), '') from users u where u.auth_id = auth.uid()),
    (select m.naam from rp_medewerker m where m.id = rp_mijn_medewerker()),
    'medewerker'
  );
  return new;
end $$;
create or replace trigger rp_activiteit_bewaken before insert on rp_activiteit for each row execute function rp_activiteit_bewaken();

-- ── Versie per rij ──────────────────────────────────────────────────────────

-- Elke tabel met een kolom rij_versie: bij elke wijziging één omhoog. De app stuurt bij het opslaan mee welke versie
-- zij kende (rp_bewaar).
create or replace function rp_versie_ophogen() returns trigger
language plpgsql as $$
begin
  new.rij_versie := coalesce(old.rij_versie, 0) + 1;
  return new;
end $$;

do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'rij_versie' loop
    execute format('create or replace trigger rp_versie before update on public.%I for each row execute function rp_versie_ophogen()', t);
  end loop;
end $$;

-- ── Opslaan: alles of niets ─────────────────────────────────────────────────

-- rp_bewaar voert alle wijzigingen van één bewaarmoment uit in één transactie. Mislukt er één (geen rechten, een regel
-- uit een trigger, een conflict), dan blijft er niets van staan. Het draait met de rechten van wie is ingelogd
-- (security invoker): de RLS en de triggers gelden gewoon.
--
-- Versiecontrole: is een rij intussen door iemand anders gewijzigd (of verwijderd, of juist aangemaakt), dan weigert
-- rp_bewaar alles met GRIP_CONFLICT en leest de app de nieuwste stand. Eerst worden de rijen die een stap raakt
-- vergrendeld (in een vaste volgorde): slaan twee mensen tegelijk dezelfde rij op, dan wacht de tweede tot de eerste
-- klaar is, ziet dan de nieuwe versie en krijgt een conflict. Een nieuwe rij die nog niet mag bestaan, wordt gewoon
-- ingevoegd (zonder "bijwerken als hij er al is"): voegt iemand anders tegelijk dezelfde rij in, dan geeft de unieke
-- sleutel een conflict in plaats van dat de een de ander overschrijft.
--
-- p_stappen: een lijst van { tabel, soort (insert, upsert, update, delete), sleutel (kolommen), rijen, controles? }.
-- Alle rijen van een stap hebben dezelfde kolommen. controles: per rij de versie die de app kende (> 0), 0 als de rij
-- nog niet mag bestaan, of -1 zonder controle. Terug: de nieuwe versie van elke geschreven rij.
create or replace function rp_bewaar(p_stappen jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  s jsonb;
  t text;
  soort text;
  rijen jsonb;
  controles jsonb;
  sleutel text[];
  kols text[];
  rest text[];
  koppel text;
  conflict text;
  orde text;
  kollijst text;
  bron text;
  n bigint;
  met_versie boolean;
  zichtbaar bigint;
  nieuw jsonb;
  uit jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_stappen) is distinct from 'array' then
    raise exception 'rp_bewaar: verwacht een lijst met stappen';
  end if;
  for s in select value from jsonb_array_elements(p_stappen) loop
    t := s ->> 'tabel';
    soort := s ->> 'soort';
    rijen := s -> 'rijen';
    controles := coalesce(s -> 'controles', 'null'::jsonb);
    if t is null or t !~ '^rp_[a-z_]+$' then
      raise exception 'rp_bewaar: onbekende tabel %', t;
    end if;
    if soort is null or soort not in ('insert', 'upsert', 'update', 'delete') then
      raise exception 'rp_bewaar: onbekende bewerking %', soort;
    end if;
    if jsonb_typeof(rijen) is distinct from 'array' or jsonb_array_length(rijen) = 0 then
      continue;
    end if;
    if jsonb_typeof(controles) = 'array' and jsonb_array_length(controles) <> jsonb_array_length(rijen) then
      raise exception 'rp_bewaar: controles en rijen verschillen in aantal (%)', t;
    end if;
    sleutel := array(select jsonb_array_elements_text(s -> 'sleutel'));
    if coalesce(cardinality(sleutel), 0) = 0 then
      raise exception 'rp_bewaar: geen sleutel voor %', t;
    end if;
    kols := array(select jsonb_object_keys(rijen -> 0));
    rest := array(select k from unnest(kols) k where not k = any(sleutel));
    koppel := (select string_agg(format('d.%1$I = r.%1$I', k), ' and ') from unnest(sleutel) k);
    conflict := (select string_agg(format('%I', k), ', ') from unnest(sleutel) k);
    orde := (select string_agg(format('d.%I', k), ', ') from unnest(sleutel) k);
    kollijst := (select string_agg(format('%I', k), ', ') from unnest(kols) k);
    met_versie := exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'rij_versie');

    -- de rijen van deze stap, met per rij de controle (rp_ctl; -1 zonder). Bij veel rijen eerst in een tijdelijke
    -- tabel met statistiek, zodat Postgres ze in één keer koppelt in plaats van rij voor rij (ook als de statistiek van
    -- de tabel zelf na een grote import nog niet is bijgewerkt).
    bron := format(
      '(select r.*, coalesce((c.v #>> ''{}'')::bigint, -1) as rp_ctl
          from jsonb_populate_recordset(null::public.%1$I, $1) with ordinality as r
          left join jsonb_array_elements(case when jsonb_typeof($2) = ''array'' then $2 else ''[]''::jsonb end) with ordinality as c(v, i) on c.i = r.ordinality)', t);
    if jsonb_array_length(rijen) > 1000 then
      drop table if exists pg_temp.rp_bewaar_rijen;
      execute format('create temp table rp_bewaar_rijen on commit drop as select * from %s r', bron) using rijen, controles;
      analyze pg_temp.rp_bewaar_rijen;
      bron := 'pg_temp.rp_bewaar_rijen';
    end if;

    -- de bestaande rijen die deze stap raakt vergrendelen, in de volgorde van de sleutel: wie tegelijk dezelfde rijen
    -- opslaat, wacht tot deze transactie klaar is
    if soort <> 'insert' then
      execute format('select count(*) from (select 1 from public.%1$I d join %2$s r on %3$s order by %4$s for update of d) x', t, bron, koppel, orde)
        into n using rijen, controles;
    end if;

    -- is elke rij nog zoals de app hem kende? (na het vergrendelen: dit is de nieuwste stand)
    if met_versie then
      execute format(
        'select count(*) from %2$s r left join public.%1$I d on %3$s
         where (r.rp_ctl > 0 and d.rij_versie is distinct from r.rp_ctl) or (r.rp_ctl = 0 and d.rij_versie is not null)', t, bron, koppel)
        into n using rijen, controles;
      if n > 0 then
        raise exception using errcode = 'P0001', message = format('GRIP_CONFLICT %s', t);
      end if;
    end if;

    -- weghalen en bijwerken slaan rijen zonder rechten stil over; dat mag niet ongemerkt blijven
    if soort in ('delete', 'update') then
      if soort = 'update' and coalesce(cardinality(rest), 0) = 0 then continue; end if;
      execute format('select count(*) from public.%1$I d join %2$s r on %3$s', t, bron, koppel) into zichtbaar using rijen, controles;
      if soort = 'delete' then
        execute format('delete from public.%1$I d using %2$s r where %3$s', t, bron, koppel) using rijen, controles;
      else
        execute format('update public.%1$I d set %4$s from %2$s r where %3$s',
          t, bron, koppel, (select string_agg(format('%1$I = r.%1$I', k), ', ') from unnest(rest) k)) using rijen, controles;
      end if;
      get diagnostics n = row_count;
      if n < zichtbaar then
        raise exception using errcode = '42501', message = format('permission denied for table %s', t);
      end if;
      if soort = 'delete' then continue; end if;
    else
      -- rijen die nog niet mogen bestaan: gewoon invoegen; bestaat de sleutel intussen toch, dan is dat een conflict
      if met_versie then
        begin
          execute format('insert into public.%1$I (%3$s) select %3$s from %2$s r where r.rp_ctl = 0', t, bron, kollijst) using rijen, controles;
        exception when unique_violation then
          raise exception using errcode = 'P0001', message = format('GRIP_CONFLICT %s', t);
        end;
      end if;
      execute format('insert into public.%1$I (%3$s) select %3$s from %2$s r where %4$s%5$s',
        t, bron, kollijst,
        case when met_versie then 'r.rp_ctl <> 0' else 'true' end,
        case
          when soort = 'insert' then ''
          when coalesce(cardinality(rest), 0) = 0 then format(' on conflict (%s) do nothing', conflict)
          else format(' on conflict (%s) do update set %s', conflict, (select string_agg(format('%1$I = excluded.%1$I', k), ', ') from unnest(rest) k))
        end) using rijen, controles;
    end if;

    -- de nieuwe versies, zodat de app bij de volgende wijziging weet wat ze kent
    if met_versie then
      execute format(
        'select coalesce(jsonb_agg(jsonb_build_object(''t'', %4$L, ''k'', (select jsonb_agg(to_jsonb(d) -> u.k order by u.o) from unnest($3::text[]) with ordinality as u(k, o)), ''v'', d.rij_versie)), ''[]''::jsonb)
           from public.%1$I d join %2$s r on %3$s', t, bron, koppel, t)
        into nieuw using rijen, controles, sleutel;
      uit := uit || nieuw;
    end if;
  end loop;
  return uit;
end $$;

-- Grote wijzigingen (een import): de app zet ze in delen klaar in rp_bewaar_deel en rp_bewaar_klaar verwerkt alle
-- delen samen in één transactie. Mislukt er iets, dan is er niets veranderd.
create table if not exists rp_bewaar_deel (
  id         uuid not null,
  nr         int not null,
  stappen    jsonb not null,
  eigenaar   uuid default auth.uid(),
  aangemaakt timestamptz not null default now(),
  primary key (id, nr)
);

create or replace function rp_bewaar_klaar(p_id uuid, p_delen int) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  d record;
  n int;
  hoogste int;
  uit jsonb := '[]'::jsonb;
begin
  select count(*), max(nr) into n, hoogste from rp_bewaar_deel where id = p_id;
  if n is distinct from p_delen or hoogste is distinct from p_delen - 1 then
    raise exception 'rp_bewaar_klaar: niet alle delen zijn klaargezet (% van %)', n, p_delen;
  end if;
  for d in select stappen from rp_bewaar_deel where id = p_id order by nr loop
    uit := uit || rp_bewaar(d.stappen);
  end loop;
  delete from rp_bewaar_deel where id = p_id;
  -- wat van een afgebroken poging is blijven staan
  delete from rp_bewaar_deel where aangemaakt < now() - interval '1 day';
  return uit;
end $$;

-- Welke versie van de database er staat. Is die ouder dan de app nodig heeft (SCHEMA_NODIG in lib/store/db/db.ts),
-- dan leest de app wel, maar bewaart hij niets. Een wijziging die de opslag raakt, zet beide hoger.
create or replace function rp_schema_versie() returns int
language sql immutable as $$ select 20261111 $$;

-- ── De dagelijkse voorspelling ──────────────────────────────────────────────

-- Legt in één handeling vast wie de taak vandaag uitvoert: claimt hem met deze status (datum, gestart, waar), tenzij
-- hij vandaag al is gedaan (geslaagd, of beperkt: voorspeld met verouderde of ontbrekende bronnen) of iemand anders
-- hem net is begonnen (korter dan p_looptijd minuten geleden). Een beperkte taak waarbij een bron niet bereikbaar was,
-- mag na opnieuwNa opnieuw. Terug: de versie van de geclaimde rij, of niets.
create or replace function rp_dagtaak_claim(p_status jsonb, p_looptijd int default 20) returns table (versie bigint)
language sql security invoker set search_path = public as $$
  insert into rp_instelling as i (sleutel, waarde)
  values ('dagtaak', p_status || jsonb_build_object('claim', now()))
  on conflict (sleutel) do update set waarde = excluded.waarde, gewijzigd = now()
    where not (
      (i.waarde ->> 'datum' = p_status ->> 'datum' and (i.waarde ->> 'status' = 'geslaagd'
        or (i.waarde ->> 'status' = 'beperkt' and coalesce((i.waarde ->> 'opnieuwNa')::timestamptz > now(), true))))
      or (i.waarde ->> 'status' = 'gestart'
          and coalesce((i.waarde ->> 'claim')::timestamptz, 'epoch'::timestamptz) > now() - make_interval(mins => p_looptijd))
    )
  returning i.rij_versie
$$;

-- ── Bewaartermijnen (AVG) ───────────────────────────────────────────────────

-- Elke ochtend ruimt de dagelijkse taak op de server op wat langer bewaard is dan nodig. Alleen de server (de eigenaar),
-- niet wie is ingelogd. De termijnen zijn een voorstel, af te stemmen met de functionaris gegevensbescherming; ze staan
-- ook in docs/werking.md. Wat de app leest, valt er ruim binnen.
--   logboek, wensen, afgehandelde ruilen   400 dagen
--   ziekmeldingen (na herstel)             400 dagen na de laatste dag
--   rooster, gepubliceerd rooster, tijden  dit en vorig kalenderjaar
--   verlof                                 dit en vorig kalenderjaar (de jaarplanning kijkt een jaar terug)
--   verdeling van meldingen (PC4)          90 dagen
--   wie uit het team is                    weg zodra er geen rooster, verlof of ziekte meer van is
create or replace function rp_opruimen(p_vandaag date) returns table (tabel text, weg bigint)
language plpgsql security invoker set search_path = public as $$
declare
  jaren date := make_date(extract(year from p_vandaag)::int - 1, 1, 1);
begin
  if auth.uid() is not null then raise exception 'Opruimen doet de dagelijkse taak op de server'; end if;
  return query with x as (delete from rp_activiteit a where a.moment < p_vandaag - 400 returning 1) select 'rp_activiteit', count(*) from x;
  return query with x as (delete from rp_wens w where w.datum < p_vandaag - 400 returning 1) select 'rp_wens', count(*) from x;
  return query with x as (delete from rp_ruil r where r.gemaakt < p_vandaag - 400 and r.status not in ('open', 'wacht_planner') returning 1) select 'rp_ruil', count(*) from x;
  return query with x as (delete from rp_ziekmelding z where z.status = 'hersteld' and coalesce(z.tot, z.van) < p_vandaag - 400 returning 1) select 'rp_ziekmelding', count(*) from x;
  return query with x as (delete from rp_rooster r where r.datum < jaren returning 1) select 'rp_rooster', count(*) from x;
  return query with x as (delete from rp_rooster_gepubliceerd r where r.datum < jaren returning 1) select 'rp_rooster_gepubliceerd', count(*) from x;
  return query with x as (delete from rp_tijd t where t.datum < jaren returning 1) select 'rp_tijd', count(*) from x;
  return query with x as (delete from rp_verlof v where v.tot < jaren returning 1) select 'rp_verlof', count(*) from x;
  return query with x as (delete from rp_verdeling v where v.datum < p_vandaag - 90 returning 1) select 'rp_verdeling', count(*) from x;
  return query with x as (
    delete from rp_medewerker m where not m.actief
      and not exists (select 1 from rp_rooster r where r.medewerker_id = m.id)
      and not exists (select 1 from rp_rooster_gepubliceerd r where r.medewerker_id = m.id)
      and not exists (select 1 from rp_verlof v where v.medewerker_id = m.id)
      and not exists (select 1 from rp_ziekmelding z where z.medewerker_id = m.id)
    returning 1
  ) select 'rp_medewerker', count(*) from x;
end $$;

-- ── Snel lezen ──────────────────────────────────────────────────────────────

-- Het rooster en het gepubliceerde rooster per medewerker vanaf een datum, in één keer in plaats van een rij per dag;
-- bij het rooster ook per dienst de versie. In een vaste volgorde, zodat lezen in pagina's van 1000 niets overslaat.
-- Draaien met de rechten van wie het vraagt, dus de RLS hieronder geldt gewoon.
create or replace function rp_rooster_versies_vanaf(van date) returns table (medewerker_id uuid, regio text, cellen jsonb, versies jsonb)
language sql stable as $$
  select r.medewerker_id, r.regio, jsonb_object_agg(r.datum::text, r.dienst), jsonb_object_agg(r.datum::text, r.rij_versie)
  from rp_rooster r where r.datum >= van group by r.medewerker_id, r.regio order by r.medewerker_id, r.regio
$$;

create or replace function rp_gepubliceerd_vanaf(van date) returns table (medewerker_id uuid, regio text, cellen jsonb)
language sql stable as $$
  select r.medewerker_id, r.regio, jsonb_object_agg(r.datum::text, r.dienst)
  from rp_rooster_gepubliceerd r where r.datum >= van group by r.medewerker_id, r.regio order by r.medewerker_id, r.regio
$$;

-- De meldingenhistorie per regio als datum -> aantal.
create or replace function rp_meldingen_per_regio() returns table (regio text, aantallen jsonb)
language sql stable as $$
  select m.regio, jsonb_object_agg(m.datum::text, m.aantal) from rp_meldingen m group by m.regio order by m.regio
$$;

-- ── Toegangsregels (RLS) ────────────────────────────────────────────────────
--
-- RLS staat aan op elke tabel. De functies over wie is ingelogd staan als deelvraag in de regels: "(select rp_rol())"
-- rekent Postgres één keer per opdracht uit in plaats van per rij; bij een jaarrooster van 15.000 rijen scheelt dat
-- seconden. "Een planningsrol die bij deze regio mag" staat er steeds zo:
--   ((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[]))
-- Eerst gaan alle bestaande regels weg, zodat dit bestand vaker mag worden uitgevoerd.

do $$
declare
  t text;
  p record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'rp\_%' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  for p in select policyname, tablename from pg_policies where schemaname = 'public' and tablename like 'rp\_%' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- Normen, schoolvakanties en instellingen: wie in GRIP staat, leest; alleen de beheerder wijzigt. De roosterbasis (de
-- voorspelling waarop het rooster wordt gemaakt) legt ook de planner vast.
create policy rp_norm_lezen on rp_norm_regio for select using ((select rp_rol()) is not null);
create policy rp_norm_schrijven on rp_norm_regio for all using ((select rp_rol()) = 'beheerder') with check ((select rp_rol()) = 'beheerder');
create policy rp_schoolvakantie_lezen on rp_schoolvakantie for select using ((select rp_rol()) is not null);
create policy rp_schoolvakantie_schrijven on rp_schoolvakantie for all using ((select rp_rol()) = 'beheerder') with check ((select rp_rol()) = 'beheerder');
create policy rp_instelling_lezen on rp_instelling for select using ((select rp_rol()) is not null);
create policy rp_instelling_schrijven on rp_instelling for all using ((select rp_rol()) = 'beheerder') with check ((select rp_rol()) = 'beheerder');
create policy rp_instelling_roosterbasis on rp_instelling for all
  using (sleutel = 'roosterbasis' and (select rp_rol()) in ('regiomanager', 'planner'))
  with check (sleutel = 'roosterbasis' and (select rp_rol()) in ('regiomanager', 'planner'));

-- Model: de planningsrollen lezen, alleen de beheerder schrijft (de dagelijkse voorspelling draait op de server).
create policy rp_model_lezen on rp_meldingen for select using ((select rp_rol()) in ('beheerder', 'regiomanager', 'planner'));
create policy rp_model_schrijven on rp_meldingen for all using ((select rp_rol()) = 'beheerder') with check ((select rp_rol()) = 'beheerder');
create policy rp_extern_lezen on rp_extern for select using ((select rp_rol()) in ('beheerder', 'regiomanager', 'planner'));
create policy rp_extern_schrijven on rp_extern for all using ((select rp_rol()) = 'beheerder') with check ((select rp_rol()) = 'beheerder');
create policy rp_bron_lezen on rp_bron_status for select using ((select rp_rol()) in ('beheerder', 'regiomanager', 'planner'));
create policy rp_bron_schrijven on rp_bron_status for all using ((select rp_rol()) = 'beheerder') with check ((select rp_rol()) = 'beheerder');
create policy rp_handmatig_lezen on rp_handmatig for select using ((select rp_rol()) in ('beheerder', 'regiomanager', 'planner'));
create policy rp_handmatig_schrijven on rp_handmatig for all using ((select rp_rol()) = 'beheerder') with check ((select rp_rol()) = 'beheerder');
create policy rp_run_lezen on rp_run for select using ((select rp_rol()) in ('beheerder', 'regiomanager', 'planner'));
create policy rp_run_schrijven on rp_run for all using ((select rp_rol()) = 'beheerder') with check ((select rp_rol()) = 'beheerder');
create policy rp_coef_lezen on rp_coef for select using ((select rp_rol()) in ('beheerder', 'regiomanager', 'planner'));
create policy rp_coef_schrijven on rp_coef for all using ((select rp_rol()) = 'beheerder') with check ((select rp_rol()) = 'beheerder');

-- Team: planningsrollen binnen hun regio's. Een medewerker leest de eigen regel; de collega's (zonder e-mailadres)
-- komen uit rp_collegas().
create policy rp_medewerker_planner on rp_medewerker for all
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])))
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));
create policy rp_medewerker_zelf on rp_medewerker for select using (id = (select rp_mijn_medewerker()));

-- Rooster en publicaties: planningsrollen binnen hun regio's. Een medewerker ziet het gepubliceerde rooster en de
-- publicaties (met de vorige versie) van de eigen regio. Gepubliceerd wordt alleen binnen wat in rp_publicatie staat;
-- rp_publicatie_bewaken bewaakt dat elke nieuwe maand is vastgesteld. De app schrijft rp_publicatie eerst.
create policy rp_rooster_planner on rp_rooster for all
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])))
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));
create policy rp_publicatie_planner on rp_publicatie for all
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])))
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));
create policy rp_publicatie_lezen on rp_publicatie for select
  using ((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[]) or regio = (select rp_mijn_regio()));
create policy rp_gepubliceerd_planner on rp_rooster_gepubliceerd for all
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])))
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])) and exists (
    select 1 from rp_publicatie p where p.regio = rp_rooster_gepubliceerd.regio and rp_rooster_gepubliceerd.datum between p.van and p.tot
  ));
create policy rp_gepubliceerd_medewerker on rp_rooster_gepubliceerd for select using (regio = (select rp_mijn_regio()));

-- Diensttijden: de planningsrollen binnen hun regio's. Een medewerker ziet de eigen tijden, en die van collega's alleen
-- op gepubliceerde dagen (een rooster in de maak blijft bij de planner). Eigen tijden vastleggen (Dg-diensten, § 5.1)
-- kan in de regio's, vanaf vandaag en alleen bij een eigen dienst in het gepubliceerde rooster. Bij de NBD zet de
-- planner de diensten en tijden.
create policy rp_tijd_planner on rp_tijd for all
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])))
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));
create policy rp_tijd_lezen on rp_tijd for select using (
  medewerker_id = (select rp_mijn_medewerker())
  or (regio = (select rp_mijn_regio()) and exists (
    select 1 from rp_rooster_gepubliceerd g where g.medewerker_id = rp_tijd.medewerker_id and g.datum = rp_tijd.datum
  ))
);
create policy rp_tijd_zelf on rp_tijd for insert with check (
  medewerker_id = (select rp_mijn_medewerker()) and regio = (select rp_mijn_regio()) and regio <> 'NBD' and datum >= current_date
  and exists (select 1 from rp_rooster_gepubliceerd g where g.medewerker_id = rp_tijd.medewerker_id and g.datum = rp_tijd.datum and g.dienst = rp_tijd.dienst)
);
create policy rp_tijd_zelf_wijzigen on rp_tijd for update
  using (medewerker_id = (select rp_mijn_medewerker()) and regio <> 'NBD' and datum >= current_date)
  with check (
    medewerker_id = (select rp_mijn_medewerker()) and regio = (select rp_mijn_regio()) and regio <> 'NBD' and datum >= current_date
    and exists (select 1 from rp_rooster_gepubliceerd g where g.medewerker_id = rp_tijd.medewerker_id and g.datum = rp_tijd.datum and g.dienst = rp_tijd.dienst)
  );
create policy rp_tijd_zelf_weg on rp_tijd for delete
  using (medewerker_id = (select rp_mijn_medewerker()) and regio <> 'NBD' and datum >= current_date);

-- Vaststelling per maand (§ 5.1): de planner (of de beheerder) geeft advies en biedt aan (ter_goedkeuring); de
-- regiomanager (of de beheerder) keurt goed of af. Lopende zaken in een aangeboden maand verwerken ook de
-- regiomanager en de beheerder (rp_goedkeuring_bewaken). Een vastgestelde maand wijzigt niemand meer, en weghalen kan
-- niet. De geschiedenis lezen de planningsrollen binnen hun regio's; schrijven doet alleen de trigger.
create policy rp_goedkeuring_lezen on rp_goedkeuring for select
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));
create policy rp_goedkeuring_aanbieden on rp_goedkeuring for insert
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])) and status = 'ter_goedkeuring' and (select rp_rol()) in ('planner', 'beheerder'));
create policy rp_goedkeuring_stap_zetten on rp_goedkeuring for update
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])) and status <> 'goedgekeurd')
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])) and (
    status = 'ter_goedkeuring'
    or (status in ('goedgekeurd', 'afgekeurd') and (select rp_rol()) in ('regiomanager', 'beheerder'))
  ));
create policy rp_goedkeuring_stap_lezen on rp_goedkeuring_stap for select
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));

-- Vakantierondes: planningsrollen voor hun cluster(s); wie in GRIP staat, ziet ze, zodat medewerkers weten wanneer ze
-- moeten aanvragen. Het besluit (fase besloten) neemt wie over verlof besluit (§ 4.1, § 5.1).
create policy rp_vakantieronde_planner on rp_vakantieronde for all using (rp_mag_cluster(cluster))
  with check (rp_mag_cluster(cluster) and (fase <> 'besloten' or (select rp_besluit_verlof())));
create policy rp_vakantieronde_lezen on rp_vakantieronde for select using ((select rp_rol()) is not null);

-- Verlof, per bewerking. De planner voert verlof in als aanvraag; wie besluit (rp_besluit_verlof), legt ook meteen een
-- besluit vast. Wijzigen: een aanvraag, of als besluiter alles; haalt de planner iemand uit het team, dan vervallen
-- diens open aanvragen en toekomstig verlof en eindigt lopend verlof: dat mag bij wie niet meer actief is. De app
-- haalt geen verlof weg (intrekken is een status); weghalen kan alleen wie besluit.
-- Een medewerker vraagt aan voor zichzelf, in de eigen regio, zonder besluit erbij, en trekt alleen een eigen aanvraag
-- in waarover nog niet is besloten (rp_verlof_bewaken); goedgekeurd verlof trekt de regiomanager in (§ 4.1).
create policy rp_verlof_planner_lezen on rp_verlof for select
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));
create policy rp_verlof_planner_invoeren on rp_verlof for insert
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])) and (status = 'aangevraagd' or (select rp_besluit_verlof())));
create policy rp_verlof_planner_wijzigen on rp_verlof for update
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])) and (
    status = 'aangevraagd' or (select rp_besluit_verlof())
    or not exists (select 1 from rp_medewerker m where m.id = rp_verlof.medewerker_id and m.actief)
  ))
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])) and (
    status = 'aangevraagd' or (select rp_besluit_verlof())
    or not exists (select 1 from rp_medewerker m where m.id = rp_verlof.medewerker_id and m.actief)
  ));
create policy rp_verlof_besluiter_weghalen on rp_verlof for delete
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])) and (select rp_besluit_verlof()));
create policy rp_verlof_zelf_lezen on rp_verlof for select using (medewerker_id = (select rp_mijn_medewerker()));
create policy rp_verlof_zelf_aanvragen on rp_verlof for insert with check (
  medewerker_id = (select rp_mijn_medewerker()) and regio = (select rp_mijn_regio()) and status = 'aangevraagd'
  and beoordeeld is null and beoordeelaar is null and reden is null and vervangen is null
  -- is het rooster goedgekeurd en gepubliceerd, dan geen verlof meer op een dag met een dienst: dat gaat via een ruil
  and not exists (
    select 1 from rp_rooster_gepubliceerd g
    where g.medewerker_id = rp_verlof.medewerker_id and g.datum between rp_verlof.van and rp_verlof.tot and g.dienst not in ('V', 'Z')
  )
);
create policy rp_verlof_zelf_intrekken on rp_verlof for update
  using (medewerker_id = (select rp_mijn_medewerker()) and status = 'aangevraagd')
  with check (medewerker_id = (select rp_mijn_medewerker()) and status = 'ingetrokken');

-- Ziekmeldingen: de planner meldt ziek en beter; de medewerker ziet de eigen meldingen.
create policy rp_ziek_planner on rp_ziekmelding for all
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])))
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));
create policy rp_ziek_zelf on rp_ziekmelding for select using (medewerker_id = (select rp_mijn_medewerker()));

-- Verschoven regelplekken: iedereen met een rol leest ze (de plekken van de eigen regio kloppen dan); wie plant in
-- beide regio's, legt ze vast of haalt ze weg.
create policy rp_verschuiving_lezen on rp_verschuiving for select using ((select rp_rol()) is not null);
create policy rp_verschuiving_planner on rp_verschuiving for all
  using (((select rp_mag_alle()) or (van_regio = any ((select rp_regios_mag())::text[]) and naar_regio = any ((select rp_regios_mag())::text[]))))
  with check (((select rp_mag_alle()) or (van_regio = any ((select rp_regios_mag())::text[]) and naar_regio = any ((select rp_regios_mag())::text[]))));

-- Wensen: een medewerker voor zichzelf, in de eigen regio. De planner beheert ze binnen de eigen regio('s): voor wie
-- belt, bij het importeren van een jaarrooster ("vrij"), en als hij meekijkt als medewerker.
create policy rp_wens_planner on rp_wens for all
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])))
  with check (
    ((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[]))
    and exists (select 1 from rp_medewerker m where m.id = rp_wens.medewerker_id and m.regio = rp_wens.regio)
  );
create policy rp_wens_zelf on rp_wens for all
  using (medewerker_id = (select rp_mijn_medewerker()))
  with check (medewerker_id = (select rp_mijn_medewerker()) and regio = (select rp_mijn_regio()));

-- Ruilen: medewerkers zien de ruilen in hun regio. Een medewerker biedt een eigen dienst (of eigen goedgekeurd verlof)
-- aan of vraagt een ruil in de eigen regio, met een collega uit die regio, zonder dat er al een besluit bij staat.
-- Daarna zet een medewerker alleen de eigen stap (rp_ruil_bewaken); goedkeuren doet de planner.
create policy rp_ruil_planner on rp_ruil for all
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])))
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));
create policy rp_ruil_regio_lezen on rp_ruil for select using (regio = (select rp_mijn_regio()));
create policy rp_ruil_aanbieden on rp_ruil for insert with check (
  aanbieder_id = (select rp_mijn_medewerker()) and regio = (select rp_mijn_regio()) and status = 'open'
  and geaccepteerd is null and beoordeeld is null and beoordeelaar is null and reden is null
  and (ontvanger_id is null or ontvanger_id in (select c.id from rp_collegas() c))
  -- verlof ruilen: alleen het eigen verlof aanbieden
  and (soort <> 'verlof' or exists (select 1 from rp_verlof v where v.id = verlof_id and v.medewerker_id = (select rp_mijn_medewerker()) and v.status = 'goedgekeurd'))
);
create policy rp_ruil_stap on rp_ruil for update
  using (regio = (select rp_mijn_regio()) and status in ('open', 'wacht_planner'))
  with check (regio = (select rp_mijn_regio()));

-- Logboek: wie plant, leest en schrijft binnen de eigen regio('s). Een medewerker leest wat voor hem of de hele regio
-- is, en schrijft alleen een regel over zichzelf of voor een collega in de eigen regio, niet voor de hele regio, en
-- altijd op eigen naam (rp_activiteit_bewaken). Aanpassen of weghalen kan niemand.
create policy rp_activiteit_planner on rp_activiteit for select using (
  (regio is null and (select rp_rol()) in ('beheerder', 'regiomanager', 'planner'))
  or ((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[]))
);
create policy rp_activiteit_zelf on rp_activiteit for select
  using (voor = (select rp_mijn_medewerker()) or (regio_breed and regio = (select rp_mijn_regio())));
create policy rp_activiteit_schrijven on rp_activiteit for insert with check (
  (regio is null and (select rp_rol()) in ('beheerder', 'regiomanager', 'planner'))
  or ((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[]))
  or (regio = (select rp_mijn_regio()) and not regio_breed and (
    voor is null or voor = (select rp_mijn_medewerker()) or voor in (select c.id from rp_collegas() c)
  ))
);

-- Voorkeuren: de medewerker beheert het eigen profiel; planningsrollen zien en wijzigen die van hun regio's.
create policy rp_profiel_zelf on rp_voorkeurprofiel for all
  using (medewerker_id = (select rp_mijn_medewerker()))
  with check (medewerker_id = (select rp_mijn_medewerker()));
create policy rp_profiel_planner on rp_voorkeurprofiel for all
  using (exists (select 1 from rp_medewerker m where m.id = medewerker_id and ((select rp_mag_alle()) or m.regio = any ((select rp_regios_mag())::text[]))))
  with check (exists (select 1 from rp_medewerker m where m.id = medewerker_id and ((select rp_mag_alle()) or m.regio = any ((select rp_regios_mag())::text[]))));
create policy rp_ronde_planner on rp_voorkeurronde for all
  using (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])))
  with check (((select rp_mag_alle()) or regio = any ((select rp_regios_mag())::text[])));
create policy rp_ronde_lezen on rp_voorkeurronde for select using (regio = (select rp_mijn_regio()));
create policy rp_ingediend_planner on rp_voorkeurronde_ingediend for select
  using (exists (select 1 from rp_voorkeurronde r where r.id = ronde_id and ((select rp_mag_alle()) or r.regio = any ((select rp_regios_mag())::text[]))));
create policy rp_ingediend_zelf on rp_voorkeurronde_ingediend for all
  using (medewerker_id = (select rp_mijn_medewerker()))
  with check (medewerker_id = (select rp_mijn_medewerker()) and exists (
    select 1 from rp_voorkeurronde r where r.id = ronde_id and r.status = 'open' and r.regio = (select rp_mijn_regio())
  ));

-- Verdelen: alleen de planningsrollen.
create policy rp_verdeling_planner on rp_verdeling for all
  using ((select rp_rol()) in ('beheerder', 'regiomanager', 'planner'))
  with check ((select rp_rol()) in ('beheerder', 'regiomanager', 'planner'));

-- Klaargezette delen van een grote wijziging: alleen van wie ze klaarzette, en alleen voor wie in GRIP staat (een
-- werkaccount zonder profiel kan de tabel anders vullen).
create policy rp_bewaar_deel_eigen on rp_bewaar_deel for all using (eigenaar = (select auth.uid()))
  with check (eigenaar = (select auth.uid()) and (select rp_rol()) is not null);

-- ── Rechten op de functies ──────────────────────────────────────────────────

grant execute on function rp_collegas(), rp_verlof_team(), rp_wensen_team(), rp_besluit_verlof() to authenticated;

-- Opruimen: alleen de server (de eigenaar), nooit via /api/db.
revoke execute on function rp_opruimen(date) from public;

-- Opslaan, de schemaversie en de dagelijkse voorspelling: alleen wie is ingelogd en de server.
revoke execute on function rp_bewaar(jsonb), rp_bewaar_klaar(uuid, int), rp_schema_versie(), rp_dagtaak_claim(jsonb, int) from public;
grant execute on function rp_bewaar(jsonb), rp_bewaar_klaar(uuid, int), rp_schema_versie(), rp_dagtaak_claim(jsonb, int) to authenticated;

-- ── De werkregio NBD ────────────────────────────────────────────────────────

-- Zodat je een regiomanager of medewerker aan de nabestaandendesk kunt koppelen (users.regios). Lukt dat niet
-- (bijvoorbeeld door een extra verplichte kolom in regios), dan gaat de rest gewoon door; de controle hieronder laat
-- zien of de regio er staat.
do $$
begin
  if not exists (select 1 from regios where naam = 'NBD') then
    insert into regios (naam) values ('NBD');
  end if;
exception when others then
  raise warning 'Regio NBD niet toegevoegd: %', sqlerrm;
end $$;

-- Controle: grip_klaar en nbd_klaar moeten allebei true zijn.
select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'rp\_%') = 27
   and rp_schema_versie() = 20261111 as grip_klaar,
   exists (select 1 from regios where naam = 'NBD') as nbd_klaar;
