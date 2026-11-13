/** Voorkeuren per uur bij de NBD (Gap wens en benodigd): per weekdag en tijdvak graag of kan niet, apart voor even en oneven weken. */
import { isoWeek, toDay } from '../dates';
import type { Medewerker, UurVoorkeuren, Voorkeurprofiel } from '../rooster/types';
import { tijdvakken, tijdvakVan, type Uur } from './parameters';

export type UurKeuze = 'g' | 'n' | '.';
export type Weektype = 'even' | 'oneven';

/** 16: elk uur van 7:00 tot 22:00, en het laatste halfuur. */
export const AANTAL_VAKKEN = tijdvakken().length;

export function leegPatroon(): string[] {
  return Array.from({ length: 7 }, () => '.'.repeat(AANTAL_VAKKEN));
}

export function leegUren(): UurVoorkeuren {
  return { even: leegPatroon(), oneven: leegPatroon() };
}

function geldigPatroon(x: unknown): string[] | null {
  if (!Array.isArray(x) || x.length !== 7) return null;
  return x.map((r) => {
    const s = typeof r === 'string' ? r : '';
    return Array.from({ length: AANTAL_VAKKEN }, (_, i) => (s[i] === 'g' || s[i] === 'n' ? s[i] : '.')).join('');
  });
}

/** Alleen wat klopt, de rest leeg. */
export function geldigeUren(x: unknown): UurVoorkeuren | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const even = geldigPatroon(o.even), oneven = geldigPatroon(o.oneven);
  if (!even && !oneven) return undefined;
  return { even: even ?? leegPatroon(), oneven: oneven ?? even ?? leegPatroon() };
}

export function weektype(datum: string): Weektype {
  return isoWeek(toDay(datum)) % 2 === 0 ? 'even' : 'oneven';
}

/** Eén teken per tijdvak, of null zonder voorkeuren. */
export function dagPatroon(uren: UurVoorkeuren | undefined, datum: string): string | null {
  if (!uren) return null;
  const wd = new Date(`${datum}T12:00:00Z`).getUTCDay();
  return uren[weektype(datum)][wd] ?? null;
}

export function zetVak(patroon: string, vak: number, keuze: UurKeuze): string {
  return patroon.slice(0, vak) + keuze + patroon.slice(vak + 1);
}

export const SNELDIENSTEN: { naam: string; van: Uur; tot: Uur }[] = [
  { naam: 'Vroeg', van: 7, tot: 15.5 },
  { naam: 'Dag', van: 9, tot: 17.5 },
  { naam: 'Laat', van: 14, tot: 22.5 },
  { naam: 'Avond', van: 17, tot: 22.5 },
];

/** Elk tijdvak waar de dienst in valt. */
export function metDienst(patroon: string, van: Uur, tot: Uur, keuze: UurKeuze = 'g'): string {
  let p = patroon;
  tijdvakken().forEach((v, i) => { if (v.tot > van + 1e-9 && v.van < tot - 1e-9) p = zetVak(p, i, keuze); });
  return p;
}

/** Kwartieren in 'graag' en in 'kan niet'. */
export function dienstTegenVoorkeur(uren: UurVoorkeuren | undefined, datum: string, start: Uur, eind: Uur): { graag: number; niet: number; totaal: number; heeftGraag: boolean } {
  const p = dagPatroon(uren, datum);
  let graag = 0, niet = 0, totaal = 0;
  for (let t = start; t < eind - 1e-9; t += 0.25) {
    totaal++;
    const i = tijdvakVan(t);
    if (!p || i < 0) continue;
    if (p[i] === 'g') graag++;
    else if (p[i] === 'n') niet++;
  }
  return { graag, niet, totaal, heeftGraag: !!p && p.includes('g') };
}

export function graagUren(uren: UurVoorkeuren | undefined, type: Weektype): number {
  if (!uren) return 0;
  const vak = tijdvakken();
  return uren[type].reduce((a, rij) => a + [...rij].reduce((b, c, i) => b + (c === 'g' ? vak[i].tot - vak[i].van : 0), 0), 0);
}

/** Per weekdag (0 = zondag) en tijdvak. */
export function wensTelling(team: Medewerker[], profielen: Record<string, Voorkeurprofiel>, type: Weektype): { graag: number[][]; niet: number[][] } {
  const graag = Array.from({ length: 7 }, () => new Array(AANTAL_VAKKEN).fill(0));
  const niet = Array.from({ length: 7 }, () => new Array(AANTAL_VAKKEN).fill(0));
  for (const m of team) {
    const u = profielen[m.id]?.uren;
    if (!u || !m.actief) continue;
    u[type].forEach((rij, wd) => [...rij].forEach((c, i) => { if (c === 'g') graag[wd][i]++; else if (c === 'n') niet[wd][i]++; }));
  }
  return { graag, niet };
}

/** 'niet' als de dienst (of zonder dienst de hele dag) op uren valt die niet kunnen; 'graag' als hij grotendeels in de graag-uren valt. */
export function uurVoorkeurDag(uren: UurVoorkeuren | undefined, datum: string, dienst: { start: Uur; eind: Uur } | null): 'niet' | 'graag' | undefined {
  const p = dagPatroon(uren, datum);
  if (!p) return undefined;
  if (dienst) {
    const fit = dienstTegenVoorkeur(uren, datum, dienst.start, dienst.eind);
    if (fit.niet > 0) return 'niet';
    return fit.totaal && fit.graag / fit.totaal >= 0.5 ? 'graag' : undefined;
  }
  if (!p.includes('g') && !p.includes('.')) return 'niet';
  return p.includes('g') ? 'graag' : undefined;
}

/** De snelle dienst die het best past bij de graag-uren. */
export function voorkeurKort(uren: UurVoorkeuren | undefined): string {
  if (!uren) return 'geen voorkeur';
  const vak = tijdvakken();
  const graag = new Array(AANTAL_VAKKEN).fill(0);
  for (const type of ['even', 'oneven'] as const) for (const rij of uren[type]) [...rij].forEach((c, i) => { if (c === 'g') graag[i]++; });
  const totaal = graag.reduce((a, x) => a + x, 0);
  if (!totaal) return 'geen voorkeur';
  let beste: { naam: string; dekking: number; lengte: number } | null = null;
  for (const d of SNELDIENSTEN) {
    const dekking = graag.reduce((a, x, i) => a + (vak[i].van >= d.van - 1e-9 && vak[i].tot <= d.tot + 1e-9 ? x : 0), 0) / totaal;
    const lengte = d.tot - d.van;
    if (!beste || dekking > beste.dekking + 1e-9 || (Math.abs(dekking - beste.dekking) < 1e-9 && lengte < beste.lengte)) beste = { naam: d.naam, dekking, lengte };
  }
  return beste && beste.dekking >= 0.6 ? `liefst ${beste.naam.toLowerCase()}` : 'eigen tijden';
}
