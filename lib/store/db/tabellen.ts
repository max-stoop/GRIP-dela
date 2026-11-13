/** Van de staat naar de tabellen in de database en terug. Een stuk dat niet veranderde (zelfde object), wordt niet vergeleken. */
import type { Activiteit, AppState, BronStatus, Coef, Goedkeuring, GoedkeuringStap, Publicatie, Ruil, Vakantieronde, Verlof, Verschuiving, Ziekmelding } from '../types';
import { TAAK_SOORTEN, weekendCadans, type Cellen, type DienstCode, type Medewerker, type Taak, type Tijden, type Voorkeurprofiel, type Voorkeurronde, type Wens } from '../../rooster/types';
import type { HandmatigRij, MeldingenData, RunMeta } from '../../model/types';
import type { NormParameters, NormRegio } from '../../capaciteit/parameters';
import type { Schoolvakantie } from '../../capaciteit/verlof';
import type { FactorKey } from '../../model/config';
import { addDays, diffDays } from '../../dates';
import { naarTijdstip, uitDatum, uitTijdstip } from './tijd';
import { NBD } from '../../nbd/parameters';
import { geldigeUren } from '../../nbd/voorkeuren';
import type { DagVerdeling } from '../../verdeling/dag';

export type Rij = Record<string, unknown>;

/**
 * insert-update: nieuwe rijen invoegen en bestaande bijwerken met alleen wat veranderde, waar de RLS voor invoegen
 * strenger is dan voor wijzigen. upsert-planner: upsert voor planners, insert-update voor medewerkers.
 */
export type Schrijfwijze = 'upsert' | 'insert-update' | 'upsert-planner' | 'alleen-insert';

export interface TabelDef {
  naam: string;
  sleutel: string[];
  wijze: Schrijfwijze;
  stukken(s: AppState): Record<string, unknown>;
  rijen(stuk: unknown, naam: string): Rij[];
}

const n = <T>(x: T | undefined): T | null => (x === undefined ? null : x);
const alle = (x: unknown) => ({ alle: x });

function cellenRijen(c: unknown, regio: string): Rij[] {
  const uit: Rij[] = [];
  for (const [mid, rij] of Object.entries((c ?? {}) as Cellen)) {
    for (const [datum, dienst] of Object.entries(rij)) if (dienst && dienst !== '-') uit.push({ medewerker_id: mid, datum, regio, dienst });
  }
  return uit;
}

const medewerkerRij = (m: Medewerker): Rij => ({
  id: m.id, regio: m.regio, naam: m.naam, contract: m.contract, voorkeur: m.voorkeur, weekendgroep: m.weekendgroep, weekend_cadans: weekendCadans(m),
  functie: m.functie ?? 'UV', afstandsverklaring: !!m.afstandsverklaring, extern: !!m.extern, email: m.email || null, actief: m.actief,
  volgorde: m.volgorde ?? null,
  postcode: m.postcode || null,
  // de maximale inzet alleen bij de NBD; leeg = het contract
  ...(m.regio === NBD ? { max_uren: m.maxUren != null && m.maxUren > m.contract ? Math.min(60, m.maxUren) : null } : {}),
});

const goedkeuringRij = (g: Goedkeuring): Rij => ({
  regio: g.regio, maand: g.maand, status: g.status, versie: g.versie, cijfer: Math.round(g.cijfer * 10) / 10, hard: g.hard,
  aangevraagd: naarTijdstip(g.aangevraagd), door: g.door, beoordeeld: naarTijdstip(g.beoordeeld), beoordeelaar: n(g.beoordeelaar), reden: n(g.reden),
  advies: g.advies?.kleur ?? null, advies_toelichting: n(g.advies?.toelichting), advies_voorstel: n(g.advies?.voorstel),
  advies_door: g.advies?.door ?? g.door, advies_op: naarTijdstip(g.advies?.op ?? g.aangevraagd),
});

const verlofRij = (v: Verlof): Rij => ({
  id: v.id, medewerker_id: v.medewerkerId, regio: v.regio, van: v.van, tot: v.tot, soort: v.soort, opmerking: n(v.opmerking), status: v.status,
  aangevraagd: naarTijdstip(v.aangevraagd), beoordeeld: naarTijdstip(v.beoordeeld), beoordeelaar: n(v.beoordeelaar), reden: n(v.reden),
  vervangen: n(v.vervangen), ronde_id: n(v.rondeId),
});

