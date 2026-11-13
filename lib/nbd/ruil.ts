/** Ruilen bij de NBD: tijden en pauze gaan mee met de dienst, zodat de bezetting aan de telefoon gelijk blijft. */
import { fromDay, toDay } from '../dates';
import { pasToe, type RuilBevinding, type RuilToets } from '../rooster/ruil';
import type { Cellen, Medewerker, Tijden, Voorkeurprofiel } from '../rooster/types';
import type { Verlof } from '../store/types';
import type { Wijziging } from '../rooster/voorstel';
import { nbdDienst } from './blokken';
import { naarTijd, zonderTaken } from './dienst';
import type { NbdParameters } from './parameters';
import { toetsNbd } from './toets';
import type { NbdWijziging } from './voorstel';

/** Taken gaan niet mee: die horen bij de collega en worden opnieuw ingepland. */
export function nbdRuilWijzigingen(w: Wijziging[], cellen: Cellen, tijden: Tijden | undefined, a: string, b: string): NbdWijziging[] {
  return w.map(([mid, d, code]) => {
    const x = code === 'N' ? nbdDienst(cellen, tijden, mid === a ? b : a, d) : null;
    return [mid, d, code, x ? zonderTaken(x) : null];
  });
}

/** Onder verlof of ziekte blijven de tijden bewaard, zodat de dienst na intrekken of herstel terugkomt. */
export function nbdTijdenNa(tijden: Tijden | undefined, w: NbdWijziging[]): Tijden {
  const uit: Tijden = { ...(tijden ?? {}) };
  for (const [mid, d, code, x] of w) {
    const rij = { ...(uit[mid] ?? {}) };
    if (code === 'N' && x) rij[d] = naarTijd(x);
    else if (code === 'N' || code === '-') delete rij[d];
    else continue;
    uit[mid] = rij;
  }
  return uit;
}

/** Zoals zetNbdDiensten ze bewaart, zonder de invoer te veranderen. */
export function nbdNa(cellen: Cellen, tijden: Tijden | undefined, w: NbdWijziging[]): { cellen: Cellen; tijden: Tijden } {
  return { cellen: pasToe(cellen, w.map(([m, d, c]) => [m, d, c] as Wijziging)), tijden: nbdTijdenNa(tijden, w) };
}

/** Per medewerker en dag geldt de laatste. */
export function samen(...lijsten: NbdWijziging[][]): NbdWijziging[] {
  const uit = new Map<string, NbdWijziging>();
  for (const w of lijsten.flat()) uit.set(`${w[0]}|${w[1]}`, w);
  return [...uit.values()];
}

/** ATW en CAO zijn hard, beleid en contracturen "let op". */
export function nbdRuilToets(o: {
  team: Medewerker[];
  cellen: Cellen;
  tijden: Tijden | undefined;
  wijzigingen: NbdWijziging[];
  p: NbdParameters;
  minVrijeWeekenden: number;
  /** Voor de voorkeuren (kan niet op een weekdag) en open verlofaanvragen: die geven een "let op". */
  profielen?: Record<string, Voorkeurprofiel>;
  aanvragen?: Verlof[];
}): RuilToets {
  const { team, cellen, tijden, wijzigingen, p } = o;
  if (!wijzigingen.length) return { ok: true, bevindingen: [] };
  const ids = new Set(wijzigingen.map((w) => w[0]));
  const betrokken = team.filter((m) => ids.has(m.id));
  const dagen = wijzigingen.map((w) => toDay(w[1]));
  const van = Math.min(...dagen) - 7, tot = Math.max(...dagen) + 7;
  const dates = Array.from({ length: tot - van + 1 }, (_, i) => fromDay(van + i));
  const na = pasToe(cellen, wijzigingen.map(([m, d, c]) => [m, d, c] as Wijziging));
  const basis = { team: betrokken, dates, behoefte: {}, p, minVrijeWeekenden: o.minVrijeWeekenden, profielen: o.profielen, aanvragen: o.aanvragen };
  const voor = toetsNbd({ ...basis, cellen, tijden });
  const daarna = toetsNbd({ ...basis, cellen: na, tijden: nbdTijdenNa(tijden, wijzigingen) });
  // de vrije weekenden gelden per jaar: die tellen per medewerker, niet per dag
  const sleutel = (id: string, item: string) => (id === 'weekenden' ? `${id}|${item.split(' · ')[0]}` : `${id}|${item}`);
  const al = new Set(voor.checks.flatMap((c) => c.items.map((i) => sleutel(c.id, i))));
  const bevindingen: RuilBevinding[] = [];
  for (const c of daarna.checks) {
    for (const i of c.items) {
      if (al.has(sleutel(c.id, i))) continue;
      const [wie, wanneer] = i.split(' · ');
      bevindingen.push({
        soort: c.id === 'contract' ? 'uren' : c.niveau === 'ATW en CAO' ? 'atw' : 'beleid',
        ernst: c.hard ? 'hard' : 'let op',
        tekst: `${wie}: ${c.naam.charAt(0).toLowerCase()}${c.naam.slice(1)} (${wanneer})`,
      });
    }
  }
  return { ok: !bevindingen.some((b) => b.ernst === 'hard'), bevindingen };
}
