-- Na het schema: de rechten van wie is ingelogd, en een seintje bij elke wijziging zodat de app van collega's
-- bijleest (lib/server/live.ts). Het seintje noemt alleen de tabel; wat iemand daarna leest, bepaalt de RLS.

grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on grip_installatie from authenticated;

create or replace function grip_meld_wijziging() returns trigger
language plpgsql as $$
begin
  perform pg_notify('grip_wijziging', tg_table_name);
  return null;
end $$;

-- De meldingenhistorie en de externe bronnen niet: die veranderen in grote stukken en worden bij het openen gelezen.
do $$
declare
  t text;
begin
  foreach t in array array[
    'rp_instelling', 'rp_norm_regio', 'rp_schoolvakantie', 'rp_run', 'rp_coef', 'rp_bron_status', 'rp_handmatig',
    'rp_medewerker', 'rp_rooster', 'rp_tijd', 'rp_goedkeuring', 'rp_publicatie', 'rp_rooster_gepubliceerd',
    'rp_voorkeurprofiel', 'rp_voorkeurronde', 'rp_voorkeurronde_ingediend', 'rp_vakantieronde', 'rp_verlof',
    'rp_ziekmelding', 'rp_wens', 'rp_ruil', 'rp_activiteit', 'rp_verdeling', 'rp_verschuiving'
  ] loop
    execute format('drop trigger if exists grip_meld_wijziging on %I', t);
    execute format('create trigger grip_meld_wijziging after insert or update or delete or truncate on %I for each statement execute function grip_meld_wijziging()', t);
  end loop;
end $$;