const ruilRij = (r: Ruil): Rij => ({
  id: r.id, regio: r.regio, soort: r.soort, aanbieder_id: r.aanbiederId, datum: r.datum, dienst: r.dienst, ontvanger_id: n(r.ontvangerId),
  tegen_datum: n(r.tegenDatum), tegen_dienst: n(r.tegenDienst), verlof_id: n(r.verlofId), tegen_verlof_id: n(r.tegenVerlofId), tot: n(r.tot), tegen_tot: n(r.tegenTot),
  opmerking: n(r.opmerking), status: r.status, gemaakt: naarTijdstip(r.gemaakt), geaccepteerd: naarTijdstip(r.geaccepteerd), beoordeeld: naarTijdstip(r.beoordeeld),
  beoordeelaar: n(r.beoordeelaar), reden: n(r.reden), toets: n(r.toets),
});

/** Alles behalve de regio's, in rp_instelling 'normen'. */
const landelijk = (p: NormParameters) => {
  const { regios: _r, ...rest } = p;
  return rest;
};

/** Per object steeds dezelfde stukken, zodat er niets opnieuw vergeleken wordt. */
const meldingStukken = new WeakMap<MeldingenData, Record<string, { start: string; waarden: (number | null)[] }>>();
function meldingenInStukken(m: MeldingenData | null): Record<string, unknown> {
  if (!m) return {};
  let st = meldingStukken.get(m);
  if (!st) {
    st = Object.fromEntries(Object.entries(m.regios).map(([r, w]) => [r, { start: m.start, waarden: w }]));
    meldingStukken.set(m, st);
  }
  return st;
}

/** Per bronobject bewaard, zodat ongewijzigd ook gelijk blijft. */
function afgeleid<A extends object, B>(f: (a: A) => B): (a: A) => B {
  const c = new WeakMap<A, B>();
  return (a) => {
    let v = c.get(a);
    if (v === undefined) { v = f(a); c.set(a, v); }
    return v;
  };
}
const pubCellen = afgeleid((p: Record<string, Publicatie>) => Object.fromEntries(Object.entries(p).map(([r, x]) => [r, x.cellen])));
const instellingen = afgeleid((s: AppState) => ({ beleid: s.beleid, roosterbasis: s.roosterbasis, normaal: s.normaal, backtest: s.backtest, laatsteAuto: s.laatsteAuto, normen: s.normen, nbd: s.nbd, dagtaak: s.dagtaak }));

