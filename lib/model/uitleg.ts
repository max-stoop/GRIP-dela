/**
 * Hoe een factor tot zijn percentage komt: bijdrage = gewicht × signaal (× wat er op die afstand van over is), en het
 * percentage is e^bijdrage − 1. Hier wordt teruggerekend naar het signaal.
 */
import { DECAY, PRIORS, type FactorKey } from './config';
import type { RunInfo } from './types';
import { fmtD } from '../dates';
import { nl, pct, pctS } from '../format';

interface FactorUitleg {
  signaal: string;
  berekening: string;
}

interface UitlegContext {
  /** Log-schaal; bij meer regio's gewogen naar het basismodel. */
  bijdrage: number;
  /** Vanaf de uitgiftedag. */
  h: number;
  info: Pick<RunInfo, 'mom7' | 'level28' | 'cbs' | 'covid' | 'flu' | 'data_end'> & { coef?: Partial<Record<FactorKey, number>> };
  eenRegio: boolean;
}

const meerMinder = (x: number) => (x >= 0 ? 'meer' : 'minder');

/** "nog 83%" van het signaal op h dagen vooruit. */
const over = (k: keyof typeof DECAY, h: number) => Math.exp(-Math.max(0, h) / DECAY[k]);

export function factorUitleg(k: FactorKey, c: UitlegContext): FactorUitleg {
  const p = PRIORS[k];
  const beta = c.info.coef?.[k] ?? p.prior;
  const geschat = Math.abs(beta - p.prior) > 1e-9;
  const herkomst = geschat ? 'geschat op de eigen meldingen' : 'de startwaarde';
  const effect = pctS(Math.exp(c.bijdrage) - 1);
  // het signaal zoals het in de som zat (bij meer regio's gewogen gemiddeld)
  const x = beta !== 0 ? c.bijdrage / beta : 0;
  const gemiddeld = c.eenRegio ? '' : ' (gemiddeld over de regio\'s, naar hun aantal meldingen)';
  const afstand = (d: keyof typeof DECAY) => (c.h > 0 ? `; op ${c.h} ${c.h === 1 ? 'dag' : 'dagen'} vooruit is daar nog ${pct(over(d, c.h))} van over` : '');
  const tm = c.info.data_end ? ` t/m ${fmtD(c.info.data_end)}` : '';

  switch (k) {
    case 'mom7':
    case 'level28': {
      const r = Math.exp(k === 'mom7' ? c.info.mom7 : c.info.level28) - 1;
      const n = k === 'mom7' ? 7 : 28;
      return {
        signaal: `De afgelopen ${n} dagen${tm} kwamen er landelijk ${pct(Math.abs(r), 1)} ${meerMinder(r)} meldingen dan het basismodel verwachtte.`,
        berekening: `Daarvan telt ${nl(beta, 2)} mee (${herkomst})${afstand(k)}. Samen: ${effect}.`,
      };
    }
    case 'cbs_exc': {
      const r = Math.exp(c.info.cbs) - 1;
      return {
        signaal: `De landelijke sterfte (CBS) in de laatste vier bekende weken lag ${pct(Math.abs(r), 1)} ${r >= 0 ? 'hoger' : 'lager'} dan in dezelfde weken van de drie jaar ervoor.`,
        berekening: `Daarvan telt ${nl(beta, 2)} mee (${herkomst})${afstand('cbs_exc')}. Samen: ${effect}.`,
      };
    }
    case 'heat':
      return {
        signaal: c.eenRegio
          ? `Het warmste moment van de dag is rond deze dag gemiddeld ${nl(25 + x, 1)} °C (over drie dagen): ${nl(x, 1)} graden boven 25 °C.`
          : `Het warmste moment van de dag ligt rond deze dag ${nl(x, 1)} graden boven 25 °C${gemiddeld}, gemiddeld over drie dagen.`,
        berekening: `Per graad boven 25 °C ${pct(beta, 1)} meer meldingen (${herkomst}). Samen: ${effect}.`,
      };
    case 'cold':
      return {
        signaal: c.eenRegio
          ? `De gemiddelde temperatuur over de twee weken ervoor is ${nl(5 - x, 1)} °C: ${nl(x, 1)} graden onder 5 °C.`
          : `De gemiddelde temperatuur over de twee weken ervoor ligt ${nl(x, 1)} graden onder 5 °C${gemiddeld}.`,
        berekening: `Per graad onder 5 °C ${pct(beta, 1)} meer meldingen (${herkomst}). Samen: ${effect}.`,
      };
    case 'pm25': {
      const verschil = 10 * x;
      return {
        signaal: `Fijnstof rond deze dag (gemiddeld over drie dagen): ${nl(9 + verschil, 1)} µg/m³${gemiddeld}, ${nl(Math.abs(verschil), 1)} ${verschil >= 0 ? 'boven' : 'onder'} het gewone niveau van 9.`,
        berekening: `Per 10 µg/m³ ${pct(beta, 1)} ${meerMinder(verschil)} meldingen (${herkomst}). Samen: ${effect}.`,
      };
    }
    case 'ozone':
      return {
        signaal: `Ozon op het hoogste moment van de dag: ${nl(100 + 10 * x, 0)} µg/m³${gemiddeld}, ${nl(10 * x, 0)} boven 100 (zomersmog).`,
        berekening: `Per 10 µg/m³ boven 100 ${pct(beta, 1)} meer meldingen (${herkomst}). Samen: ${effect}.`,
      };
    case 'covid_ww': {
      const keer = Math.pow(2, c.info.covid);
      return {
        signaal: `In het rioolwater zit ${nl(keer, keer < 1 ? 2 : 1)} keer zoveel coronavirus als gewoonlijk${keer >= 1 ? ` (${nl(c.info.covid, 1)} keer verdubbeld)` : ''}.`,
        berekening: `Per verdubbeling ${pct(beta, 1)} meer meldingen (${herkomst})${afstand('covid_ww')}. Samen: ${effect}.`,
      };
    }
    case 'flu_ili':
      return {
        signaal: `Huisartsen zien ${nl(50 + 50 * c.info.flu, 0)} mensen met griepachtige klachten per 100.000 inwoners per week; de epidemiegrens is 50.`,
        berekening: `Per 50 boven die grens ${pct(beta, 1)} meer meldingen (${herkomst})${afstand('flu_ili')}. Samen: ${effect}.`,
      };
    case 'niveau_regio': {
      const r = Math.exp(x) - 1;
      return {
        signaal: c.eenRegio
          ? `In de 16 weken${tm} kwamen er in deze regio ${pct(Math.abs(r), 1)} ${meerMinder(r)} meldingen dan het basismodel verwachtte, vergeleken met de rest van het land.`
          : `In de 16 weken${tm} kwamen er in deze regio's ${pct(Math.abs(r), 1)} ${meerMinder(r)} meldingen dan het basismodel verwachtte, vergeleken met de rest van het land${gemiddeld}.`,
        berekening: `Bij weinig meldingen telt dat minder mee (het schuift naar het landelijke niveau), en het ebt niet weg: groei of krimp van een regio blijft meestal. Samen: ${effect}.`,
      };
    }
    case 'seas_tw':
    case 'seas_ts': {
      const winter = k === 'seas_tw';
      return {
        signaal: `De seizoensverwachting rond deze dag is ${nl(Math.abs(x), 1)} graden ${x >= 0 ? 'warmer' : 'kouder'} dan normaal voor de tijd van het jaar.`,
        berekening: `${winter ? 'Een zachte winter geeft minder meldingen, een strenge meer' : 'Een warme zomer geeft iets meer meldingen'}: per graad warmer ${pct(Math.abs(beta), 1)} ${beta < 0 ? 'minder' : 'meer'} (${herkomst}). Samen: ${effect}.`,
      };
    }
  }
}

/** "114,8 (basismodel) × 1,028 × 1,015 × 0,999 ≈ 119,6": het basismodel keer elke factor. */
export function somUitleg(basis: number, nu: number, effecten: number[]): string {
  const delen = effecten.map((e) => nl(1 + e, 3));
  return `${nl(basis)} (basismodel) × ${delen.join(' × ')} ≈ ${nl(nu)}`;
}
