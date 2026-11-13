/**
 * Het ene roostervoorstel: eerst alle regelplekken (weekenden eerst, een tekort gespreid, in het weekend een 2), dan
 * Dg-diensten gelijkmatig over de dagen, met aangevraagd verlof, het urensaldo van de vier weken ervoor en een eerlijke
 * weging van wensen. En: een andere verdeling die net zo goed aan het beleid voldoet.
 */
import { describe, it, expect } from 'vitest';
import { addDays, isoRange, isWeekend, toDay, weekday } from '@/lib/dates';
import { voorstel, voorstelMetUitleg } from '@/lib/rooster/voorstel';
import { beschikbaarPerMedewerker, eigenMeldingVoorgaan, maakRooster, REKENT_MET, urenBovenContract, voorgangenPerDag, werkEnBezetting } from '@/lib/rooster/maak';
import { binnen24Uur, clusterGenoeg, kans1BPerDag, val1B } from '@/lib/rooster/kans1b';
import { wensGehonoreerd } from '@/lib/rooster/diensten';
import { CLUSTERS } from '@/lib/model/config';
import { pasToe } from '@/lib/rooster/ruil';
import { toets, cel } from '@/lib/rooster/toets';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { DIENSTEN, isEnkel } from '@/lib/rooster/diensten';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { STANDAARD_BELEID, LEEG_PROFIEL, WENS_JAARROOSTER, beleidVoor, maxKanNiet, type Voorkeurprofiel, type Beleid, type Cellen, type DienstCode, type Medewerker, type Wens } from '@/lib/rooster/types';

const regio = 'Utrecht';
const B = beleidVoor(STANDAARD_BELEID, regio, NORM_STANDAARD);
const dates = isoRange('2027-02-01', '2027-02-28'); // vier hele weken, maandag t/m zondag
let n = 0;
const alle = voorbeeldTeam(regio, () => `m${++n}`).filter((m) => !m.extern);
const uv = (team: Medewerker[]) => team.filter((m) => (m.functie ?? 'UV') === 'UV');
const behoefte = behoefteVoor({ norm: NORM_STANDAARD }, regio, dates, { alphaRegio: B.alphaRegio, tegen: 'norm' });
const som = (a: number[]) => a.reduce((x, y) => x + y, 0);
const plekken = (c: Cellen, team: Medewerker[], d: string) => som(team.map((m) => DIENSTEN[cel(c, m.id, d)].plekken));
const tekort = (c: Cellen, team: Medewerker[]) => dates.map((d) => Math.max(0, (behoefte[d]?.k ?? 0) - plekken(c, team, d)));
const dg = (c: Cellen, team: Medewerker[], d: string) => team.filter((m) => DIENSTEN[cel(c, m.id, d)].categorie === 'dossier').length;
const uren = (c: Cellen, m: Medewerker) => som(dates.map((d) => DIENSTEN[cel(c, m.id, d)].uren));
function maak(team: Medewerker[], extra: Partial<Parameters<typeof voorstelMetUitleg>[0]> = {}, start: Cellen = {}) {
  const v = voorstelMetUitleg({ team, dates, cellen: start, behoefte, wensen: [], beleid: B, opnieuw: true, seed: 11, ...extra });
  const cellen = pasToe(start, v.wijzigingen);
  return { ...v, cellen, t: toets({ team, dates, cellen, behoefte, wensen: extra.wensen ?? [], beleid: extra.beleid ?? B, profielen: extra.profielen }) };
}

