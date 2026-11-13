import { describe, it, expect } from 'vitest';
import { leesCsv, leesDatum, rijenNaarMeldingen, herkenRegio, tabelNaarRijen, verdwijntBijVervangen, voegSamen } from '@/lib/import';
import { parseRiool } from '@/lib/bronnen/rivm';
import { parseCbs, weekStart } from '@/lib/bronnen/cbs';
import { naarReeksen } from '@/lib/bronnen/common';
import { fourierFit, seizoenRijen } from '@/lib/bronnen/openmeteo';
import { toDay, fromDay, dayOfYear } from '@/lib/dates';

describe('meldingen inlezen', () => {
  it('een Excel-tabel (eerste rij = kop) wordt rijen met kolomnamen; Excel-datums tellen in UTC', () => {
    const rijen = tabelNaarRijen([['datum', 'Utrecht', null], [new Date(Date.UTC(2026, 9, 5)), 4, 'x'], [null, null, null]]);
    expect(rijen).toEqual([{ datum: new Date(Date.UTC(2026, 9, 5)), Utrecht: 4, kolom2: 'x' }]);
    expect(leesDatum(new Date(Date.UTC(2026, 9, 5)))).toBe('2026-10-05');
    expect(rijenNaarMeldingen(rijen).data.regios.Utrecht).toEqual([4]);
  });

  it('herkent regio’s ongeacht streepjes, schuine strepen en hoofdletters', () => {
    expect(herkenRegio('twente-achterhoek')).toBe('Twente/Achterhoek');
    expect(herkenRegio('Noord Holland Midden')).toBeNull();
    expect(herkenRegio('noord-holland midden')).toBe('Noord-Holland Midden');
    expect(herkenRegio('West Brabant-Zeeland')).toBe('West Brabant/Zeeland');
  });

  it('leest datums uit Excel-getallen en tekst', () => {
    expect(leesDatum(46300)).toBe('2026-10-05');
    expect(leesDatum('2026-10-05')).toBe('2026-10-05');
    expect(leesDatum('5-10-2026')).toBe('2026-10-05');
    expect(leesDatum('05/10/2026')).toBe('2026-10-05');
    expect(leesDatum('onzin')).toBeNull();
  });

  it('lang formaat (datum, regio, aantal) met puntkomma', () => {
    const rows = leesCsv('Datum;Regio;Aantal\n2026-01-01;Utrecht;4\n2026-01-03;Utrecht;6\n2026-01-02;Amsterdam;3\n2026-01-02;Atlantis;9\n');
    const r = rijenNaarMeldingen(rows);
    expect(r.van).toBe('2026-01-01');
    expect(r.tot).toBe('2026-01-03');
    expect(r.data.n).toBe(3);
    // geen rij op 2 januari tussen twee dagen van Utrecht: 0 meldingen, niet onbekend
    expect(r.data.regios.Utrecht).toEqual([4, 0, 6]);
    // voor de eerste en na de laatste dag van een regio blijft het onbekend
    expect(r.data.regios.Amsterdam).toEqual([null, 3, null]);
    expect(r.nul).toBe(1);
    expect(r.onbekend).toEqual(['Atlantis']);
    expect(r.rijen).toBe(3);
  });

  it('een export met alleen dagen met meldingen: de dagen zonder rij tellen als 0, ook in breed formaat', () => {
    const lang = rijenNaarMeldingen(leesCsv('datum;regio;aantal\n2026-03-01;Tilburg;2\n2026-03-04;Tilburg;1\n'));
    expect(lang.data.regios.Tilburg).toEqual([2, 0, 0, 1]);
    expect(lang.nul).toBe(2);
    const breed = rijenNaarMeldingen(leesCsv('datum,Tilburg,Breda\n2026-03-01,2,\n2026-03-02,,1\n2026-03-03,3,\n'));
    expect(breed.data.regios.Tilburg).toEqual([2, 0, 3]);
    expect(breed.data.regios.Breda).toEqual([null, 1, null]);
  });

  it('breed formaat: per regio een kolom', () => {
    const rows = leesCsv('datum,Friesland,Zuid-Limburg,Onbekend\n2026-02-01,5,6,1\n2026-02-02,4,,2\n');
    const r = rijenNaarMeldingen(rows);
    expect(r.data.regios.Friesland).toEqual([5, 4]);
    expect(r.data.regios['Zuid Limburg']).toBeUndefined();
    expect(r.onbekend).toContain('Zuid-Limburg');
    expect(r.onbekend).toContain('Onbekend');
  });

  it('geeft een duidelijke fout bij een leeg of onbruikbaar bestand', () => {
    expect(() => rijenNaarMeldingen([])).toThrow(/geen rijen/);
    expect(() => rijenNaarMeldingen([{ a: 'x', b: 'y' }])).toThrow(/Geen bruikbare rijen/);
  });
});