export const TABELLEN: TabelDef[] = [
  {
    naam: 'rp_instelling', sleutel: ['sleutel'], wijze: 'upsert',
    stukken: (s) => instellingen(s),
    rijen: (x, sleutel) => (x == null ? [] : [{ sleutel, waarde: sleutel === 'normen' ? landelijk(x as NormParameters) : x }]),
  },
  {
    naam: 'rp_norm_regio', sleutel: ['regio'], wijze: 'upsert',
    stukken: (s) => alle(s.normen.regios),
    rijen: (x) => Object.entries(x as Record<string, NormRegio>).map(([regio, r]) => ({
      regio, cluster: r.cluster, natura: r.natura, cbs: r.cbs, vrije_markt: r.vrijeMarkt, amplitude: r.amplitude, voorgangen: r.voorgangen, fte: r.fte, correctie: r.correctie,
    })),
  },
  {
    naam: 'rp_schoolvakantie', sleutel: ['id'], wijze: 'upsert',
    stukken: (s) => alle(s.schoolvakanties),
    rijen: (x) => (x as Schoolvakantie[]).map((v) => ({ id: v.id, naam: v.naam, regio: v.regio, van: v.van, tot: v.tot, bron: v.bron })),
  },
  {
    naam: 'rp_meldingen', sleutel: ['datum', 'regio'], wijze: 'upsert',
    stukken: (s) => meldingenInStukken(s.meldingen),
    rijen: (x, regio) => {
      const { start, waarden } = x as { start: string; waarden: (number | null)[] };
      const uit: Rij[] = [];
      waarden.forEach((a, i) => { if (a != null) uit.push({ datum: addDays(start, i), regio, aantal: a }); });
      return uit;
    },
  },
  {
    naam: 'rp_extern', sleutel: ['bron'], wijze: 'upsert',
    stukken: (s) => s.extern,
    rijen: (x, bron) => [{ bron, data: x }],
  },
  {
    naam: 'rp_bron_status', sleutel: ['bron'], wijze: 'upsert',
    stukken: (s) => alle(s.bronStatus),
    rijen: (x) => Object.values(x as Record<string, BronStatus>).map((b) => ({ bron: b.bron, opgehaald: naarTijdstip(b.opgehaald), ok: b.ok, melding: b.melding, rijen: b.rijen })),
  },
  {
    naam: 'rp_handmatig', sleutel: ['variabele', 'datum'], wijze: 'upsert',
    stukken: (s) => alle(s.handmatig),
    rijen: (x) => (x as HandmatigRij[]).map((h) => ({ variabele: h.variabele, datum: h.datum, waarde: h.waarde })),
  },
  {
    naam: 'rp_coef', sleutel: ['naam'], wijze: 'upsert',
    stukken: (s) => alle(s.coef),
    rijen: (x) => Object.entries(x as Partial<Record<FactorKey, Coef>>).filter(([, c]) => !!c).map(([naam, c]) => ({
      naam, waarde: c!.waarde, se: c!.se, dagen: c!.dagen, bijgewerkt: naarTijdstip(c!.bijgewerkt),
    })),
  },
  {
    // de voorspelling zelf (kolom data) voegt de schrijver toe bij het invoegen; die staat niet in de staat
    naam: 'rp_run', sleutel: ['id'], wijze: 'insert-update',
    stukken: (s) => alle(s.runs),
    rijen: (x) => (x as RunMeta[]).map((m) => ({ id: m.id, soort: m.soort, uitgegeven: m.uitgegeven, gemaakt: naarTijdstip(m.gemaakt), info: m.info })),
  },
  {
    naam: 'rp_verdeling', sleutel: ['datum'], wijze: 'upsert',
    stukken: (s) => s.verdelingen,
    rijen: (x, datum) => [{ datum, data: x }],
  },
  {
    naam: 'rp_medewerker', sleutel: ['id'], wijze: 'upsert',
    stukken: (s) => alle(s.medewerkers),
    rijen: (x) => (x as Medewerker[]).map(medewerkerRij),
  },
  {
    naam: 'rp_vakantieronde', sleutel: ['id'], wijze: 'upsert',
    stukken: (s) => alle(s.vakantierondes),
    rijen: (x) => (x as Vakantieronde[]).map((v) => ({
      id: v.id, naam: v.naam, cluster: v.cluster, van: v.van, tot: v.tot,
      datum_aanvragen: v.data.aanvragen, datum_analyse: v.data.analyse, datum_advies: v.data.advies, datum_gesprek: v.data.gesprek, datum_besluit: v.data.besluit,
      fase: v.fase, gemaakt: naarTijdstip(v.gemaakt), door: v.door,
    })),
  },
  {
    naam: 'rp_voorkeurronde', sleutel: ['id'], wijze: 'upsert',
    stukken: (s) => alle(s.rondes),
    rijen: (x) => (x as Voorkeurronde[]).map((r) => ({ id: r.id, regio: r.regio, van: r.van, tot: r.tot, deadline: r.deadline, status: r.status, geopend: naarTijdstip(r.geopend), door: r.door })),
  },
  {
    naam: 'rp_verlof', sleutel: ['id'], wijze: 'upsert-planner',
    stukken: (s) => alle(s.verlof),
    rijen: (x) => (x as Verlof[]).map(verlofRij),
  },
  {
    naam: 'rp_rooster', sleutel: ['medewerker_id', 'datum'], wijze: 'upsert',
    stukken: (s) => s.rooster,
    rijen: cellenRijen,
  },
  {
    naam: 'rp_tijd', sleutel: ['medewerker_id', 'datum'], wijze: 'upsert',
    stukken: (s) => s.tijden,
    rijen: (x, regio) => {
      const uit: Rij[] = [];
      for (const [mid, rij] of Object.entries((x ?? {}) as Tijden)) {
        // de pauze en de taken alleen bij de NBD; de regio's hebben die niet
        for (const [datum, t] of Object.entries(rij)) uit.push({ medewerker_id: mid, datum, regio, dienst: t.code ?? '', begin_uur: t.start, eind_uur: t.eind, ...(regio === NBD ? { pauze_min: t.pauze ?? 0, pauze_begin: t.pauze ? t.pauzeStart ?? null : null, taken: t.taken?.length ? t.taken : null } : {}) });
      }
      return uit;
    },
  },
  {
    naam: 'rp_goedkeuring', sleutel: ['regio', 'maand'], wijze: 'insert-update',
    stukken: (s) => s.goedkeuringen,
    rijen: (x) => Object.values((x ?? {}) as Record<string, Goedkeuring>).filter((g) => !!g.advies).map(goedkeuringRij),
  },
  {
    naam: 'rp_publicatie', sleutel: ['regio'], wijze: 'upsert',
    stukken: (s) => s.publicaties,
    rijen: (x) => {
      const p = x as Publicatie;
      return [{ regio: p.regio, op: naarTijdstip(p.op), door: p.door, van: p.van, tot: p.tot, vorige: p.vorige ? { op: p.vorige.op, cellen: p.vorige.cellen } : null }];
    },
  },
  {
    naam: 'rp_rooster_gepubliceerd', sleutel: ['medewerker_id', 'datum'], wijze: 'upsert',
    stukken: (s) => pubCellen(s.publicaties),
    rijen: cellenRijen,
  },
  {
    naam: 'rp_voorkeurprofiel', sleutel: ['medewerker_id'], wijze: 'upsert',
    stukken: (s) => alle(s.profielen),
    rijen: (x) => Object.values(x as Record<string, Voorkeurprofiel>).map((p) => {
      const bijgewerkt = naarTijdstip(p.bijgewerkt);
      return {
        medewerker_id: p.medewerkerId, dagen: p.dagen, dienst: p.dienst, beschikbaarheid: p.beschikbaarheid, max_dagen_per_week: p.maxDagenPerWeek, opmerking: n(p.opmerking), twee: p.twee ?? 'neutraal',
        korte_dagen: p.korteDagen ?? 'neutraal', weekend: n(p.weekend), weekend_plekken: p.weekendPlekken ?? null,
        ...(p.uren ? { uren: p.uren } : {}), ...(bijgewerkt ? { bijgewerkt } : {}),
      };
    }),
  },
  {
    naam: 'rp_voorkeurronde_ingediend', sleutel: ['ronde_id', 'medewerker_id'], wijze: 'upsert',
    stukken: (s) => alle(s.rondes),
    rijen: (x) => (x as Voorkeurronde[]).flatMap((r) => Object.entries(r.ingediend).map(([mid, op]) => ({ ronde_id: r.id, medewerker_id: mid, ingediend: naarTijdstip(op) }))),
  },
  {
    naam: 'rp_wens', sleutel: ['id'], wijze: 'upsert',
    stukken: (s) => alle(s.wensen),
    rijen: (x) => (x as Wens[]).map((w) => ({ id: w.id, medewerker_id: w.medewerkerId, regio: w.regio, datum: w.datum, soort: w.soort, opmerking: n(w.opmerking), gemaakt: naarTijdstip(w.gemaakt) })),
  },
  {
    naam: 'rp_verschuiving', sleutel: ['id'], wijze: 'upsert',
    stukken: (s) => alle(s.verschuivingen),
    rijen: (x) => (x as Verschuiving[]).map((v) => ({
      id: v.id, van_regio: v.vanRegio, naar_regio: v.naarRegio, van: v.van, tot: v.tot, plekken: v.plekken, opmerking: n(v.opmerking), door: v.door, gemaakt: naarTijdstip(v.gemaakt),
    })),
  },
  {
    naam: 'rp_ziekmelding', sleutel: ['id'], wijze: 'upsert',
    stukken: (s) => alle(s.ziekmeldingen),
    rijen: (x) => (x as Ziekmelding[]).map((z) => ({
      id: z.id, medewerker_id: z.medewerkerId, regio: z.regio, van: z.van, tot: n(z.tot), gemeld: naarTijdstip(z.gemeld), door: z.door,
      vervangen: z.vervangen ?? {}, voor: z.voor ?? {}, status: z.status,
    })),
  },
  {
    naam: 'rp_ruil', sleutel: ['id'], wijze: 'upsert-planner',
    stukken: (s) => alle(s.ruil),
    rijen: (x) => (x as Ruil[]).map(ruilRij),
  },
  {
    // het logboek groeit alleen; oude regels ruimt de database op (zie rp_activiteit in het schema)
    naam: 'rp_activiteit', sleutel: ['id'], wijze: 'alleen-insert',
    stukken: (s) => alle(s.activiteit),
    rijen: (x) => (x as Activiteit[]).map((a) => ({
      id: a.id, moment: naarTijdstip(a.moment), soort: a.soort, tekst: a.tekst, regio: n(a.regio), voor: n(a.voor), regio_breed: !!a.regioBreed, door: n(a.door),
    })),
  },
];