describe('eerst de regelplekken, dan het dossierwerk', () => {
  it('een gewoon team: alle regelplekken gevuld, geen overtredingen, en het beleid voor de 2 en de 1B gehaald', () => {
    const r = maak(alle);
    expect(som(tekort(r.cellen, alle))).toBe(0);
    expect(r.tekorten).toEqual([]);
    expect(r.t.hard).toBe(0);
    for (const d of dates) {
      const codes = alle.map((m) => cel(r.cellen, m.id, d));
      const twee = codes.filter((c) => c === '2').length;
      // nooit meer dan afgesproken; hoogstens twee keer een 2, met genoeg enkele diensten; elke dag een 1M en een 1B
      expect(plekken(r.cellen, alle, d)).toBe(behoefte[d]!.k);
      expect(twee).toBeLessThanOrEqual(B.maxTwee);
      if (twee) expect(codes.filter(isEnkel).length).toBeGreaterThanOrEqual(B.minEnkelBijTwee);
      expect(codes.filter((c) => c === '1M').length).toBeGreaterThanOrEqual(B.minMiddag);
      expect(codes.filter((c) => c === '1B').length).toBe(B.beschikbaarPerDag);
    }
  });

  it('een te klein team: de regelplekken gaan voor de Dg-diensten', () => {
    const team = alle.slice(3);
    const r = maak(team);
    // alle regelplekken staan; wat er niet meer past, is dossierwerk
    expect(som(tekort(r.cellen, team))).toBe(0);
    expect(dates.filter((d) => weekday(toDay(d)) !== 0 && dg(r.cellen, team, d) < B.minDG).length).toBeGreaterThan(0);
    expect(r.t.hard).toBe(0);
  });

  const weekUren = (c: Cellen, m: Medewerker, w: number) => som(dates.slice(w * 7, w * 7 + 7).map((d) => DIENSTEN[cel(c, m.id, d)].uren));
  const strak: Beleid = { ...B, bovenContractPct: 0, omHetWeekend: true };

  it('nooit boven contract ingesteld: dan blijft iedereen binnen zijn contract, en staat bij een lege plek waarom', () => {
    const team = alle.slice(7);
    const r = maak(team, { beleid: strak });
    for (const m of team) for (let w = 0; w < 4; w++) expect(weekUren(r.cellen, m, w)).toBeLessThanOrEqual(m.contract + 0.01);
    const tk = tekort(r.cellen, team);
    expect(r.tekorten.map((x) => [x.datum, x.tekort])).toEqual(dates.map((d, i) => [d, tk[i]] as [string, number]).filter(([, x]) => x > 0));
    for (const x of r.tekorten) {
      expect(x.redenen.length).toBeGreaterThan(0);
      // iedereen die die dag niet werkt, heeft een reden
      expect(som(x.redenen.map(([, aantal]) => aantal))).toBe(team.filter((m) => !DIENSTEN[cel(r.cellen, m.id, x.datum)].werk).length);
    }
  });

  it('de regelplekken staan er altijd: bij te weinig mensen boven contract, tot de grens', () => {
    const boven = (c: Cellen, team: Medewerker[]) => team.flatMap((m) => [0, 1, 2, 3].map((w) => weekUren(c, m, w) - m.contract)).filter((x) => x > 0.01);
    for (const weg of [5, 7]) {
      const team = alle.slice(weg);
      const r = maak(team);
      // tien mensen: alles staat. Acht mensen: wat nog open blijft, komt alleen door de grens boven contract of de wet
      if (weg === 5) expect(som(tekort(r.cellen, team))).toBe(0);
      expect(som(tekort(r.cellen, team))).toBeLessThanOrEqual(3);
      const mag = ['al een dienst boven contract deze week', 'te ver boven contract deze periode', 'te veel dagen achter elkaar', 'te weinig rust tussen twee diensten', 'vrije weekenden per jaar (CAO)', 'heeft het maximum aan regelplekken dit weekend', 'andere functie', 'kan niet op deze weekdag'];
      for (const x of r.tekorten) for (const [reden] of x.redenen) expect(mag).toContain(reden);
      expect(r.t.hard).toBe(0);
      expect(boven(r.cellen, team).length).toBeGreaterThan(0);
      // over de periode hoogstens 15% boven het contract (28 uur wordt 32)
      for (const m of team) expect(uren(r.cellen, m)).toBeLessThanOrEqual(((m.contract * dates.length) / 7) * 1.15 + 0.01);
    }
    // genoeg mensen: af en toe een hele dag boven contract mag, maar over de periode nooit meer dan 15%
    const vol = maak(alle);
    for (const m of alle) expect(uren(vol.cellen, m)).toBeLessThanOrEqual(((m.contract * dates.length) / 7) * 1.15 + 0.01);
  });

  it('elke dag minstens één voorgaansplek, en de rest zo gelijk mogelijk over de dagen', () => {
    const vg = (c: Cellen, team: Medewerker[], d: string) => som(team.map((m) => DIENSTEN[cel(c, m.id, d)].voorgangen));
    const maZa = dates.filter((d) => weekday(toDay(d)) !== 0);
    // ook met tien mensen: geen dag zonder (zonder de grens boven contract wel)
    const tien = alle.slice(5);
    // (hoogstens een enkele dag waar de grens boven contract het tegenhoudt)
    expect(maZa.filter((d) => vg(maak(tien).cellen, tien, d) === 0).length).toBeLessThanOrEqual(1);
    expect(maZa.filter((d) => vg(maak(tien, { beleid: strak }).cellen, tien, d) === 0).length).toBeGreaterThan(0);
    // een gewoon team: binnen een week op werkdagen hoogstens drie verschil
    const r = maak(alle);
    for (let w = 0; w < 4; w++) {
      const week = dates.slice(w * 7, w * 7 + 5).map((d) => vg(r.cellen, alle, d));
      expect(Math.min(...week)).toBeGreaterThanOrEqual(B.voorgangenPerDag);
      expect(Math.max(...week) - Math.min(...week)).toBeLessThanOrEqual(3);
    }
  });

  it('eigen melding voorgaan: zes dagen na een regeldienst staat er veel vaker weer een regeldienst of Dg-dienst', () => {
    const deel = (beleid: Beleid) => { const x = eigenMeldingVoorgaan(alle, dates, maak(alle, { beleid }).cellen, 6)!; return x.kan / x.van; };
    const zonder = deel({ ...B, voorgaanNaDagen: 0 }), met = deel(B);
    expect(met).toBeGreaterThan(zonder + 0.08);
    expect(met).toBeGreaterThan(0.55);
    expect(eigenMeldingVoorgaan(alle, dates, {}, 6)).toBeNull();
    expect(eigenMeldingVoorgaan(alle, dates, { [alle[0].id]: { '2027-02-01': '1', '2027-02-07': '1', '2027-02-02': '2', '2027-02-08': 'DG2', '2027-02-03': '1', '2027-02-26': '1' } }, 6)).toEqual({ kan: 1, van: 2 });
    expect(voorgangenPerDag(alle, dates.slice(0, 7), { [alle[0].id]: { '2027-02-01': 'DG2', '2027-02-02': 'DG1' } })).toEqual({ min: 0, max: 1, zaterdag: { min: 0, max: 0 }, zonder: 4 });
  });

  it('te veel mensen: iedereen ongeveer hetzelfde deel van zijn contract', () => {
    const groot = [...alle, ...alle.slice(0, 6).map((m, i) => ({ ...m, id: `g${i}`, naam: `Extra ${i}` }))];
    const r = maak(groot);
    const deel = groot.map((m) => uren(r.cellen, m) / ((m.contract * dates.length) / 7));
    // niemand haalt zijn uren, en het verschil tussen de hoogste en de laagste is klein
    expect(Math.max(...deel)).toBeLessThan(0.95);
    expect(Math.max(...deel) - Math.min(...deel)).toBeLessThanOrEqual(0.12);
    expect(som(tekort(r.cellen, groot))).toBe(0);
  });

  it('de beschikbaarheidsdienst is evenredig verdeeld: iedereen ongeveer evenveel, naar contract', () => {
    const r = maak(alle);
    const b = uv(alle).map((m) => ({ n: dates.filter((d) => cel(r.cellen, m.id, d) === '1B').length, m }));
    const totaal = som(b.map((x) => x.n)), contract = som(b.map((x) => x.m.contract));
    expect(totaal).toBe(dates.length * B.beschikbaarPerDag);
    // hoogstens één 1B van het aandeel naar contract af
    for (const x of b) expect(Math.abs(x.n - (totaal * x.m.contract) / contract)).toBeLessThanOrEqual(1.01);
  });
});

