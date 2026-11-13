/**
 * Het rooster als jaarrooster van de regio's: per cluster een werkmap, per regio een blad met dezelfde kop, telregels,
 * formules en kleuren, en een urenblad. Geen namen: een medewerker staat er als "AMS 01".
 */
import { addDays, DAG_KORT, dayOfMonth, feestdagenVan, fromDay, isoWeek, MAAND_KORT, MAAND_LANG, month, mondayOf, toDay, weekday } from '../dates';
import { bladNaam, bladRef, kol, nieuwBlad, ref, zet, type Blad, type Opmaakregel, type Stijl } from '../xlsx';
import { BLAD_REGIO } from '../jaarrooster';
import type { Maand } from './maand';
import type { Cellen, DienstCode, Medewerker } from './types';

/** Zoals de bladen in de jaarroosters heten. */
const REGIO_AFK: Record<string, string> = {
  ...Object.fromEntries(Object.entries(BLAD_REGIO).map(([a, r]) => [r, a])),
  Friesland: 'FRL', Groningen: 'GRO', 'Noord-Oost': 'NO', 'Twente/Achterhoek': 'TA', 'Veluwe-IJssel': 'VIJ',
  Arnhem: 'ARN', 'Midden Nederland': 'MN', Nijmegen: 'NIJ', Utrecht: 'UTR',
  Haaglanden: 'HGL', Rotterdam: 'RDM', 'West Brabant/Zeeland': 'WBZ', 'Zuid Holland Zuid': 'ZHZ',
  Kempenland: 'KEM', 'Midden Limburg': 'ML', 'Oost Brabant': 'OB', 'Zuid Limburg': 'ZL',
  Breda: 'BRE', 'Den Bosch': 'DB', Eindhoven: 'EHV', Tilburg: 'TIL',
};

const afkVan = (regio: string) => REGIO_AFK[regio] ?? regio.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();

export interface ExportRegio {
  regio: string;
  /** In de volgorde van het rooster. */
  team: Medewerker[];
  cellen: Cellen;
  /** Inclusief de 1B, of null. */
  plekken: (datum: string) => number | null;
  /** Boven de maand: 'Definitief', 'concept' of ''. */
  status: (maand: Maand) => string;
}

/** 1 en 2 als getal, zodat de telregels ze optellen. */
export function exportCode(c: DienstCode | undefined, gepland: boolean): string | number | null {
  if (c == null) return gepland ? 'vrij' : null;
  if (c === '1') return 1;
  if (c === '2') return 2;
  if (c === 'DG2') return 'DG';
  if (c === '-') return 'vrij';
  return c;
}

const ANONIEM = /^([A-Z]{2,6}) (\d{2,3})$/;

/** Bestaande codes ("AMS 01") blijven, de rest krijgt het volgende vrije nummer. */
export function exportRijen(team: Medewerker[], afk: string): { e: Medewerker; label: string }[] {
  const eigen = new Map<string, string>();
  for (const e of team) {
    const m = e.naam.trim().match(ANONIEM);
    if (m && m[1] === afk && ![...eigen.values()].includes(m[2])) eigen.set(e.id, m[2]);
  }
  let nr = Math.max(0, ...[...eigen.values()].map(Number));
  return team.map((e) => ({ e, label: `${afk} ${eigen.get(e.id) ?? String(++nr).padStart(2, '0')}` }));
}

// kleuren en stijlen zoals in de jaarroosters

const K = {
  geel: 'FFFF66', lichtblauw: 'C0E4F5', goudLicht: 'FFF2CC', naam: 'FFFF99', vorigJaar: 'DAE9F8', grijs: 'BFBFBF', donker: '747474',
  zwart: '000000', wit: 'FFFFFF', grijsTekst: '808080', cluster: 'F5C6AB',
  blauw: '5B9BD5', groen: '70AD47', goud: 'FFC000', rood: 'FF0000',
};

const CODE_KLEUR: [string, string, string?][] = [
  ['"MS"', 'FFF2CC'], ['"DG"', 'ED7D31'], ['1', '9BC2E6'], ['"V0"', 'A9D08E'], ['"V"', 'A9D08E'], ['"Z"', 'E7E6E6', K.grijsTekst],
  ['"VMS"', 'ACB9CA'], ['"O"', '8497B0'], ['"TD"', 'FFD966'], ['"1B"', 'DDEBF7'], ['2', '2F75B5'], ['"1M"', '9BC2E6'],
  ['"RV"', 'A6A6A6'], ['"VRIJ"', 'A6A6A6'], ['"DG1"', 'F8CBAD'],
];