/** Eerst waar andere tabellen naar verwijzen; weghalen gaat andersom. */
export const VOLGORDE = TABELLEN.map((t) => t.naam);

const num = (x: unknown) => Number(x);
/** De database geeft jsonb al als waarde terug. */
export const json = <T>(x: unknown): T => x as T;

/** Wat niet klopt, valt weg. */
export function leesVerdelingen(rijen: Rij[]): Record<string, DagVerdeling> {
  const uit: Record<string, DagVerdeling> = {};
  for (const r of rijen) {
    const datum = String(r.datum).slice(0, 10);
    const d = json<Partial<DagVerdeling> | null>(r.data);
    if (!d || typeof d !== 'object') continue;
    const meldingen = (Array.isArray(d.meldingen) ? d.meldingen : []).filter((m) => m && typeof m.id === 'string' && typeof m.postcode === 'string' && typeof m.regio === 'string');
    const toewijzingen = (Array.isArray(d.toewijzingen) ? d.toewijzingen : []).filter((t) => t && typeof t.meldingId === 'string' && typeof t.persoonId === 'string' && typeof t.slotId === 'string');
    uit[datum] = { datum, meldingen, toewijzingen, ...(typeof d.verdeeld === 'string' ? { verdeeld: d.verdeeld } : {}), ...(typeof d.door === 'string' ? { door: d.door } : {}) };
  }
  return uit;
}