describe('het weekend', () => {
  const weekend = dates.filter((d) => isWeekend(toDay(d)));
  const werkers = (c: Cellen, d: string) => alle.filter((m) => DIENSTEN[cel(c, m.id, d)].plekken > 0).length;

  it('liever een 2: dezelfde regelplekken met minder mensen', () => {
    const met = maak(alle), zonder = maak(alle, { beleid: { ...B, tweeInWeekend: false } });
    for (const d of weekend) {
      expect(alle.filter((m) => cel(met.cellen, m.id, d) === '2').length).toBeGreaterThanOrEqual(1);
      expect(werkers(met.cellen, d)).toBeLessThan(behoefte[d]!.k);
      // zonder die keuze één medewerker per regelplek (een 2 alleen bij een tekort)
      expect(werkers(zonder.cellen, d)).toBe(behoefte[d]!.k);
    }
    // op werkdagen geen 2 als het ook zonder kan
    for (const d of dates.filter((x) => !isWeekend(toDay(x)))) expect(alle.filter((m) => cel(met.cellen, m.id, d) === '2').length).toBe(0);
    expect(met.t.hard).toBe(0);
  });

  it('wie de 2 niet kan, krijgt hem niet', () => {
    const profielen = Object.fromEntries(uv(alle).slice(0, 6).map((m) => [m.id, { medewerkerId: m.id, dagen: Array(7).fill('neutraal'), dienst: 'geen' as const, beschikbaarheid: 'neutraal' as const, maxDagenPerWeek: null, twee: 'niet' as const, korteDagen: 'neutraal' as const }]));
    const r = maak(alle, { profielen: profielen as never });
    for (const id of Object.keys(profielen)) expect(dates.filter((d) => cel(r.cellen, id, d) === '2')).toEqual([]);
  });
});

