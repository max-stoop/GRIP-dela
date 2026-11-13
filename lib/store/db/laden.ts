/** De staat uit de database lezen: alles bij het openen, of een deel na een wijziging van een collega. */
import type { AppState } from '../types';
import { addDays } from '../../dates';
import { NORM_STANDAARD, type NormParameters } from '../../capaciteit/parameters';
import { nbdParameters, type NbdParameters } from '../../nbd/parameters';
import type { Db } from './db';
import {
  leesActiviteit, leesBronStatus, leesCellen, leesCoef, leesExtern, leesGoedkeuringen, leesHandmatig, leesInstellingen, leesMedewerker, leesMeldingen,
  leesNormRegio, leesProfiel, leesPublicaties, leesRondes, leesRuil, leesRunMeta, leesSchoolvakantie, leesTijden, leesVakantieronde, leesVerdelingen, leesVerlof, leesVerschuiving, leesWens, leesZiekmelding,
  json,
} from './tabellen';
import { noteer, type Leesronde } from './versies';
import { uitDatum } from './tijd';
import type { WensTelling } from '../../rooster/wensen';
import { LOGBOEK_DAGEN, LOGBOEK_MAX } from './grenzen';

export type Deel =
  | 'instellingen' | 'normen' | 'schoolvakanties' | 'meldingen' | 'extern' | 'bronStatus' | 'handmatig' | 'coef' | 'runs'
  | 'medewerkers' | 'rooster' | 'tijden' | 'goedkeuringen' | 'publicaties' | 'profielen' | 'rondes' | 'vakantierondes'
  | 'verlof' | 'wensen' | 'ziekmeldingen' | 'ruil' | 'activiteit' | 'verdelingen' | 'verschuivingen';

const DELEN: Deel[] = ['instellingen', 'normen', 'schoolvakanties', 'meldingen', 'extern', 'bronStatus', 'handmatig', 'coef', 'runs', 'medewerkers', 'rooster', 'tijden', 'goedkeuringen', 'publicaties', 'profielen', 'rondes', 'vakantierondes', 'verlof', 'wensen', 'ziekmeldingen', 'ruil', 'activiteit', 'verdelingen', 'verschuivingen'];

export const DEEL_VAN_TABEL: Record<string, Deel[]> = {
  rp_instelling: ['instellingen', 'normen', 'runs'], rp_norm_regio: ['normen'], rp_schoolvakantie: ['schoolvakanties'], rp_meldingen: ['meldingen'], rp_extern: ['extern'],
  rp_bron_status: ['bronStatus'], rp_handmatig: ['handmatig'], rp_coef: ['coef'], rp_run: ['runs'], rp_medewerker: ['medewerkers'], rp_rooster: ['rooster'],
  rp_tijd: ['tijden'], rp_goedkeuring: ['goedkeuringen'], rp_goedkeuring_stap: ['goedkeuringen'], rp_publicatie: ['publicaties'], rp_rooster_gepubliceerd: ['publicaties', 'tijden'],
  rp_voorkeurprofiel: ['profielen'], rp_voorkeurronde: ['rondes'], rp_voorkeurronde_ingediend: ['rondes'], rp_vakantieronde: ['vakantierondes'], rp_verlof: ['verlof'],
  rp_wens: ['wensen'], rp_ziekmelding: ['ziekmeldingen'], rp_ruil: ['ruil'], rp_activiteit: ['activiteit'], rp_verdeling: ['verdelingen'],
  rp_verschuiving: ['verschuivingen'],
};

/** Dit kalenderjaar (weekenden per jaar) en minstens vijf weken terug (28-dagenregels). */
function roosterVanaf(vandaag: string): string {
  const jaar = `${vandaag.slice(0, 4)}-01-01`, terug = addDays(vandaag, -35);
  return jaar < terug ? jaar : terug;
}

type Lezer = (db: Db, vandaag: string) => Promise<Partial<AppState>>;

