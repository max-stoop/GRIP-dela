// @vitest-environment node
/**
 * Het water in de schatting: de lijnen liggen aan de goede kant van elke woonkern, de oversteken liggen over het
 * water, en bekende ritten komen uit op een geloofwaardige reistijd.
 */
import { describe, it, expect } from 'vitest';
import { BARRIERES, EILANDEN, KNOPEN, OVERSTEKEN, eilandVan, geblokkeerd, hemelsbreed, type LL } from '@/lib/verdeling/water';
import { SCHATTING, afstandKm, laadPostcodes, puntVan, rijtijd, schatReistijd, wegVan } from '@/lib/verdeling/geo';

function binnen(p: LL, lus: LL[]): boolean {
  let c = false;
  for (let i = 0, j = lus.length - 1; i < lus.length; j = i++) {
    const [yi, xi] = lus[i], [yj, xj] = lus[j];
    if ((yi > p[0]) !== (yj > p[0]) && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const gesloten = (l: LL[]) => l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];

describe('de kaart van het water', () => {
  it('geen woonkern ligt in een meer, en geen knoop of haven ligt in het water', async () => {
    const t = await laadPostcodes();
    for (const b of BARRIERES.filter((x) => gesloten(x.lijn))) {
      const erin = [...t].filter(([, [la, ln]]) => binnen([la, ln], b.lijn)).map(([pc, [, , n]]) => `${pc} ${n}`);
      expect(erin, b.naam).toEqual([]);
      for (const k of KNOPEN) expect(binnen(k.p, b.lijn), `${k.naam} in ${b.naam}`).toBe(false);
      for (const o of OVERSTEKEN) expect(binnen(o.van, b.lijn) || binnen(o.naar, b.lijn), `${o.naam} in ${b.naam}`).toBe(false);
    }
  });

  it('elke oversteek gaat echt over het water (begin en eind aan weerszijden)', () => {
    for (const o of OVERSTEKEN) {
      // de dammen tussen twee meren lopen over een strook land tussen de lussen; de rest kruist een lijn
      if (o.naam === 'Afsluitdijk' || o.naam === 'Houtribdijk') expect(geblokkeerd(o.van, o.naar), o.naam).toBe(false);
      else expect(geblokkeerd(o.van, o.naar), o.naam).toBe(true);
    }
  });

  it('woonkernen aan de overkant van het water zijn niet rechtstreeks bereikbaar, aan dezelfde kant wel', async () => {
    const t = await laadPostcodes();
    const p = (pc: string): LL => { const x = puntVan(t, pc)!; return [x.lat, x.lng]; };
    const overkant: [string, string, string][] = [
      ['4381', '4511', 'Vlissingen - Breskens (Westerschelde)'], ['4437', '4531', 'Ellewoutsdijk - Terneuzen'], ['4417', '4588', 'Hansweert - Walsoorden'],
      ['4302', '4486', 'Zierikzee - Colijnsplaat (Oosterschelde)'], ['4401', '4695', 'Yerseke - Sint Maartensdijk'], ['4311', '4697', 'Bruinisse - Sint Annaland (Keeten)'],
      ['4318', '3247', 'Brouwershaven - Dirksland (Grevelingen)'], ['3221', '3241', 'Hellevoetsluis - Middelharnis (Haringvliet)'], ['3281', '4797', 'Numansdorp - Willemstad'],
      ['3292', '4782', 'Strijensas - Moerdijk (Hollands Diep)'], ['3329', '4924', 'Dordrecht - Drimmelen (Biesbosch)'], ['3151', '3198', 'Hoek van Holland - Europoort'],
      ['3144', '3181', 'Maassluis - Rozenburg (Nieuwe Waterweg)'], ['1781', '8861', 'Den Helder - Harlingen (Waddenzee)'], ['1601', '8715', 'Enkhuizen - Stavoren (IJsselmeer)'], ['8243', '8302', 'Lelystad - Emmeloord (IJsselmeer bij de Ketelbrug)'],
      ['1627', '8243', 'Hoorn - Lelystad (Markermeer)'], ['8243', '8321', 'Lelystad - Urk'],
    ];
    for (const [a, b, n] of overkant) expect(geblokkeerd(p(a), p(b)), n).toBe(true);
    const zelfdeKant: [string, string, string][] = [
      ['4331', '4381', 'Middelburg - Vlissingen'], ['4531', '4561', 'Terneuzen - Hulst'], ['4461', '4401', 'Goes - Yerseke'], ['3011', '3311', 'Rotterdam - Dordrecht'],
      ['1012', '3511', 'Amsterdam - Utrecht'], ['1012', '1311', 'Amsterdam - Almere'], ['1621', '1601', 'Hoorn - Enkhuizen'],
      ['4931', '4921', 'Geertruidenberg - Made'], ['2511', '3011', 'Den Haag - Rotterdam'], ['9711', '8911', 'Groningen - Leeuwarden'],
    ];
    for (const [a, b, n] of zelfdeKant) expect(geblokkeerd(p(a), p(b)), n).toBe(false);
  });

  it('herkent de eilanden aan de postcode, en anders aan de plek', () => {
    expect(EILANDEN[eilandVan('1791 AB', [0, 0])].naam).toBe('Texel');
    expect(EILANDEN[eilandVan('8881', [0, 0])].naam).toBe('Terschelling');
    expect(eilandVan('1781', [53.05, 4.8])).toBe(-1);
    expect(EILANDEN[eilandVan(undefined, [53.45, 5.77])].naam).toBe('Ameland');
    expect(eilandVan('', [52.0, 5.0])).toBe(-1);
  });
});

describe('reistijd met water', () => {
  const ritten: [string, string, string, number, number][] = [
    // van, naar, wat, minuten tussen (daluren, geschat over de weg)
    ['4331', '4531', 'Middelburg - Terneuzen (tunnel)', 30, 50],
    ['4381', '4511', 'Vlissingen - Breskens (tunnel, geen autoveer)', 40, 65],
    ['4561', '4461', 'Hulst - Goes', 35, 60],
    ['1781', '1791', 'Den Helder - Den Burg (veerboot)', 45, 70],
    ['8861', '1781', 'Harlingen - Den Helder (Afsluitdijk)', 50, 75],
    ['1621', '8243', 'Hoorn - Lelystad (Houtribdijk)', 35, 55],
    ['8243', '8302', 'Lelystad - Emmeloord (Ketelbrug)', 30, 50],
    ['4301', '3241', 'Zierikzee - Middelharnis (Grevelingendam)', 25, 45],
    ['3221', '3241', 'Hellevoetsluis - Middelharnis (Haringvlietdam)', 20, 40],
    ['4401', '4691', 'Yerseke - Tholen (via Bergen op Zoom)', 25, 45],
    ['3151', '3231', 'Hoek van Holland - Brielle (pont of tunnel)', 30, 55],
    ['3311', '4921', 'Dordrecht - Made (Moerdijk)', 25, 45],
    ['4461', '4301', 'Goes - Zierikzee (Zeelandbrug)', 20, 40],
    ['1012', '3511', 'Amsterdam - Utrecht', 35, 55],
    ['2511', '3011', 'Den Haag - Rotterdam', 25, 40],
    ['6211', '5611', 'Maastricht - Eindhoven', 55, 80],
  ];

  it('bekende ritten komen uit op een geloofwaardige reistijd', async () => {
    const t = await laadPostcodes();
    for (const [a, b, n, lo, hi] of ritten) {
      const r = schatReistijd(puntVan(t, a)!, puntVan(t, b)!, 11 * 60);
      expect(r, n).toBeGreaterThanOrEqual(lo);
      expect(r, n).toBeLessThanOrEqual(hi);
    }
  });

  it('zonder water verandert er niets; om water heen is het altijd langer dan hemelsbreed', async () => {
    const t = await laadPostcodes();
    const ams = puntVan(t, '1012')!, utr = puntVan(t, '3511')!;
    expect(wegVan(ams, utr)).toMatchObject({ omweg: false, veer: 0 });
    expect(wegVan(ams, utr).km).toBeCloseTo(afstandKm(ams, utr) * SCHATTING.omrijfactor, 6);
    expect(schatReistijd(ams, utr, 11 * 60)).toBeCloseTo(SCHATTING.vast + rijtijd(afstandKm(ams, utr) * SCHATTING.omrijfactor), 6);
    const vlis = puntVan(t, '4381')!, bres = puntVan(t, '4511')!;
    expect(wegVan(vlis, bres).km).toBeGreaterThan(afstandKm(vlis, bres) * 5);
  });

  it('heen en terug zijn even lang', async () => {
    const t = await laadPostcodes();
    for (const [a, b] of ritten) {
      const pa = puntVan(t, a)!, pb = puntVan(t, b)!;
      expect(wegVan(pa, pb).km, `${a}-${b}`).toBeCloseTo(wegVan(pb, pa).km, 6);
    }
  });

  it('de Waddeneilanden behalve Texel vallen buiten de maximale reistijd', async () => {
    const t = await laadPostcodes();
    const harlingen = puntVan(t, '8861')!;
    expect(schatReistijd(harlingen, puntVan(t, '8881')!, 11 * 60)).toBeGreaterThan(120);
    expect(schatReistijd(puntVan(t, '9151')!, puntVan(t, '9163')!, 11 * 60)).toBeGreaterThan(75);
    // op het eiland zelf gewoon rijden
    expect(wegVan(puntVan(t, '1791')!, puntVan(t, '1795')!)).toMatchObject({ omweg: false, veer: 0 });
  });

  it('heel Nederland is bereikbaar, en snel genoeg', async () => {
    const t = await laadPostcodes();
    const pcs = [...t.keys()];
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < pcs.length; i += 11) {
      for (let j = 0; j < pcs.length; j += 131) {
        const r = schatReistijd(puntVan(t, pcs[i])!, puntVan(t, pcs[j])!, 600);
        expect(Number.isFinite(r), `${pcs[i]}-${pcs[j]}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(10_000);
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('een knoop is bereikbaar vanaf de oevers die hij moet verbinden', () => {
    // de dam tussen IJsselmeer en Markermeer, en de omweg via Bergen op Zoom
    expect(geblokkeerd([52.640, 5.06], KNOPEN.find((k) => k.naam.startsWith('Enkhuizen'))!.p)).toBe(false);
    expect(geblokkeerd([51.493, 4.049], KNOPEN.find((k) => k.naam === 'Bergen op Zoom')!.p)).toBe(false);
    expect(geblokkeerd([51.533, 4.216], KNOPEN.find((k) => k.naam === 'Bergen op Zoom')!.p)).toBe(false);
    expect(hemelsbreed([52, 5], [52, 5])).toBe(0);
  });
});