const dun = { l: 'thin', r: 'thin', t: 'thin', b: 'thin' } as const;
const S = {
  a1: { vulling: K.geel, font: { grootte: 10 }, rand: dun },
  b1: { vulling: K.lichtblauw, font: { grootte: 8 }, rand: { r: 'thin', t: 'thin', b: 'thin' } },
  a2: { vulling: K.geel, font: { grootte: 13 }, rand: { l: 'thin', r: 'thin', b: 'thin' }, uitlijning: { h: 'center' } },
  b2: { vulling: K.lichtblauw, font: { grootte: 13 }, rand: { r: 'thin', b: 'thin' }, uitlijning: { h: 'center' } },
  a3: { vulling: K.goudLicht, font: { naam: 'Calibri' }, uitlijning: { h: 'center', terugloop: true } },
  kop: { vulling: K.wit, font: { vet: true }, rand: { l: 'thin', r: 'thin', t: 'thin', b: 'thin' }, uitlijning: { terugloop: true } },
  naam: { vulling: K.naam, font: { naam: 'Calibri Light', grootte: 10 }, rand: { l: 'thin', r: 'thin', b: 'thin' } },
  contract: { vulling: K.naam, rand: { b: 'thin' } },
  telLabel: { vulling: K.grijs, font: { vet: true }, rand: { r: 'thin', t: 'thin', b: 'thin' }, uitlijning: { h: 'right' } },
  clusterLabel: { vulling: K.cluster, font: { vet: true }, rand: { r: 'thin', t: 'thin', b: 'thin' }, uitlijning: { h: 'right' } },
  tel: { rand: dun, uitlijning: { h: 'center' } },
  blokKop: { vulling: K.grijs, font: { naam: 'Calibri', vet: true }, rand: { l: 'medium', r: 'medium', t: 'medium', b: 'medium' }, uitlijning: { h: 'center' } },
  blokSub: { vulling: K.wit, font: { naam: 'Calibri', grootte: 10 }, rand: { l: 'medium', r: 'thin', t: 'thin', b: 'thin' }, uitlijning: { v: 'top', terugloop: true } },
  blokCel: { font: { naam: 'Calibri' }, rand: { l: 'thin', r: 'thin', t: 'thin', b: 'thin' }, uitlijning: { h: 'center' } },
  urenKop: { vulling: K.grijs, font: { vet: true }, rand: dun, uitlijning: { h: 'center', v: 'top', terugloop: true } },
} satisfies Record<string, Stijl>;

const HOLIDAY: Record<string, string> = {
  Nieuwjaarsdag: 'Nieuwjaar', 'Eerste paasdag': '1e Paasdag', 'Tweede paasdag': '2e Paasdag', Koningsdag: 'Koningsdag', Bevrijdingsdag: 'Bevrijdingsdag',
  Hemelvaartsdag: 'Hemelvaart', 'Eerste pinksterdag': '1e Pinkster', 'Tweede pinksterdag': '2e Pinkster', 'Eerste kerstdag': '1e Kerst', 'Tweede kerstdag': '2e Kerst',
};

const WERK = '{"1";"2";"TD";"DG";"DG1";"O";"O4";"VMS";"1M"}';

function modus(xs: (number | null)[]): number | null {
  const n = new Map<number, number>();
  for (const x of xs) if (x != null) n.set(x, (n.get(x) ?? 0) + 1);
  let beste: number | null = null, bn = 0;
  for (const [x, c] of n) if (c > bn) { beste = x; bn = c; }
  return beste;
}

/** Van de maandag van week 1 tot en met de zondag van de laatste week. */
export function jaarDagen(jaar: number): string[] {
  const s = mondayOf(toDay(`${jaar}-01-04`)), e = mondayOf(toDay(`${jaar + 1}-01-04`)) - 1;
  return Array.from({ length: e - s + 1 }, (_, i) => fromDay(s + i));
}

const EERSTE_RIJ = 7;
const EERSTE_DAG = 3;