const LEZERS: Record<Deel, Lezer> = {
  instellingen: async (db) => {
    const i = leesInstellingen(await db.lees('rp_instelling', { orde: ['sleutel'] }));
    const uit: Partial<AppState> = { roosterbasis: (i.roosterbasis as AppState['roosterbasis']) ?? null, normaal: (i.normaal as number[]) ?? null, backtest: (i.backtest as AppState['backtest']) ?? null, laatsteAuto: (i.laatsteAuto as string) ?? null, dagtaak: (i.dagtaak as AppState['dagtaak']) ?? null };
    // het beleid alleen als het is opgeslagen; anders blijft het standaardbeleid staan (vulAan vult aan)
    if (i.beleid) uit.beleid = i.beleid as AppState['beleid'];
    if (i.nbd) uit.nbd = nbdParameters(i.nbd as Partial<NbdParameters>);
    return uit;
  },
  normen: async (db) => {
    const [inst, regios] = await Promise.all([db.lees('rp_instelling', { filters: [{ kolom: 'sleutel', op: 'eq', waarde: 'normen' }] }), db.lees('rp_norm_regio', { orde: ['regio'] })]);
    const landelijk = (leesInstellingen(inst).normen ?? {}) as Partial<NormParameters>;
    return { normen: { ...NORM_STANDAARD, ...landelijk, regios: { ...NORM_STANDAARD.regios, ...Object.fromEntries(regios.map((r) => [String(r.regio), leesNormRegio(r)])) } } };
  },
  schoolvakanties: async (db) => {
    const r = await db.lees('rp_schoolvakantie', { orde: ['id'] });
    // leeg: vulAan vult de standaard schoolvakanties aan
    return r.length ? { schoolvakanties: r.map(leesSchoolvakantie) } : {};
  },
  meldingen: async (db) => ({ meldingen: leesMeldingen(await db.rpc('rp_meldingen_per_regio', {}, ['regio'])) }),
  extern: async (db) => ({ extern: leesExtern(await db.lees('rp_extern', { kolommen: 'bron, data', orde: ['bron'] })) }),
  bronStatus: async (db) => ({ bronStatus: leesBronStatus(await db.lees('rp_bron_status', { orde: ['bron'] })) }),
  handmatig: async (db) => ({ handmatig: leesHandmatig(await db.lees('rp_handmatig', { orde: ['variabele', 'datum'] })) }),
  coef: async (db) => ({ coef: leesCoef(await db.lees('rp_coef', { orde: ['naam'] })) }),
  // de voorspellingen zelf (kolom data) pas als ze nodig zijn: getRun
  runs: async (db) => {
    const kolommen = 'id, soort, uitgegeven, gemaakt, info';
    const [lijst, inst] = await Promise.all([
      db.lees('rp_run', { kolommen, orde: ['uitgegeven', 'gemaakt'], aflopend: true, limiet: 60 }),
      db.lees('rp_instelling', { filters: [{ kolom: 'sleutel', op: 'eq', waarde: 'roosterbasis' }] }),
    ]);
    const runs = lijst.map(leesRunMeta);
    // de roosterbasis blijft bewaard, ook als die ouder is dan de laatste 60 voorspellingen
    const basis = (leesInstellingen(inst).roosterbasis as { runId?: string } | null)?.runId;
    if (basis && !runs.some((r) => r.id === basis)) runs.push(...(await db.lees('rp_run', { kolommen, filters: [{ kolom: 'id', op: 'eq', waarde: basis }] })).map(leesRunMeta));
    return { runs };
  },
  medewerkers: async (db) => {
    const eigen = (await db.lees('rp_medewerker', { orde: ['id'] })).map(leesMedewerker);
    // een medewerker leest alleen de eigen regel; de collega's (zonder e-mailadres) komen uit rp_collegas(). Wie plant,
    // leest het hele team uit de tabel (en krijgt uit de functie niets), dus die vragen we het niet.
    const collegas = eigen.length <= 1 ? (await db.rpc('rp_collegas', {}, ['id'])).map((r) => ({ ...leesMedewerker(r), collega: true })) : [];
    const al = new Set(eigen.map((m) => m.id));
    return { medewerkers: [...eigen, ...collegas.filter((m) => !al.has(m.id))] };
  },
  rooster: async (db, vandaag) => {
    const van = roosterVanaf(vandaag);
    const rijen = await db.rpc('rp_rooster_versies_vanaf', { van }, ['medewerker_id', 'regio']);
    db.noteer?.('rp_rooster', [{ kolom: 'datum', op: 'gte', waarde: van }], rijen.flatMap((r) => Object.entries(json<Record<string, number>>(r.versies) ?? {}).map(([datum, v]) => ({ medewerker_id: r.medewerker_id, datum, rij_versie: v }))));
    return { rooster: leesCellen(rijen) };
  },
  tijden: async (db, vandaag) => ({ tijden: leesTijden(await db.lees('rp_tijd', { filters: [{ kolom: 'datum', op: 'gte', waarde: roosterVanaf(vandaag) }], orde: ['medewerker_id', 'datum'] })) }),
  goedkeuringen: async (db) => {
    const [g, s] = await Promise.all([db.lees('rp_goedkeuring', { orde: ['regio', 'maand'] }), db.lees('rp_goedkeuring_stap', { orde: ['id'] })]);
    return { goedkeuringen: leesGoedkeuringen(g, s) };
  },
  publicaties: async (db, vandaag) => {
    const [p, c] = await Promise.all([db.lees('rp_publicatie', { orde: ['regio'] }), db.rpc('rp_gepubliceerd_vanaf', { van: roosterVanaf(vandaag) }, ['medewerker_id', 'regio'])]);
    return { publicaties: leesPublicaties(p, leesCellen(c)) };
  },
  profielen: async (db) => ({ profielen: Object.fromEntries((await db.lees('rp_voorkeurprofiel', { orde: ['medewerker_id'] })).map((r) => [String(r.medewerker_id), leesProfiel(r)])) }),
  rondes: async (db) => {
    const [r, i] = await Promise.all([db.lees('rp_voorkeurronde', { orde: ['geopend'], aflopend: true }), db.lees('rp_voorkeurronde_ingediend', { orde: ['ronde_id', 'medewerker_id'] })]);
    return { rondes: leesRondes(r, i) };
  },
  vakantierondes: async (db) => ({ vakantierondes: (await db.lees('rp_vakantieronde', { orde: ['gemaakt'], aflopend: true })).map(leesVakantieronde) }),
  // verlof van vorig jaar en verder: de jaarplanning kijkt een jaar terug (zomervakantie vorig jaar)
  verlof: async (db, vandaag) => {
    const eigen = (await db.lees('rp_verlof', { filters: [{ kolom: 'tot', op: 'gte', waarde: `${Number(vandaag.slice(0, 4)) - 1}-01-01` }], orde: ['id'] })).map(leesVerlof);
    // een medewerker leest alleen het eigen verlof; van collega's alleen wie en wanneer (verlofruimte, verlof ruilen)
    const team = (await db.rpc('rp_verlof_team', {}, ['id'])).filter((r) => r.regio && r.status).map((r) => leesVerlof({ ...r, soort: 'vakantie', aangevraagd: null }));
    const al = new Set(eigen.map((v) => v.id));
    return { verlof: [...eigen, ...team.filter((v) => !al.has(v.id))] };
  },
  // de eigen wensen (wie plant: die van de regio); van de collega's in de eigen regio alleen de aantallen per dag
  wensen: async (db, vandaag) => {
    const [eigen, team] = await Promise.all([
      db.lees('rp_wens', { filters: [{ kolom: 'datum', op: 'gte', waarde: addDays(vandaag, -60) }], orde: ['id'] }),
      db.rpc('rp_wensen_team', {}, ['datum']),
    ]);
    const wensenTeam: Record<string, WensTelling> = {};
    for (const r of team) {
      const d = uitDatum(r.datum);
      if (d) wensenTeam[d] = { werken: Number(r.werken) || 0, vrij: Number(r.vrij) || 0, neutraal: Number(r.neutraal) || 0, overig: Number(r.overig) || 0 };
    }
    return { wensen: eigen.map(leesWens), wensenTeam };
  },
  ziekmeldingen: async (db, vandaag) => {
    const [lopend, recent] = await Promise.all([
      db.lees('rp_ziekmelding', { filters: [{ kolom: 'status', op: 'eq', waarde: 'ziek' }], orde: ['id'] }),
      db.lees('rp_ziekmelding', { filters: [{ kolom: 'van', op: 'gte', waarde: addDays(vandaag, -400) }], orde: ['id'] }),
    ]);
    return { ziekmeldingen: [...new Map([...lopend, ...recent].map((r) => [String(r.id), leesZiekmelding(r)])).values()] };
  },
  // afspraken die nog lopen of nog komen, en die van het afgelopen jaar (terugkijken in het rooster)
  verschuivingen: async (db, vandaag) => ({ verschuivingen: (await db.lees('rp_verschuiving', { filters: [{ kolom: 'tot', op: 'gte', waarde: addDays(vandaag, -400) }], orde: ['van'] })).map(leesVerschuiving) }),
  ruil: async (db, vandaag) => ({ ruil: (await db.lees('rp_ruil', { filters: [{ kolom: 'gemaakt', op: 'gte', waarde: addDays(vandaag, -400) }], orde: ['gemaakt'], aflopend: true })).map(leesRuil) }),
  // de verdelingen van de afgelopen drie weken (voor de werkdruk) en wat er al klaarstaat
  verdelingen: async (db, vandaag) => ({ verdelingen: leesVerdelingen(await db.lees('rp_verdeling', { filters: [{ kolom: 'datum', op: 'gte', waarde: addDays(vandaag, -21) }], orde: ['datum'] })) }),
  activiteit: async (db, vandaag) => ({
    activiteit: (await db.lees('rp_activiteit', { filters: [{ kolom: 'moment', op: 'gte', waarde: addDays(vandaag, -LOGBOEK_DAGEN) }], orde: ['moment'], aflopend: true, limiet: LOGBOEK_MAX })).map(leesActiviteit),
  }),
};