export function leesMedewerker(r: Rij): Medewerker {
  return {
    id: String(r.id), regio: String(r.regio), naam: String(r.naam), contract: num(r.contract), voorkeur: (r.voorkeur === 'M' ? 'M' : 'O'),
    weekendgroep: Math.max(0, Math.min(3, Math.round(num(r.weekendgroep)) || 0)), ...(r.weekend_cadans != null && weekendCadans({ weekendCadans: num(r.weekend_cadans) }) !== 2 ? { weekendCadans: weekendCadans({ weekendCadans: num(r.weekend_cadans) }) } : {}), functie: r.functie === 'UL' ? 'UL' : 'UV',
    ...(r.afstandsverklaring ? { afstandsverklaring: true } : {}), ...(r.extern ? { extern: true } : {}), ...(r.email ? { email: String(r.email) } : {}),
    ...(r.max_uren != null && num(r.max_uren) > 0 ? { maxUren: num(r.max_uren) } : {}),
    ...(r.volgorde != null && num(r.volgorde) > 0 ? { volgorde: num(r.volgorde) } : {}),
    ...(typeof r.postcode === 'string' && /^[1-9]\d{3}$/.test(r.postcode) ? { postcode: r.postcode } : {}),
    actief: r.actief !== false,
  };
}

/** Uit rp_rooster_versies_vanaf en rp_gepubliceerd_vanaf. */
export function leesCellen(rijen: Rij[]): Record<string, Cellen> {
  const uit: Record<string, Cellen> = {};
  for (const r of rijen) {
    const regio = String(r.regio), mid = String(r.medewerker_id);
    const cellen = json<Record<string, DienstCode>>(r.cellen);
    (uit[regio] ??= {})[mid] = { ...(uit[regio][mid] ?? {}), ...cellen };
  }
  return uit;
}

const SOORTEN = new Set<string>(TAAK_SOORTEN);

/** Alleen geldige blokken. */
function leesTaken(x: unknown): Taak[] {
  if (!Array.isArray(x)) return [];
  return x.filter((k): k is Taak => !!k && typeof k === 'object' && SOORTEN.has(String((k as Taak).soort)) && Number.isFinite(Number((k as Taak).van)) && Number.isFinite(Number((k as Taak).tot)) && Number((k as Taak).tot) > Number((k as Taak).van))
    .map((k) => ({ soort: k.soort, van: Number(k.van), tot: Number(k.tot) }));
}

export function leesTijden(rijen: Rij[]): Record<string, Tijden> {
  const uit: Record<string, Tijden> = {};
  for (const r of rijen) {
    const regio = String(r.regio), mid = String(r.medewerker_id);
    const code = r.dienst ? (String(r.dienst) as DienstCode) : undefined;
    const pauze = r.pauze_min != null ? num(r.pauze_min) : 0;
    const taken = leesTaken(r.taken);
    ((uit[regio] ??= {})[mid] ??= {})[uitDatum(r.datum)!] = {
      start: num(r.begin_uur), eind: num(r.eind_uur), ...(code ? { code } : {}),
      ...(pauze > 0 ? { pauze, ...(r.pauze_begin != null ? { pauzeStart: num(r.pauze_begin) } : {}) } : {}),
      ...(taken.length ? { taken } : {}),
    };
  }
  return uit;
}

