/** Wat het beleid over een langere periode vraagt en je in één maandrooster niet ziet, per medewerker en als spreiding over het team. */
import { addDays, isHoliday, isWeekend, isoRange, toDay, weekIndex, weekdayMon } from '../dates';
import { DIENSTEN, afwezigVoorNorm } from './diensten';
import type { Beleid, Cellen, DienstCode, Medewerker, Voorkeurprofiel } from './types';
import { nietVrijeWeekenden } from './toets';

interface TeamVerlof { medewerkerId: string; van: string; tot: string; status: string }

export interface MwOverzicht {
  m: Medewerker;
  /** Komende 4 weken; de norm is het contract min verlof en ziekte. */
  uren4: { gepland: number; norm: number };
  /** Dit kalenderjaar; max = 52 min 26. */
  weekenden: { aantal: number; max: number | null };
  /** In 28 dagen, rond vandaag. */
  b28: number;
  /** Dit jaar. */
  feestdagen: number;
  /** Komende 8 weken, als aandeel van de werkdagen. */
  dgAandeel: number | null;
  twee: number;
  /** Werkdagen dit jaar. */
  verlof: { goed: number; aangevraagd: number };
  ziekDagen: number;
  profiel: boolean;
  signalen: { ernst: 'bad' | 'warn' | 'info'; tekst: string }[];
}

interface TeamOverzicht {
  rijen: MwOverzicht[];
  /** Zonder externen: laagste en hoogste. */
  spreiding: { weekenden: [number, number]; b28: [number, number]; feestdagen: [number, number]; dg: [number, number] | null };
  contract: number;
  extern: number;
}

const werkdag = (d: string) => weekdayMon(toDay(d)) < 5;