describe('Dg-diensten en uren', () => {
  it('gelijkmatig over de dagen: op werkdagen hoogstens twee verschil, nooit boven het maximum', () => {
    const r = maak(alle);
    const perDag = dates.filter((d) => !isWeekend(toDay(d))).map((d) => dg(r.cellen, alle, d));
    expect(Math.min(...perDag)).toBeGreaterThanOrEqual(B.minDG);
    expect(Math.max(...perDag) - Math.min(...perDag)).toBeLessThanOrEqual(2);
    for (const d of dates) {
      expect(som(alle.map((m) => DIENSTEN[cel(r.cellen, m.id, d)].voorgangen))).toBeLessThanOrEqual(Math.max(B.voorgangenPerDag * 2, B.minDG * 2));
      if (weekday(toDay(d)) === 0) expect(dg(r.cellen, alle, d)).toBe(0);
    }
  });

  it('een halve dag (4 uur) alleen bij wie dat zelf aangaf; die komt dan dichter bij zijn uren', () => {
    const onder = (c: Cellen) => alle.map((m) => Math.max(0, (m.contract * dates.length) / 7 - uren(c, m)));
    const zonder = maak(alle);
    // niemand gaf het aan: alleen de uitvaartleiders (die werken altijd met DG1) hebben halve dagen
    for (const m of uv(alle)) expect(dates.filter((d) => cel(zonder.cellen, m.id, d) === 'DG1')).toEqual([]);
    const graag = Object.fromEntries(uv(alle).map((m) => [m.id, { ...LEEG_PROFIEL(m.id), korteDagen: 'graag' as const, bijgewerkt: 'x' }]));
    const met = maak(alle, { profielen: graag });
    expect(uv(alle).some((m) => dates.some((d) => cel(met.cellen, m.id, d) === 'DG1'))).toBe(true);
    // in beide gevallen komt het team dicht bij zijn uren: zonder halve dagen met af en toe een hele dag boven contract
    expect(som(onder(zonder.cellen))).toBeLessThan(80);
    expect(som(onder(met.cellen))).toBeLessThan(80);
    // en nooit meer dan 15% boven het contract over de periode
    for (const m of alle) expect(uren(met.cellen, m)).toBeLessThanOrEqual(((m.contract * dates.length) / 7) * 1.15 + 0.01);
  });

  it('Dg-diensten: per werkdag binnen een week hoogstens één verschil, en op zaterdag minstens één DG2', () => {
    const r = maak(alle);
    for (let w = 0; w < 4; w++) {
      const week = dates.slice(w * 7, w * 7 + 5).map((d) => dg(r.cellen, alle, d));
      expect(Math.max(...week) - Math.min(...week)).toBeLessThanOrEqual(1);
      expect(alle.filter((m) => cel(r.cellen, m.id, dates[w * 7 + 5]) === 'DG2').length).toBeGreaterThanOrEqual(1);
    }
    // ook met minder mensen: lager, maar gelijk verdeeld
    const klein = alle.slice(3), k = maak(klein);
    for (let w = 0; w < 4; w++) {
      const week = dates.slice(w * 7, w * 7 + 5).map((d) => dg(k.cellen, klein, d));
      expect(Math.max(...week) - Math.min(...week)).toBeLessThanOrEqual(1);
    }
  });

  it('wie de vier weken ervoor te weinig uren kreeg, gaat nu voor op wie te veel kreeg', () => {
    // een team dat groter is dan het werk: dan haalt niet iedereen zijn uren en telt het saldo
    const groot = [...alle, ...alle.slice(0, 6).map((m, i) => ({ ...m, id: `x${i}`, naam: `Extra ${i}` }))];
    const [a, b] = uv(groot).filter((m) => m.contract === 28 && m.weekendgroep === uv(groot).find((x) => x.contract === 28)!.weekendgroep);
    const vooraf = isoRange(addDays(dates[0], -28), addDays(dates[0], -1));
    const start: Cellen = {
      // a werkte toen één dag, b elke werkdag (ruim boven zijn 28 uur)
      [a.id]: { [vooraf[0]]: 'DG2' },
      [b.id]: Object.fromEntries(vooraf.filter((d) => !isWeekend(toDay(d))).map((d) => [d, 'DG2' as DienstCode])),
    };
    const met = maak(groot, {}, start), zonder = maak(groot);
    const verschil = (c: Cellen) => uren(c, a) - uren(c, b);
    expect(verschil(met.cellen)).toBeGreaterThanOrEqual(8);
    expect(verschil(met.cellen)).toBeGreaterThan(verschil(zonder.cellen));
  });
});

