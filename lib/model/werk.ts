/** Rekentaken van het model, los van waar ze draaien (web worker, hoofdthread of later de server). */
import { History, runForecast, calibrate } from './forecast';
import { terugtestMorgen, type Terugtest } from './terugtest';
import type { Kalibratie, ModelInput, Run } from './types';

export type Opdracht =
  | { type: 'runs'; input: ModelInput; uitgaven: { issue: string; soort: string; id?: string }[]; now?: string }
  | { type: 'kalibreren'; input: ModelInput; now?: string }
  | { type: 'terugtest'; input: ModelInput; now?: string };

export type Antwoord = { type: 'runs'; runs: Run[] } | { type: 'kalibreren'; kalibratie: Kalibratie } | { type: 'terugtest'; terugtest: Terugtest | null };

export function voerUit(o: Opdracht): Antwoord {
  const now = o.now ? new Date(o.now) : new Date();
  if (o.type === 'runs') {
    const hist = new History(o.input.meldingen);
    return { type: 'runs', runs: o.uitgaven.map((u) => runForecast(o.input, { ...u, hist, now })) };
  }
  if (o.type === 'terugtest') return { type: 'terugtest', terugtest: terugtestMorgen(o.input) };
  return { type: 'kalibreren', kalibratie: calibrate(o.input, 365, now) };
}