/** Het eerste rooster is het blad dat open staat. */
export function jaarroosterBladen(jaar: number, regios: ExportRegio[]): Blad[] {
  const dagen = jaarDagen(jaar);
  const namen = regios.map((r) => bladNaam(afkVan(r.regio)));
  const bladen: Blad[] = [];
  regios.forEach((r, i) => {
    const b = roosterBlad(jaar, dagen, r, namen[i], namen);
    bladen.push(b);
  });
  regios.forEach((r, i) => bladen.push(urenBlad(jaar, dagen, r, namen[i], rijenVan(r).length)));
  return bladen;
}

const rijenVan = (r: ExportRegio) => exportRijen(r.team, afkVan(r.regio));

/** Minstens tot rij 46 zoals in de jaarroosters; langer bij een groot team. */
const laatsteRij = (n: number) => EERSTE_RIJ + Math.max(40, n) - 1;

function roosterBlad(jaar: number, dagen: string[], r: ExportRegio, naam: string, alle: string[]): Blad {
  const b = nieuwBlad(naam);
  b.vast = { rij: EERSTE_RIJ, kolom: EERSTE_DAG };
  b.zoom = 90;
  b.liggend = true;
  const rijen = rijenVan(r);
  const lr = laatsteRij(rijen.length);
  const kolVan = (i: number) => EERSTE_DAG + i;
  const laatsteDag = kolVan(dagen.length - 1);
  const jaarIdx = dagen.map((d) => Number(d.slice(0, 4)) === jaar);
  const eersteJaar = kolVan(jaarIdx.indexOf(true)), laatsteJaar = kolVan(jaarIdx.lastIndexOf(true));

  // maanden waarvoor al gepland is: daar is een leeg vakje "vrij", in latere maanden blijft het leeg
  const gepland = new Set<string>();
  for (const e of r.team) for (const d of Object.keys(r.cellen[e.id] ?? {})) gepland.add(d.slice(0, 7));

  // kop
  const plekkenJaar = dagen.filter((_, i) => jaarIdx[i]).map((d) => r.plekken(d));
  const rp = modus(plekkenJaar);
  zet(b, 1, 1, 'ingezet aantal regelplekken regio:', S.a1);
  zet(b, 1, 2, 'benodigde regelplekken cluster:', S.b1);
  zet(b, 2, 1, rp, S.a2);
  zet(b, 2, 2, { f: `SUM(${alle.map((n) => `${bladRef(n)}!$A$2`).join(',')})` }, S.b2);
  zet(b, 3, 1, 'vastgesteld aantal rp', S.a3);
  zet(b, 3, 2, 'vastgesteld rp cluster', S.b2);
  zet(b, 4, 1, rp, S.a3);
  zet(b, 4, 2, { f: `SUM(${alle.map((n) => `${bladRef(n)}!$A$4`).join(',')})` }, S.b2);
  zet(b, 5, 1, wijzigingenTekst(dagen.filter((_, i) => jaarIdx[i]), r.plekken), S.a3);
  zet(b, 5, 2, 'datum', { font: { vet: true }, vulling: K.wit });
  zet(b, 6, 1, 'mw', { ...S.kop, rand: { l: 'thick', r: 'thin', t: 'thin', b: 'thin' } });
  zet(b, 6, 2, 'contract-uren', { ...S.kop, rand: { r: 'thick', t: 'thin', b: 'thin' } });

  // maanden (rij 1 en 2)
  let i = 0, nMaand = 0;
  while (i < dagen.length) {
    const m = dagen[i].slice(0, 7);
    let j = i;
    while (j + 1 < dagen.length && dagen[j + 1].slice(0, 7) === m) j++;
    const binnen = jaarIdx[i];
    const mn = Number(m.slice(5)) - 1;
    const tekst = binnen ? MAAND_LANG[mn].toUpperCase() : Number(m.slice(0, 4)) < jaar ? MAAND_KORT[mn] : MAAND_LANG[mn];
    const vul = binnen ? (nMaand++ % 2 === 0 ? K.zwart : K.donker) : K.donker;
    for (let k = i; k <= j; k++) zet(b, 2, kolVan(k), k === i ? tekst : null, { vulling: vul, font: { kleur: K.wit } });
    if (j > i) b.samengevoegd.push(`${ref(2, kolVan(i))}:${ref(2, kolVan(j))}`);
    if (binnen) {
      const st = r.status(m);
      if (st) zet(b, 1, kolVan(i), st);
    }
    i = j + 1;
  }
  // weken (rij 3 en 4), datum en weekdag (rij 5 en 6)
  for (let w = 0; w < dagen.length; w += 7) {
    const wk = isoWeek(toDay(dagen[w]));
    const even = wk % 2 === 0;
    for (let k = w; k < w + 7; k++) {
      const rand = { l: k === w ? 'thick' : undefined, r: k === w + 6 ? 'thick' : undefined } as const;
      zet(b, 3, kolVan(k), k === w ? (even ? 'EVEN' : 'ONEVEN') : null, { vulling: K.grijs, font: { grootte: 13, vet: true, kleur: even ? K.wit : K.zwart }, rand: { ...rand, b: 'thin' } });
      zet(b, 4, kolVan(k), k === w ? `wk ${wk}` : null, { vulling: K.grijs, font: { grootte: 13, vet: true }, rand: { ...rand, t: 'thin' } });
    }
    b.samengevoegd.push(`${ref(3, kolVan(w))}:${ref(3, kolVan(w + 6))}`, `${ref(4, kolVan(w))}:${ref(4, kolVan(w + 6))}`);
  }
  dagen.forEach((d, k) => {
    const n = toDay(d), wd = weekday(n), we = wd === 0 || wd === 6;
    const vorig = !jaarIdx[k] && Number(d.slice(0, 4)) < jaar;
    const rand = { l: wd === 1 ? 'thick' : undefined, r: wd === 0 ? 'thick' : 'thin', t: 'thin' } as const;
    zet(b, 5, kolVan(k), dayOfMonth(n), vorig ? { vulling: K.vorigJaar, font: { kleur: K.grijsTekst }, rand } : { font: { vet: true }, rand });
    zet(b, 6, kolVan(k), DAG_KORT[wd], vorig ? { vulling: K.vorigJaar, font: { kleur: K.grijsTekst }, rand: { ...rand, t: 'thick', b: 'thin' } } : { vulling: we ? K.grijs : K.wit, font: { vet: true }, rand: { ...rand, t: 'thick', b: 'thin' }, uitlijning: { terugloop: true } });
  });

  // medewerkers
  for (let x = 0; x < lr - EERSTE_RIJ + 1; x++) {
    const rij = EERSTE_RIJ + x;
    const m = rijen[x];
    zet(b, rij, 1, m ? m.label : null, S.naam);
    zet(b, rij, 2, m ? m.e.contract : null, S.contract);
    dagen.forEach((d, k) => {
      const wd = weekday(toDay(d)), we = wd === 0 || wd === 6;
      const vorig = !jaarIdx[k] && Number(d.slice(0, 4)) < jaar;
      const v = m ? exportCode(r.cellen[m.e.id]?.[d], gepland.has(d.slice(0, 7))) : null;
      const s: Stijl = vorig ? { vulling: K.vorigJaar, font: { kleur: K.grijsTekst }, rand: { l: 'thin', r: 'thin', b: 'thin' } } : { vulling: we ? K.grijs : undefined, rand: { r: 'thin', t: 'thin', b: 'thin' } };
      if (v != null || we || vorig) zet(b, rij, kolVan(k), v, s);
    });
  }
  const dagBereik = `${ref(EERSTE_RIJ, EERSTE_DAG)}:${ref(lr, laatsteDag)}`;
  for (const [f, vulling, kleur] of CODE_KLEUR) b.regels.push({ bereik: dagBereik, operator: 'equal', formules: [f], vulling, kleur });

  // telregels en clusterregels
  const t = lr + 1;
  const kolom = (c: number) => `${kol(c)}${EERSTE_RIJ}:${kol(c)}${lr}`;
  const vast = (c: number) => `${kol(c)}$${EERSTE_RIJ}:${kol(c)}$${lr}`;
  const telregels: [string, (c: number) => string][] = [
    ['regelplekken gepland', (c) => `SUM(${kolom(c)})+COUNTIF(${kolom(c)},"1M")+COUNTIF(${kolom(c)},"1B")`],
    ['DG voorgaansdiensten gepland', (c) => `COUNTIF(${vast(c)},"dg")+COUNTIF(${vast(c)},"DG1")`],
    ['1M middagregelplek', (c) => `COUNTIF(${kolom(c)},"1M")`],
    ['1B bereikbaarheidsdienst', (c) => `COUNTIF(${vast(c)},"1B")`],
    ['TD teamdienst gepland', (c) => `COUNTIF(${kolom(c)},"TD")`],
    ['O overige diensten', (c) => `COUNTIF(${vast(c)},"O")`],
    ['VMS vrije markt specialist', (c) => `COUNTIF(${vast(c)},"VMS")`],
    ['CF gepland', (c) => `COUNTIF(${vast(c)},"CF")`],
    ['Z ziek', (c) => `COUNTIF(${vast(c)},"Z")`],
    ['vrij', (c) => `COUNTIF(${vast(c)},"vrij")`],
    ['Verlof (V)', (c) => `COUNTIF(${vast(c)},"V")+COUNTIF(${vast(c)},"V0")`],
  ];
  telregels.forEach(([label, f], k) => {
    zet(b, t + k, 1, label, S.telLabel);
    zet(b, t + k, 2, null, S.telLabel);
    b.samengevoegd.push(`${ref(t + k, 1)}:${ref(t + k, 2)}`);
    for (let c = EERSTE_DAG; c <= laatsteDag; c++) zet(b, t + k, c, { f: f(c) }, S.tel);
  });
  const c0 = t + telregels.length;
  const clusterregels: [string, number][] = [['regelplekken gepland cluster', 0], ['voorgaansdiensten gepland cluster', 1], ['teamdiensten gepland cluster', 4], ['verlof cluster', 10]];
  clusterregels.forEach(([label, bron], k) => {
    zet(b, c0 + k, 1, label, S.clusterLabel);
    zet(b, c0 + k, 2, null, S.clusterLabel);
    b.samengevoegd.push(`${ref(c0 + k, 1)}:${ref(c0 + k, 2)}`);
    for (let c = EERSTE_DAG; c <= laatsteDag; c++) zet(b, c0 + k, c, { f: `SUM(${alle.map((n) => `${bladRef(n)}!${ref(t + bron, c)}`).join(',')})` }, S.tel);
  });
  const rij = (n: number) => `${ref(n, EERSTE_DAG)}:${ref(n, laatsteDag)}`;
  const regels: Opmaakregel[] = [
    { bereik: rij(t), operator: 'greaterThan', formules: ['$A$2'], vulling: K.blauw },
    { bereik: rij(t), operator: 'between', formules: ['$A$2-3', '0'], vulling: K.rood },
    { bereik: rij(t), operator: 'between', formules: ['$A$2-1', '$A$2-2'], vulling: K.goud },
    { bereik: rij(t), operator: 'equal', formules: ['$A$2'], vulling: K.groen },
    { bereik: rij(t + 1), operator: 'greaterThan', formules: ['2'], vulling: K.blauw },
    { bereik: rij(t + 1), operator: 'equal', formules: ['1'], vulling: K.goud },
    { bereik: rij(t + 1), operator: 'equal', formules: ['2'], vulling: K.groen },
    { bereik: `${ref(t + 1, EERSTE_DAG)}:${ref(t + 4, laatsteDag)}`, operator: 'equal', formules: ['0'], vulling: K.rood },
    { bereik: `${ref(t + 2, EERSTE_DAG)}:${ref(t + 4, laatsteDag)}`, operator: 'greaterThan', formules: ['1'], vulling: K.blauw },
    { bereik: `${ref(t + 2, EERSTE_DAG)}:${ref(t + 4, laatsteDag)}`, operator: 'equal', formules: ['1'], vulling: K.groen },
    { bereik: rij(t + 10), operator: 'greaterThanOrEqual', formules: ['$A$2-($A$2-4)'], vulling: K.rood },
    { bereik: rij(t + 10), operator: 'between', formules: ['$A$2-($A$2-2)', '$A$2-($A$2-3)'], vulling: K.goud },
    { bereik: rij(t + 10), operator: 'between', formules: ['$A$2-$A$2', '$A$2-($A$2-1)'], vulling: K.groen },
    { bereik: rij(c0), operator: 'greaterThan', formules: ['$B$2'], vulling: K.blauw },
    { bereik: rij(c0), operator: 'lessThanOrEqual', formules: ['$B$2-3'], vulling: K.rood },
    { bereik: rij(c0), operator: 'between', formules: ['$B$2-1', '$B$2-2'], vulling: K.goud },
    { bereik: rij(c0), operator: 'equal', formules: ['$B$2'], vulling: K.groen },
    { bereik: rij(c0 + 1), operator: 'greaterThan', formules: ['8'], vulling: K.blauw },
    { bereik: rij(c0 + 1), operator: 'lessThanOrEqual', formules: ['4'], vulling: K.rood },
    { bereik: rij(c0 + 1), operator: 'between', formules: ['5', '7'], vulling: K.goud },
    { bereik: rij(c0 + 1), operator: 'equal', formules: ['8'], vulling: K.groen },
    { bereik: rij(c0 + 2), operator: 'greaterThan', formules: ['2'], vulling: K.blauw },
    { bereik: rij(c0 + 2), operator: 'equal', formules: ['0'], vulling: K.rood },
    { bereik: rij(c0 + 2), operator: 'equal', formules: ['1'], vulling: K.goud },
    { bereik: rij(c0 + 2), operator: 'equal', formules: ['2'], vulling: K.groen },
    { bereik: rij(c0 + 3), operator: 'greaterThanOrEqual', formules: ['$B$2-($B$2-13)'], vulling: K.rood },
    { bereik: rij(c0 + 3), operator: 'between', formules: ['$B$2-($B$2-5)', '$B$2-($B$2-12)'], vulling: K.goud },
    { bereik: rij(c0 + 3), operator: 'between', formules: ['$B$2-$B$2', '$B$2-($B$2-4)'], vulling: K.groen },
  ];
  b.regels.push(...regels);

  // rechts: feestdagenteller, weekendteller, afstandsverklaring
  const s0 = laatsteDag + 3;
  const eerste = toDay(dagen[0]), laatste = toDay(dagen[dagen.length - 1]);
  const feest = [...feestdagenVan(jaar), ...feestdagenVan(jaar + 1)].filter((f) => toDay(f.datum) >= eerste && toDay(f.datum) <= laatste);
  feest.forEach((f, k) => {
    const c = s0 + k, n = toDay(f.datum), dk = kolVan(n - eerste);
    zet(b, 3, c, k === 0 ? 'Feestdagenteller' : null, S.blokKop);
    zet(b, 4, c, HOLIDAY[f.naam] ?? f.naam, S.blokSub);
    zet(b, 5, c, `wk ${isoWeek(n)}`, S.blokSub);
    zet(b, 6, c, `${DAG_KORT[weekday(n)]} ${dayOfMonth(n)} ${MAAND_KORT[month(n) - 1]}`, S.blokSub);
    for (let rr = EERSTE_RIJ; rr <= lr; rr++) {
      const cel = ref(rr, dk);
      zet(b, rr, c, rijen[rr - EERSTE_RIJ] ? { f: `COUNTIF(${cel},"1")+COUNTIF(${cel},"2")+COUNTIF(${cel},"TD")+COUNTIF(${cel},"DG")` } : null, S.blokCel);
    }
  });
  if (feest.length > 1) b.samengevoegd.push(`${ref(3, s0)}:${ref(3, s0 + feest.length - 1)}`);
  const tot = s0 + feest.length;
  zet(b, 6, tot, 'Totaal', { ...S.blokSub, font: { naam: 'Calibri', vet: true } });
  for (let rr = EERSTE_RIJ; rr <= lr; rr++) zet(b, rr, tot, rijen[rr - EERSTE_RIJ] ? { f: `SUM(${ref(rr, s0)}:${ref(rr, tot - 1)})` } : null, { ...S.blokCel, font: { naam: 'Calibri', vet: true } });

  const w0 = tot + 3;
  const za = (rr: number, dag: string) => `SUMPRODUCT((${kol(eersteJaar)}$6:${kol(laatsteJaar)}$6="${dag}")*ISNUMBER(MATCH(TRIM(UPPER(${kol(eersteJaar)}${rr}:${kol(laatsteJaar)}${rr})),${WERK},0)))`;
  ['Totaal', 'za', 'zo'].forEach((label, k) => {
    zet(b, 3, w0 + k, k === 0 ? 'Weekendteller' : null, S.blokKop);
    zet(b, 6, w0 + k, label, { ...S.blokSub, font: { naam: 'Calibri', vet: true }, uitlijning: { h: 'center', v: 'top', terugloop: true } });
  });
  b.samengevoegd.push(`${ref(3, w0)}:${ref(3, w0 + 2)}`);
  for (let rr = EERSTE_RIJ; rr <= lr; rr++) {
    if (!rijen[rr - EERSTE_RIJ]) continue;
    const beide = `SUMPRODUCT((${kol(eersteJaar)}$6:${kol(laatsteJaar - 1)}$6="za")*ISNUMBER(MATCH(TRIM(UPPER(${kol(eersteJaar)}${rr}:${kol(laatsteJaar - 1)}${rr})),${WERK},0))*ISNUMBER(MATCH(TRIM(UPPER(${kol(eersteJaar + 1)}${rr}:${kol(laatsteJaar)}${rr})),${WERK},0)))`;
    zet(b, rr, w0, { f: `${ref(rr, w0 + 1)}+${ref(rr, w0 + 2)}-${beide}` }, { ...S.blokCel, font: { naam: 'Calibri', vet: true } });
    zet(b, rr, w0 + 1, { f: za(rr, 'za') }, S.blokCel);
    zet(b, rr, w0 + 2, { f: za(rr, 'zo') }, S.blokCel);
  }
  const a0 = w0 + 3;
  zet(b, 3, a0, 'Afstandsverklaring', S.blokKop);
  zet(b, 3, a0 + 1, null, S.blokKop);
  b.samengevoegd.push(`${ref(3, a0)}:${ref(3, a0 + 1)}`);
  zet(b, 6, a0, 'ja', { ...S.blokSub, font: { naam: 'Calibri', vet: true }, uitlijning: { h: 'center' } });
  zet(b, 6, a0 + 1, 'nee', { ...S.blokSub, font: { naam: 'Calibri', vet: true }, uitlijning: { h: 'center' } });
  rijen.forEach((m, k) => {
    zet(b, EERSTE_RIJ + k, a0, m.e.afstandsverklaring ? 'x' : null, S.blokCel);
    zet(b, EERSTE_RIJ + k, a0 + 1, m.e.afstandsverklaring ? null : 'x', S.blokCel);
  });

  b.breedtes.push(
    { van: 1, tot: 1, breedte: 29.3 }, { van: 2, tot: 2, breedte: 9.3 }, { van: EERSTE_DAG, tot: laatsteDag, breedte: 5 },
    { van: laatsteDag + 1, tot: laatsteDag + 2, breedte: 2.3 }, { van: s0, tot: tot - 1, breedte: 9.1 }, { van: tot, tot, breedte: 6.3 },
    { van: tot + 1, tot: tot + 2, breedte: 2.3 }, { van: w0, tot: w0 + 2, breedte: 9.3 }, { van: a0, tot: a0 + 1, breedte: 7.7 },
  );
  b.hoogtes = new Map([[2, 14.45], [3, 14.1], [4, 14.1], [5, 13.5], [6, 15.75]]);
  return b;
}

