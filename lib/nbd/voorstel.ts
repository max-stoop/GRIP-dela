/**
 * Een NBD-rooster maken. Per dag, van vroeg naar laat: waar Erlang C meer mensen vraagt dan er staan, komt een dienst
 * die het tekort zo lang mogelijk dekt. De medewerker volgt uit voorkeuren, wensen en achterstand op het contract,
 * binnen de ATW en de CAO. Daarna inkorten waar te veel mensen staan en aanvullen tot de contracturen. Boven het
 * contract alleen als het tekort anders niet te dekken is.
 */
import { dagVoorkeurOp, type Cellen, type DienstCode, type Medewerker, type Tijden, type Voorkeurprofiel, type Wens } from '../rooster/types';
import type { Verlof } from '../store/types';
import { DIENSTEN } from '../rooster/diensten';
import { addDays, toDay, weekday, year } from '../dates';
import type { NbdDag } from './behoefte';
import { kwartierIndex, kwartierenOpen } from './behoefte';
import { aanTelefoon, bruto, dagdeel, kwartier, maakDienst, naarTijd, netto, type NbdDienst } from './dienst';
import { blokOp, blokkenVan, nbdDienst, weekVan, weekrustOk, werkInWeek, type Blok } from './blokken';
import { gewerkteWeekenden } from './toets';
import { tijdvakken, tijdvakVan, type NbdParameters } from './parameters';
import { dagPatroon, dienstTegenVoorkeur, weektype } from './voorkeuren';
import { maxUren } from './capaciteit';

export type NbdWijziging = [mid: string, datum: string, dienst: DienstCode, tijd: NbdDienst | null];

interface NbdVoorstelInvoer {
  team: Medewerker[];
  dates: string[];
  cellen: Cellen;
  tijden: Tijden | undefined;
  behoefte: Record<string, NbdDag>;
  p: NbdParameters;
  profielen?: Record<string, Voorkeurprofiel>;
  wensen?: Wens[];
  aanvragen?: Verlof[];
  /** aanvullen: bestaande diensten blijven staan; opnieuw: NBD-diensten in de periode opnieuw plannen. */
  modus: 'aanvullen' | 'opnieuw';
  minVrijeWeekenden?: number;
  /** Overschrijft p.aanvullenTotContract; bijsturen vult niet aan. */
  totContract?: boolean;
}

interface NbdVoorstel {
  wijzigingen: NbdWijziging[];
  diensten: number;
  uren: number;
}

const EPS = 1e-9;