describe('verlof en wensen', () => {
  it('aangevraagd verlof: daar wordt niemand ingeroosterd zolang er anderen zijn', () => {
    const aanvragers = uv(alle).slice(0, 4);
    const aanvragen = aanvragers.map((m) => ({ medewerkerId: m.id, van: '2027-02-08', tot: '2027-02-12' }));
    const dagen = isoRange('2027-02-08', '2027-02-12');
    const werkt = (c: Cellen) => som(aanvragers.map((m) => dagen.filter((d) => DIENSTEN[cel(c, m.id, d)].werk).length));
    expect(werkt(maak(alle).cellen)).toBeGreaterThan(0);
    const r = maak(alle, { aanvragen });
    expect(werkt(r.cellen)).toBe(0);
    expect(som(tekort(r.cellen, alle))).toBe(0);
    // alleen als er echt niemand anders is: het hele team vraagt verlof aan, de regelplekken staan er toch
    const iedereen = maakRooster({ team: alle, dates, cellen: {}, behoefte, wensen: [], beleid: B, opnieuw: true, aanvragen: alle.map((m) => ({ medewerkerId: m.id, van: '2027-02-08', tot: '2027-02-08' })), pogingen: 1 });
    expect(plekken(pasToe({}, iedereen.wijzigingen), alle, '2027-02-08')).toBe(behoefte['2027-02-08']!.k);
    expect(iedereen.opAanvraag).toBeGreaterThan(0);
  });

  it('"liever vrij": een vast aantal per vier weken is zeker; een afspraak uit het jaarrooster altijd', () => {
    const e = uv(alle)[2];
    const dagen = dates.filter((d) => [1, 2, 4, 5].includes(weekday(toDay(d)))).slice(0, 12);
    const wensen = (opmerking?: string): Wens[] => dagen.map((d, i) => ({ id: `w${i}`, medewerkerId: e.id, regio, datum: d, soort: 'vrij', gemaakt: '', ...(opmerking ? { opmerking } : {}) }));
    const gewerkt = (beleid: Beleid, w: Wens[]) => { const r = maak(alle, { wensen: w, beleid }); return dagen.filter((d) => DIENSTEN[cel(r.cellen, e.id, d)].werk); };
    // zonder grens: alle twaalf vrij
    expect(gewerkt({ ...B, wensenZeker: 0 }, wensen())).toEqual([]);
    // met een grens van vier: de eerste vier zijn zeker
    const metGrens = gewerkt({ ...B, wensenZeker: 4 }, wensen());
    expect(metGrens.filter((d) => dagen.indexOf(d) < 4)).toEqual([]);
    // uit het jaarrooster: een afspraak, geen losse wens
    expect(gewerkt({ ...B, wensenZeker: 4 }, wensen(WENS_JAARROOSTER))).toEqual([]);
  });
});