export function leesGoedkeuringen(rijen: Rij[], stappen: Rij[]): AppState['goedkeuringen'] {
  const uit: AppState['goedkeuringen'] = {};
  const per = new Map<string, GoedkeuringStap[]>();
  for (const s of stappen) {
    const k = `${s.regio}|${s.maand}`;
    const stap: GoedkeuringStap = { soort: s.soort as GoedkeuringStap['soort'], op: uitTijdstip(s.op) ?? '', door: String(s.door) };
    if (s.kleur) stap.kleur = s.kleur as GoedkeuringStap['kleur'];
    if (s.toelichting) stap.toelichting = String(s.toelichting);
    if (s.cijfer != null) stap.cijfer = num(s.cijfer);
    if (s.reden) stap.reden = String(s.reden);
    per.set(k, [...(per.get(k) ?? []), stap]);
  }
  for (const r of rijen) {
    const regio = String(r.regio), maand = String(r.maand);
    const g: Goedkeuring = {
      regio, maand, status: r.status as Goedkeuring['status'], versie: String(r.versie), cijfer: num(r.cijfer), hard: num(r.hard),
      aangevraagd: uitTijdstip(r.aangevraagd) ?? '', door: String(r.door),
      advies: {
        kleur: r.advies as NonNullable<Goedkeuring['advies']>['kleur'], door: String(r.advies_door), op: uitTijdstip(r.advies_op) ?? '',
        ...(r.advies_toelichting ? { toelichting: String(r.advies_toelichting) } : {}), ...(r.advies_voorstel ? { voorstel: r.advies_voorstel as NonNullable<Goedkeuring['advies']>['kleur'] } : {}),
      },
      geschiedenis: per.get(`${regio}|${maand}`) ?? [],
    };
    if (r.beoordeeld) g.beoordeeld = uitTijdstip(r.beoordeeld);
    if (r.beoordeelaar) g.beoordeelaar = String(r.beoordeelaar);
    if (r.reden) g.reden = String(r.reden);
    (uit[regio] ??= {})[maand] = g;
  }
  return uit;
}

export function leesPublicaties(rijen: Rij[], cellen: Record<string, Cellen>): Record<string, Publicatie> {
  const uit: Record<string, Publicatie> = {};
  for (const r of rijen) {
    const regio = String(r.regio);
    const vorige = r.vorige ? json<{ op: string; cellen: Cellen }>(r.vorige) : null;
    uit[regio] = { regio, op: uitTijdstip(r.op) ?? '', door: String(r.door), van: uitDatum(r.van)!, tot: uitDatum(r.tot)!, cellen: cellen[regio] ?? {}, ...(vorige ? { vorige } : {}) };
  }
  return uit;
}

export function leesVerlof(r: Rij): Verlof {
  const v: Verlof = {
    id: String(r.id), medewerkerId: String(r.medewerker_id), regio: String(r.regio), van: uitDatum(r.van)!, tot: uitDatum(r.tot)!,
    soort: r.soort as Verlof['soort'], status: r.status as Verlof['status'], aangevraagd: uitTijdstip(r.aangevraagd) ?? '',
  };
  if (r.opmerking) v.opmerking = String(r.opmerking);
  if (r.beoordeeld) v.beoordeeld = uitTijdstip(r.beoordeeld);
  if (r.beoordeelaar) v.beoordeelaar = String(r.beoordeelaar);
  if (r.reden) v.reden = String(r.reden);
  if (r.vervangen) v.vervangen = json(r.vervangen);
  if (r.ronde_id) v.rondeId = String(r.ronde_id);
  return v;
}

