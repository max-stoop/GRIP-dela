/** Welke bron vandaag niet is opgehaald, verouderd is of ontbreekt. Gedeeld door de dagelijkse taak, de app en Bronnen en model. */
import { addDays } from '../dates';
import type { ExternData } from '../model/types';
import type { BronNaam } from './common';

/** naam, plek in de externe gegevens, label */
export const DAGELIJKSE_BRONNEN: [BronNaam, string, string][] = [
  ['weer', 'weer', 'Weersverwachting'], ['lucht', 'lucht', 'Luchtkwaliteit'], ['seizoen', 'seizoen', 'Seizoensverwachting'],
  ['riool', 'riool', 'Rioolwater'], ['cbs', 'cbs', 'CBS-sterfte'],
];

/** Tot welke dag de gegevens minstens moeten lopen, in dagen vanaf vandaag; negatief voor metingen die met vertraging verschijnen. */
const ACTUEEL: Record<string, { label: string; dagen: number }> = {
  weer: { label: 'Weersverwachting', dagen: 3 },
  lucht: { label: 'Luchtkwaliteit', dagen: 1 },
  seizoen: { label: 'Seizoensverwachting', dagen: 30 },
  riool: { label: 'Rioolwater', dagen: -21 },
  cbs: { label: 'CBS-sterfte', dagen: -35 },
};

export interface BronGebrek {
  bron: string;
  label: string;
  reden: 'niet opgehaald' | 'verouderd' | 'geen gegevens';
  tot: string | null;
}

/** Over alle variabelen en reeksen. */
export function laatsteDatum(bron: ExternData[string] | undefined): string | null {
  let tot: string | null = null;
  for (const perVar of Object.values(bron ?? {})) {
    for (const reeks of Object.values(perVar)) {
      for (const d of Object.keys(reeks)) if (tot === null || d > tot) tot = d;
    }
  }
  return tot;
}

/** null als de bron niet in de lijst staat. */
export function isActueel(bron: string, tot: string | null, vandaag: string): boolean | null {
  const a = ACTUEEL[bron];
  if (!a) return null;
  return tot !== null && tot >= addDays(vandaag, a.dagen);
}

/** Een bron die vandaag niet is opgehaald, telt altijd mee; een opgehaalde als de gegevens niet ver genoeg lopen. */
export function bronGebreken(o: { extern: ExternData; opgehaald: Record<string, boolean>; vandaag: string; normaal?: boolean }): BronGebrek[] {
  const uit: BronGebrek[] = [];
  for (const [bron, { label }] of Object.entries(ACTUEEL)) {
    const tot = laatsteDatum(o.extern[bron]);
    if (o.opgehaald[bron] === false) uit.push({ bron, label, reden: tot === null ? 'geen gegevens' : 'niet opgehaald', tot });
    else if (tot === null) uit.push({ bron, label, reden: 'geen gegevens', tot });
    else if (!isActueel(bron, tot, o.vandaag)) uit.push({ bron, label, reden: 'verouderd', tot });
  }
  if (o.normaal === false) uit.push({ bron: 'normalen', label: 'Klimaatnormalen', reden: 'geen gegevens', tot: null });
  return uit;
}

/** Eén gebrek in gewone taal, bijvoorbeeld "Rioolwater: vandaag niet opgehaald (gegevens tot 3 okt)". */
export function gebrekTekst(g: BronGebrek, datum: (d: string) => string): string {
  const tot = g.tot ? ` (gegevens tot ${datum(g.tot)})` : '';
  if (g.reden === 'niet opgehaald') return `${g.label}: vandaag niet opgehaald${tot}`;
  if (g.reden === 'verouderd') return `${g.label}: verouderd${tot}`;
  return `${g.label}: ontbreekt`;
}