describe('een overige dienst als wens', () => {
  it('8 of 4 uur: die staat er, telt mee in de uren, en er komt die dag niets anders bij', () => {
    const [a, b] = uv(alle);
    const wensen: Wens[] = [
      { id: 'o1', medewerkerId: a.id, regio, datum: '2027-02-10', soort: 'overig8', gemaakt: '' },
      { id: 'o2', medewerkerId: b.id, regio, datum: '2027-02-11', soort: 'overig4', gemaakt: '' },
    ];
    const r = maak(alle, { wensen });
    expect(cel(r.cellen, a.id, '2027-02-10')).toBe('O');
    expect(cel(r.cellen, b.id, '2027-02-11')).toBe('O4');
    expect(DIENSTEN.O4.uren).toBe(4);
    expect(wensGehonoreerd('overig8', 'O')).toBe(true);
    expect(wensGehonoreerd('overig4', '1')).toBe(false);
    expect(wensGehonoreerd('overig4', '-')).toBeNull();
    // de overige dienst telt mee in de uren: over de periode niet meer dan 15% boven contract
    for (const m of [a, b]) expect(uren(r.cellen, m)).toBeLessThanOrEqual(((m.contract * dates.length) / 7) * 1.15 + 0.01);
    expect(som(tekort(r.cellen, alle))).toBe(0);
    expect(r.t.hard).toBe(0);
    // bij aanvullen blijft een dienst die er al stond staan
    const start: Cellen = { [a.id]: { '2027-02-10': '1' } };
    const v = voorstelMetUitleg({ team: alle, dates, cellen: start, behoefte, wensen, beleid: B, seed: 11 });
    expect(cel(pasToe(start, v.wijzigingen), a.id, '2027-02-10')).toBe('1');
  });
});