export function leesRuil(r: Rij): Ruil {
  const x: Ruil = {
    id: String(r.id), regio: String(r.regio), soort: r.soort as Ruil['soort'], aanbiederId: String(r.aanbieder_id), datum: uitDatum(r.datum)!,
    dienst: String(r.dienst) as DienstCode, status: r.status as Ruil['status'], gemaakt: uitTijdstip(r.gemaakt) ?? '',
  };
  if (r.ontvanger_id) x.ontvangerId = String(r.ontvanger_id);
  if (r.tegen_datum) x.tegenDatum = uitDatum(r.tegen_datum);
  if (r.tegen_dienst) x.tegenDienst = String(r.tegen_dienst) as DienstCode;
  if (r.verlof_id) x.verlofId = String(r.verlof_id);
  if (r.tegen_verlof_id) x.tegenVerlofId = String(r.tegen_verlof_id);
  if (r.tot) x.tot = uitDatum(r.tot);
  if (r.tegen_tot) x.tegenTot = uitDatum(r.tegen_tot);
  if (r.opmerking) x.opmerking = String(r.opmerking);
  if (r.geaccepteerd) x.geaccepteerd = uitTijdstip(r.geaccepteerd);
  if (r.beoordeeld) x.beoordeeld = uitTijdstip(r.beoordeeld);
  if (r.beoordeelaar) x.beoordeelaar = String(r.beoordeelaar);
  if (r.reden) x.reden = String(r.reden);
  if (r.toets) x.toets = json(r.toets);
  return x;
}

export function leesZiekmelding(r: Rij): Ziekmelding {
  const z: Ziekmelding = {
    id: String(r.id), medewerkerId: String(r.medewerker_id), regio: String(r.regio), van: uitDatum(r.van)!, gemeld: uitTijdstip(r.gemeld) ?? '',
    door: String(r.door), vervangen: json(r.vervangen ?? {}), status: r.status as Ziekmelding['status'],
  };
  if (r.tot) z.tot = uitDatum(r.tot);
  const voor = json<Ziekmelding['voor']>(r.voor ?? {});
  if (voor && Object.keys(voor).length) z.voor = voor;
  return z;
}

export function leesWens(r: Rij): Wens {
  return { id: String(r.id), medewerkerId: String(r.medewerker_id), regio: String(r.regio), datum: uitDatum(r.datum)!, soort: r.soort as Wens['soort'], ...(r.opmerking ? { opmerking: String(r.opmerking) } : {}), gemaakt: uitTijdstip(r.gemaakt) ?? '' };
}

export function leesVerschuiving(r: Rij): Verschuiving {
  const v: Verschuiving = {
    id: String(r.id), vanRegio: String(r.van_regio), naarRegio: String(r.naar_regio), van: uitDatum(r.van)!, tot: uitDatum(r.tot)!,
    plekken: num(r.plekken), door: String(r.door ?? ''), gemaakt: uitTijdstip(r.gemaakt) ?? '',
  };
  if (r.opmerking) v.opmerking = String(r.opmerking);
  return v;
}

export function leesProfiel(r: Rij): Voorkeurprofiel {
  const p: Voorkeurprofiel = {
    medewerkerId: String(r.medewerker_id), dagen: json(r.dagen), dienst: r.dienst as Voorkeurprofiel['dienst'], beschikbaarheid: r.beschikbaarheid as Voorkeurprofiel['beschikbaarheid'],
    maxDagenPerWeek: r.max_dagen_per_week == null ? null : num(r.max_dagen_per_week), bijgewerkt: uitTijdstip(r.bijgewerkt) ?? '',
  };
  if (r.opmerking) p.opmerking = String(r.opmerking);
  if (r.twee === 'graag' || r.twee === 'liever_niet' || r.twee === 'niet') p.twee = r.twee;
  if (r.korte_dagen === 'graag' || r.korte_dagen === 'liever_niet') p.korteDagen = r.korte_dagen;
  if (r.weekend === 'even' || r.weekend === 'oneven') p.weekend = r.weekend;
  if (num(r.weekend_plekken) === 2 || num(r.weekend_plekken) === 3) p.weekendPlekken = num(r.weekend_plekken) as 2 | 3;
  const uren = geldigeUren(json(r.uren));
  if (uren) p.uren = uren;
  return p;
}

export function leesRondes(rijen: Rij[], ingediend: Rij[]): Voorkeurronde[] {
  return rijen.map((r) => ({
    id: String(r.id), regio: String(r.regio), van: uitDatum(r.van)!, tot: uitDatum(r.tot)!, deadline: uitDatum(r.deadline)!, status: r.status as Voorkeurronde['status'],
    geopend: uitTijdstip(r.geopend) ?? '', door: String(r.door),
    ingediend: Object.fromEntries(ingediend.filter((i) => i.ronde_id === r.id).map((i) => [String(i.medewerker_id), uitTijdstip(i.ingediend) ?? ''])),
  }));
}

