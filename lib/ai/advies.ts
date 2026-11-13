/**
 * De vraag aan het AI-model en het antwoord. Namen gaan nooit mee: medewerkers heten M1, M2, …; de koppeling blijft in
 * de browser. Elk voorstel gaat daarna door de eigen toets en wordt alleen getoond zonder nieuwe harde overtreding.
 */
import { DAG_KORT, toDay, weekday } from '../dates';
import { DIENSTEN, PALET } from '../rooster/diensten';
import { REGELS, cel, type Toets } from '../rooster/toets';
import type { Behoefte, Beleid, Cellen, DienstCode, Medewerker, Voorkeurprofiel, Wens } from '../rooster/types';
import { BEHOEFTE_BRON, weekendTekst } from '../rooster/types';

export interface AdviesVraag {
  regio: string;
  vandaag: string;
  dagen: { datum: string; weekdag: string; afgesproken: number | null; verwacht: number | null; bron: string; gepland: number; beschikbaar: number; voorgangen: number }[];
  medewerkers: { code: string; functie: 'UV' | 'UL'; contract: number; voorkeur: string; weekendgroep: string; patroon: string; maxDagenPerWeek: number | null }[];
  /** In de volgorde van dagen; '-' = vrij. */
  rooster: Record<string, string[]>;
  wensen: { medewerker: string; datum: string; wens: string }[];
  toets: {
    cijfer: number;
    status: string;
    pijlers: { continuiteit: number; efficiency: number; medewerkers: number; klanten: number };
    regels: { regel: string; niveau: string; paragraaf: string; aantal: number; voorbeelden: string[] }[];
  };
  beleid: Record<string, number | boolean>;
}

export interface AdviesVoorstel {
  medewerker: string;
  datum: string;
  dienst: DienstCode;
  reden: string;
}

export interface AdviesAntwoord {
  samenvatting: string;
  sterk: string[];
  risicos: { titel: string; uitleg: string; ernst: 'hoog' | 'middel' | 'laag'; paragraaf: string }[];
  voorstellen: AdviesVoorstel[];
}

/** JSON-schema voor het antwoord (structured outputs: alle objecten zonder extra velden). */
export const ADVIES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['samenvatting', 'sterk', 'risicos', 'voorstellen'],
  properties: {
    samenvatting: { type: 'string', description: 'Twee tot vier zinnen: hoe staat dit rooster ervoor, in gewone taal.' },
    sterk: { type: 'array', items: { type: 'string' }, description: 'Wat goed gaat (maximaal 4 punten).' },
    risicos: {
      type: 'array',
      description: 'Wat aandacht vraagt, belangrijkste eerst (maximaal 6).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titel', 'uitleg', 'ernst', 'paragraaf'],
        properties: {
          titel: { type: 'string' },
          uitleg: { type: 'string' },
          ernst: { type: 'string', enum: ['hoog', 'middel', 'laag'] },
          paragraaf: { type: 'string', description: 'Paragraaf in het roosterbeleid, bijvoorbeeld "3.1", of "-".' },
        },
      },
    },
    voorstellen: {
      type: 'array',
      description: 'Concrete roosterwijzigingen, maximaal 12. Elke wijziging zet één dienst voor één medewerker op één dag.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['medewerker', 'datum', 'dienst', 'reden'],
        properties: {
          medewerker: { type: 'string', description: 'Code van de medewerker, bijvoorbeeld "M3".' },
          datum: { type: 'string', format: 'date' },
          dienst: { type: 'string', enum: PALET.filter((c) => c !== 'V' && c !== 'Z') },
          reden: { type: 'string', description: 'Eén zin: waarom dit het rooster beter maakt.' },
        },
      },
    },
  },
} as const;

const PATROON: Record<string, string> = { niet: 'kan niet', liever_niet: 'liever niet', graag: 'graag' };