export function maakNbdRooster(inv: NbdVoorstelInvoer): NbdVoorstel {
  const { team, p, behoefte } = inv;
  const dates = [...inv.dates].sort();
  const planbaar = new Set(dates);
  const ks = kwartierenOpen(p);
  const totContract = inv.totContract ?? p.aanvullenTotContract;

  const c: Cellen = {};
  const t: Tijden = {};
  for (const m of team) {
    c[m.id] = { ...(inv.cellen[m.id] ?? {}) };
    t[m.id] = { ...(inv.tijden?.[m.id] ?? {}) };
    if (inv.modus === 'opnieuw') for (const d of dates) if (c[m.id][d] === 'N') { delete c[m.id][d]; delete t[m.id][d]; }
  }
  const nieuw = new Map<string, NbdDienst>();
  const sleutel = (mid: string, d: string) => `${mid}|${d}`;
  const blokCache = new Map<string, Blok[]>();
  const blokken = (mid: string) => {
    let b = blokCache.get(mid);
    if (!b) { b = blokkenVan(c, t, mid); blokCache.set(mid, b); }
    return b;
  };
  const urenNieuw = new Map<string, number>();
  const zet = (mid: string, d: string, x: NbdDienst | null) => {
    const oud = nieuw.get(sleutel(mid, d));
    urenNieuw.set(mid, (urenNieuw.get(mid) ?? 0) - (oud ? netto(oud) : 0) + (x ? netto(x) : 0));
    if (x) { c[mid][d] = 'N'; t[mid][d] = naarTijd(x); nieuw.set(sleutel(mid, d), x); } else { delete c[mid][d]; delete t[mid][d]; nieuw.delete(sleutel(mid, d)); }
    blokCache.delete(mid);
  };
  const werkt = (mid: string, d: string) => !!DIENSTEN[c[mid][d] ?? '-']?.werk;
  const profiel = (mid: string) => inv.profielen?.[mid];
  const wensOp = new Map<string, Wens>();
  for (const w of inv.wensen ?? []) wensOp.set(sleutel(w.medewerkerId, w.datum), w);
  const aanvraag = (mid: string, d: string) => !!inv.aanvragen?.some((v) => v.medewerkerId === mid && v.status === 'aangevraagd' && v.van <= d && v.tot >= d);
  /** Met extra de maximale inzet (variabel rooster); nooit boven de ATW. */
  const weekCap = (m: Medewerker, extra = false) => (m.extern ? p.maxWeekUren : Math.min(p.maxWeekUren, extra ? maxUren(m) : m.contract));

  const mag = (m: Medewerker, d: string, x: NbdDienst, extra = false): boolean => {
    if (!planbaar.has(d) || (c[m.id][d] ?? '-') !== '-') return false;
    if (aanvraag(m.id, d)) return false;
    // voorkeuren per uur: geen dienst op uren die niet kunnen; anders de voorkeur per weekdag
    const pr = profiel(m.id);
    if (pr?.uren) { if (dienstTegenVoorkeur(pr.uren, d, x.start, x.eind).niet > 0) return false; }
    else if (dagVoorkeurOp(pr?.dagen[weekday(toDay(d))], wensOp.get(sleutel(m.id, d))?.soort) === 'niet') return false;
    const w = netto(x);
    if (w < p.minDienst - EPS || w > p.maxDienst + EPS) return false;
    const b = blokOp('N', d, x)!;
    const lijst = blokken(m.id);
    for (const o of lijst) {
      if (o.tot <= b.van + EPS && b.van - o.tot < p.minRust - EPS) return false;
      if (o.van >= b.tot - EPS && o.van - b.tot < p.minRust - EPS) return false;
      if (o.van < b.tot && o.tot > b.van) return false;
    }
    let voor = 0, na = 0;
    while (voor < p.maxAchtereen + 1 && werkt(m.id, addDays(d, -(voor + 1)))) voor++;
    while (na < p.maxAchtereen + 1 && werkt(m.id, addDays(d, na + 1))) na++;
    if (voor + na + 1 > p.maxAchtereen) return false;
    const ma = weekVan(d);
    if (werkInWeek(lijst, ma) + w > weekCap(m, extra) + EPS) return false;
    const met = [...lijst, b].sort((a1, a2) => a1.van - a2.van);
    if (![ma - 7, ma, ma + 7].every((wk) => weekrustOk(met, wk, p))) return false;
    const minVrij = inv.minVrijeWeekenden ?? 0;
    const wd = weekday(toDay(d));
    if (minVrij > 0 && !m.afstandsverklaring && (wd === 0 || wd === 6)) {
      const zat = wd === 6 ? toDay(d) : toDay(d) - 1;
      const gewerkt = gewerkteWeekenden(c[m.id], year(toDay(d)));
      if (!gewerkt.has(zat) && gewerkt.size >= 52 - minVrij) return false;
    }
    return true;
  };

  /** Hoger is beter. */
  const score = (m: Medewerker, d: string, x: NbdDienst, periodeTot: number): number => {
    const pr = profiel(m.id);
    let s = 0;
    const cap = weekCap(m);
    const ma = weekVan(d);
    s += cap > 0 ? (3 * (cap - werkInWeek(blokken(m.id), ma))) / cap : 0;
    const norm = m.extern ? 0 : (m.contract * periodeTot) / 7;
    const gepland = urenNieuw.get(m.id) ?? 0;
    if (norm > 0) s += (norm - gepland) / Math.max(8, m.contract);
    if (m.extern) s -= 2;
    const dd = dagdeel(x);
    if (pr?.uren) {
      // hoeveel van de dienst in de graag-uren valt; een dag zonder graag-uren als iemand die elders wel heeft
      const fit = dienstTegenVoorkeur(pr.uren, d, x.start, x.eind);
      if (fit.heeftGraag && fit.totaal) s += 2.4 * (fit.graag / fit.totaal) - 0.8;
      else if (pr.uren[weektype(d)].some((r) => r.includes('g'))) s -= 0.7;
    } else {
      if (pr && pr.dienst !== 'geen') s += pr.dienst === dd ? 1 : -0.6;
      const vk = dagVoorkeurOp(pr?.dagen[weekday(toDay(d))], wensOp.get(sleutel(m.id, d))?.soort);
      if (vk === 'graag') s += 0.7; else if (vk === 'liever_niet') s -= 0.9;
    }
    const w = wensOp.get(sleutel(m.id, d));
    if (w && w.soort !== 'neutraal' && w.soort !== 'overig8' && w.soort !== 'overig4') s += w.soort === 'vrij' ? -4 : w.soort === 'werken' ? 1 : w.soort === dd ? 1.2 : -0.6;
    if (pr?.maxDagenPerWeek) {
      let dagen = 0;
      for (let i = 0; i < 7; i++) if (werkt(m.id, addDays(isoMa(d), i))) dagen++;
      if (dagen >= pr.maxDagenPerWeek) s -= 1.5;
    }
    return s;
  };
  const isoMa = (d: string) => addDays(d, -((weekday(toDay(d)) + 6) % 7));
  /** Het aaneengesloten stuk graag-uren rond een tijdstip, als de medewerker voorkeuren per uur heeft. */
  const graagVenster = (m: Medewerker, d: string, t: number): { van: number; tot: number } | null => {
    const patroon = dagPatroon(profiel(m.id)?.uren, d);
    const i = tijdvakVan(t);
    if (!patroon || i < 0 || patroon[i] !== 'g') return null;
    const vak = tijdvakken(p);
    let a = i, b = i;
    while (a > 0 && patroon[a - 1] === 'g') a--;
    while (b < vak.length - 1 && patroon[b + 1] === 'g') b++;
    return { van: vak[a].van, tot: vak[b].tot };
  };

  const dekkingOp = (d: string): number[] => {
    const cov = ks.map(() => 0);
    for (const m of team) {
      const x = nbdDienst(c, t, m.id, d);
      if (x) voegToe(cov, x, 1);
    }
    return cov;
  };
  const voegToe = (cov: number[], x: NbdDienst, teken: number) => {
    ks.forEach((q, i) => { if (aanTelefoon(x, q)) cov[i] += teken; });
  };

  /** Liefst in het midden van de dienst. */
  const metPauze = (x: NbdDienst, cov: number[], nodig: number[]): NbdDienst => {
    if (!x.pauze) return x;
    const duur = x.pauze / 60;
    const midden = x.start + (bruto(x) - duur) / 2;
    let beste: number | null = null, besteKost = Infinity;
    for (let pb = x.start + 1; pb + duur <= x.eind - 1 + EPS; pb += 0.25) {
      let kost = 0;
      for (let q = pb; q < pb + duur - EPS; q += 0.25) {
        const i = kwartierIndex(p, q);
        if (i < 0 || i >= ks.length) continue;
        kost += Math.max(0, nodig[i] - cov[i]);
      }
      kost += Math.abs(pb - midden) * 0.01;
      if (kost < besteKost - EPS) { besteKost = kost; beste = pb; }
    }
    return beste == null ? x : { ...x, pauzeStart: kwartier(beste) };
  };

  const plaats = (m: Medewerker, d: string, x: NbdDienst, cov: number[], nodig: number[]) => {
    const zonder: NbdDienst = { start: x.start, eind: x.eind, pauze: 0 };
    voegToe(cov, zonder, 1);
    const metP = metPauze(x, cov, nodig);
    voegToe(cov, zonder, -1);
    voegToe(cov, metP, 1);
    zet(m.id, d, metP);
    return metP;
  };

  const dienstVoor = (start: number, werk: number): NbdDienst => {
    let x = maakDienst(p, start, werk);
    if (x.eind > p.sluit + EPS) x = maakDienst(p, Math.max(p.open, p.sluit - bruto(x)), werk);
    return x;
  };

  // 1. per dag de tekorten dekken
  for (const d of dates) {
    const dag = behoefte[d];
    if (!dag) continue;
    const nodig = dag.kwartieren.map((k) => k.nodig);
    const cov = dekkingOp(d);
    const overslaan = new Set<number>();
    for (let ronde = 0; ronde < 400; ronde++) {
      const q0 = nodig.findIndex((n, i) => n - cov[i] > 0 && !overslaan.has(i));
      if (q0 < 0) break;
      let q1 = q0;
      while (q1 < ks.length && nodig[q1] - cov[q1] > 0) q1++;
      const gewenst = Math.min(p.maxDienst, Math.max(p.minDienst, (q1 - q0) / 4));
      const kies = (extra: boolean) => {
        let beste: { m: Medewerker; x: NbdDienst; s: number } | null = null;
        for (const m of team) {
          // externen plant GRIP niet zelf in (zoals bij de regio's): dat doet de planner met de hand
          if (!m.actief || m.extern || (extra && maxUren(m) <= m.contract)) continue;
          const ruimte = weekCap(m, extra) - werkInWeek(blokken(m.id), weekVan(d));
          const werk = Math.floor(Math.min(gewenst, ruimte, p.maxDienst) * 4) / 4;
          if (werk < p.minDienst - EPS) continue;
          // de dienst vanaf het tekort, en (met voorkeuren per uur) een dienst die stopt waar de graag-uren stoppen
          const opties = [dienstVoor(ks[q0], werk)];
          const venster = graagVenster(m, d, ks[q0]);
          if (venster) {
            const kort = Math.floor(Math.min(werk, venster.tot - ks[q0] - (venster.tot - ks[q0] > p.pauzeNa + 0.5 ? p.pauzeMinuten / 60 : 0)) * 4) / 4;
            if (kort >= p.minDienst - EPS && kort < werk - EPS) opties.push(maakDienst(p, ks[q0], kort));
          }
          for (const x of opties) {
            if (!mag(m, d, x, extra)) continue;
            const s = score(m, d, x, dates.length) + netto(x) / 9;
            if (!beste || s > beste.s + EPS) beste = { m, x, s };
          }
        }
        return beste;
      };
      // eerst binnen de contracturen; lukt dat niet, dan tot de maximale inzet (variabel rooster)
      const beste = kies(false) ?? kies(true);
      if (!beste) { for (let i = q0; i < q1; i++) overslaan.add(i); continue; }
      plaats(beste.m, d, beste.x, cov, nodig);
    }

    // 2. inkorten waar te veel mensen staan (alleen nieuwe diensten)
    for (const m of team) {
      const k = sleutel(m.id, d);
      let x = nieuw.get(k);
      if (!x) continue;
      for (let stap = 0; stap < 40; stap++) {
        const w = netto(x);
        if (w - 0.25 < p.minDienst - EPS) break;
        const iStart = kwartierIndex(p, x.start), iEind = kwartierIndex(p, x.eind) - 1;
        const overBegin = iStart >= 0 && iStart < ks.length && cov[iStart] > nodig[iStart];
        const overEind = iEind >= 0 && iEind < ks.length && cov[iEind] > nodig[iEind];
        if (!overBegin && !overEind) break;
        voegToe(cov, x, -1);
        const kort = overBegin ? maakDienst(p, x.start + 0.25, w - 0.25) : maakDienst(p, x.start, w - 0.25);
        x = metPauze(kort, cov, nodig);
        voegToe(cov, x, 1);
        zet(m.id, d, x);
      }
    }
  }

  // 3. aanvullen tot de contracturen, op de drukste momenten
  if (totContract) {
    const waarde = (d: string, i: number, cov: number[]) => {
      const k = behoefte[d]?.kwartieren[i];
      return k ? k.gesprekken / (cov[i] + 1) : 0;
    };
    const dekkingen = new Map(dates.map((d) => [d, dekkingOp(d)]));
    for (const ma of [...new Set(dates.map(weekVan))]) {
      const weekDagen = dates.filter((d) => weekVan(d) === ma && behoefte[d]);
      for (let ronde = 0; ronde < 6; ronde++) {
        let iets = false;
        const volgorde = team.filter((m) => m.actief && !m.extern).sort((a, b) => (weekCap(b) - werkInWeek(blokken(b.id), ma)) - (weekCap(a) - werkInWeek(blokken(a.id), ma)));
        for (const m of volgorde) {
          const ruimte = weekCap(m) - werkInWeek(blokken(m.id), ma);
          if (ruimte < 0.25 - EPS) continue;
          for (const d of weekDagen) {
            let x = nieuw.get(sleutel(m.id, d));
            if (!x) continue;
            const cov = dekkingen.get(d)!;
            for (let stap = 0; stap < 24; stap++) {
              const rest = weekCap(m) - werkInWeek(blokken(m.id), ma);
              const w = netto(x);
              if (rest < 0.25 - EPS || w + 0.25 > p.maxDienst + EPS) break;
              const iVoor = kwartierIndex(p, x.start) - 1, iNa = kwartierIndex(p, x.eind);
              const vVoor = iVoor >= 0 ? waarde(d, iVoor, cov) : -1;
              const vNa = iNa < ks.length ? waarde(d, iNa, cov) : -1;
              if (vVoor <= 0 && vNa <= 0) break;
              const kandidaat = vVoor >= vNa ? maakDienst(p, x.start - 0.25, w + 0.25) : maakDienst(p, x.start, w + 0.25);
              if (kandidaat.start < p.open - EPS || kandidaat.eind > p.sluit + EPS) break;
              zet(m.id, d, null);
              voegToe(cov, x, -1);
              const nodig = behoefte[d].kwartieren.map((k) => k.nodig);
              const y = metPauze(kandidaat, cov, nodig);
              if (mag(m, d, y)) { voegToe(cov, y, 1); zet(m.id, d, y); x = y; iets = true; } else { voegToe(cov, x, 1); zet(m.id, d, x); break; }
            }
          }
          const rest = weekCap(m) - werkInWeek(blokken(m.id), ma);
          const werk = Math.floor(Math.min(rest, p.maxDienst) * 4) / 4;
          if (werk < p.minDienst - EPS) continue;
          let beste: { d: string; x: NbdDienst; v: number } | null = null;
          for (const d of weekDagen) {
            if ((c[m.id][d] ?? '-') !== '-') continue;
            const cov = dekkingen.get(d)!;
            const lengte = Math.round((werk + (werk > p.pauzeNa ? p.pauzeMinuten / 60 : 0)) * 4);
            for (let i0 = 0; i0 + lengte <= ks.length; i0++) {
              const x = maakDienst(p, ks[i0], werk);
              if (x.eind > p.sluit + EPS) break;
              let v = 0;
              for (let i = i0; i < i0 + lengte && i < ks.length; i++) v += waarde(d, i, cov);
              v += score(m, d, x, dates.length) * 2;
              if (!beste || v > beste.v + EPS) {
                if (mag(m, d, x)) beste = { d, x, v };
              }
            }
          }
          if (beste) {
            const cov = dekkingen.get(beste.d)!;
            plaats(m, beste.d, beste.x, cov, behoefte[beste.d].kwartieren.map((k) => k.nodig));
            iets = true;
          }
        }
        if (!iets) break;
      }
    }
  }

  const wijzigingen: NbdWijziging[] = [];
  let diensten = 0, uren = 0;
  for (const m of team) {
    for (const d of dates) {
      const oud = inv.cellen[m.id]?.[d] ?? '-';
      const nu = c[m.id][d] ?? '-';
      const x = nu === 'N' ? nbdDienst(c, t, m.id, d) : null;
      const oudX = oud === 'N' ? nbdDienst(inv.cellen, inv.tijden, m.id, d) : null;
      if (x) { diensten++; uren += netto(x); }
      const gelijk = oud === nu && (nu !== 'N' || (!!x && !!oudX && x.start === oudX.start && x.eind === oudX.eind && x.pauze === oudX.pauze && (x.pauzeStart ?? null) === (oudX.pauzeStart ?? null)));
      if (!gelijk) wijzigingen.push([m.id, d, nu, x]);
    }
  }
  return { wijzigingen, diensten, uren };
}