describe('het overzicht bij het voorstel', () => {
  it('werk tegenover bezetting: te veel, krap of te weinig', () => {
    const w = (team: Medewerker[], cellen: Cellen = {}) => werkEnBezetting({ team, dates, cellen, behoefte, beleid: B });
    expect(w(alle).beschikbaar).toBeCloseTo(som(alle.map((m) => m.contract)) * 4, 6);
    expect(w(alle).nodig).toBeLessThan(w(alle).beschikbaar);
    expect(w(alle.slice(5)).nodig).toBeGreaterThan(w(alle.slice(5)).beschikbaar);
    // een week verlof kost één week contract
    const e = alle[0];
    expect(w(alle).beschikbaar - w(alle, { [e.id]: Object.fromEntries(isoRange('2027-02-08', '2027-02-14').map((d) => [d, 'V' as DienstCode])) }).beschikbaar).toBeCloseTo(e.contract, 6);
  });

  it('uren boven contract en de 1B per medewerker', () => {
    const r = maakRooster({ team: alle, dates, cellen: {}, behoefte, wensen: [], beleid: B, opnieuw: true, pogingen: 2 });
    const na = pasToe({}, r.wijzigingen);
    expect(urenBovenContract(alle, dates, na)).toBe(r.boven);
    const b = beschikbaarPerMedewerker(alle, dates, na)!;
    expect(b.max - b.min).toBeLessThanOrEqual(2);
    const krap = maakRooster({ team: alle.slice(5), dates, cellen: {}, behoefte, wensen: [], beleid: B, opnieuw: true, pogingen: 2 });
    expect(krap.boven).toBeGreaterThan(0);
  });

  it('hoe vaak de 1B valt, en voor wie: eigen regio en cluster tellen op tot het geheel', () => {
    const cluster = Object.keys(CLUSTERS).find((c) => CLUSTERS[c].includes(regio))!;
    const na = pasToe({}, voorstel({ team: alle, dates, cellen: {}, behoefte, wensen: [], beleid: B, opnieuw: true, seed: 11 }));
    const dagen = kans1BPerDag({ normen: NORM_STANDAARD, cluster, regios: CLUSTERS[cluster], dates, lam: () => null, rooster: (r) => (r === regio ? { cellen: na, team: alle.map((m) => m.id) } : null) });
    const v = val1B(dagen, regio, NORM_STANDAARD.uitval)!;
    expect(v.dagen).toBe(dates.length);
    expect(v.valt).toBeGreaterThan(0);
    expect(v.valt).toBeLessThan(1);
    expect(v.eigen + v.cluster).toBeCloseTo(v.valt, 6);
    expect(v.keer).toBeCloseTo(v.valt * v.dagen, 6);
    // zonder rooster en zonder norm voor de dag: niets
    expect(clusterGenoeg([null])).toBeNull();
    // dagen: bij de afgesproken plekken heeft de regio op ruim 80% van de dagen genoeg en het cluster op ruim 93%
    const t = toets({ team: alle, dates, cellen: na, behoefte, wensen: [], beleid: B });
    const regioDagen = t.pijlers.continuiteit.gemKans!;
    expect(regioDagen).toBeGreaterThan(0.8);
    expect(regioDagen).toBeLessThan(0.9);
    expect(clusterGenoeg(dagen)!).toBeGreaterThan(0.93);
  });

  it('klanten binnen 24 uur: in de eigen regio, met hulp van het cluster (dat het zelf ook druk heeft), of niet', () => {
    const cluster = Object.keys(CLUSTERS).find((c) => CLUSTERS[c].includes(regio))!;
    const kans = (team: Medewerker[], beleid: Beleid = B) => {
      const na = pasToe({}, voorstel({ team, dates, cellen: {}, behoefte, wensen: [], beleid, opnieuw: true, seed: 11 }));
      const dagen = kans1BPerDag({ normen: NORM_STANDAARD, cluster, regios: CLUSTERS[cluster], dates, lam: () => null, rooster: (r) => (r === regio ? { cellen: na, team: team.map((m) => m.id) } : null) });
      return binnen24Uur(dagen, regio, NORM_STANDAARD.uitval)!;
    };
    const k = kans(alle);
    expect(k.eigen + k.cluster + k.niet).toBeCloseTo(1, 6);
    // het grootste deel in de eigen regio, een deel met hulp van het cluster, en bijna niets blijft liggen
    expect(k.eigen).toBeGreaterThan(0.85);
    expect(k.cluster).toBeGreaterThan(0.01);
    expect(k.niet).toBeLessThan(0.02);
    // de helft van het team en nooit boven contract: de eigen regio kan minder, het cluster vangt een deel op maar niet alles
    const half = kans(alle.slice(0, 7), { ...B, bovenContractPct: 0 });
    expect(half.eigen).toBeLessThan(k.eigen - 0.05);
    expect(half.cluster).toBeGreaterThan(k.cluster);
    expect(half.niet).toBeGreaterThan(k.niet);
    expect(binnen24Uur([null], regio, 0)).toBeNull();
  });
});