/** Namen worden codes; geeft ook de koppeling code → medewerker-id. */
export function maakVraag(o: {
  regio: string; vandaag: string; team: Medewerker[]; dates: string[]; cellen: Cellen; behoefte: Behoefte;
  wensen: Wens[]; profielen: Record<string, Voorkeurprofiel>; beleid: Beleid; toets: Toets;
}): { vraag: AdviesVraag; codes: Map<string, string> } {
  const codes = new Map<string, string>();
  const naarCode = new Map<string, string>();
  o.team.forEach((e, i) => { codes.set(`M${i + 1}`, e.id); naarCode.set(e.id, `M${i + 1}`); });
  const perDag = new Map(o.toets.perDag.map((p) => [p.datum, p]));
  const vraag: AdviesVraag = {
    regio: o.regio,
    vandaag: o.vandaag,
    dagen: o.dates.map((d) => {
      const p = perDag.get(d), b = o.behoefte[d];
      return {
        datum: d, weekdag: DAG_KORT[weekday(toDay(d))], afgesproken: b?.k ?? null, verwacht: b ? Math.round(b.lam * 10) / 10 : null,
        bron: b ? BEHOEFTE_BRON[b.bron] : '-', gepland: p?.p ?? 0, beschikbaar: p?.b ?? 0, voorgangen: p?.voorgangen ?? 0,
      };
    }),
    medewerkers: o.team.map((e) => {
      const p = o.profielen[e.id];
      const patroon = p ? p.dagen.map((v, i) => (v !== 'neutraal' ? `${DAG_KORT[i]} ${PATROON[v]}` : '')).filter(Boolean).join(', ') : '';
      return {
        code: naarCode.get(e.id)!, functie: e.functie ?? 'UV', contract: e.contract,
        voorkeur: p?.dienst && p.dienst !== 'geen' ? p.dienst : e.voorkeur === 'M' ? 'middag' : 'ochtend',
        weekendgroep: weekendTekst(e), patroon, maxDagenPerWeek: p?.maxDagenPerWeek ?? null,
      };
    }),
    rooster: Object.fromEntries(o.team.map((e) => [naarCode.get(e.id)!, o.dates.map((d) => cel(o.cellen, e.id, d))])),
    wensen: o.wensen.filter((w) => naarCode.has(w.medewerkerId) && o.dates.includes(w.datum)).map((w) => ({ medewerker: naarCode.get(w.medewerkerId)!, datum: w.datum, wens: w.soort })),
    toets: {
      cijfer: o.toets.cijfer,
      status: o.toets.status[1],
      pijlers: { continuiteit: Math.round(o.toets.sub.cont * 100), efficiency: Math.round(o.toets.sub.eff * 100), medewerkers: Math.round(o.toets.sub.mw * 100), klanten: Math.round(o.toets.sub.klant * 100) },
      regels: o.toets.checks.filter((c) => c.items.length).map((c) => ({
        regel: c.naam, niveau: c.niveau, paragraaf: c.paragraaf, aantal: new Set(c.items).size,
        // langste namen eerst, zodat "Jan" niet een deel van "Jan de Vries" vervangt en de achternaam achterlaat
        voorbeelden: [...new Set(c.items)].slice(0, 8).map((x) => [...o.team].sort((a, b) => b.naam.length - a.naam.length).reduce((t, e) => t.split(e.naam).join(naarCode.get(e.id)!), x)),
      })),
    },
    beleid: {
      dekkingsgraad: o.beleid.alphaRegio, beschikbaarheidsdienstenPerDag: o.beleid.beschikbaarPerDag, minMiddagdiensten: o.beleid.minMiddag,
      maxTweePerDag: o.beleid.maxTwee, minEnkeleRegeldienstenBijTwee: o.beleid.minEnkelBijTwee, maxRegelplekkenPerWeekend: o.beleid.maxWeekendPlekken,
      minDgPerDag: o.beleid.minDG, voorgaansplekkenPerDag: o.beleid.voorgangenPerDag, maxContracturen: o.beleid.maxContract,
      minRustUren: o.beleid.minRustUren, maxDienstenAchterElkaar: o.beleid.maxAchtereen, maxBeschikbaarPer28Dagen: o.beleid.maxBeschikbaarPer28,
      omHetWeekend: o.beleid.omHetWeekend, werkdagenVastDagenVooruit: o.beleid.vastDagen,
    },
  };
  return { vraag, codes };
}

