/** Verandert iets waarop een voorstel rust (een dienst, verlof, een wens, de voorspelling), dan is het voorstel verouderd. */
import { addDays } from '../dates';
import type { Cellen, Medewerker } from './types';

function vast(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(vast).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().filter((k) => (x as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${vast((x as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(x ?? null);
}

export function voorstelBasis(o: { team: Medewerker[]; dates: string[]; cellen: Cellen; overig?: unknown[] }): string {
  if (!o.dates.length) return '';
  // de toets kijkt ook terug en vooruit (rusttijd, dagen achter elkaar, weekenden): een ruime marge eromheen
  const van = addDays(o.dates[0], -14), tot = addDays(o.dates[o.dates.length - 1], 14);
  const team = o.team.map((m) => ({
    m,
    cellen: Object.fromEntries(Object.entries(o.cellen[m.id] ?? {}).filter(([d]) => d >= van && d <= tot)),
  }));
  return vast([o.dates[0], o.dates[o.dates.length - 1], team, o.overig ?? []]);
}