export function leesVakantieronde(r: Rij): Vakantieronde {
  return {
    id: String(r.id), naam: String(r.naam), cluster: String(r.cluster) as Vakantieronde['cluster'], van: uitDatum(r.van)!, tot: uitDatum(r.tot)!,
    data: { aanvragen: uitDatum(r.datum_aanvragen)!, analyse: uitDatum(r.datum_analyse)!, advies: uitDatum(r.datum_advies)!, gesprek: uitDatum(r.datum_gesprek)!, besluit: uitDatum(r.datum_besluit)! },
    fase: r.fase as Vakantieronde['fase'], gemaakt: uitTijdstip(r.gemaakt) ?? '', door: String(r.door),
  };
}

export function leesActiviteit(r: Rij): Activiteit {
  const a: Activiteit = { id: String(r.id), moment: uitTijdstip(r.moment) ?? '', soort: r.soort as Activiteit['soort'], tekst: String(r.tekst) };
  if (r.regio) a.regio = String(r.regio);
  if (r.voor) a.voor = String(r.voor);
  if (r.regio_breed) a.regioBreed = true;
  if (r.door) a.door = String(r.door);
  return a;
}

export function leesNormRegio(r: Rij): NormRegio {
  const fte = json<unknown[]>(r.fte).map(num) as [number, number, number, number];
  return { cluster: r.cluster as NormRegio['cluster'], natura: num(r.natura), cbs: num(r.cbs), vrijeMarkt: num(r.vrije_markt), amplitude: num(r.amplitude), voorgangen: num(r.voorgangen), fte, correctie: num(r.correctie) };
}

export function leesSchoolvakantie(r: Rij): Schoolvakantie {
  return { id: String(r.id), naam: String(r.naam), regio: r.regio as Schoolvakantie['regio'], van: uitDatum(r.van)!, tot: uitDatum(r.tot)!, bron: r.bron as Schoolvakantie['bron'] };
}

/** Uit rp_meldingen_per_regio (regio → {datum: aantal}) terug naar één doorlopende reeks. */
export function leesMeldingen(rijen: Rij[]): MeldingenData | null {
  const per = rijen.map((r) => ({ regio: String(r.regio), aantallen: json<Record<string, number>>(r.aantallen) }));
  const data = per.flatMap((p) => Object.keys(p.aantallen));
  if (!data.length) return null;
  const start = data.reduce((a, d) => (d < a ? d : a)), eind = data.reduce((a, d) => (d > a ? d : a));
  const lengte = diffDays(eind, start) + 1;
  const regios: MeldingenData['regios'] = {};
  for (const p of per) {
    const reeks: (number | null)[] = new Array(lengte).fill(null);
    for (const [d, a] of Object.entries(p.aantallen)) reeks[diffDays(d, start)] = num(a);
    regios[p.regio] = reeks;
  }
  return { start, n: lengte, regios };
}

export function leesRunMeta(r: Rij): RunMeta {
  return { id: String(r.id), soort: String(r.soort), uitgegeven: uitDatum(r.uitgegeven)!, gemaakt: uitTijdstip(r.gemaakt) ?? '', info: json(r.info) };
}

export function leesCoef(rijen: Rij[]): AppState['coef'] {
  return Object.fromEntries(rijen.map((r) => [String(r.naam), { waarde: num(r.waarde), se: num(r.se), dagen: num(r.dagen), bijgewerkt: uitTijdstip(r.bijgewerkt) ?? '' }]));
}

export function leesBronStatus(rijen: Rij[]): AppState['bronStatus'] {
  return Object.fromEntries(rijen.map((r) => [String(r.bron), { bron: String(r.bron), opgehaald: uitTijdstip(r.opgehaald) ?? '', ok: !!r.ok, melding: String(r.melding ?? ''), rijen: num(r.rijen) }]));
}

export function leesHandmatig(rijen: Rij[]): HandmatigRij[] {
  return rijen.map((r) => ({ variabele: String(r.variabele), datum: uitDatum(r.datum)!, waarde: num(r.waarde) })).sort((a, b) => b.datum.localeCompare(a.datum));
}

export function leesExtern(rijen: Rij[]): AppState['extern'] {
  return Object.fromEntries(rijen.map((r) => [String(r.bron), json(r.data)]));
}

export function leesInstellingen(rijen: Rij[]): Record<string, unknown> {
  return Object.fromEntries(rijen.map((r) => [String(r.sleutel), json(r.waarde)]));
}