/** Stabiel, zodat het gecachet kan worden. */
export function systeemPrompt(): string {
  const diensten = PALET.filter((c) => c !== '-').map((c) => {
    const d = DIENSTEN[c];
    return `- ${c}: ${d.naam}. ${d.uitleg} Uren: ${d.uren}. Regelplekken: ${d.plekken}. Voorgangen: ${d.voorgangen}.`;
  }).join('\n');
  const regels = Object.entries(REGELS).map(([id, r]) => `- ${id} (${r.niveau}, § ${r.paragraaf}): ${r.kort}`).join('\n');
  return `Je bent een ervaren roosteraar bij een uitvaartorganisatie. Je beoordeelt het rooster van één regio en stelt verbeteringen voor. Je schrijft in helder Nederlands, zonder jargon.

Doelen (de vierledige doelstelling personeelsplanning), in deze volgorde: continuïteit (het werk past, binnen ATW en CAO), efficiency (binnen de normen, niet meer dan afgesproken), medewerkerstevredenheid (ruimte voor wensen en voorkeuren, eerlijke verdeling) en klanttevredenheid (klanten binnen 24 uur helpen).

Diensten:
${diensten}

Regels die de app toetst (ATW en CAO zijn hard, nooit overtreden):
${regels}

Belangrijk uit het roosterbeleid:
- Plan precies het afgesproken aantal regelplekken per dag, niet meer en niet minder. De beschikbaarheidsdienst (1B) telt als regelplek; plan er één per dag.
- Minimaal één middag/avonddienst (1M) per dag. Uitgangspunt is één regelplek per uitvaartverzorger per dag; een 2 mag maximaal twee keer per dag en alleen als er dan nog minstens twee enkele regeldiensten (1 of 1M) staan.
- Minimaal twee Dg-diensten per dag behalve zondag, en genoeg voorgaansplekken (DG1 = 1, DG2 = 2). Een uitvaartleider (UL) doet geen regelgesprekken: alleen DG1, DG2 of overige diensten.
- Maximaal 3 regelplekken per uitvaartverzorger per weekend. Maximaal op contracturen plannen. Minimaal 12 uur rust tussen diensten.
- Vrij is vrij: binnen 28 dagen zet je een vrije dag alleen om in een dienst als het niet anders kan, en dan in overleg. Verlof (V) en ziekte (Z) verander je nooit.
- Eerst regelplekken, dan Dg-dagen (voorwaartse rotatie). Houd rekening met vaste voorkeuren (kan niet, liever niet, graag), wensen en een eerlijke verdeling van weekenden, 1B en 2-diensten.

Werkwijze:
- Je krijgt het rooster als codes per medewerker per dag, de afgesproken regelplekken per dag, wat er gepland is, en de uitkomst van de toets.
- Stel alleen wijzigingen voor die een probleem uit de toets oplossen of de tevredenheid duidelijk verbeteren, zonder een andere regel te breken. Liever weinig goede voorstellen dan veel twijfelachtige.
- Een wijziging zet één dienst voor één medewerker op één dag. Wil je ruilen, geef dan twee wijzigingen.
- Verwijs bij risico's naar de paragraaf in het roosterbeleid.
- Gebruik alleen de codes M1, M2, ... om medewerkers aan te duiden.`;
}

export function gebruikersBericht(v: AdviesVraag): string {
  return `Beoordeel het rooster van regio ${v.regio} (vandaag is ${v.vandaag}) en stel verbeteringen voor.\n\nGegevens (JSON):\n${JSON.stringify(v)}`;
}

/** De API garandeert het schema, maar we vertrouwen niets blind. */
export function isAdviesAntwoord(x: unknown): x is AdviesAntwoord {
  if (!x || typeof x !== 'object') return false;
  const a = x as AdviesAntwoord;
  return typeof a.samenvatting === 'string' && Array.isArray(a.sterk) && Array.isArray(a.risicos) && Array.isArray(a.voorstellen)
    && a.voorstellen.every((v) => typeof v.medewerker === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.datum) && v.dienst in DIENSTEN && typeof v.reden === 'string');
}