export function teamOverzicht(o: {
  team: Medewerker[];
  cellen: Cellen;
  verlof: TeamVerlof[];
  profielen: Record<string, Voorkeurprofiel>;
  beleid: Beleid;
  vandaag: string;
  /** Standaard uit de dienstdefinitie; bij de NBD uit de tijden. */
  uren?: (medewerkerId: string, datum: string, code: DienstCode) => number;
  /** Bij de NBD een variabel rooster; daarboven pas een waarschuwing. */
  maxPerWeek?: (m: Medewerker) => number;
  /** NBD, in plaats van het weekpatroon. */
  perUur?: boolean;
}): TeamOverzicht {
  const { cellen, beleid, vandaag } = o;
  const team = o.team.filter((m) => m.actief);
  const jaar = vandaag.slice(0, 4);
  const jaarBegin = `${jaar}-01-01`, jaarEind = `${jaar}-12-31`;
  const komend4 = isoRange(vandaag, addDays(vandaag, 27));
  const komend8 = isoRange(vandaag, addDays(vandaag, 55));
  const rond = isoRange(addDays(vandaag, -27), addDays(vandaag, 27));
  const maxWeekenden = 52 - beleid.minVrijeWeekenden;

  const rijen: MwOverzicht[] = team.map((m) => {
    const rij = cellen[m.id] ?? {};
    const c = (d: string): DienstCode => rij[d] ?? '-';

    let gepland = 0, afwezig = 0;
    for (const d of komend4) {
      const x = c(d);
      gepland += o.uren ? o.uren(m.id, d, x) : DIENSTEN[x].uren;
      if (afwezigVoorNorm(x, !werkdag(d))) afwezig++;
    }
    const norm = Math.max(0, m.contract * 4 - (afwezig * m.contract) / 5);

    const weekenden = new Set<number>();
    let feest = 0, ziek = 0;
    for (const [d, x] of Object.entries(rij)) {
      if (d < jaarBegin || d > jaarEind) continue;
      const n = toDay(d);
      if (DIENSTEN[x].werk && isWeekend(n)) weekenden.add(weekIndex(n));
      if (DIENSTEN[x].werk && isHoliday(n)) feest++;
      if (x === 'Z') ziek++;
    }

    // vier weken terug tot vier weken vooruit
    let b28 = 0;
    for (let i = 0; i + 27 < rond.length; i++) {
      let n = 0;
      for (let j = i; j < i + 28; j++) if (c(rond[j]) === '1B') n++;
      b28 = Math.max(b28, n);
    }

    let dg = 0, werk = 0, twee = 0;
    for (const d of komend8) {
      const x = c(d), def = DIENSTEN[x];
      if (!def.werk || def.categorie === 'overig') continue;
      werk++;
      if (def.categorie === 'dossier') dg++;
      if (x === '2') twee++;
    }

    const verlof = { goed: 0, aangevraagd: 0 };
    for (const v of o.verlof) {
      if (v.medewerkerId !== m.id || (v.status !== 'goedgekeurd' && v.status !== 'aangevraagd')) continue;
      const n = isoRange(v.van < jaarBegin ? jaarBegin : v.van, v.tot > jaarEind ? jaarEind : v.tot).filter(werkdag).length;
      if (v.status === 'goedgekeurd') verlof.goed += n; else verlof.aangevraagd += n;
    }

    const signalen: MwOverzicht['signalen'] = [];
    const maxW = m.afstandsverklaring ? null : maxWeekenden;
    // de CAO telt een weekend met zondag en maandag vrij (hoogstens 13 keer) ook als vrij
    const nietVrij = maxW == null ? 0 : nietVrijeWeekenden(rij, Number(jaar)).length;
    if (maxW != null && nietVrij > maxW) signalen.push({ ernst: 'bad', tekst: `${nietVrij} weekenden niet vrij, maximaal ${maxW} (CAO)` });
    else if (maxW != null && nietVrij >= maxW - 2) signalen.push({ ernst: 'warn', tekst: `${nietVrij} van ${maxW} weekenden gebruikt` });
    if (b28 > beleid.maxBeschikbaarPer28) signalen.push({ ernst: 'bad', tekst: `${b28} keer 1B in 28 dagen (max ${beleid.maxBeschikbaarPer28})` });
    else if (b28 >= beleid.maxBeschikbaarPer28 - 2) signalen.push({ ernst: 'warn', tekst: `${b28} keer 1B in 28 dagen` });
    const max = o.maxPerWeek ? Math.max(m.contract, o.maxPerWeek(m)) : m.contract;
    const maxNorm = Math.max(0, max * 4 - (afwezig * max) / 5);
    if (!m.extern && gepland > maxNorm + 0.5) signalen.push({ ernst: 'warn', tekst: `${Math.round(gepland - norm)} uur boven contract (4 weken)${max > m.contract ? ', meer dan de maximale inzet' : ''}` });
    else if (!m.extern && gepland > norm + 0.5) signalen.push({ ernst: 'info', tekst: `${Math.round(gepland - norm)} uur boven contract, binnen de maximale inzet (4 weken)` });
    if (!m.extern && gepland < norm - 16) signalen.push({ ernst: 'info', tekst: `${Math.round(norm - gepland)} uur onder contract (4 weken)` });
    if (!m.extern && (o.perUur ? !o.profielen[m.id]?.uren : !o.profielen[m.id])) signalen.push({ ernst: 'info', tekst: o.perUur ? 'Geen voorkeuren per uur ingevuld' : 'Geen vaste voorkeuren ingevuld' });

    return {
      m,
      uren4: { gepland, norm },
      weekenden: { aantal: weekenden.size, max: maxW },
      b28,
      feestdagen: feest,
      dgAandeel: werk ? dg / werk : null,
      twee,
      verlof,
      ziekDagen: ziek,
      profiel: !!o.profielen[m.id],
      signalen,
    };
  });

  const vast = rijen.filter((r) => !r.m.extern);
  const mm = (f: (r: MwOverzicht) => number): [number, number] => (vast.length ? [Math.min(...vast.map(f)), Math.max(...vast.map(f))] : [0, 0]);
  const uv = vast.filter((r) => r.m.functie !== 'UL' && r.dgAandeel != null);
  return {
    rijen,
    spreiding: {
      weekenden: mm((r) => r.weekenden.aantal),
      b28: mm((r) => r.b28),
      feestdagen: mm((r) => r.feestdagen),
      dg: uv.length ? [Math.min(...uv.map((r) => r.dgAandeel!)), Math.max(...uv.map((r) => r.dgAandeel!))] : null,
    },
    contract: vast.reduce((s, r) => s + r.m.contract, 0),
    extern: rijen.filter((r) => r.m.extern).length,
  };
}