export const DEEL_NAAM: Record<Deel, string> = {
  instellingen: 'de instellingen', normen: 'de vastgestelde regelplekken', schoolvakanties: 'de schoolvakanties', meldingen: 'de meldingen',
  extern: 'de externe bronnen (weer, griep, sterfte)', bronStatus: 'de status van de bronnen', handmatig: 'de eigen invoer bij de bronnen', coef: 'het model',
  runs: 'de voorspellingen', medewerkers: 'de teams', rooster: 'het rooster', tijden: 'de diensttijden', goedkeuringen: 'de vaststellingen',
  publicaties: 'de publicaties', profielen: 'de voorkeuren', rondes: 'de voorkeurenrondes', vakantierondes: 'de vakantierondes', verlof: 'het verlof',
  wensen: 'de wensen', ziekmeldingen: 'de ziekmeldingen', ruil: 'de ruilen', activiteit: 'het logboek', verdelingen: 'de verdeling van de meldingen',
  verschuivingen: 'de verschoven regelplekken',
};

export interface LeesFout { deel: Deel; fout: string }

interface Gelezen {
  staat: Partial<AppState>;
  mislukt: LeesFout[];
  /** Per gelukt deel de onderdelen van de staat en de versies van de gelezen rijen. */
  perDeel: Partial<Record<Deel, { sleutels: string[]; ronde: Leesronde }>>;
}