describe('bronnen', () => {
  it('RIVM: vindt datum- en RNA-kolom en het scheidingsteken', () => {
    const csv = 'Version;Date_measurement;RNA_flow_per_100000;Other\n1;2026-09-01;1.5e+13;x\n1;2026-09-08;2.25e+13;y\n1;;;z\n';
    expect(parseRiool(csv)).toEqual([['NL', '2026-09-01', 'covid_rna', 1.5e13], ['NL', '2026-09-08', 'covid_rna', 2.25e13]]);
  });

  it('CBS: weekcodes naar maandag, jaartotalen en week 0 vallen af', () => {
    expect(weekStart('2024W01')).toBe('2024-01-01');
    expect(weekStart('2026W53')).toBe('2026-12-28');
    expect(weekStart('2025W53')).toBeNull();
    expect(weekStart('2024W00')).toBeNull();
    expect(weekStart('2024JJ00')).toBeNull();
    expect(parseCbs([{ Perioden: '2024W02', Overledenen_1: 3100 }, { Perioden: '2024JJ00', Overledenen_1: 170000 }])).toEqual([['NL', '2024-01-08', 'overledenen', 3100]]);
  });

  it('maakt compacte reeksen met gaten', () => {
    const { reeksen, rijen } = naarReeksen([['Utrecht', '2026-10-01', 'tmax', 20], ['Utrecht', '2026-10-03', 'tmax', 22.12345], ['Utrecht', '2026-10-02', 'tmax', null]]);
    expect(rijen).toBe(2);
    expect(reeksen).toEqual([{ sleutel: 'Utrecht', variabele: 'tmax', start: '2026-10-01', v: [20, null, 22.123] }]);
  });

  it('seizoensverwachting: gemiddelde over de ensembleleden', () => {
    const r = seizoenRijen({ time: ['2026-10-05'], temperature_2m_mean: [12], temperature_2m_mean_member01: [14], temperature_2m_mean_member02: [null] } as never);
    expect(r).toEqual([['NL', '2026-10-05', 'tmean_ens', 13]]);
  });

  it('klimaatnormaal: Fourier-fit vindt de seizoensvorm terug', () => {
    const time: string[] = [], vals: number[] = [];
    for (let d = toDay('2000-01-01'); d <= toDay('2009-12-31'); d++) {
      const a = (2 * Math.PI * dayOfYear(d)) / 365.25;
      time.push(fromDay(d));
      vals.push(10 + 2 * Math.sin(a) - 7.5 * Math.cos(a) + 0.3 * Math.cos(2 * a));
    }
    const b = fourierFit(time, vals);
    expect(b[0]).toBeCloseTo(10, 6);
    expect(b[1]).toBeCloseTo(2, 6);
    expect(b[2]).toBeCloseTo(-7.5, 6);
    expect(b[4]).toBeCloseTo(0.3, 6);
  });
});

describe('meldingen aanvullen', () => {
  const oud = { start: '2026-10-01', n: 5, regios: { Utrecht: [4, 5, null, 6, 7], Rotterdam: [3, 3, 3, 3, 3] } };

  it('vult aan: nieuwe dagen erbij, het bestand telt, de rest blijft', () => {
    // 4 t/m 7 okt: 4 en 5 okt stonden er al (één anders), 6 en 7 okt zijn nieuw; Friesland is nieuw
    const nieuw = { start: '2026-10-04', n: 4, regios: { Utrecht: [6, 8, 2, 5], Friesland: [null, 1, 2, null] } };
    const s = voegSamen(oud, nieuw);
    expect(s.data.start).toBe('2026-10-01');
    expect(s.data.n).toBe(7);
    expect(s.data.regios.Utrecht).toEqual([4, 5, null, 6, 8, 2, 5]);
    expect(s.data.regios.Rotterdam).toEqual([3, 3, 3, 3, 3, null, null]);
    expect(s.data.regios.Friesland).toEqual([null, null, null, null, 1, 2, null]);
    expect([s.nieuw, s.gewijzigd, s.gelijk]).toEqual([4, 1, 1]);
    // vervangen gooit de rest weg: Utrecht 1-3 okt (2 dagen met een aantal) en Rotterdam 1-5 okt
    expect(verdwijntBijVervangen(oud, nieuw)).toBe(7);
  });

  it('ook een gat of oudere dagen invullen, en zonder historie gewoon het bestand', () => {
    const s = voegSamen(oud, { start: '2026-09-29', n: 5, regios: { Utrecht: [1, 2, null, null, 9] } });
    expect(s.data.start).toBe('2026-09-29');
    expect(s.data.regios.Utrecht).toEqual([1, 2, 4, 5, 9, 6, 7]);
    expect([s.nieuw, s.gewijzigd]).toEqual([3, 0]);
    const leeg = voegSamen(null, oud);
    expect(leeg.data).toBe(oud);
    expect(leeg.nieuw).toBe(9);
    expect(verdwijntBijVervangen(null, oud)).toBe(0);
  });
});
