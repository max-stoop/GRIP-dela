import { toDay, fromDay, mondayOf, isoWeek, fmtD } from '../dates';
import { DIENSTEN } from './diensten';
import { celOvertredingen, cel, REGELS } from './toets';
import type { Wijziging } from './voorstel';
import type { Beleid, Cellen, Medewerker, Tijden } from './types';

export interface RuilBevinding {
  soort: 'atw' | 'beleid' | 'uren' | 'dekking';
  ernst: 'hard' | 'let op';
  tekst: string;
}

export interface RuilToets {
  ok: boolean;
  bevindingen: RuilBevinding[];
}

export function pasToe(cellen: Cellen, wijzigingen: Wijziging[]): Cellen {
  const out: Cellen = { ...cellen };
  for (const [m, d, s] of wijzigingen) {
    out[m] = { ...(out[m] ?? {}) };
    if (s === '-') delete out[m][d]; else out[m][d] = s;
  }
  return out;
}

/** ATW en CAO zijn hard, beleid en teamafspraken "let op"; daarnaast uren boven het contract en de dekking. */
export function ruilToets(opts: { team: Medewerker[]; cellen: Cellen; wijzigingen: Wijziging[]; beleid: Beleid; tijden?: Tijden }): RuilToets {
  const { team, cellen, wijzigingen, beleid, tijden } = opts;
  if (!wijzigingen.length) return { ok: true, bevindingen: [] };
  const na = pasToe(cellen, wijzigingen);
  const ids = new Set(wijzigingen.map((w) => w[0]));
  const betrokken = team.filter((e) => ids.has(e.id));
  const naam = Object.fromEntries(team.map((e) => [e.id, e.naam]));
  const days = wijzigingen.map((w) => toDay(w[1]));
  const van = Math.min(...days) - 7, tot = Math.max(...days) + 7;
  const periode = Array.from({ length: tot - van + 1 }, (_, i) => fromDay(van + i));
  const sleutel = (o: { mid: string; datum: string; regel: string }) => `${o.mid}|${o.datum}|${o.regel}`;
  const voor = new Set(celOvertredingen(betrokken, cellen, periode, beleid, tijden).map(sleutel));
  const bevindingen: RuilBevinding[] = [];
  const gezien = new Set<string>();
  for (const o of celOvertredingen(betrokken, na, periode, beleid, tijden)) {
    if (voor.has(sleutel(o))) continue;
    const r = REGELS[o.regel];
    const tekst = `${naam[o.mid]}: ${r.kort} (${fmtD(o.datum)})`;
    if (gezien.has(tekst)) continue;
    gezien.add(tekst);
    bevindingen.push({ soort: r.niveau === 'ATW en CAO' ? 'atw' : 'beleid', ernst: r.niveau === 'ATW en CAO' ? 'hard' : 'let op', tekst });
  }
  for (const e of betrokken) {
    const weken = new Set(wijzigingen.filter((w) => w[0] === e.id).map((w) => mondayOf(toDay(w[1]))));
    for (const mon of weken) {
      let h = 0, h0 = 0;
      for (let i = 0; i < 7; i++) {
        h += DIENSTEN[cel(na, e.id, fromDay(mon + i))].uren;
        h0 += DIENSTEN[cel(cellen, e.id, fromDay(mon + i))].uren;
      }
      if (h > e.contract && h > h0) {
        bevindingen.push({ soort: 'uren', ernst: 'let op', tekst: `${e.naam}: ${h} uur in week ${isoWeek(mon)}, contract ${e.contract} uur` });
      }
    }
  }
  for (const d of [...new Set(wijzigingen.map((w) => w[1]))]) {
    const som = (c: Cellen, f: (s: ReturnType<typeof cel>) => number) => team.reduce((s, e) => s + f(cel(c, e.id, d)), 0);
    const p = (c: Cellen) => som(c, (s) => DIENSTEN[s].plekken);
    const b = (c: Cellen) => som(c, (s) => (s === '1B' ? 1 : 0));
    const v = (c: Cellen) => som(c, (s) => DIENSTEN[s].voorgangen);
    if (p(na) < p(cellen)) bevindingen.push({ soort: 'dekking', ernst: 'let op', tekst: `Regelplekken op ${fmtD(d)} dalen van ${p(cellen)} naar ${p(na)}` });
    if (b(na) < b(cellen)) bevindingen.push({ soort: 'dekking', ernst: 'let op', tekst: `Beschikbaarheidsdiensten op ${fmtD(d)} dalen van ${b(cellen)} naar ${b(na)}` });
    if (v(na) < v(cellen)) bevindingen.push({ soort: 'dekking', ernst: 'let op', tekst: `Voorgaansplekken op ${fmtD(d)} dalen van ${v(cellen)} naar ${v(na)}` });
  }
  return { ok: !bevindingen.some((x) => x.ernst === 'hard'), bevindingen };
}