/** Elk deel apart, met één nieuwe poging bij een fout. Lukt een deel niet, dan staat de rest er toch. */
export async function laadDelenVeilig(db: Db, vandaag: string, delen: Deel[] = DELEN, wacht = 700): Promise<Gelezen> {
  const uit = await Promise.all(delen.map(async (deel): Promise<{ deel: Deel; staat?: Partial<AppState>; ronde?: Leesronde; fout?: LeesFout }> => {
    for (let poging = 0; ; poging++) {
      const ronde: Leesronde = new Map();
      const meet: Db = {
        ...db,
        lees: async (tabel, o) => { const r = await db.lees(tabel, o); noteer(ronde, tabel, o?.filters ?? [], r); return r; },
        noteer: (tabel, filters, rijen) => noteer(ronde, tabel, filters, rijen),
      };
      try {
        return { deel, staat: await LEZERS[deel](meet, vandaag), ronde };
      } catch (e) {
        if (poging >= 1) return { deel, fout: { deel, fout: e instanceof Error ? e.message : String(e) } };
        await new Promise((r) => setTimeout(r, wacht));
      }
    }
  }));
  return {
    staat: Object.assign({}, ...uit.map((x) => x.staat ?? {})),
    mislukt: uit.flatMap((x) => (x.fout ? [x.fout] : [])),
    perDeel: Object.fromEntries(uit.filter((x) => x.staat).map((x) => [x.deel, { sleutels: Object.keys(x.staat!), ronde: x.ronde! }])),
  };
}
