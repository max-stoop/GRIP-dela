/** De bandbreedte van één dag in gewone taal. */
import { nl, pct } from '../format';
import { bandDekking, poissonBand } from './poisson';
import type { Bucket } from './betrouwbaarheid';

interface Band {
  /** Op 8 van de 10 dagen tussen lo80 en hi80. */
  lo80: number;
  hi80: number;
  /** Op 19 van de 20 dagen tussen lo95 en hi95. */
  lo95: number;
  hi95: number;
}

export function band(lam: number): Band {
  return { lo80: poissonBand(0.1, lam), hi80: poissonBand(0.9, lam), lo95: poissonBand(0.025, lam), hi95: poissonBand(0.975, lam) };
}

type BandOordeel = 'goed' | 'smal' | 'ruim' | 'weinig' | 'geen';

interface BandUitleg {
  wat: string;
  waarom: string;
  /** Leeg zonder eigen meldingenhistorie. */
  aanname: string | null;
  /** Leeg zonder eigen meldingenhistorie. */
  terug: string | null;
  oordeel: BandOordeel | null;
  /** De plekken rekenen ook met een percentage. */
  plekken: string;
}

/** Onder dit aantal vergelijkingen zeggen we nog niet of de band te smal of te ruim is. */
export const MIN_VERGELIJKINGEN = 10;
/** Zoveel procentpunt mag het werkelijke aandeel binnen de band afwijken van wat hoort. */
const MARGE = 0.07;

/**
 * `vergelijking`: de terugblik op deze afstand (`null` als er nog niets te vergelijken is), of `undefined` als er geen
 * eigen voorspellingen zijn om terug te kijken.
 */
export function bandUitleg(lam: number, b: Band, scopeNaam: string, vergelijking: Bucket | null | undefined, alpha: number): BandUitleg {
  const waar = scopeNaam === 'landelijk' ? 'landelijk' : `in ${scopeNaam}`;
  const dekking = bandDekking(lam);
  const heel = dekking >= 0.83 ? ` (door de hele aantallen hier zelfs op ${pct(dekking)})` : '';
  const wat = `${nl(lam)} is een gemiddelde. Het werkelijke aantal meldingen ${waar} schommelt van dag tot dag: op 8 van de 10 van zulke dagen ligt het tussen ${b.lo80} en ${b.hi80}${heel}, op 19 van de 20 tussen ${b.lo95} en ${b.hi95}.`;
  const breed = lam >= 3 ? ` Hier is de band ongeveer ±${pct((b.hi80 - b.lo80) / 2 / lam)} rond de verwachting.` : '';
  const waarom = `Ook als de verwachting precies klopt, is het per dag toeval hoeveel meldingen er binnenkomen. Bij weinig meldingen per dag is die schommeling naar verhouding groot, bij veel meldingen middelt het meer uit.${breed}`;
  const a = Math.round(alpha * 100);
  const plekken = `Niet hetzelfde als de plekken op ${a}%: die zijn per regio zo gekozen dat er op ${a}% van de dagen niet meer meldingen komen dan plekken. De band kijkt naar twee kanten: 1 op de 10 dagen komt het lager uit, 1 op de 10 hoger.`;

  if (vergelijking === undefined) return { wat, waarom, aanname: null, terug: null, oordeel: null, plekken };
  const aanname = 'De band gaat ervan uit dat de verwachting klopt. Zit het model ernaast, bijvoorbeeld bij een plotselinge griepgolf, dan valt het aantal vaker buiten de band. Daarom kijken we terug.';
  if (!vergelijking || !vergelijking.punten) {
    return { wat, waarom, aanname, terug: 'Hoe vaak de band op deze afstand klopte, staat hier zodra er genoeg voorspelde dagen voorbij zijn.', oordeel: 'geen', plekken };
  }
  const { binnenSom: binnen, punten: n, binnenSomVerwacht: v } = vergelijking;
  const p = binnen / n;
  const feit = `Op ${vergelijking.naam} vooruit viel het werkelijke aantal ${waar} ${binnen} van de ${n} keer binnen de band (${pct(p)}). Als de verwachting klopt, hoort dat ongeveer ${pct(v)} te zijn.`;
  let oordeel: BandOordeel, slot: string;
  if (n < MIN_VERGELIJKINGEN) { oordeel = 'weinig'; slot = 'Dat zijn nog te weinig dagen om te zeggen of de band te smal of te ruim is.'; }
  else if (p < v - MARGE) { oordeel = 'smal'; slot = 'De band is op deze afstand dus te smal: reken op meer uitschieters dan de band aangeeft.'; }
  else if (p > v + MARGE) { oordeel = 'ruim'; slot = 'De band is op deze afstand eerder te ruim: het aantal viel er vaker binnen dan je mag verwachten.'; }
  else { oordeel = 'goed'; slot = 'De band klopt op deze afstand goed.'; }
  const scheef = n >= MIN_VERGELIJKINGEN && Math.abs(vergelijking.bias) >= 0.02
    ? ` Gemiddeld kwamen er ${pct(Math.abs(vergelijking.bias), 1)} ${vergelijking.bias > 0 ? 'meer' : 'minder'} meldingen dan voorspeld.`
    : '';
  return { wat, waarom, aanname, terug: `${feit} ${slot}${scheef}`, oordeel, plekken };
}