/** "4; vanaf wk 31 3; vanaf wk 39 4": de vastgestelde regelplekken per week, met de weken waarin het verandert. */
export function wijzigingenTekst(dagen: string[], plekken: (d: string) => number | null): string {
  const perWeek: { wk: number; k: number | null }[] = [];
  for (let i = 0; i < dagen.length; i += 7) perWeek.push({ wk: isoWeek(toDay(dagen[i])), k: modus(dagen.slice(i, i + 7).map(plekken)) });
  const delen: string[] = [];
  let vorige: number | null = null;
  for (const { wk, k } of perWeek) {
    if (k == null || k === vorige) continue;
    delen.push(vorige == null ? String(k) : `vanaf wk ${wk} ${k}`);
    vorige = k;
  }
  return delen.join('; ');
}

const UREN_KOP = ['regelplekken', 'DG', 'gem uren pw ', 'Verschil aan uren', '1M', '1B', '1', '2', 'TD', 'O', 'VMS', 'MS', 'Z', 'weekend', 'V'];

function urenBlad(jaar: number, dagen: string[], r: ExportRegio, rooster: string, n: number): Blad {
  const b = nieuwBlad(bladNaam(`${afkVan(r.regio)} uren`));
  b.vast = { rij: EERSTE_RIJ, kolom: EERSTE_DAG };
  const lr = laatsteRij(n);
  const R = bladRef(rooster);
  const dagKol = new Map(dagen.map((d, i) => [d, EERSTE_DAG + i]));
  zet(b, 1, 1, 'ingezet aantal regelplekken regio:', S.a1);
  zet(b, 1, 2, 'benodigde regelplekken cluster:', S.b1);
  zet(b, 2, 1, { f: `${R}!A2` }, S.a2);
  zet(b, 2, 2, { f: `${R}!B2` }, S.b2);
  zet(b, 5, 2, 'datum', { font: { vet: true } });
  zet(b, 6, 1, 'mw', S.kop);
  zet(b, 6, 2, 'contract-uren', S.kop);
  // rijen zonder medewerker blijven leeg, maar rekenen mee zodra er in het rooster iemand bij komt
  const leeg = (rr: number) => rr >= EERSTE_RIJ + n;
  const alsIemand = (rr: number, f: string) => (leeg(rr) ? `IF(${R}!$A${rr}="","",${f})` : f);
  for (let rr = EERSTE_RIJ; rr <= lr; rr++) {
    zet(b, rr, 1, { f: alsIemand(rr, `${R}!A${rr}`) }, S.naam);
    zet(b, rr, 2, { f: alsIemand(rr, `${R}!B${rr}`) }, S.contract);
  }
  for (let m = 1; m <= 12; m++) {
    const c0 = EERSTE_DAG + (m - 1) * 16;
    const md = dagen.filter((d) => Number(d.slice(0, 4)) === jaar && Number(d.slice(5, 7)) === m);
    const van = kol(dagKol.get(md[0])!), tot = kol(dagKol.get(md[md.length - 1])!);
    zet(b, 2, c0, MAAND_LANG[m - 1], { font: { vet: true }, vulling: K.grijs });
    for (let k = 1; k < 15; k++) zet(b, 2, c0 + k, null, { vulling: K.grijs });
    b.samengevoegd.push(`${ref(2, c0)}:${ref(2, c0 + 14)}`);
    UREN_KOP.forEach((h, k) => {
      for (let rr = 3; rr <= 6; rr++) zet(b, rr, c0 + k, rr === 3 ? (/^\d$/.test(h) ? Number(h) : h) : null, S.urenKop);
      b.samengevoegd.push(`${ref(3, c0 + k)}:${ref(6, c0 + k)}`);
    });
    const C = (k: number, rr: number) => ref(rr, c0 + k);
    // de weekenden van de maand: een weekend telt als gewerkt, tenzij beide dagen vrij zijn
    const weekenden: string[][] = [];
    for (const d of md) {
      const wd = weekday(toDay(d));
      if (wd === 6) weekenden.push([d, ...(md.includes(addDays(d, 1)) ? [addDays(d, 1)] : [])]);
      else if (wd === 0 && !md.includes(addDays(d, -1))) weekenden.push([d]);
    }
    for (let rr = EERSTE_RIJ; rr <= lr; rr++) {
      const bereik = `${R}!$${van}${rr}:$${tot}${rr}`;
      const f = (x: string) => ({ f: alsIemand(rr, x) });
      zet(b, rr, c0, f(`SUM(${C(4, rr)}:${C(6, rr)})+(2*${C(7, rr)})`), S.tel);
      zet(b, rr, c0 + 1, f(`COUNTIF(${bereik},"DG")+COUNTIF(${bereik},"DG1")`), S.tel);
      zet(b, rr, c0 + 2, f(`ROUND(((${C(1, rr)}*8)+(${C(4, rr)}*8)+(${C(5, rr)}*3)+(${C(6, rr)}*8)+(${C(7, rr)}*10)+(SUM(${C(8, rr)}:${C(10, rr)})*8)+(${C(11, rr)}*3)+(${C(12, rr)}*8)+(${C(14, rr)}*8))/(${md.length}/7),1)`), S.tel);
      zet(b, rr, c0 + 3, f(`ROUND($B${rr}-${C(2, rr)},1)`), S.tel);
      for (const k of [4, 5, 6, 7, 8, 9, 10, 11, 12, 14]) zet(b, rr, c0 + k, f(`COUNTIF(${bereik},${C(k, 3).replace(/(\d+)$/, '$$$1')})`), S.tel);
      const we = weekenden.map((w) => `IF(AND(${w.map((d) => `${R}!${kol(dagKol.get(d)!)}${rr}="vrij"`).join(',')}),0,1)`).join('+');
      zet(b, rr, c0 + 13, f(we || '0'), S.tel);
    }
    b.breedtes.push({ van: c0, tot: c0 + 14, breedte: 5.4 }, { van: c0 + 15, tot: c0 + 15, breedte: 2 });
  }
  b.breedtes.push({ van: 1, tot: 1, breedte: 29.3 }, { van: 2, tot: 2, breedte: 17.1 });
  return b;
}