describe('één voorstel, en een andere verdeling', () => {
  const basis = { team: alle, dates, cellen: {}, behoefte, wensen: [], beleid: B, opnieuw: true };

  it('de beste van een paar pogingen, en twee keer hetzelfde antwoord', () => {
    const r = maakRooster(basis);
    const los = Array.from({ length: 6 }, (_, p) => { const c = pasToe({}, voorstel({ ...basis, seed: 11 + p })); return toets({ team: alle, dates, cellen: c, behoefte, wensen: [], beleid: B }).cijfer; });
    expect(r.toets.cijfer).toBeCloseTo(Math.max(...los), 6);
    expect(r.toets.hard).toBe(0);
    expect(r.tekorten).toEqual([]);
    expect(maakRooster(basis).wijzigingen).toEqual(r.wijzigingen);
  });

  it('een andere verdeling is een ander rooster dat ook aan het beleid voldoet', () => {
    const a = maakRooster(basis), b = maakRooster({ ...basis, ronde: 1 });
    expect(b.wijzigingen).not.toEqual(a.wijzigingen);
    expect(b.toets.hard).toBe(0);
    expect(b.tekorten).toEqual([]);
    expect(Math.abs(b.toets.cijfer - a.toets.cijfer)).toBeLessThan(0.5);
  });

  it('de uitleg noemt waar het voorstel rekening mee houdt', () => {
    const tekst = REKENT_MET.flatMap((g) => g.punten).join(' ');
    for (const woord of ['verlof', 'regelplekken', 'weekend', 'vier weken ervoor', 'voorkeur', 'aangevraagd', 'zo gelijk mogelijk']) expect(tekst).toContain(woord);
  });
});

describe('kan niet heeft een maximum per maand, en liever een hele dag dan uren die open blijven', () => {
  it('het maximum naar contract: 40 uur 2, 36 uur 3, 32 uur 5', () => {
    expect([40, 36, 32, 28, 24].map(maxKanNiet)).toEqual([2, 3, 5, 6, 8]);
    // iemand met 36 uur die elke werkdag "kan niet" opgeeft: de eerste drie werkdagen van de maand staan vast, daarna
    // weegt het als "liever niet" en kan hij worden ingeroosterd
    const e = uv(alle).find((m) => m.contract === 36)!;
    const profielen = { [e.id]: { ...LEEG_PROFIEL(e.id), dagen: ['neutraal', 'niet', 'niet', 'niet', 'niet', 'niet', 'neutraal'] as Voorkeurprofiel['dagen'], bijgewerkt: 'x' } };
    const r = maak(alle, { profielen });
    const werkdagen = dates.filter((d) => !isWeekend(toDay(d)));
    for (const d of werkdagen.slice(0, 3)) expect(DIENSTEN[cel(r.cellen, e.id, d)].werk).toBe(false);
    expect(werkdagen.slice(3).some((d) => DIENSTEN[cel(r.cellen, e.id, d)].werk)).toBe(true);
    // zonder het maximum blijft elke werkdag "kan niet"
    const vrij = maak(alle, { profielen, beleid: { ...B, kanNietBegrensd: false } });
    expect(werkdagen.filter((d) => DIENSTEN[cel(vrij.cellen, e.id, d)].werk)).toEqual([]);
  });

  it('wie 28 of 36 uur heeft, krijgt af en toe een hele dag boven contract en komt over de periode op zijn uren', () => {
    const r = maak(alle);
    for (const m of uv(alle).filter((x) => x.contract === 28 || x.contract === 36)) {
      const norm = (m.contract * dates.length) / 7;
      // geen halve dagen, wel dicht bij de uren van de periode en nooit meer dan 15% erboven
      expect(dates.filter((d) => cel(r.cellen, m.id, d) === 'DG1')).toEqual([]);
      expect(uren(r.cellen, m)).toBeGreaterThanOrEqual(norm - 12);
      expect(uren(r.cellen, m)).toBeLessThanOrEqual(norm * 1.15 + 0.01);
    }
    expect(r.t.hard).toBe(0);
  });
});
