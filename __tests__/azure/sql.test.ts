import { describe, expect, it } from 'vitest';
import { alsSql, leesVraag, OngeldigeVraag } from '@/lib/server/sql';
import type { Vraag } from '@/lib/store/db/vraag';

const fout = (v: unknown) => expect(() => alsSql(leesVraag(v))).toThrow(OngeldigeVraag);

describe('een vraag uit de browser als SQL', () => {
  it('lezen: namen tussen aanhalingstekens, waarden als parameter', () => {
    const s = alsSql({ op: 'lees', tabel: 'rp_run', opties: { kolommen: 'id, soort', filters: [{ kolom: 'soort', op: 'eq', waarde: "x'; drop table users; --" }, { kolom: 'id', op: 'in', waarde: ['a', 'b'] }], orde: ['uitgegeven'], aflopend: true, limiet: 60 } });
    expect(s.sql).toContain('select "id", "soort" from rp_run where "soort" = $1 and "id" = any($2) order by "uitgegeven" desc limit 60');
    expect(s.params).toEqual(["x'; drop table users; --", ['a', 'b']]);
  });

  it('een leesfunctie met benoemde argumenten', () => {
    const s = alsSql({ op: 'rpc', functie: 'rp_rooster_versies_vanaf', args: { van: '2026-01-01' }, orde: ['medewerker_id'] });
    expect(s.sql).toContain('select * from rp_rooster_versies_vanaf("van" => $1) order by "medewerker_id"');
    expect(s.params).toEqual(['2026-01-01']);
  });

  it('weigert wat niet in de lijst staat of er niet als naam uitziet', () => {
    fout({ op: 'lees', tabel: 'users' });
    fout({ op: 'lees', tabel: 'pg_authid' });
    fout({ op: 'lees', tabel: 'rp_run', opties: { kolommen: 'id, (select 1)' } });
    fout({ op: 'lees', tabel: 'rp_run', opties: { kolommen: 'data"; drop table rp_run; --' } });
    fout({ op: 'lees', tabel: 'rp_run', opties: { filters: [{ kolom: 'id', op: 'like', waarde: '%' }] } });
    fout({ op: 'lees', tabel: 'rp_run', opties: { filters: [{ kolom: 'id', op: 'in', waarde: 'a' }] } });
    fout({ op: 'lees', tabel: 'rp_run', opties: { limiet: 0 } });
    fout({ op: 'lees', tabel: 'rp_run', opties: { limiet: '1; drop' } });
    fout({ op: 'rpc', functie: 'rp_bewaar' });
    fout({ op: 'rpc', functie: 'pg_sleep', args: { secs: 10 } });
    fout({ op: 'rpc', functie: 'rp_collegas', args: { 'x => 1); drop table users; --': 1 } });
    fout({ op: 'klaarzetten', id: 'geen-uuid', nr: 0, stappen: [] });
    fout({ op: 'bewaarKlaar', id: '6f1c0d3e-2a5b-4c8d-9e0f-1a2b3c4d5e6f', delen: 0 });
    fout({ op: 'bewaar', stappen: 'alles' });
    fout({ op: 'iets' });
    fout(null);
    fout([]);
  });

  it('bewaren gaat als één jsonb-parameter naar rp_bewaar', () => {
    const stappen: Extract<Vraag, { op: 'bewaar' }>['stappen'] = [{ tabel: 'rp_medewerker', soort: 'upsert', sleutel: ['id'], rijen: [{ id: '1' }] }];
    const s = alsSql({ op: 'bewaar', stappen });
    expect(s.sql).toBe('select rp_bewaar($1::jsonb) as uit');
    expect(JSON.parse(s.params[0] as string)).toEqual(stappen);
  });
});
