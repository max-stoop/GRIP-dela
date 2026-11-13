/**
 * Alle staat van de app. Met een gedeelde database wordt na elke actie het verschil weggeschreven en komen
 * wijzigingen van collega's live binnen; anders staat alles in IndexedDB.
 */
import { useRef, useSyncExternalStore } from 'react';
import { idb, idbEcht, kiesOpslag, testOpslag } from './idb';
import type { Activiteit, ActiviteitSoort, AppState, BronStatus, Coef, Dagtaak, Goedkeuring, Publicatie, Rol, Ruil, Taak, Vakantieronde, VakantieFase, Verlof, VerlofSoort, Verschuiving, Ziekmelding } from './types';
import { NORM_STANDAARD, type NormParameters, type NormRegio } from '../capaciteit/parameters';
import { SCHOOLREGIO, STANDAARD_SCHOOLVAKANTIES, verlofRuimte, verlofUrenPerWeek, vulSchoolvakantiesAan, type Schoolvakantie } from '../capaciteit/verlof';
import { jaarWeken } from '../capaciteit/jaarplan';
import { pasVoorstelToe, type NormVoorstel } from '../capaciteit/herberekenen';
import type { ExternData, MeldingenData, ModelInput, RunData, RunMeta } from '../model/types';
import type { Terugtest } from '../model/terugtest';
import type { FactorKey } from '../model/config';
import { REGIONS, REGION_CLUSTER, regionsInScope } from '../model/config';
import { reken } from '../model/client';
import { voegSamen } from '../import';
import { makeDemoHistory, DEMO_TERUG, rng } from '../model/demo';
import { addDays, isoRange, todayIso, nowStamp, toDay, fromDay, mondayOf, weekday, fmtD, fmtDJ } from '../dates';
import { plural } from '../format';
import { beleidVoor, inRooster, LEEG_PROFIEL, STANDAARD_BELEID, STANDAARD_WEGING, WENS_JAARROOSTER, ZZP_IN_ROOSTER, type Beleid, type Cellen, type DagVoorkeur, type DienstCode, type Medewerker, type Tijd, type Voorkeurprofiel, type Voorkeurronde, type Wens, type WensSoort } from '../rooster/types';
import { voorbeeldTeam } from '../rooster/demo';
import { voorstel, type Wijziging } from '../rooster/voorstel';
import { ruilToets, pasToe } from '../rooster/ruil';
import { tijdBevindingen, uurTekst } from '../rooster/tijden';
import { adviesFout, type AdviesKleur } from '../rooster/advies';
import { isMaand, maandEind, maandenTussen, maandNaam, maandStart, maandVan, volgendeMaand, type Maand } from '../rooster/maand';
import { DIENSTEN } from '../rooster/diensten';
import { standaardWensen } from '../rooster/wensen';
import { behoefteVoor } from './afgeleid';
import { LOGBOEK_DAGEN, LOGBOEK_MAX } from './db/grenzen';
import { DatabaseVerouderd, conflictTabel, databaseBijgewerkt, voerUit, type Db, type Voortgang } from './db/db';
import { runsBijwerken, uniekRunId, voegExternToe, type BronAntwoord } from '../model/bijhouden';
import { dagtaakOverslaan } from '../taken/status';
import { DAGELIJKSE_BRONNEN, bronGebreken, type BronGebrek } from '../bronnen/actualiteit';
import { Versies } from './db/versies';
import { verschil } from './db/verschil';
import { DEEL_NAAM, DEEL_VAN_TABEL, laadDelenVeilig, type Deel, type LeesFout } from './db/laden';
import { apiDb } from './db/vraag';
import { luisterLive } from './db/live';
import { gedeeld } from '../platform';
import { isNbd, NBD, NBD_NAAM, NBD_STANDAARD, nbdParameters, type NbdParameters } from '../nbd/parameters';
import { nbdRuilToets, nbdRuilWijzigingen, nbdTijdenNa } from '../nbd/ruil';
import { nbdDemo, nbdVoorbeeldVoorkeuren } from '../nbd/demo';
import type { NbdWijziging } from '../nbd/voorstel';
import type { DagMelding, DagToewijzing, DagVerdeling } from '../verdeling/dag';

const LEEG: AppState = {
  geladen: false,
  demo: false,
  meldingen: null,
  extern: {},
  bronStatus: {},
  handmatig: [],
  runs: [],
  coef: {},
  backtest: null,
  normaal: null,
  roosterbasis: null,
  beleid: STANDAARD_BELEID,
  medewerkers: [],
  rooster: {},
  publicaties: {},
  verlof: [],
  wensen: [],
  wensenTeam: null,
  profielen: {},
  rondes: [],
  ruil: [],
  ziekmeldingen: [],
  vakantierondes: [],
  verschuivingen: [],
  normen: NORM_STANDAARD,
  nbd: NBD_STANDAARD,
  schoolvakanties: STANDAARD_SCHOOLVAKANTIES,
  tijden: {},
  goedkeuringen: {},
  activiteit: [],
  laatsteAuto: null,
  dagtaak: null,
  verdelingen: {},
};

let state: AppState = LEEG;
let taak: Taak | null = null;
const listeners = new Set<() => void>();
const runCache = new Map<string, RunData>();

/** null: alles staat in deze browser (lokale modus, demo). */
let db: Db | null = null;
/** Wat laatst in de database stond; het verschil daarmee wordt weggeschreven. */
let basis: AppState = LEEG;
/** De echte rol, niet die van de voorvertoning. */
let rolNu: Rol = 'beheerder';

/** Een kopie in deze browser om mee te spelen; er gaat niets naar de gedeelde database. */
let test = false;
/** Alleen om de echte gegevens te lezen terwijl de test aan staat. */
let echteDb: Db | null = null;
let wisselt = false;
const TEST_VLAG = 'grip-test';
const TEST_EIGENAAR = 'test-eigenaar';
const TEST_BEWAREN_MS = 12 * 3_600_000;
interface TestEigenaar { wie: string; bijgewerkt: number }

function testVlag(): boolean {
  try { return sessionStorage.getItem(TEST_VLAG) === '1'; } catch { return false; }
}

function zetTestVlag(aan: boolean) {
  try { if (aan) sessionStorage.setItem(TEST_VLAG, '1'); else sessionStorage.removeItem(TEST_VLAG); } catch { /* geen opslag: alleen tot vernieuwen */ }
}

type Opslagwijze = 'database' | 'test' | 'browser';

export function opslagwijze(): Opslagwijze {
  return test ? 'test' : db || gedeeld() ? 'database' : 'browser';
}

export function useOpslagwijze(): Opslagwijze {
  return useSyncExternalStore(subscribe, opslagwijze, () => (gedeeld() ? 'database' : 'browser'));
}

async function leesEcht(): Promise<AppState> {
  const d = echteDb ?? db;
  if (d) {
    const { staat, mislukt } = await laadDelenVeilig(d, todayIso());
    // geen halve kopie: dan zou de test zonder teams of rooster beginnen
    if (mislukt.length) throw new Error(`Niet alles kon worden opgehaald (${mislukt.map((x) => DEEL_NAAM[x.deel]).join(', ')}). Probeer het zo opnieuw.`);
    return vulAan({ ...LEEG, ...staat, geladen: true });
  }
  const [c, m, e] = await Promise.all([idbEcht.get<Partial<AppState>>('core'), idbEcht.get<MeldingenData>('meldingen'), idbEcht.get<ExternData>('extern')]);
  return vulAan({ ...LEEG, ...(c ?? {}), meldingen: m ?? null, extern: e ?? {}, geladen: true });
}

/** Niet terwijl er iets loopt: dat zou daarna in de verkeerde opslag schrijven. */
async function wissel(fn: () => Promise<void>): Promise<void> {
  if (taak) throw new Error(`Wacht tot ${taak.naam.charAt(0).toLowerCase()}${taak.naam.slice(1)} klaar is.`);
  if (wisselt) throw new Error('Even geduld: de testomgeving wordt al gewisseld.');
  wisselt = true;
  try { await fn(); } finally { wisselt = false; emit(); }
}

function testEigenaarBij(): Promise<void> {
  return idb.set(TEST_EIGENAAR, { wie: wieNu, bijgewerkt: Date.now() } satisfies TestEigenaar).catch(() => undefined);
}

export function startTest(): Promise<void> {
  return wissel(async () => {
    if (test) return;
    if (leesMislukt.length) throw new Error('Niet alles kon worden opgehaald. Probeer dat eerst opnieuw; anders begint de test zonder die gegevens.');
    await flush();
    await bezigMetOpslaan;
    const kopie = state;
    stopLuisteren();
    echteDb = db;
    db = null;
    test = true;
    zetTestVlag(true);
    kiesOpslag('test');
    await idb.clear().catch(() => undefined);
    state = { ...kopie, geladen: true };
    basis = LEEG;
    opslagFout = null;
    set({}, ['core', 'meldingen', 'extern']);
    await flush();
  });
}

export function testOpnieuw(): Promise<void> {
  return wissel(async () => {
    if (!test) return;
    // eerst lezen: lukt dat niet, dan blijft de test zoals hij was
    const echt = await leesEcht();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty.clear();
    await bezigMetOpslaan;
    await idb.clear().catch(() => undefined);
    runCache.clear();
    state = echt;
    set({}, ['core', 'meldingen', 'extern']);
    await flush();
  });
}

export async function vergeetTest(): Promise<void> {
  zetTestVlag(false);
  if (test) await idb.clear().catch(() => undefined);
}

export function stopTest(): Promise<void> {
  return wissel(async () => {
    if (!test) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty.clear();
    await bezigMetOpslaan;
    await idb.clear().catch(() => undefined);
    test = false;
    zetTestVlag(false);
    kiesOpslag('echt');
    db = echteDb;
    echteDb = null;
    runCache.clear();
    laden = null;
    basis = LEEG;
    state = LEEG;
    opslagFout = null;
    leesMislukt = GEEN_FOUTEN;
    emit();
    await laad();
  });
}

async function ruimTestOp(): Promise<void> {
  const t = testOpslag();
  const e = await t.get<TestEigenaar>(TEST_EIGENAAR).catch(() => undefined);
  if (!test && e && (e.wie !== wieNu || Date.now() - e.bijgewerkt > TEST_BEWAREN_MS)) await t.clear().catch(() => undefined);
}

let wieNu = '';

export function zetGebruiker(rol: Rol, wie = '', regios: string[] | null = null) {
  rolNu = rol;
  wieNu = wie;
  regiosNu = regios;
}

/** Voor tests. */
export function koppelDb(d: Db | null) {
  db = d;
  laden = null;
  basis = LEEG;
}

const plant = () => rolNu !== 'medewerker';

/** null = alle; het logboek schrijft alleen in deze regio's. */
let regiosNu: string[] | null = null;

/** Wie plant werkt in het concept; een medewerker ziet het gepubliceerde rooster. */
export function zichtbaarRooster(s: AppState, regio: string): Cellen {
  return plant() ? s.rooster[regio] ?? {} : s.publicaties[regio]?.cellen ?? {};
}
const zichtbaar = (regio: string): Cellen => zichtbaarRooster(state, regio);

function alleenLokaal(wat: string) {
  if (db) throw new Error(`${wat} kan hier niet: dat zou de gegevens van iedereen vervangen.`);
}

function alleenBeheerder(wat: string) {
  if (db && rolNu !== 'beheerder') throw new Error(`${wat} doet de beheerder.`);
}

const VEROUDERD = 'De database moet eerst worden bijgewerkt. Tot die tijd wordt niets bewaard; vraag de beheerder de laatste update uit te voeren.';

function leesbaar(e: unknown): string {
  const t = e instanceof Error ? e.message : String(e);
  if (e instanceof DatabaseVerouderd) return VEROUDERD;
  if (/GRIP_VIER_OGEN/.test(t)) return 'Je gaf zelf het advies voor deze maand. Een ander keurt het rooster goed of af (vier ogen, roosterbeleid § 5.1). De gegevens zijn opnieuw opgehaald.';
  const conflict = conflictTabel(e);
  if (conflict) {
    const deel = DEEL_VAN_TABEL[conflict]?.[0];
    return `Iemand anders heeft ${deel ? DEEL_NAAM[deel] : 'dit'} intussen gewijzigd. Je wijziging is niet bewaard; je ziet nu de nieuwste stand. Doe je wijziging zo nodig opnieuw.`;
  }
  if (/row-level security|permission denied/i.test(t)) return 'Dit mag je niet wijzigen. De gegevens zijn opnieuw opgehaald.';
  if (/Failed to fetch|NetworkError|fetch failed/i.test(t)) return 'Geen verbinding. De gegevens zijn opnieuw opgehaald; probeer het zo nog eens.';
  return 'Opslaan is niet gelukt. De gegevens zijn opnieuw opgehaald; probeer het nog eens.';
}

function emit() {
  for (const l of listeners) l();
}

export function getState(): AppState {
  return state;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Het resultaat blijft gelijk zolang staat en selector gelijk zijn; een selector met filter of map rendert anders eindeloos. */
export function useApp<T>(sel: (s: AppState) => T): T {
  const cache = useRef<{ s: AppState; sel: (s: AppState) => T; v: T } | null>(null);
  const lees = (bron: AppState) => {
    const c = cache.current;
    if (c && c.s === bron && c.sel === sel) return c.v;
    const v = sel(bron);
    cache.current = { s: bron, sel, v };
    return v;
  };
  return useSyncExternalStore(subscribe, () => lees(state), () => lees(LEEG));
}

export function useTaak(): Taak | null {
  return useSyncExternalStore(subscribe, () => taak, () => null);
}

/** Grote lijsten staan apart, zodat een kleine wijziging niet alles opnieuw wegschrijft. */
type Sleutel = 'core' | 'meldingen' | 'extern';
const dirty = new Set<Sleutel>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let opslagFout: string | null = null;
const versies = new Versies();

export function useOpslagFout(): string | null {
  return useSyncExternalStore(subscribe, () => opslagFout, () => null);
}

type GroteOpslag = (Voortgang & { klaar?: false }) | { klaar: true; rijen: number };
let groteOpslag: GroteOpslag | null = null;
let groteOpslagWeg: ReturnType<typeof setTimeout> | null = null;

export function useGroteOpslag(): GroteOpslag | null {
  return useSyncExternalStore(subscribe, () => groteOpslag, () => null);
}

function zetGroteOpslag(g: GroteOpslag | null) {
  if (groteOpslagWeg) { clearTimeout(groteOpslagWeg); groteOpslagWeg = null; }
  groteOpslag = g;
  emit();
  if (g?.klaar) groteOpslagWeg = setTimeout(() => { groteOpslag = null; emit(); }, 10_000);
}

let leesMislukt: LeesFout[] = [];
const GEEN_FOUTEN: LeesFout[] = [];

export function useLeesFout(): LeesFout[] {
  return useSyncExternalStore(subscribe, () => leesMislukt, () => GEEN_FOUTEN);
}

export function leesFoutNu(): LeesFout[] {
  return leesMislukt;
}

/** Voor tests. */
export function opslagFoutNu(): string | null {
  return opslagFout;
}

function core(s: AppState) {
  const { meldingen: _m, extern: _e, geladen: _g, ...rest } = s;
  return rest;
}

function set(patch: Partial<AppState>, keys: Sleutel[] = ['core']) {
  state = { ...state, ...patch };
  keys.forEach((k) => dirty.add(k));
  emit();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 250);
}

let bezigMetOpslaan: Promise<void> = Promise.resolve();

function flush(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (db) {
    dirty.clear();
    bezigMetOpslaan = bezigMetOpslaan.then(schrijfNaarDb);
    return bezigMetOpslaan;
  }
  const keys = [...dirty];
  dirty.clear();
  if (!keys.length) return bezigMetOpslaan;
  // schrijfacties na elkaar, zodat een oudere versie nooit een nieuwere overschrijft
  bezigMetOpslaan = bezigMetOpslaan.then(async () => {
    try {
      await Promise.all(keys.map((k) => idb.set(k, k === 'core' ? core(state) : state[k])));
      if (test) await testEigenaarBij();
      if (opslagFout) { opslagFout = null; emit(); }
    } catch (e) {
      keys.forEach((k) => dirty.add(k));
      opslagFout = e instanceof Error ? e.message : 'Opslaan in de browser mislukt';
      console.error('Opslaan mislukt', e);
      emit();
    }
  });
  return bezigMetOpslaan;
}

async function schrijfNaarDb() {
  const d = db;
  if (!d) return;
  const doel = state, basisVoor = basis;
  let ops = verschil(basis, doel, rolNu);
  // een onderdeel dat niet kon worden gelezen, schrijven we niet: dat zou overschrijven wat er in de database staat
  let nietBewaard: string[] = [];
  if (leesMislukt.length) {
    const geblokkeerd = new Set(leesMislukt.map((x) => x.deel));
    const raakt = (tabel: string) => (DEEL_VAN_TABEL[tabel] ?? []).some((x) => geblokkeerd.has(x));
    nietBewaard = [...new Set(ops.filter((o) => raakt(o.tabel)).flatMap((o) => DEEL_VAN_TABEL[o.tabel] ?? []).filter((x) => geblokkeerd.has(x)).map((x) => DEEL_NAAM[x]))];
    ops = ops.filter((o) => !raakt(o.tabel));
  }
  const meldNietBewaard = () => {
    if (!nietBewaard.length) return;
    opslagFout = `Niet bewaard: wijzigingen in ${nietBewaard.join(' en ')}. Die konden niet worden opgehaald; probeer het opnieuw.`;
    emit();
  };
  if (!ops.length) { basis = doel; meldNietBewaard(); return; }
  let groot = 0;
  try {
    const nieuweVersies = await voerUit(d, ops, {
      rol: rolNu,
      aanvullen: (tabel, rij) => (tabel === 'rp_run' ? { ...rij, data: runCache.get(String(rij.id)) ?? null } : rij),
      controle: (tabel, rij, nieuw) => versies.controle(tabel, rij, nieuw),
      voortgang: (v) => { groot = v.rijen; zetGroteOpslag(v); },
    });
    versies.naSchrijven(nieuweVersies, ops);
    if (groot) zetGroteOpslag({ klaar: true, rijen: groot });
    // wat intussen is bijgelezen (wijzigingen van collega's), blijft staan; de rest is nu wat we schreven
    const nieuw = { ...doel } as Record<string, unknown>;
    for (const k of Object.keys(basis) as (keyof AppState)[]) if (basis[k] !== basisVoor[k]) nieuw[k] = basis[k];
    basis = nieuw as unknown as AppState;
    if (opslagFout) { opslagFout = null; emit(); }
    meldNietBewaard();
  } catch (e) {
    console.error('Opslaan in de database mislukt', e);
    if (groot) zetGroteOpslag(null);
    opslagFout = groot && !(e instanceof DatabaseVerouderd) && !conflictTabel(e)
      ? `De grote wijziging (${groot.toLocaleString('nl-NL')} regels) is niet bewaard; er is niets veranderd. ${leesbaar(e).replace(/^Opslaan is niet gelukt\. /, '')}`
      : leesbaar(e);
    emit();
    // wat de database weigerde, staat nu alleen hier: opnieuw lezen, zodat iedereen hetzelfde ziet
    await leesAllesUitDb();
  }
}

/** Schrijft openstaande wijzigingen direct weg (bijv. voor navigatie of na een grote actie). */
export function bewaarNu(): Promise<void> {
  return flush();
}

async function leesAllesUitDb() {
  const d = db!;
  const { staat, mislukt, perDeel } = await laadDelenVeilig(d, todayIso());
  if (mislukt.length) console.error('Niet alles kon worden opgehaald', mislukt);
  leesMislukt = mislukt.length ? mislukt : GEEN_FOUTEN;
  state = vulAan({ ...LEEG, ...staat, geladen: true });
  basis = state;
  versies.leeg();
  for (const x of Object.values(perDeel)) versies.vervang(x.ronde);
  // meteen melden, niet pas bij de eerste wijziging
  if (!await databaseBijgewerkt(d).catch(() => true)) opslagFout = VEROUDERD;
  emit();
}

export async function leesOpnieuw(): Promise<void> {
  const d = db;
  if (!d || !leesMislukt.length) return;
  await bezigMetOpslaan;
  const { staat, mislukt, perDeel } = await laadDelenVeilig(d, todayIso(), leesMislukt.map((x) => x.deel));
  if (mislukt.length) console.error('Niet alles kon worden opgehaald', mislukt);
  for (const x of Object.values(perDeel)) versies.vervang(x.ronde);
  const nieuw = vulAan({ ...state, ...staat });
  const patch = Object.fromEntries(Object.keys(staat).map((k) => [k, nieuw[k as keyof AppState]])) as Partial<AppState>;
  state = { ...state, ...patch };
  basis = { ...basis, ...patch };
  leesMislukt = mislukt.length ? mislukt : GEEN_FOUTEN;
  if (!mislukt.length && opslagFout?.startsWith('Niet bewaard')) opslagFout = null;
  emit();
}

/** Voor tests: dezelfde inhoud als nieuwe objecten, zoals na bijlezen. Formulieren moeten hun invoer houden. */
function bijlezenNabootsen() {
  state = {
    ...state,
    medewerkers: state.medewerkers.map((m) => ({ ...m })),
    profielen: Object.fromEntries(Object.entries(state.profielen).map(([k, p]) => [k, { ...p }])),
    tijden: Object.fromEntries(Object.entries(state.tijden).map(([r, t]) => [r, Object.fromEntries(Object.entries(t).map(([m, rij]) => [m, Object.fromEntries(Object.entries(rij).map(([d, x]) => [d, { ...x }]))]))])),
  };
  basis = state;
  emit();
}

let luisteraar: (() => void) | null = null;
let teLezen = new Set<Deel>();
let leesTimer: ReturnType<typeof setTimeout> | null = null;

function stopLuisteren() {
  luisteraar?.();
  luisteraar = null;
  if (leesTimer) { clearTimeout(leesTimer); leesTimer = null; }
  teLezen = new Set();
}

function allesBijlezen() {
  if (!luisteraar) return;
  for (const delen of Object.values(DEEL_VAN_TABEL)) for (const d of delen) teLezen.add(d);
  if (!leesTimer) leesTimer = setTimeout(() => { leesTimer = null; void leesBij(); }, 500);
}

let verborgenSinds = 0;

function startLuisteren() {
  if (luisteraar || !gedeeld()) return;
  const opWijziging = (tabel: string) => {
    for (const d of DEEL_VAN_TABEL[tabel] ?? []) teLezen.add(d);
    if (!leesTimer) leesTimer = setTimeout(() => { leesTimer = null; void leesBij(); }, 1500);
  };
  luisteraar = luisterLive(opWijziging, allesBijlezen);
}

/** Een deel met een eigen wijziging die nog onderweg is, wordt later gelezen. */
async function leesBij() {
  const d = db;
  if (!d || !teLezen.size) return;
  const delen = [...teLezen];
  teLezen = new Set();
  await bezigMetOpslaan;
  try {
    const { staat: vers, mislukt, perDeel } = await laadDelenVeilig(d, todayIso(), delen);
    const nogFout = leesMislukt.filter((x) => !delen.includes(x.deel)).concat(mislukt);
    if (nogFout.length !== leesMislukt.length || mislukt.length) leesMislukt = nogFout.length ? nogFout : GEEN_FOUTEN;
    const nieuw = vulAan({ ...state, ...vers });
    const patch: Partial<AppState> = {};
    let wacht = false;
    const uitgesteld = new Set<string>();
    for (const k of Object.keys(vers) as (keyof AppState)[]) {
      if (state[k] !== basis[k]) { wacht = true; uitgesteld.add(k); continue; }
      (patch as Record<string, unknown>)[k] = nieuw[k];
    }
    state = { ...state, ...patch };
    basis = { ...basis, ...patch };
    // alleen de versies van wat ook echt is overgenomen: wat nog wacht op een eigen wijziging, houdt de oude versie
    for (const x of Object.values(perDeel)) if (!x.sleutels.some((k) => uitgesteld.has(k))) versies.vervang(x.ronde);
    emit();
    if (wacht) {
      delen.forEach((x) => teLezen.add(x));
      if (!leesTimer) leesTimer = setTimeout(() => { leesTimer = null; void leesBij(); }, 2000);
    }
  } catch (e) {
    console.error('Bijlezen mislukt', e);
  }
}

if (typeof window !== 'undefined') {
  // voor tests en foutzoeken in de browserconsole
  (window as unknown as { __grip: unknown }).__grip = { getState, bewaarNu: () => flush(), idb, bijlezenNabootsen, opslagwijze };
  const nu = () => { if (dirty.size) void flush(); };
  window.addEventListener('pagehide', nu);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { verborgenSinds = Date.now(); nu(); return; }
    // langer dan een minuut weg: opnieuw lezen wat collega's intussen deden
    if (verborgenSinds && Date.now() - verborgenSinds > 60_000) allesBijlezen();
    verborgenSinds = 0;
  });
  window.addEventListener('online', () => allesBijlezen());
}

export function vulAan(s: AppState): AppState {
  const normen = s.normen ? { ...NORM_STANDAARD, ...s.normen, regios: { ...NORM_STANDAARD.regios, ...s.normen.regios } } : NORM_STANDAARD;
  return {
    ...s,
    beleid: { ...STANDAARD_BELEID, ...s.beleid, weging: { ...STANDAARD_WEGING, ...s.beleid?.weging } },
    medewerkers: s.medewerkers ?? [],
    rooster: s.rooster ?? {},
    publicaties: s.publicaties ?? {},
    ruil: s.ruil ?? [],
    verlof: s.verlof ?? [],
    profielen: s.profielen ?? {},
    nbd: nbdParameters(s.nbd),
    rondes: s.rondes ?? [],
    ziekmeldingen: s.ziekmeldingen ?? [],
    vakantierondes: s.vakantierondes ?? [],
    verschuivingen: s.verschuivingen ?? [],
    normen,
    schoolvakanties: s.schoolvakanties ? vulSchoolvakantiesAan(s.schoolvakanties) : STANDAARD_SCHOOLVAKANTIES,
    tijden: s.tijden ?? {},
    goedkeuringen: s.goedkeuringen ?? {},
    activiteit: snoeiLog(s.activiteit ?? []),
    verdelingen: s.verdelingen ?? {},
    dagtaak: s.dagtaak ?? null,
  };
}

let laden: Promise<void> | null = null;

export function laad(): Promise<void> {
  if (laden) return laden;
  laden = (async () => {
    if (!test && testVlag()) {
      const e = await testOpslag().get<TestEigenaar>(TEST_EIGENAAR).catch(() => undefined);
      if (e && e.wie !== wieNu) { await testOpslag().clear().catch(() => undefined); zetTestVlag(false); } else { test = true; kiesOpslag('test'); }
    }
    if (!db && !echteDb && gedeeld()) {
      const d = apiDb();
      if (test) echteDb = d; else db = d;
    }
    if (!test && typeof indexedDB !== 'undefined') void ruimTestOp();
    if (db) {
      try {
        await leesAllesUitDb();
        startLuisteren();
        onderhoud();
      } catch (err) {
        console.error('Lezen uit de database mislukt', err);
        opslagFout = 'De gegevens konden niet worden opgehaald. Vernieuw de pagina of probeer het later opnieuw.';
        state = { ...LEEG, geladen: true };
        basis = state;
      }
      emit();
      return;
    }
    try {
      const [c, m, e] = await Promise.all([idb.get<Partial<AppState>>('core'), idb.get<MeldingenData>('meldingen'), idb.get<ExternData>('extern')]);
      if (test && !c) {
        // een lege test, bijvoorbeeld in een ander tabblad gestart
        state = await leesEcht();
        set({}, ['core', 'meldingen', 'extern']);
      } else state = vulAan({ ...LEEG, ...(c ?? {}), meldingen: m ?? null, extern: e ?? {}, geladen: true });
      emit();
      verloopRuilen();
    } catch (err) {
      opslagFout = err instanceof Error ? err.message : 'Browseropslag niet beschikbaar';
      state = { ...LEEG, geladen: true };
    }
    emit();
  })();
  return laden;
}

function nieuwId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function log(soort: ActiviteitSoort, tekst: string, extra: Partial<Activiteit> = {}): Activiteit {
  return { id: nieuwId(), moment: nowStamp(), soort, tekst, ...extra };
}

export const LOGBOEK = { dagen: LOGBOEK_DAGEN, max: LOGBOEK_MAX };

function metLog(...a: Activiteit[]): Activiteit[] {
  return snoeiLog([...a, ...state.activiteit]);
}

export function snoeiLog(log: Activiteit[], vandaag = todayIso()): Activiteit[] {
  const grens = addDays(vandaag, -LOGBOEK.dagen);
  return log.filter((x) => x.moment >= grens).slice(0, LOGBOEK.max);
}

async function metTaak<T>(naam: string, fn: (stap: (s: string) => void) => Promise<T>): Promise<T> {
  if (taak) throw new Error(`${taak.naam} is nog bezig`);
  if (wisselt) throw new Error('Even geduld: de testomgeving wordt gewisseld.');
  taak = { naam, sinds: nowStamp() };
  emit();
  try {
    return await fn((s) => { taak = { ...taak!, stap: s }; emit(); });
  } finally {
    await flush();
    taak = null;
    emit();
  }
}

function modelInput(): ModelInput {
  if (!state.meldingen) throw new Error('Er staan nog geen meldingen klaar. Lees eerst de meldingenhistorie in bij Bronnen en model.');
  return {
    meldingen: state.meldingen,
    extern: state.extern,
    handmatig: state.handmatig,
    coef: Object.fromEntries(Object.entries(state.coef).map(([k, c]) => [k, c!.waarde])) as Partial<Record<FactorKey, number>>,
    normaal: state.normaal,
  };
}

export async function getRun(id: string): Promise<RunData | null> {
  const c = runCache.get(id);
  if (c) return c;
  if (db) {
    const data = await runUit(db, id);
    if (data) runCache.set(id, data);
    return data ?? null;
  }
  let d = await idb.get<RunData>(`run:${id}`).catch(() => undefined);
  if (!d && test) d = await (echteDb ? runUit(echteDb, id) : idbEcht.get<RunData>(`run:${id}`)).catch(() => undefined);
  if (d) runCache.set(id, d);
  return d ?? null;
}

async function runUit(d: Db, id: string): Promise<RunData | undefined> {
  const [r] = await d.lees('rp_run', { kolommen: 'data', filters: [{ kolom: 'id', op: 'eq', waarde: id }] });
  return (typeof r?.data === 'string' ? JSON.parse(r.data) : r?.data) as RunData | undefined;
}

export function getRunSync(id: string): RunData | null {
  return runCache.get(id) ?? null;
}

async function bewaarRuns(runs: { meta: RunMeta; data: RunData }[]) {
  for (const r of runs) {
    runCache.set(r.meta.id, r.data);
    if (!db) await idb.set(`run:${r.meta.id}`, r.data);
  }
  // de roosterbasis blijft altijd bewaard
  const { alle, weg } = runsBijwerken(state.runs, runs, state.roosterbasis?.runId);
  for (const m of weg) {
    runCache.delete(m.id);
    if (!db) await idb.del(`run:${m.id}`).catch(() => undefined);
  }
  set({ runs: alle });
}

function uniekId(issue: string): string {
  return uniekRunId(issue, state.runs);
}

async function maakRun(soort = 'handmatig', issue = todayIso()): Promise<RunMeta> {
  return metTaak('Nieuwe voorspelling', async () => maakRunIntern(soort, issue));
}

async function maakRunIntern(soort: string, issue: string): Promise<RunMeta> {
  alleenBeheerder('Een nieuwe voorspelling maken');
  const a = await reken({ type: 'runs', input: modelInput(), uitgaven: [{ issue, soort, id: uniekId(issue) }] });
  if (a.type !== 'runs') throw new Error('Het rekenen is niet gelukt. Probeer het opnieuw.');
  await bewaarRuns(a.runs);
  set({ activiteit: metLog(log('model', `Nieuwe voorspelling (${soort}) van ${fmtD(issue)}`)) });
  return a.runs[0].meta;
}

export function vastleggenRoosterbasis(runId: string, door?: string) {
  const r = state.runs.find((x) => x.id === runId);
  set({
    roosterbasis: { runId, vastgelegd: nowStamp(), door },
    activiteit: metLog(log('model', `Roosterbasis vastgelegd: run van ${r ? fmtD(r.uitgegeven) : runId}`, { door })),
  });
}

export async function verwijderRun(runId: string) {
  if (state.roosterbasis?.runId === runId) throw new Error('De roosterbasis kan niet worden verwijderd. Leg eerst een andere run vast.');
  alleenBeheerder('Een voorspelling verwijderen');
  runCache.delete(runId);
  if (!db) await idb.del(`run:${runId}`).catch(() => undefined);
  set({ runs: state.runs.filter((r) => r.id !== runId) });
}

/** Aanvullen houdt de rest van de historie; vervangen gooit weg wat niet in het bestand staat (demodata altijd). */
export async function zetMeldingen(m: MeldingenData, bron: string, wijze: 'aanvullen' | 'vervangen' = 'aanvullen') {
  alleenBeheerder('De meldingenhistorie inlezen');
  const aanvullen = wijze === 'aanvullen' && !!state.meldingen && !state.demo;
  const s = aanvullen ? voegSamen(state.meldingen, m) : null;
  const tekst = s
    ? `Meldingen aangevuld (${bron}): ${s.nieuw} nieuw, ${s.gewijzigd} bijgewerkt`
    : `Meldingenhistorie ${state.meldingen && !state.demo ? 'vervangen' : 'ingelezen'} (${bron})`;
  set({ meldingen: s ? s.data : m, demo: false, activiteit: metLog(log('model', tekst)) }, ['core', 'meldingen']);
  await maakRun('na upload');
}

async function haalBron(naam: string, body: Record<string, string> = {}): Promise<BronAntwoord> {
  const r = await fetch('/api/bronnen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bron: naam, ...body }) });
  let js: BronAntwoord & { fout?: string };
  try {
    js = await r.json();
  } catch {
    throw new Error('Niet bereikbaar');
  }
  if (!r.ok || js.fout) throw new Error(js.fout ?? 'Niet bereikbaar');
  return js;
}

/** Een fout blokkeert de andere bronnen niet. */
async function ververs(naam: string, opslagBron: string, body: Record<string, string> = {}): Promise<boolean> {
  const status: BronStatus = { bron: naam, opgehaald: nowStamp(), ok: false, melding: '', rijen: 0 };
  try {
    const res = await haalBron(naam, body);
    if (res.normaal) set({ normaal: res.normaal });
    if (res.reeksen.length) set({ extern: voegExternToe(state.extern, opslagBron, res) }, ['extern']);
    status.ok = true;
    status.rijen = res.rijen;
  } catch (e) {
    status.melding = e instanceof Error ? e.message : String(e);
  }
  set({ bronStatus: { ...state.bronStatus, [naam]: status } });
  return status.ok;
}

export async function verversBronnen(soort = 'handmatig'): Promise<{ ok: number; fout: number; gebreken: BronGebrek[] }> {
  return metTaak('Bronnen verversen', async (stap) => {
    const lijst: [string, string, string][] = [...DAGELIJKSE_BRONNEN];
    if (!state.normaal) lijst.push(['normalen', 'normalen', 'Klimaatnormalen']);
    let ok = 0;
    const opgehaald: Record<string, boolean> = {};
    for (const [naam, opslag, label] of lijst) {
      stap(label);
      opgehaald[opslag] = await ververs(naam, opslag);
      if (opgehaald[opslag]) ok++;
    }
    const gebreken = bronGebreken({ extern: state.extern, opgehaald, vandaag: todayIso(), normaal: !!state.normaal });
    set({ activiteit: metLog(log('bronnen', `Bronnen ververst: ${ok} van ${lijst.length} gelukt${gebreken.length ? `; verouderd of ontbrekend: ${gebreken.map((g) => g.label).join(', ')}` : ''}`)) });
    if (state.meldingen) {
      stap('Nieuwe voorspelling');
      await maakRunIntern(soort === 'handmatig' ? 'na verversen' : soort, todayIso());
    }
    return { ok, fout: lijst.length - ok, gebreken };
  });
}

export async function haalHistorie(): Promise<boolean> {
  return metTaak('Historie ophalen', async (stap) => {
    const van = state.meldingen?.start ?? '2022-07-01';
    const tot = addDays(todayIso(), -6);
    stap('Weerhistorie');
    const a = await ververs('weer_archief', 'weer', { van, tot });
    stap('Luchthistorie');
    const b = await ververs('lucht_archief', 'lucht', { van, tot });
    set({ activiteit: metLog(log('bronnen', `Historie opgehaald: weer ${a ? 'gelukt' : 'mislukt'}, lucht ${b ? 'gelukt' : 'mislukt'}`)) });
    return a && b;
  });
}

/** Eén keer per stand van meldingen, signalen en factoren. */
let terugtestCache: { sleutel: unknown[]; uitkomst: Promise<Terugtest | null> } | null = null;
export function terugtestMorgen(): Promise<Terugtest | null> {
  if (!state.meldingen) return Promise.resolve(null);
  const sleutel = [state.meldingen, state.extern, state.handmatig, state.coef, state.normaal];
  if (terugtestCache && terugtestCache.sleutel.every((x, i) => x === sleutel[i])) return terugtestCache.uitkomst;
  const uitkomst = reken({ type: 'terugtest', input: modelInput() }).then((a) => (a.type === 'terugtest' ? a.terugtest : null));
  terugtestCache = { sleutel, uitkomst };
  uitkomst.catch(() => { if (terugtestCache?.uitkomst === uitkomst) terugtestCache = null; });
  return uitkomst;
}

export async function kalibreren() {
  return metTaak('Kalibreren', async (stap) => {
    stap('Factoren schatten en backtesten');
    const a = await reken({ type: 'kalibreren', input: modelInput() });
    if (a.type !== 'kalibreren') throw new Error('Het rekenen is niet gelukt. Probeer het opnieuw.');
    const t = nowStamp();
    const coef: Partial<Record<FactorKey, Coef>> = {};
    for (const [k, c] of Object.entries(a.kalibratie.coef)) coef[k as FactorKey] = { ...c!, bijgewerkt: t };
    set({ coef, backtest: a.kalibratie.backtest, activiteit: metLog(log('model', 'Model gekalibreerd op eigen historie')) });
    stap('Nieuwe voorspelling');
    await maakRunIntern('na kalibratie', todayIso());
    return a.kalibratie;
  });
}

export function startwaardenTerug() {
  set({ coef: {}, backtest: null, activiteit: metLog(log('model', 'Kalibratie teruggezet naar startwaarden')) });
}

export function griepToevoegen(datum: string, waarde: number) {
  const rest = state.handmatig.filter((h) => !(h.variabele === 'flu_ili' && h.datum === datum));
  set({ handmatig: [...rest, { variabele: 'flu_ili', datum, waarde }].sort((a, b) => b.datum.localeCompare(a.datum)) });
}

export function griepVerwijderen(datum: string) {
  set({ handmatig: state.handmatig.filter((h) => !(h.variabele === 'flu_ili' && h.datum === datum)) });
}

/** Mislukt het, dan niet bij elke pagina opnieuw. */
let dagtaakGeprobeerd: string | null = null;

/** Normaal doet de server dit elke ochtend; is dat vandaag niet gelukt, dan doet de browser van de beheerder het. */
export async function dagelijkseRun(): Promise<void> {
  const vandaag = todayIso();
  onderhoud();
  if (db && rolNu !== 'beheerder') return;
  if (!state.meldingen || taak || state.laatsteAuto === vandaag || dagtaakGeprobeerd === vandaag) return;
  if (db && dagtaakOverslaan(state.dagtaak, vandaag, nowStamp()) !== null) return;
  dagtaakGeprobeerd = vandaag;
  if (state.runs.some((r) => r.uitgegeven === vandaag)) {
    set({ laatsteAuto: vandaag });
    return;
  }
  const start: Dagtaak = { datum: vandaag, status: 'gestart', gestart: nowStamp(), waar: 'browser' };
  if (db) {
    // de database legt in één handeling vast wie de taak uitvoert; is de server al bezig of klaar, dan niets doen
    const geclaimd = await db.rpc('rp_dagtaak_claim', { p_status: start, p_looptijd: 20 }).catch((e) => { console.error('Dagelijkse voorspelling', e); return []; });
    const v = Number(geclaimd[0]?.versie);
    if (!v) return;
    versies.naSchrijven([{ t: 'rp_instelling', k: ['dagtaak'], v }], []);
    state = { ...state, dagtaak: start };
    basis = { ...basis, dagtaak: start };
    emit();
  }
  try {
    if (state.demo) await verlengDemo();
    const { gebreken, ...b } = await verversBronnen('dagelijks');
    const run = state.runs.find((r) => r.uitgegeven === vandaag);
    const klaar: Dagtaak = {
      ...start, status: gebreken.length ? 'beperkt' : 'geslaagd', klaar: nowStamp(), bronnen: b,
      ...(gebreken.length ? { gebreken } : {}), ...(run ? { run: run.id } : {}),
    };
    set({ laatsteAuto: vandaag, ...(db ? { dagtaak: klaar } : {}) });
  } catch (e) {
    if (db) set({ dagtaak: { ...start, status: 'mislukt', klaar: nowStamp(), melding: e instanceof Error ? e.message : String(e) } });
  }
}

export function zetBeleid(patch: Partial<Beleid>) {
  set({ beleid: { ...state.beleid, ...patch } });
}

export function zetNormen(patch: Partial<Omit<NormParameters, 'regios'>>) {
  set({ normen: { ...state.normen, ...patch } });
}

export function zetNormRegio(regio: string, patch: Partial<NormRegio>) {
  const r = state.normen.regios[regio];
  if (!r) return;
  set({ normen: { ...state.normen, regios: { ...state.normen.regios, [regio]: { ...r, ...patch } } } });
}

export function normenTerug() {
  set({ normen: NORM_STANDAARD, activiteit: metLog(log('systeem', 'Vastgestelde regelplekken teruggezet naar de Excel van 2027')) });
}

export function normenHerberekend(v: NormVoorstel) {
  const wat = `herberekend uit de eigen meldingen t/m ${fmtDJ(v.tot)}`;
  set({
    normen: pasVoorstelToe(state.normen, v, `${state.normen.bron.split(' · ')[0]} · ${wat}`),
    activiteit: metLog(log('systeem', `Vastgestelde regelplekken ${wat}`)),
  });
}

export function zetSchoolvakanties(lijst: Schoolvakantie[]) {
  set({ schoolvakanties: [...lijst].sort((a, b) => a.van.localeCompare(b.van)) });
}

export async function haalSchoolvakanties(schooljaren: string[]): Promise<number> {
  const r = await fetch('/api/bronnen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bron: 'schoolvakanties', schooljaren: schooljaren.join(',') }) });
  const js = await r.json().catch(() => ({ fout: null }));
  if (!r.ok || js.fout !== undefined) throw new Error(js.fout || 'De schoolvakanties konden niet worden opgehaald. Probeer het later opnieuw.');
  const nieuw: Schoolvakantie[] = js.vakanties ?? [];
  if (!nieuw.length) throw new Error('Geen schoolvakanties gevonden');
  // vervang per schooljaar (augustus t/m juli): de zomervakantie hoort bij het schooljaar dat dan eindigt
  const schooljaarVan = (d: string) => { const j = Number(d.slice(0, 4)); return d.slice(5) >= '08-01' ? `${j}-${j + 1}` : `${j - 1}-${j}`; };
  const opgehaald = new Set(schooljaren);
  const rest = state.schoolvakanties.filter((v) => v.bron === 'handmatig' || !opgehaald.has(schooljaarVan(v.van)));
  zetSchoolvakanties([...rest, ...nieuw]);
  set({ activiteit: metLog(log('bronnen', `Schoolvakanties opgehaald (${nieuw.length})`)) });
  return nieuw.length;
}

export function bewaarMedewerker(m: Omit<Medewerker, 'id' | 'actief'> & { id?: string }): string {
  const bestaand = m.id ? state.medewerkers.find((x) => x.id === m.id) : undefined;
  if (bestaand) {
    set({ medewerkers: state.medewerkers.map((x) => (x.id === m.id ? { ...x, ...m, id: x.id } : x)) });
    return bestaand.id;
  }
  const nieuw: Medewerker = { ...m, id: nieuwId(), actief: true };
  set({ medewerkers: [...state.medewerkers, nieuw], activiteit: metLog(log('team', `${nieuw.naam} toegevoegd aan ${nieuw.regio}`, { regio: nieuw.regio })) });
  return nieuw.id;
}

/** 1 = bovenaan. */
export function zetVolgorde(plek: Record<string, number>) {
  const anders = (m: Medewerker) => plek[m.id] != null && m.volgorde !== plek[m.id];
  if (!state.medewerkers.some(anders)) return;
  set({ medewerkers: state.medewerkers.map((m) => (anders(m) ? { ...m, volgorde: plek[m.id] } : m)) });
}

const leegDag = (datum: string): DagVerdeling => ({ datum, meldingen: [], toewijzingen: [] });

function zetDag(datum: string, v: DagVerdeling, activiteit?: Activiteit) {
  set({ verdelingen: { ...state.verdelingen, [datum]: v }, ...(activiteit ? { activiteit: metLog(activiteit) } : {}) });
}

export function voegDagMeldingenToe(datum: string, nieuw: Omit<DagMelding, 'id'>[]): string[] {
  const v = state.verdelingen[datum] ?? leegDag(datum);
  let nr = v.meldingen.reduce((a, m) => Math.max(a, Number(m.id.replace(/\D/g, '')) || 0), 0);
  const erbij = nieuw.map((m) => ({ ...m, id: `M${++nr}` }));
  zetDag(datum, { ...v, meldingen: [...v.meldingen, ...erbij] });
  return erbij.map((m) => m.id);
}

/** Wat al was verdeeld en nog niet doorgegeven, vervalt: het kan anders uitkomen. */
export function wijzigDagMelding(datum: string, id: string, patch: Partial<Omit<DagMelding, 'id'>>) {
  const v = state.verdelingen[datum];
  if (!v) return;
  zetDag(datum, {
    ...v,
    meldingen: v.meldingen.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    toewijzingen: v.toewijzingen.filter((t) => t.meldingId !== id),
  });
}

export function verwijderDagMelding(datum: string, id: string) {
  const v = state.verdelingen[datum];
  if (!v) return;
  zetDag(datum, { ...v, meldingen: v.meldingen.filter((m) => m.id !== id), toewijzingen: v.toewijzingen.filter((t) => t.meldingId !== id) });
}

/** Wat al was doorgegeven, blijft dat zolang het op dezelfde plek staat. */
export function zetDagVerdeling(datum: string, toewijzingen: Omit<DagToewijzing, 'vast'>[], door: string) {
  const v = state.verdelingen[datum] ?? leegDag(datum);
  const vast = new Set(v.toewijzingen.filter((t) => t.vast).map((t) => `${t.meldingId}|${t.slotId}`));
  const nieuw = toewijzingen.map((t) => (vast.has(`${t.meldingId}|${t.slotId}`) ? { ...t, vast: true } : { ...t }));
  zetDag(datum, { ...v, toewijzingen: nieuw, verdeeld: nowStamp(), door }, log('bijsturen', `Meldingen ${fmtD(datum)} verdeeld: ${nieuw.length} van ${v.meldingen.length}`, { door }));
}

/** Bij opnieuw verdelen blijft wat is doorgegeven staan. */
export function geefDagVerdelingDoor(datum: string, door: string) {
  const v = state.verdelingen[datum];
  if (!v?.toewijzingen.length) return;
  zetDag(datum, { ...v, toewijzingen: v.toewijzingen.map((t) => ({ ...t, vast: true })) }, log('bijsturen', `Verdeling ${fmtD(datum)} doorgegeven: ${v.toewijzingen.length} gesprekken`, { door }));
}

export function geefDagMeldingVrij(datum: string, id: string) {
  const v = state.verdelingen[datum];
  if (!v) return;
  zetDag(datum, { ...v, toewijzingen: v.toewijzingen.map((t) => (t.meldingId === id ? { ...t, vast: false } : t)) });
}

/** PC4; leeg haalt hem weg. */
export function zetWoonpostcodes(postcodes: Record<string, string>) {
  set({
    medewerkers: state.medewerkers.map((m) => {
      if (!(m.id in postcodes)) return m;
      const pc = /^\s*([1-9]\d{3})/.exec(postcodes[m.id])?.[1];
      if ((pc ?? undefined) === m.postcode) return m;
      const { postcode: _p, ...rest } = m;
      return pc ? { ...rest, postcode: pc } : rest;
    }),
  });
}

/**
 * De geschiedenis blijft; wat nog moest komen vervalt (diensten, tijden, open aanvragen, toekomstig verlof).
 * Wensen blijven staan: die tellen niet meer mee zodra iemand niet actief is.
 */
export function verwijderMedewerker(id: string) {
  const m = state.medewerkers.find((x) => x.id === id);
  if (!m) return;
  const vandaag = todayIso(), op = nowStamp();
  const cel = { ...(state.rooster[m.regio]?.[id] ?? {}) };
  for (const d of Object.keys(cel)) if (d > vandaag) delete cel[d];
  const tijdenRij = Object.fromEntries(Object.entries(state.tijden[m.regio]?.[id] ?? {}).filter(([d]) => d <= vandaag));
  const pub = state.publicaties[m.regio];
  const pubRij = pub ? Object.fromEntries(Object.entries(pub.cellen[id] ?? {}).filter(([d]) => d <= vandaag)) : null;
  const reden = `${m.naam} is uit het team`;
  set({
    medewerkers: state.medewerkers.map((x) => (x.id === id ? { ...x, actief: false } : x)),
    rooster: { ...state.rooster, [m.regio]: { ...(state.rooster[m.regio] ?? {}), [id]: cel } },
    publicaties: pub && pubRij ? { ...state.publicaties, [m.regio]: { ...pub, cellen: { ...pub.cellen, [id]: pubRij } } } : state.publicaties,
    tijden: { ...state.tijden, [m.regio]: { ...(state.tijden[m.regio] ?? {}), [id]: tijdenRij } },
    verlof: state.verlof.map((v) => {
      if (v.medewerkerId !== id) return v;
      if (v.status === 'aangevraagd' || (v.status === 'goedgekeurd' && v.van > vandaag)) return { ...v, status: 'ingetrokken', beoordeeld: op, beoordeelaar: 'systeem', reden };
      if (v.status === 'goedgekeurd' && v.tot > vandaag) return { ...v, tot: vandaag };
      return v;
    }),
    ruil: state.ruil.map((r) => ((r.aanbiederId === id || r.ontvangerId === id) && (r.status === 'open' || r.status === 'wacht_planner') ? { ...r, status: 'ingetrokken', beoordeeld: op, beoordeelaar: 'systeem', reden } : r)),
    activiteit: metLog(log('team', `${m.naam} verwijderd uit ${m.regio}`, { regio: m.regio })),
  });
}

/** Alleen in de lokale modus en de testomgeving. */
export function voorbeeldTeamToevoegen(regio: string) {
  if (db) throw new Error('Een voorbeeldteam kan alleen in de testomgeving.');
  const team = voorbeeldTeam(regio, nieuwId);
  const wat = 'Voorbeeldteam';
  // bij de NBD ook voorkeuren per uur, zodat rooster maken er meteen mee rekent
  const profielen = isNbd(regio) ? { ...state.profielen, ...nbdVoorbeeldVoorkeuren(team, nowStamp()) } : state.profielen;
  set({ medewerkers: [...state.medewerkers, ...team], profielen, activiteit: metLog(log('team', `${wat} (${team.length}) toegevoegd aan ${regio === NBD ? NBD_NAAM : regio}`, { regio })) });
}

export function zetCellen(regio: string, wijzigingen: Wijziging[]) {
  if (!wijzigingen.length) return;
  set({ rooster: { ...state.rooster, [regio]: pasToe(state.rooster[regio] ?? {}, wijzigingen) } });
}

export interface ImportRij {
  /** De naam wordt "AMS 01"; namen uit het bestand worden niet gelezen. */
  nr: number;
  contract: number;
  cadans: number;
  groep: number;
  /** null voor een nieuwe medewerker. */
  medewerkerId: string | null;
  diensten: Record<string, DienstCode>;
  /** Wens "vrij" (RV, NB). */
  wensVrij: string[];
}

/** Verlof en ziekte die al in het rooster staan, blijven staan. Met alleenLeeg worden alleen lege vakjes gevuld. */
export function importeerJaarrooster(regio: string, afk: string, rijen: ImportRij[], opts: { alleenLeeg: boolean }, door: string): { nieuw: number; diensten: number; wensen: number } {
  let medewerkers = state.medewerkers;
  const w: Wijziging[] = [];
  const nieuweWensen: Wens[] = [];
  let nieuw = 0;
  const huidig = state.rooster[regio] ?? {};
  for (const r of rijen) {
    const naam = `${afk} ${String(r.nr).padStart(2, '0')}`;
    let id = r.medewerkerId && medewerkers.some((m) => m.id === r.medewerkerId) ? r.medewerkerId : null;
    if (!id) {
      const bestaand = medewerkers.find((m) => m.regio === regio && m.naam === naam && m.actief);
      if (bestaand) {
        id = bestaand.id;
        medewerkers = medewerkers.map((m) => (m.id === id ? { ...m, contract: r.contract, weekendCadans: r.cadans, weekendgroep: r.groep } : m));
      } else {
        id = nieuwId();
        nieuw++;
        medewerkers = [...medewerkers, { id, regio, naam, contract: r.contract, voorkeur: 'O', weekendgroep: r.groep, weekendCadans: r.cadans, functie: 'UV', actief: true }];
      }
    }
    for (const [d, code] of Object.entries(r.diensten)) {
      const nu = huidig[id]?.[d] ?? '-';
      if (nu === 'V' || nu === 'Z' || nu === code) continue;
      if (opts.alleenLeeg && nu !== '-') continue;
      w.push([id, d, code]);
    }
    for (const d of r.wensVrij) {
      if (!state.wensen.some((x) => x.medewerkerId === id && x.datum === d)) nieuweWensen.push({ id: nieuwId(), medewerkerId: id, regio, datum: d, soort: 'vrij', opmerking: WENS_JAARROOSTER, gemaakt: nowStamp() });
    }
  }
  set({
    medewerkers,
    rooster: { ...state.rooster, [regio]: pasToe(huidig, w) },
    wensen: nieuweWensen.length ? [...state.wensen, ...nieuweWensen] : state.wensen,
    activiteit: metLog(log('rooster', `Jaarrooster geïmporteerd in ${regio}: ${rijen.length} medewerkers (${nieuw} nieuw), ${w.length} diensten`, { regio, door })),
  });
  return { nieuw, diensten: w.length, wensen: nieuweWensen.length };
}

/** ZZP'ers staan voorlopig niet in het rooster. */
export function wisDienstenExternen(regio: string, vanaf = addDays(todayIso(), 1)): number {
  const externen = state.medewerkers.filter((m) => m.regio === regio && m.extern).map((m) => m.id);
  const w: Wijziging[] = [];
  for (const mid of externen) for (const [d, c] of Object.entries(state.rooster[regio]?.[mid] ?? {})) if (d >= vanaf && c !== '-') w.push([mid, d, '-']);
  if (!w.length) return 0;
  if (isNbd(regio)) zetNbdDiensten(w.map(([m, d]) => [m, d, '-', null] as NbdWijziging));
  else zetCellen(regio, w);
  return w.length;
}

export function zetNbd(patch: Partial<NbdParameters>) {
  set({ nbd: nbdParameters({ ...state.nbd, ...patch }) });
}

export function nbdTerug() {
  set({ nbd: NBD_STANDAARD });
}

/** Wordt een vakje iets anders dan N, dan gaan de tijden weg; bij ziekte en verlof blijven ze, zodat herstel de dienst terugzet. */
export function zetNbdDiensten(wijzigingen: NbdWijziging[]) {
  if (!wijzigingen.length) return;
  const tijden = nbdTijdenNa(state.tijden[NBD], wijzigingen);
  set({
    rooster: { ...state.rooster, [NBD]: pasToe(state.rooster[NBD] ?? {}, wijzigingen.map(([m, d, c]) => [m, d, c] as Wijziging)) },
    tijden: { ...state.tijden, [NBD]: tijden },
  });
}

export function roosterVersie(regio: string, van: string, tot: string): string {
  return versieRegio(regio, state.rooster[regio] ?? {}, state.tijden[regio], state.medewerkers.filter((m) => m.regio === regio).map((m) => m.id), van, tot);
}

/** Bij de NBD tellen tijden en pauzes mee. */
function versieRegio(regio: string, c: Cellen, tijden: Record<string, Record<string, Tijd>> | undefined, team: string[], van: string, tot: string): string {
  const v = versieVan(c, team, van, tot);
  if (regio !== NBD) return v;
  const t: Cellen = {};
  for (const mid of team) {
    for (const [d, x] of Object.entries(tijden?.[mid] ?? {})) {
      // de taken alleen als ze er zijn: zo blijft de vingerafdruk van een rooster zonder taken gelijk aan eerder
      if (c[mid]?.[d] === 'N') (t[mid] ??= {})[d] = `${x.start}-${x.eind}-${x.pauze ?? 0}-${x.pauzeStart ?? ''}${x.taken?.length ? `-${x.taken.map((k) => `${k.soort}${k.van}-${k.tot}`).join('.')}` : ''}` as DienstCode;
    }
  }
  return `${v}|${versieVan(t, team, van, tot).split('|')[2]}`;
}

function versieVan(c: Cellen, teamIds: string[], van: string, tot: string): string {
  const team = [...teamIds].sort();
  let h = 5381;
  for (const mid of team) {
    for (const [d, x] of Object.entries(c[mid] ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (d < van || d > tot) continue;
      for (const ch of `${mid}${d}${x};`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
    }
  }
  return `${van}|${tot}|${(h >>> 0).toString(36)}`;
}

export function goedkeuringVan(regio: string, maand: Maand): Goedkeuring | undefined {
  return state.goedkeuringen[regio]?.[maand];
}

export function maandVastgesteld(regio: string, maand: Maand): boolean {
  const g = goedkeuringVan(regio, maand);
  return !!g && g.status === 'goedgekeurd' && !!g.advies;
}

function zetGoedkeuring(g: Goedkeuring): Pick<AppState, 'goedkeuringen'> {
  return { goedkeuringen: { ...state.goedkeuringen, [g.regio]: { ...(state.goedkeuringen[g.regio] ?? {}), [g.maand]: g } } };
}

export function vraagGoedkeuring(regio: string, maand: Maand, toets: { cijfer: number; hard: number }, door: string, advies: { kleur: AdviesKleur; toelichting?: string; voorstel?: AdviesKleur }) {
  if (!isMaand(maand)) throw new Error('Onbekende maand');
  if (maandEind(maand) < todayIso()) throw new Error('Deze maand is al voorbij');
  if (maandVastgesteld(regio, maand)) throw new Error(`Het rooster van ${maandNaam(maand)} is al vastgesteld`);
  if (toets.hard > 0) throw new Error('Los eerst de overtredingen van ATW en CAO op');
  const fout = adviesFout(advies?.kleur, advies?.toelichting);
  if (fout) throw new Error(fout);
  const op = nowStamp();
  const toelichting = advies.toelichting?.trim() || undefined;
  const vorig = goedkeuringVan(regio, maand);
  const g: Goedkeuring = {
    regio, maand, status: 'ter_goedkeuring', versie: roosterVersie(regio, maandStart(maand), maandEind(maand)), cijfer: toets.cijfer, hard: toets.hard, aangevraagd: op, door,
    advies: { kleur: advies.kleur, toelichting, voorstel: advies.voorstel, door, op },
    geschiedenis: [...(vorig?.geschiedenis ?? []), { soort: 'advies', op, door, kleur: advies.kleur, toelichting, cijfer: toets.cijfer }],
  };
  set({ ...zetGoedkeuring(g), activiteit: metLog(log('goedkeuring', `Rooster ${regio} ${maandNaam(maand)} ter goedkeuring aangeboden met advies ${advies.kleur} (cijfer ${String(toets.cijfer).replace('.', ',')})`, { regio, door })) });
}

export function aangepastNaAdvies(regio: string, maand: Maand): boolean {
  const g = goedkeuringVan(regio, maand);
  return !!g && g.status === 'ter_goedkeuring' && g.versie !== roosterVersie(regio, maandStart(maand), maandEind(maand));
}

export function beoordeelRooster(regio: string, maand: Maand, besluit: 'goedgekeurd' | 'afgekeurd', door: string, reden?: string) {
  const g = goedkeuringVan(regio, maand);
  if (!g || g.status !== 'ter_goedkeuring') return;
  if (!g.advies) throw new Error('Er is nog geen advies van de planner. Zonder advies kan het rooster niet worden beoordeeld.');
  if (besluit === 'goedgekeurd' && g.advies.kleur === 'rood' && !reden?.trim()) throw new Error('De planner adviseert rood. Licht toe waarom je het rooster toch goedkeurt.');
  if (besluit === 'afgekeurd' && !reden?.trim()) throw new Error('Geef aan wat er anders moet');
  const op = nowStamp();
  const r = reden?.trim() || undefined;
  set({
    ...zetGoedkeuring({ ...g, status: besluit, versie: roosterVersie(regio, maandStart(maand), maandEind(maand)), beoordeeld: op, beoordeelaar: door, reden: r, geschiedenis: [...g.geschiedenis, { soort: besluit, op, door, reden: r }] }),
    activiteit: metLog(log('goedkeuring', `Rooster ${regio} ${maandNaam(maand)} ${besluit}${r ? `: ${r}` : ''}`, { regio, door })),
  });
}

export function publiceer(regio: string, van: string, tot: string, door: string) {
  if (state.beleid.goedkeuringVerplicht) {
    const open = maandenTussen(van, tot).find((m) => !maandVastgesteld(regio, m));
    if (open) throw new Error(`Het rooster van ${maandNaam(open)} is nog niet vastgesteld: eerst een advies van de planner en goedkeuring van de regiomanager (roosterbeleid § 5.1)`);
  }
  const vorige = state.publicaties[regio];
  // geen gat in het gepubliceerde rooster: medewerkers zouden daar ten onrechte vrij zien
  const aansluiting = vorige && vorige.tot >= todayIso() ? addDays(vorige.tot, 1) : todayIso();
  if (van > aansluiting) throw new Error(`Publiceer aansluitend vanaf ${fmtD(aansluiting)}, zodat er geen gat in het gepubliceerde rooster zit`);
  // externen staan voorlopig niet in het rooster: hun diensten gaan ook niet mee in de publicatie
  const team = new Set(state.medewerkers.filter((m) => m.regio === regio && (ZZP_IN_ROOSTER || !m.extern)).map((m) => m.id));
  const bron = state.rooster[regio] ?? {};
  const cellen: Cellen = {};
  for (const [mid, rij] of Object.entries(bron)) {
    if (!team.has(mid)) continue;
    cellen[mid] = Object.fromEntries(Object.entries(rij).filter(([d]) => d >= van && d <= tot));
  }
  // eerder gepubliceerde dagen buiten deze periode blijven zichtbaar
  if (vorige) {
    for (const [mid, rij] of Object.entries(vorige.cellen)) {
      for (const [d, s] of Object.entries(rij)) if (d < van || d > tot) (cellen[mid] ??= {})[d] = s;
    }
  }
  const pub: Publicatie = {
    regio, op: nowStamp(), door,
    van: vorige && vorige.van < van ? vorige.van : van,
    tot: vorige && vorige.tot > tot ? vorige.tot : tot,
    cellen,
    vorige: vorige ? { op: vorige.op, cellen: vorige.cellen } : undefined,
  };
  set({
    publicaties: { ...state.publicaties, [regio]: pub },
    activiteit: metLog(log('rooster', `Rooster ${regio} gepubliceerd t/m ${fmtD(tot)}`, { regio, door, regioBreed: true })),
  });
}

export function zetTijd(regio: string, medewerkerId: string, datum: string, tijd: Tijd | null, door: string) {
  const code = zichtbaar(regio)[medewerkerId]?.[datum];
  if (tijd) {
    if (!code || !DIENSTEN[code].werk) throw new Error('Op deze dag staat geen dienst');
    if (!(tijd.start >= 0 && tijd.eind <= 24 && tijd.eind > tijd.start)) throw new Error('De eindtijd moet na de begintijd liggen');
    if (tijd.eind - tijd.start > state.beleid.maxDagUren) throw new Error(`Een dienst duurt maximaal ${state.beleid.maxDagUren} uur (ATW)`);
  }
  const regioTijden = { ...(state.tijden[regio] ?? {}) };
  const rij = { ...(regioTijden[medewerkerId] ?? {}) };
  if (tijd) rij[datum] = { start: tijd.start, eind: tijd.eind, code }; else delete rij[datum];
  regioTijden[medewerkerId] = rij;
  const m = state.medewerkers.find((x) => x.id === medewerkerId);
  const tekst = tijd ? `Tijden ${code} op ${fmtD(datum)} voor ${m?.naam}: ${uurTekst(tijd.start)}–${uurTekst(tijd.eind)}` : `Tijden op ${fmtD(datum)} voor ${m?.naam} terug naar standaard`;
  set({ tijden: { ...state.tijden, [regio]: regioTijden }, activiteit: metLog(log('tijden', tekst, { regio, voor: medewerkerId, door })) });
}

/** Ziekte, verlof, ruilen en bijsturen gaan meteen ook in het gepubliceerde rooster: de planner heeft ze al beoordeeld. */
function doorvoer(regio: string, w: Wijziging[], tijdenNa = state.tijden[regio]): Pick<AppState, 'rooster' | 'publicaties' | 'goedkeuringen'> {
  const voor = state.rooster[regio] ?? {};
  const na = pasToe(voor, w);
  let publicaties = state.publicaties, goedkeuringen = state.goedkeuringen;
  const pub = state.publicaties[regio];
  if (pub) {
    const binnen = w.filter(([, d]) => d >= pub.van && d <= pub.tot);
    if (binnen.length) publicaties = { ...publicaties, [regio]: { ...pub, cellen: pasToe(pub.cellen, binnen) } };
  }
  // lopende zaken tellen niet als aanpassing na het advies: de vingerafdruk van die maand gaat mee
  const team = state.medewerkers.filter((m) => m.regio === regio).map((m) => m.id);
  for (const m of new Set(w.map(([, d]) => maandVan(d)))) {
    const g = state.goedkeuringen[regio]?.[m];
    // alleen een aangeboden maand: daar ziet de regiomanager of er na het advies nog iets veranderde
    if (!g || g.status !== 'ter_goedkeuring') continue;
    const [van, tot] = [maandStart(m), maandEind(m)];
    if (versieRegio(regio, voor, state.tijden[regio], team, van, tot) === g.versie) goedkeuringen = { ...goedkeuringen, [regio]: { ...(goedkeuringen[regio] ?? {}), [m]: { ...g, versie: versieRegio(regio, na, tijdenNa, team, van, tot) } } };
  }
  return { rooster: { ...state.rooster, [regio]: na }, publicaties, goedkeuringen };
}

export function voegVerschuivingToe(v: Omit<Verschuiving, 'id' | 'gemaakt'>): Verschuiving {
  if (v.vanRegio === v.naarRegio) throw new Error('Kies twee verschillende regio\'s');
  if (v.tot < v.van) throw new Error('De einddatum ligt voor de begindatum');
  if (!(v.plekken >= 1 && v.plekken <= 5)) throw new Error('Kies 1 tot en met 5 regelplekken');
  const x: Verschuiving = { ...v, opmerking: v.opmerking?.trim() || undefined, id: nieuwId(), gemaakt: nowStamp() };
  const periode = x.van === x.tot ? `op ${fmtD(x.van)}` : `van ${fmtD(x.van)} t/m ${fmtD(x.tot)}`;
  set({
    verschuivingen: [...state.verschuivingen, x],
    activiteit: metLog(log('rooster', `${plural(x.plekken, 'regelplek', 'regelplekken')} van ${x.vanRegio} naar ${x.naarRegio} ${periode}`, { regio: x.vanRegio, door: x.door })),
  });
  return x;
}

export function verwijderVerschuiving(id: string, door: string) {
  const x = state.verschuivingen.find((v) => v.id === id);
  if (!x) return;
  set({
    verschuivingen: state.verschuivingen.filter((v) => v.id !== id),
    activiteit: metLog(log('rooster', `Verschuiving van ${x.vanRegio} naar ${x.naarRegio} (${fmtD(x.van)} t/m ${fmtD(x.tot)}) weggehaald`, { regio: x.vanRegio, door })),
  });
}

export function meldZiek(medewerkerId: string, van: string, tot: string, door: string): Ziekmelding {
  const m = state.medewerkers.find((x) => x.id === medewerkerId);
  if (!m) throw new Error('Medewerker niet gevonden');
  if (tot < van) throw new Error('De einddatum ligt voor de begindatum');
  const huidig = state.rooster[m.regio]?.[m.id] ?? {};
  const vervangen: Record<string, DienstCode> = {};
  const voor: NonNullable<Ziekmelding['voor']> = {};
  const w: Wijziging[] = [];
  for (const d of isoRange(van, tot)) {
    const s = huidig[d];
    if (s && DIENSTEN[s].werk) { vervangen[d] = s; voor[d] = bezettingOp(m.regio, d); w.push([m.id, d, 'Z']); }
  }
  const z: Ziekmelding = { id: nieuwId(), medewerkerId, regio: m.regio, van, tot, gemeld: nowStamp(), door, vervangen, voor, status: 'ziek' };
  set({
    ...doorvoer(m.regio, w),
    ziekmeldingen: [z, ...state.ziekmeldingen],
    activiteit: metLog(log('ziek', `${m.naam} ziek gemeld ${van === tot ? `op ${fmtD(van)}` : `van ${fmtD(van)} t/m ${fmtD(tot)}`}: ${w.length} dienst${w.length === 1 ? '' : 'en'} op te vangen`, { regio: m.regio, door })),
  });
  return z;
}

function bezettingOp(regio: string, datum: string, zonder?: string): { plekken: number; dg: number } {
  let plekken = 0, dg = 0;
  for (const m of state.medewerkers) {
    if (m.regio !== regio || m.id === zonder) continue;
    const def = DIENSTEN[state.rooster[regio]?.[m.id]?.[datum] ?? '-'];
    plekken += def.plekken;
    if (def.categorie === 'dossier') dg++;
  }
  return { plekken, dg };
}

/** Heeft een collega de dienst intussen overgenomen, dan blijft die bij de collega; anders zou er iemand dubbel staan. */
export function herstelZiek(id: string, vanaf: string, door: string) {
  const z = state.ziekmeldingen.find((x) => x.id === id);
  if (!z || z.status !== 'ziek') return;
  const huidig = state.rooster[z.regio]?.[z.medewerkerId] ?? {};
  const w: Wijziging[] = [];
  const overgenomen: string[] = [];
  for (const [d, s] of Object.entries(z.vervangen)) {
    if (d < vanaf || huidig[d] !== 'Z') continue;
    const was = z.voor?.[d];
    if (was) {
      const nu = bezettingOp(z.regio, d, z.medewerkerId);
      const def = DIENSTEN[s];
      const dubbel = (def.plekken > 0 && nu.plekken + def.plekken > was.plekken) || (def.categorie === 'dossier' && nu.dg + 1 > was.dg);
      if (dubbel) { overgenomen.push(d); w.push([z.medewerkerId, d, '-']); continue; }
    }
    w.push([z.medewerkerId, d, s]);
  }
  const m = state.medewerkers.find((x) => x.id === z.medewerkerId);
  const extra = overgenomen.length ? `; ${overgenomen.length === 1 ? 'de dienst van' : 'de diensten van'} ${overgenomen.map(fmtD).join(', ')} ${overgenomen.length === 1 ? 'blijft' : 'blijven'} bij de collega die ${overgenomen.length === 1 ? 'hem' : 'ze'} overnam` : '';
  set({
    ...doorvoer(z.regio, w),
    ziekmeldingen: state.ziekmeldingen.map((x) => (x.id === id ? { ...x, status: 'hersteld', tot: addDays(vanaf, -1) < x.van ? x.van : addDays(vanaf, -1) } : x)),
    activiteit: metLog(log('ziek', `${m?.naam ?? 'Medewerker'} hersteld per ${fmtD(vanaf)}${extra}`, { regio: z.regio, door }), ...(overgenomen.length ? [log('ziek', `Welkom terug. Op ${overgenomen.map(fmtD).join(', ')} heeft een collega je dienst overgenomen; je bent die ${overgenomen.length === 1 ? 'dag' : 'dagen'} vrij.`, { regio: z.regio, voor: z.medewerkerId, door })] : [])),
  });
}

/** Is het rooster op die dagen nog zoals toen de actie werd berekend? Anders zou de actie een collega overschrijven. */
function controleerGezien(regio: string, dagen: string[], gezien: Cellen | undefined) {
  if (!gezien) return;
  const nu = state.rooster[regio] ?? {};
  const ids = new Set([...Object.keys(nu), ...Object.keys(gezien)]);
  for (const d of new Set(dagen)) {
    for (const id of ids) {
      if ((nu[id]?.[d] ?? '-') !== (gezien[id]?.[d] ?? '-')) {
        throw new Error('Het rooster is intussen gewijzigd, bijvoorbeeld door een collega. De actie is niet doorgevoerd; bekijk hem opnieuw.');
      }
    }
  }
}

export function pasNbdBijsturingToe(wijzigingen: NbdWijziging[], tekst: string, door: string, gezien?: Cellen) {
  if (!wijzigingen.length) return;
  controleerGezien(NBD, wijzigingen.map((w) => w[1]), gezien);
  const tijden = nbdTijdenNa(state.tijden[NBD], wijzigingen);
  const voor = [...new Set(wijzigingen.map((w) => w[0]))];
  set({
    ...doorvoer(NBD, wijzigingen.map(([m, d, c]) => [m, d, c] as Wijziging), tijden),
    tijden: { ...state.tijden, [NBD]: tijden },
    activiteit: metLog(log('bijsturen', tekst, { regio: NBD, door }), ...voor.map((mid) => log('bijsturen', `Je rooster is bijgestuurd: ${tekst}`, { regio: NBD, voor: mid, door }))),
  });
}

export function pasBijsturingToe(regio: string, wijzigingen: Wijziging[], tekst: string, door: string, gezien?: Cellen) {
  controleerGezien(regio, wijzigingen.map((w) => w[1]), gezien);
  const voor = [...new Set(wijzigingen.map((w) => w[0]))];
  set({
    ...(wijzigingen.length ? doorvoer(regio, wijzigingen) : {}),
    activiteit: metLog(log('bijsturen', tekst, { regio, door }), ...voor.map((mid) => log('bijsturen', `Je rooster is bijgestuurd: ${tekst}`, { regio, voor: mid, door }))),
  });
}

/** De dagen in deze periode waarop de medewerker in het goedgekeurde, gepubliceerde rooster een dienst heeft. */
export function ingeroosterdOp(medewerkerId: string, van: string, tot: string): string[] {
  const m = state.medewerkers.find((x) => x.id === medewerkerId);
  const pub = m ? state.publicaties[m.regio] : undefined;
  if (!m || !pub || tot < van) return [];
  return isoRange(van, tot).filter((d) => d >= pub.van && d <= pub.tot && DIENSTEN[pub.cellen[m.id]?.[d] ?? '-'].werk);
}

/**
 * Is het rooster eenmaal goedgekeurd en gepubliceerd, dan kan een medewerker voor een dag waarop hij staat ingeroosterd
 * geen verlof meer aanvragen: dat gaat via een ruil (de dienst aanbieden of ruilen). Alleen wie plant kan dan nog
 * verlof invoeren (opts.planner), bijvoorbeeld bij bijzonder verlof.
 */
export function vraagVerlofAan(v: { medewerkerId: string; van: string; tot: string; soort: VerlofSoort; opmerking?: string }, door: string, opts: { planner?: boolean } = {}) {
  const m = state.medewerkers.find((x) => x.id === v.medewerkerId);
  if (!m) throw new Error('Medewerker niet gevonden');
  if (v.tot < v.van) throw new Error('De einddatum ligt voor de begindatum');
  if (!opts.planner) {
    const vast = ingeroosterdOp(v.medewerkerId, v.van, v.tot);
    if (vast.length) throw new Error(`Het rooster is al goedgekeurd en je staat ingeroosterd op ${vast.slice(0, 4).map(fmtD).join(', ')}${vast.length > 4 ? ' en meer' : ''}. Vrij nemen kan dan alleen via een ruil: bied je dienst aan of ruil hem met een collega (Ruilen).`);
  }
  const overlap = state.verlof.find((x) => x.medewerkerId === v.medewerkerId && ['aangevraagd', 'goedgekeurd'].includes(x.status) && x.van <= v.tot && x.tot >= v.van);
  if (overlap) throw new Error(`Overlapt met een verlofaanvraag van ${fmtD(overlap.van)} t/m ${fmtD(overlap.tot)}`);
  // de vakantierondes zijn per cluster of landelijk voor de regio's; de NBD besluit per aanvraag
  const ronde = m.regio === NBD ? undefined : state.vakantierondes.find((r) => r.fase !== 'besloten' && (r.cluster === 'NL' || r.cluster === REGION_CLUSTER[m.regio]) && v.van <= r.tot && v.tot >= r.van);
  const nieuw: Verlof = { id: nieuwId(), regio: m.regio, status: 'aangevraagd', aangevraagd: nowStamp(), rondeId: ronde?.id, ...v };
  set({ verlof: [nieuw, ...state.verlof], activiteit: metLog(log('verlof', `${m.naam} vraagt verlof aan: ${fmtD(v.van)} t/m ${fmtD(v.tot)}`, { regio: m.regio, door })) });
  return nieuw;
}

export function beoordeelVerlof(id: string, besluit: 'goedgekeurd' | 'afgewezen', door: string, reden?: string) {
  const v = state.verlof.find((x) => x.id === id);
  if (!v || v.status !== 'aangevraagd') return;
  const m = state.medewerkers.find((x) => x.id === v.medewerkerId);
  let roosterPatch: Partial<AppState> = {};
  let vervangen: Record<string, DienstCode> | undefined;
  if (besluit === 'goedgekeurd') {
    const huidig = state.rooster[v.regio]?.[v.medewerkerId] ?? {};
    vervangen = {};
    const w: Wijziging[] = [];
    for (const d of isoRange(v.van, v.tot)) {
      if (huidig[d] && huidig[d] !== 'V') vervangen[d] = huidig[d];
      w.push([v.medewerkerId, d, 'V']);
    }
    roosterPatch = doorvoer(v.regio, w);
  }
  const tekst = `Verlof ${fmtD(v.van)} t/m ${fmtD(v.tot)} van ${m?.naam ?? 'medewerker'} ${besluit}`;
  set({
    ...roosterPatch,
    verlof: state.verlof.map((x) => (x.id === id ? { ...x, status: besluit, beoordeeld: nowStamp(), beoordeelaar: door, reden, vervangen } : x)),
    activiteit: metLog(log('verlof', tekst + (reden ? `: ${reden}` : ''), { regio: v.regio, voor: v.medewerkerId, door })),
  });
}

/** Begonnen verlof eindigt gisteren; alleen de dagen vanaf vandaag krijgen hun dienst terug. */
export function trekVerlofIn(id: string, door: string) {
  const v = state.verlof.find((x) => x.id === id);
  if (!v || !['aangevraagd', 'goedgekeurd'].includes(v.status)) return;
  const vandaag = todayIso();
  const m = state.medewerkers.find((x) => x.id === v.medewerkerId);
  if (v.status === 'goedgekeurd' && v.tot < vandaag) throw new Error('Dit verlof is al voorbij en kan niet meer worden ingetrokken');
  const lopend = v.status === 'goedgekeurd' && v.van < vandaag;
  let roosterPatch: Partial<AppState> = {};
  if (v.status === 'goedgekeurd') {
    const huidig = state.rooster[v.regio]?.[v.medewerkerId] ?? {};
    const w: Wijziging[] = isoRange(lopend ? vandaag : v.van, v.tot).filter((d) => huidig[d] === 'V').map((d) => [v.medewerkerId, d, v.vervangen?.[d] ?? '-']);
    roosterPatch = doorvoer(v.regio, w);
  }
  const gisteren = addDays(vandaag, -1);
  const vervangen = (x: Verlof) => (x.vervangen ? Object.fromEntries(Object.entries(x.vervangen).filter(([d]) => d <= gisteren)) : undefined);
  set({
    ...roosterPatch,
    verlof: state.verlof.map((x) => (x.id !== id ? x : lopend ? { ...x, tot: gisteren, vervangen: vervangen(x) } : { ...x, status: 'ingetrokken', beoordeeld: nowStamp(), beoordeelaar: door })),
    activiteit: metLog(log('verlof', lopend
      ? `Verlof ${fmtD(v.van)} t/m ${fmtD(v.tot)} van ${m?.naam ?? 'medewerker'} ingekort: het eindigt op ${fmtD(gisteren)}`
      : `Verlof ${fmtD(v.van)} t/m ${fmtD(v.tot)} van ${m?.naam ?? 'medewerker'} ingetrokken`, { regio: v.regio, voor: v.medewerkerId, door })),
  });
}

export function openVakantieronde(r: Omit<Vakantieronde, 'id' | 'fase' | 'gemaakt' | 'door'>, door: string): Vakantieronde {
  if (r.tot < r.van) throw new Error('De einddatum ligt voor de begindatum');
  const ronde: Vakantieronde = { ...r, id: nieuwId(), fase: 'planning', gemaakt: nowStamp(), door };
  // lopende aanvragen in de periode horen er ook bij
  const regios = new Set(regionsInScope(r.cluster === 'NL' ? 'NL' : `C:${r.cluster}`));
  set({
    vakantierondes: [ronde, ...state.vakantierondes],
    verlof: state.verlof.map((v) => (v.status === 'aangevraagd' && !v.rondeId && regios.has(v.regio) && v.van <= r.tot && v.tot >= r.van ? { ...v, rondeId: ronde.id } : v)),
    // een bericht voor de regio's waar deze gebruiker bij mag (anders weigert de database het)
    activiteit: metLog(...[...regios].filter((regio) => !regiosNu || regiosNu.includes(regio)).map((regio) => log('verlof', `Vakantieronde ${r.naam} geopend: vraag je vakantie aan vóór ${fmtD(r.data.aanvragen)}`, { regio, door, regioBreed: true }))),
  });
  return ronde;
}

export function zetVakantieFase(id: string, fase: VakantieFase, door: string) {
  const r = state.vakantierondes.find((x) => x.id === id);
  if (!r) return;
  set({
    vakantierondes: state.vakantierondes.map((x) => (x.id === id ? { ...x, fase } : x)),
    activiteit: metLog(log('verlof', `Vakantieronde ${r.naam}: ${fase === 'besloten' ? 'besluit genomen' : `door naar ${fase}`}`, { door })),
  });
}

/** Met de gedeelde database sluit de database de ronde af: een regiomanager ziet niet alle regio's. */
export function besluitVakantieronde(id: string, besluiten: Record<string, 'goedgekeurd' | 'afgewezen'>, door: string, reden?: string) {
  for (const [vid, b] of Object.entries(besluiten)) beoordeelVerlof(vid, b, door, b === 'afgewezen' ? reden ?? 'Geen ruimte in deze periode (vakantieronde)' : undefined);
  const r = state.vakantierondes.find((x) => x.id === id);
  if (!r) return;
  const open = state.verlof.some((v) => v.rondeId === id && v.status === 'aangevraagd');
  if (!db && !open) { zetVakantieFase(id, 'besloten', door); return; }
  set({ activiteit: metLog(log('verlof', `Vakantieronde ${r.naam}: besluit genomen over ${Object.keys(besluiten).length} aanvragen`, { door })) });
}

export function zetWens(medewerkerId: string, datum: string, soort: WensSoort | null, opmerking?: string) {
  const m = state.medewerkers.find((x) => x.id === medewerkerId);
  if (!m) return;
  const was = state.wensen.find((w) => w.medewerkerId === medewerkerId && w.datum === datum);
  if (!soort) {
    if (was) set({ wensen: state.wensen.filter((w) => w !== was) });
    return;
  }
  // dezelfde rij bijwerken: weghalen en opnieuw toevoegen botst in de database op één wens per dag
  const wens: Wens = { id: was?.id ?? nieuwId(), medewerkerId, regio: m.regio, datum, soort, opmerking, gemaakt: was?.gemaakt ?? nowStamp() };
  set({ wensen: was ? state.wensen.map((w) => (w === was ? wens : w)) : [...state.wensen, wens] });
}

/**
 * De vaste voorkeuren overnemen op deze dagen ("Standaard overnemen"): alleen waar nog geen wens staat, niet in het
 * verleden en niet tijdens (aangevraagd) verlof. Daarna past de medewerker losse dagen aan. Geeft het aantal nieuwe
 * wensen.
 */
export function neemStandaardOver(medewerkerId: string, dagen: string[]): number {
  const m = state.medewerkers.find((x) => x.id === medewerkerId);
  if (!m) return 0;
  const vandaag = todayIso();
  const overslaan = new Set(state.wensen.filter((w) => w.medewerkerId === medewerkerId).map((w) => w.datum));
  const verlof = state.verlof.filter((v) => v.medewerkerId === medewerkerId && (v.status === 'aangevraagd' || v.status === 'goedgekeurd'));
  for (const d of dagen) if (d < vandaag || verlof.some((v) => v.van <= d && v.tot >= d)) overslaan.add(d);
  const gemaakt = nowStamp();
  const nieuw: Wens[] = standaardWensen(state.profielen[medewerkerId], dagen, overslaan).map((w) => ({ id: nieuwId(), medewerkerId, regio: m.regio, datum: w.datum, soort: w.soort, gemaakt }));
  if (nieuw.length) set({ wensen: [...state.wensen, ...nieuw] });
  return nieuw.length;
}

/** De wensen op deze dagen weghalen (niet in het verleden). Geeft het aantal. */
export function wisWensen(medewerkerId: string, dagen: string[]): number {
  const vandaag = todayIso(), weg = new Set(dagen.filter((d) => d >= vandaag));
  const blijft = state.wensen.filter((w) => !(w.medewerkerId === medewerkerId && weg.has(w.datum)));
  const n = state.wensen.length - blijft.length;
  if (n) set({ wensen: blijft });
  return n;
}

function profielVan(medewerkerId: string): Voorkeurprofiel {
  return state.profielen[medewerkerId] ?? LEEG_PROFIEL(medewerkerId);
}

export function bewaarProfiel(medewerkerId: string, patch: Partial<Omit<Voorkeurprofiel, 'medewerkerId' | 'bijgewerkt'>>) {
  const p: Voorkeurprofiel = { ...profielVan(medewerkerId), ...patch, medewerkerId, bijgewerkt: nowStamp() };
  set({ profielen: { ...state.profielen, [medewerkerId]: p } });
}

export function openRonde(r: { regio: string; van: string; tot: string; deadline: string }, door: string): Voorkeurronde {
  if (r.tot < r.van) throw new Error('De einddatum ligt voor de begindatum');
  if (state.rondes.some((x) => x.regio === r.regio && x.status === 'open')) throw new Error(`Er loopt al een voorkeurenronde in ${r.regio}`);
  const ronde: Voorkeurronde = { id: nieuwId(), ...r, status: 'open', geopend: nowStamp(), door, ingediend: {} };
  set({
    rondes: [ronde, ...state.rondes],
    activiteit: metLog(log('voorkeur', `Voorkeurenronde ${r.regio} geopend voor ${fmtD(r.van)} t/m ${fmtD(r.tot)}, uiterlijk ${fmtD(r.deadline)} invullen`, { regio: r.regio, door, regioBreed: true })),
  });
  return ronde;
}

export function sluitRonde(id: string, door: string) {
  const r = state.rondes.find((x) => x.id === id);
  if (!r || r.status !== 'open') return;
  set({
    rondes: state.rondes.map((x) => (x.id === id ? { ...x, status: 'gesloten' } : x)),
    activiteit: metLog(log('voorkeur', `Voorkeurenronde ${r.regio} gesloten (${Object.keys(r.ingediend).length} ingediend)`, { regio: r.regio, door })),
  });
}

export function dienVoorkeurenIn(rondeId: string, medewerkerId: string) {
  const r = state.rondes.find((x) => x.id === rondeId);
  if (!r || r.status !== 'open') throw new Error('Deze voorkeurenronde is niet meer open');
  set({ rondes: state.rondes.map((x) => (x.id === rondeId ? { ...x, ingediend: { ...x.ingediend, [medewerkerId]: nowStamp() } } : x)) });
}

/** De twee wisselen in beide verlofperiodes hun roosterrij; de dekking blijft gelijk. */
function verlofRuilWijzigingen(r: Ruil, ontvangerId: string): Wijziging[] {
  const a = state.verlof.find((v) => v.id === r.verlofId), b = state.verlof.find((v) => v.id === r.tegenVerlofId);
  if (!a || !b) return [];
  const c = zichtbaar(r.regio);
  const dagen = [...new Set([...isoRange(a.van, a.tot), ...isoRange(b.van, b.tot)])];
  const out: Wijziging[] = [];
  for (const d of dagen) {
    const x = c[r.aanbiederId]?.[d] ?? '-', y = c[ontvangerId]?.[d] ?? '-';
    if (x === y) continue;
    out.push([r.aanbiederId, d, y], [ontvangerId, d, x]);
  }
  return out;
}

function ruilWijzigingen(r: Ruil, ontvangerId: string): Wijziging[] {
  if (r.soort === 'verlof') return verlofRuilWijzigingen(r, ontvangerId);
  if (r.soort === 'aanbieden') return [[r.aanbiederId, r.datum, '-'], [ontvangerId, r.datum, r.dienst]];
  const tegen = zichtbaar(r.regio)[ontvangerId]?.[r.tegenDatum!] ?? '-';
  if (r.datum === r.tegenDatum) return [[r.aanbiederId, r.datum, tegen], [ontvangerId, r.datum, r.dienst]];
  return [[r.aanbiederId, r.datum, '-'], [ontvangerId, r.datum, r.dienst], [ontvangerId, r.tegenDatum!, '-'], [r.aanbiederId, r.tegenDatum!, tegen]];
}

function ruilBeletsel(r: Ruil, ontvangerId = r.ontvangerId): string | null {
  const vandaag = todayIso();
  const actief = (id?: string) => !id || !!state.medewerkers.find((m) => m.id === id && m.actief);
  if (!actief(r.aanbiederId) || !actief(ontvangerId)) return 'een van beiden is niet meer in het team';
  const c = zichtbaar(r.regio);
  const cel = (mid: string, d: string) => c[mid]?.[d] ?? '-';
  if (r.soort === 'verlof') {
    const a = state.verlof.find((v) => v.id === r.verlofId), b = state.verlof.find((v) => v.id === r.tegenVerlofId);
    if (!a || !b || a.status !== 'goedgekeurd' || b.status !== 'goedgekeurd') return 'het verlof is niet meer goedgekeurd';
    if (a.van !== r.datum || b.van !== r.tegenDatum || (r.tot && a.tot !== r.tot) || (r.tegenTot && b.tot !== r.tegenTot)) return 'het verlof is intussen gewijzigd';
    if (a.van <= vandaag || b.van <= vandaag) return 'het verlof is al begonnen';
    return null;
  }
  if (r.datum < vandaag || (r.tegenDatum && r.tegenDatum < vandaag)) return 'de dag is al voorbij';
  if (cel(r.aanbiederId, r.datum) !== r.dienst) return 'de dienst is intussen gewijzigd';
  if (r.soort === 'ruilen' && ontvangerId && r.tegenDatum && r.tegenDienst && cel(ontvangerId, r.tegenDatum) !== r.tegenDienst) return 'de dienst van de collega is intussen gewijzigd';
  if (ontvangerId && r.soort === 'aanbieden' && cel(ontvangerId, r.datum) !== '-') return 'de collega is die dag niet vrij';
  if (ontvangerId && r.soort === 'ruilen' && r.tegenDatum && r.tegenDatum !== r.datum) {
    if (cel(ontvangerId, r.datum) !== '-') return 'de collega is die dag niet vrij';
    if (cel(r.aanbiederId, r.tegenDatum) !== '-') return 'je bent op de dag van de collega niet vrij';
  }
  return null;
}

/** Alleen in de browser van een planner: een medewerker mag ruilen niet laten verlopen of goedkeuren. */
function onderhoud() {
  if (db && !plant()) return;
  verloopRuilen();
  if (db) keurRuilenAutomatischGoed();
}

function keurRuilenAutomatischGoed() {
  if (!state.beleid.ruilAutomatisch) return;
  for (const r of state.ruil.filter((x) => x.status === 'wacht_planner' && x.soort !== 'verlof' && x.ontvangerId)) {
    if (ruilBeletsel(r)) continue;
    const t = toetsRuil(r, r.ontvangerId!);
    if (t.ok && !t.bevindingen.length) beoordeelRuil(r.id, 'goedgekeurd', 'automatisch');
  }
}

export function verloopRuilen() {
  if (db && !plant()) return;
  const op = nowStamp();
  const weg = state.ruil.filter((r) => (r.status === 'open' || r.status === 'wacht_planner') && ruilBeletsel(r));
  if (!weg.length) return;
  const ids = new Set(weg.map((r) => r.id));
  set({ ruil: state.ruil.map((r) => (ids.has(r.id) ? { ...r, status: 'verlopen', beoordeeld: op, beoordeelaar: 'systeem', reden: ruilBeletsel(r) ?? undefined } : r)) });
}

function verloop(r: Ruil, reden: string): never {
  // met de gedeelde database zet het onderhoud in de app van de planner de ruil op verlopen; een medewerker mag dat niet
  if (db && !plant()) throw new Error(`Deze ruil kan niet meer door: ${reden}.`);
  set({
    ruil: state.ruil.map((x) => (x.id === r.id ? { ...x, status: 'verlopen', beoordeeld: nowStamp(), beoordeelaar: 'systeem', reden } : x)),
    activiteit: metLog(log('ruil', `Ruil van ${fmtD(r.datum)} verlopen: ${reden}`, { regio: r.regio, voor: r.aanbiederId })),
  });
  throw new Error(`Deze ruil kan niet meer door: ${reden}. Hij staat nu op verlopen.`);
}

export function toetsRuil(r: Ruil, ontvangerId: string) {
  const team = state.medewerkers.filter((m) => m.regio === r.regio && inRooster(m));
  if (r.regio === NBD) {
    const cellen = zichtbaar(NBD), tijden = state.tijden[NBD];
    return nbdRuilToets({ team, cellen, tijden, wijzigingen: nbdRuilWijzigingen(ruilWijzigingen(r, ontvangerId), cellen, tijden, r.aanbiederId, ontvangerId), p: state.nbd, minVrijeWeekenden: state.beleid.minVrijeWeekenden });
  }
  return ruilToets({ team, cellen: zichtbaar(r.regio), wijzigingen: ruilWijzigingen(r, ontvangerId), beleid: state.beleid, tijden: state.tijden[r.regio] });
}

export function maakVerlofRuil(r: { aanbiederId: string; verlofId: string; ontvangerId: string; tegenVerlofId: string; opmerking?: string }, door: string): Ruil {
  const a = state.verlof.find((v) => v.id === r.verlofId), b = state.verlof.find((v) => v.id === r.tegenVerlofId);
  if (!a || !b || a.status !== 'goedgekeurd' || b.status !== 'goedgekeurd') throw new Error('Alleen goedgekeurd verlof kan worden geruild');
  if (a.medewerkerId !== r.aanbiederId || b.medewerkerId !== r.ontvangerId) throw new Error('Dit verlof hoort niet bij deze medewerkers');
  if (a.regio !== b.regio) throw new Error('Verlof ruilen kan binnen de eigen regio');
  if (a.van <= todayIso() || b.van <= todayIso()) throw new Error('Alleen verlof dat nog moet beginnen kan worden geruild');
  if (state.ruil.some((x) => x.soort === 'verlof' && (x.verlofId === a.id || x.tegenVerlofId === a.id) && ['open', 'wacht_planner'].includes(x.status))) throw new Error('Voor dit verlof loopt al een ruilverzoek');
  const m = state.medewerkers.find((x) => x.id === r.aanbiederId), o = state.medewerkers.find((x) => x.id === r.ontvangerId);
  const nieuw: Ruil = { id: nieuwId(), regio: a.regio, soort: 'verlof', aanbiederId: r.aanbiederId, datum: a.van, dienst: 'V', ontvangerId: r.ontvangerId, tegenDatum: b.van, tegenDienst: 'V', verlofId: a.id, tegenVerlofId: b.id, tot: a.tot, tegenTot: b.tot, opmerking: r.opmerking, status: 'open', gemaakt: nowStamp() };
  set({ ruil: [nieuw, ...state.ruil], activiteit: metLog(log('ruil', `${m?.naam} wil verlof (${fmtD(a.van)} t/m ${fmtD(a.tot)}) ruilen met dat van ${o?.naam} (${fmtD(b.van)} t/m ${fmtD(b.tot)})`, { regio: a.regio, voor: r.ontvangerId, door })) });
  return nieuw;
}

export function maakRuil(r: Omit<Ruil, 'id' | 'status' | 'gemaakt' | 'regio'>, door: string): Ruil {
  const m = state.medewerkers.find((x) => x.id === r.aanbiederId);
  if (!m) throw new Error('Medewerker niet gevonden');
  // een medewerker ruilt wat gepubliceerd is; wie plant, werkt in het concept
  const eigen = zichtbaar(m.regio)[m.id]?.[r.datum];
  if (!eigen || !DIENSTEN[eigen].werk || eigen === 'V') throw new Error('Op deze dag staat geen dienst om aan te bieden');
  if (state.ruil.some((x) => x.aanbiederId === r.aanbiederId && x.datum === r.datum && ['open', 'wacht_planner'].includes(x.status))) {
    throw new Error('Voor deze dienst loopt al een verzoek');
  }
  const nieuw: Ruil = { ...r, dienst: eigen, id: nieuwId(), regio: m.regio, status: 'open', gemaakt: nowStamp() };
  const ontv = r.ontvangerId ? state.medewerkers.find((x) => x.id === r.ontvangerId) : undefined;
  const tekst = r.soort === 'aanbieden'
    ? `${m.naam} biedt dienst ${eigen} van ${fmtD(r.datum)} aan`
    : `${m.naam} wil dienst ${eigen} van ${fmtD(r.datum)} ruilen met ${ontv?.naam ?? 'een collega'}`;
  set({ ruil: [nieuw, ...state.ruil], activiteit: metLog(log('ruil', tekst, { regio: m.regio, voor: r.ontvangerId, door })) });
  return nieuw;
}

export function accepteerRuil(id: string, ontvangerId: string, door: string) {
  const r = state.ruil.find((x) => x.id === id);
  if (!r || r.status !== 'open') return;
  if (r.soort !== 'aanbieden' && r.ontvangerId !== ontvangerId) throw new Error('Dit verzoek is voor een andere collega');
  if (ontvangerId === r.aanbiederId) throw new Error('Je kunt je eigen dienst niet overnemen');
  const beletsel = ruilBeletsel(r, ontvangerId);
  if (beletsel) verloop(r, beletsel);
  const t = toetsRuil(r, ontvangerId);
  const ontv = state.medewerkers.find((x) => x.id === ontvangerId);
  const bijgewerkt: Ruil = { ...r, ontvangerId, status: 'wacht_planner', geaccepteerd: nowStamp(), toets: t };
  set({
    ruil: state.ruil.map((x) => (x.id === id ? bijgewerkt : x)),
    activiteit: metLog(log('ruil', r.soort === 'verlof' ? `${ontv?.naam ?? 'Collega'} gaat akkoord met het ruilen van verlof (${fmtD(r.datum)} en ${fmtD(r.tegenDatum!)})` : `${ontv?.naam ?? 'Collega'} ${r.soort === 'aanbieden' ? 'neemt' : 'ruilt'} dienst van ${fmtD(r.datum)} ${r.soort === 'aanbieden' ? 'over' : ''}`.trim(), { regio: r.regio, voor: r.aanbiederId, door })),
  });
  // automatisch goedkeuren geldt voor diensten; over verlof besluit de regiomanager (§ 4.1, § 5.1). Met de
  // gedeelde database past een medewerker het rooster niet zelf aan: dat doet de browser van de planner (onderhoud)
  if (state.beleid.ruilAutomatisch && r.soort !== 'verlof' && t.ok && !t.bevindingen.length && (!db || plant())) beoordeelRuil(id, 'goedgekeurd', 'automatisch');
}

export function beoordeelRuil(id: string, besluit: 'goedgekeurd' | 'afgewezen', door: string, reden?: string) {
  const r = state.ruil.find((x) => x.id === id);
  if (!r || r.status !== 'wacht_planner' || !r.ontvangerId) return;
  if (besluit === 'goedgekeurd') {
    const beletsel = ruilBeletsel(r);
    if (beletsel) verloop(r, beletsel);
  }
  let roosterPatch: Partial<AppState> = {};
  let verlof = state.verlof;
  if (besluit === 'goedgekeurd') {
    const voor = state.rooster[r.regio] ?? {};
    const w = ruilWijzigingen(r, r.ontvangerId);
    if (r.regio === NBD) {
      // bij de NBD gaan de tijden en de pauze mee met de dienst
      const tijden = nbdTijdenNa(state.tijden[NBD], nbdRuilWijzigingen(w, voor, state.tijden[NBD], r.aanbiederId, r.ontvangerId));
      roosterPatch = { ...doorvoer(r.regio, w, tijden), tijden: { ...state.tijden, [NBD]: tijden } };
    } else roosterPatch = doorvoer(r.regio, w);
    if (r.soort === 'verlof') {
      // wat er eerst stond, blijft bewaard voor intrekken
      const va = state.verlof.find((v) => v.id === r.verlofId), vb = state.verlof.find((v) => v.id === r.tegenVerlofId);
      if (va && vb) {
        const vervangen = (mid: string, v: Verlof) => Object.fromEntries(isoRange(v.van, v.tot).map((d) => [d, voor[mid]?.[d] ?? '-']).filter(([, x]) => x !== 'V' && x !== '-')) as Record<string, DienstCode>;
        verlof = state.verlof.map((v) => (v.id === va.id ? { ...v, van: vb.van, tot: vb.tot, vervangen: vervangen(r.aanbiederId, vb) } : v.id === vb.id ? { ...v, van: va.van, tot: va.tot, vervangen: vervangen(r.ontvangerId!, va) } : v));
      }
    }
  }
  const a = state.medewerkers.find((x) => x.id === r.aanbiederId), b = state.medewerkers.find((x) => x.id === r.ontvangerId);
  const tekst = `${r.soort === 'verlof' ? 'Verlofruil' : 'Ruil'} ${fmtD(r.datum)} tussen ${a?.naam} en ${b?.naam} ${besluit}${reden ? `: ${reden}` : ''}`;
  set({
    ...roosterPatch,
    verlof,
    ruil: state.ruil.map((x) => (x.id === id ? { ...x, status: besluit, beoordeeld: nowStamp(), beoordeelaar: door, reden } : x)),
    activiteit: metLog(log('ruil', tekst, { regio: r.regio, voor: r.aanbiederId, door }), log('ruil', tekst, { regio: r.regio, voor: r.ontvangerId, door })),
  });
}

export function weigerRuil(id: string, door: string) {
  const r = state.ruil.find((x) => x.id === id);
  if (!r || r.status !== 'open') return;
  const b = state.medewerkers.find((x) => x.id === r.ontvangerId);
  set({
    ruil: state.ruil.map((x) => (x.id === id ? { ...x, status: 'afgewezen', beoordeeld: nowStamp(), beoordeelaar: door, reden: `Geweigerd door ${b?.naam ?? 'collega'}` } : x)),
    activiteit: metLog(log('ruil', `${b?.naam ?? 'Collega'} wil de dienst van ${fmtD(r.datum)} niet ruilen`, { regio: r.regio, voor: r.aanbiederId, door })),
  });
}

export function trekRuilIn(id: string, door: string) {
  const r = state.ruil.find((x) => x.id === id);
  if (!r || !['open', 'wacht_planner'].includes(r.status)) return;
  set({ ruil: state.ruil.map((x) => (x.id === id ? { ...x, status: 'ingetrokken', beoordeeld: nowStamp(), beoordeelaar: door } : x)) });
}

/** Tot gisteren, zodat de demo na dagen nog actueel is. */
async function verlengDemo() {
  const m = state.meldingen;
  if (!m) return;
  const eind = fromDay(toDay(m.start) + m.n - 1);
  if (eind >= addDays(todayIso(), -1)) return;
  set({ meldingen: makeDemoHistory(todayIso()) }, ['meldingen']);
}

export async function laadDemo(): Promise<void> {
  alleenLokaal('De demo laden');
  return metTaak('Demo klaarzetten', async (stap) => {
    const vandaag = todayIso();
    stap('Meldingenhistorie maken');
    for (const k of await idb.keys().catch(() => [] as string[])) if (k.startsWith('run:')) await idb.del(k).catch(() => undefined);
    runCache.clear();
    const meldingen = makeDemoHistory(vandaag);
    state = {
      ...LEEG, geladen: true, beleid: state.beleid, normen: state.normen, schoolvakanties: state.schoolvakanties,
      extern: state.extern, bronStatus: state.bronStatus, normaal: state.normaal, meldingen, demo: true,
    };
    set({}, ['core', 'meldingen']);

    stap('Voorspellingen rekenen');
    const uitgaven = [...DEMO_TERUG.map((b) => ({ issue: addDays(vandaag, -b), soort: 'demo terugwerkend' })), { issue: vandaag, soort: 'demo' }];
    const a = await reken({ type: 'runs', input: modelInput(), uitgaven: uitgaven.map((u, i) => ({ ...u, id: `${u.issue}_demo${String(i).padStart(2, '0')}` })) });
    if (a.type !== 'runs') throw new Error('Het rekenen is niet gelukt. Probeer het opnieuw.');
    await bewaarRuns(a.runs);
    const basis = a.runs.find((r) => r.meta.uitgegeven === addDays(vandaag, -14)) ?? a.runs[0];
    const laatste = a.runs[a.runs.length - 1];

    stap('Teams en verlof');
    const R = rng(42);
    const medewerkers: Medewerker[] = [];
    for (const regio of REGIONS) medewerkers.push(...voorbeeldTeam(regio, nieuwId));
    // de naam wordt altijd getrokken, zodat de rest van de demo gelijk blijft
    REGIONS.forEach((regio, i) => {
      if (i % 3 !== 1) return;
      const naam = `${R.pick(['Joost', 'Monique', 'Hans', 'Ellen', 'Wouter', 'Ingrid'])} ${R.pick(['de Vries', 'Bakker', 'Visser', 'Smit', 'Meijer'])} (ZZP)`;
      if (ZZP_IN_ROOSTER) medewerkers.push({ id: nieuwId(), regio, naam, contract: 24, voorkeur: 'O', weekendgroep: 0, functie: 'UV', extern: true, actief: true });
    });
    const start = fromDay(mondayOf(toDay(vandaag)) - 7 * 8);
    const M0 = maandVan(vandaag), M1 = volgendeMaand(M0), M2 = volgendeMaand(M0, 2);
    const eind = maandEind(M2);
    const periode = isoRange(start, eind);
    const verlof: Verlof[] = [], wensen: Wens[] = [], rooster: Record<string, Cellen> = {};
    const profielen: Record<string, Voorkeurprofiel> = {};
    for (const m of medewerkers) {
      if (R.uniform() < 0.4) continue;
      const dagen: DagVoorkeur[] = ['neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal'];
      if (R.uniform() < 0.4) dagen[R.int(1, 5)] = 'niet';
      if (R.uniform() < 0.6) dagen[R.int(1, 5)] = 'liever_niet';
      for (let j = 0; j < R.int(0, 2); j++) { const d = R.int(1, 5); if (dagen[d] === 'neutraal') dagen[d] = 'graag'; }
      profielen[m.id] = {
        medewerkerId: m.id,
        dagen,
        dienst: R.pick(['geen', 'ochtend', 'middag', m.voorkeur === 'O' ? 'ochtend' : 'middag'] as Voorkeurprofiel['dienst'][]),
        beschikbaarheid: R.pick(['neutraal', 'neutraal', 'graag', 'liever_niet'] as Voorkeurprofiel['beschikbaarheid'][]),
        maxDagenPerWeek: m.contract <= 28 && R.uniform() < 0.5 ? 4 : null,
        bijgewerkt: nowStamp(),
      };
    }
    const goedgekeurd = (m: Medewerker, van: string, tot: string, soort: VerlofSoort = 'vakantie'): Verlof => ({
      id: nieuwId(), medewerkerId: m.id, regio: m.regio, van, tot, soort, status: 'goedgekeurd', aangevraagd: nowStamp(), beoordeeld: nowStamp(), beoordeelaar: 'demo',
    });
    {
      const jaar = Number(vandaag.slice(0, 4));
      const { eerste, aantal } = jaarWeken(jaar);
      const dezeWeek = fromDay(mondayOf(toDay(vandaag)));
      const voorbij = Math.max(1, Math.round((toDay(dezeWeek) - toDay(eerste)) / 7));
      for (const regio of REGIONS) {
        const team = medewerkers.filter((m) => m.regio === regio && !m.extern);
        const ctx = { normen: state.normen, beleid: state.beleid, medewerkers, verlof, schoolvakanties: state.schoolvakanties };
        const over = new Map(verlofRuimte(ctx, regio, eerste, aantal).map((w) => [w.maandag, w.over]));
        const zomer = state.schoolvakanties.find((v) => /zomer/i.test(v.naam) && (v.regio === 'alle' || v.regio === SCHOOLREGIO[regio]) && v.van.startsWith(String(jaar)));
        const vrij = (m: Medewerker, van: string, weken: number) => {
          for (let k = 0; k < weken; k++) {
            const ma = addDays(van, 7 * k);
            if (ma >= dezeWeek || (over.get(ma) ?? -1) < m.contract * 0.75) return false;
          }
          return !verlof.some((v) => v.medewerkerId === m.id && v.van <= addDays(van, 7 * weken) && v.tot >= addDays(van, -3));
        };
        const neem = (m: Medewerker, van: string, weken: number, soort: VerlofSoort = 'vakantie') => {
          for (let k = 0; k < weken; k++) over.set(addDays(van, 7 * k), over.get(addDays(van, 7 * k))! - m.contract);
          verlof.push(goedgekeurd(m, van, addDays(van, 7 * weken - 3), soort));
        };
        for (const m of team) {
          if (zomer && R.uniform() < 0.7) {
            const weken = R.pick([2, 2, 3]);
            const opties: string[] = [];
            for (let ma = fromDay(mondayOf(toDay(zomer.van) + 2)); addDays(ma, 7 * (weken - 1)) <= zomer.tot; ma = addDays(ma, 7)) opties.push(ma);
            for (let i = opties.length - 1; i > 0; i--) { const j = R.int(0, i); [opties[i], opties[j]] = [opties[j], opties[i]]; }
            const van = opties.find((x) => vrij(m, x, weken));
            if (van) neem(m, van, weken);
          }
          const doel = m.contract * 52 * state.beleid.verlofNorm * (voorbij / aantal) * (0.7 + 0.3 * R.uniform());
          let gepland = verlof.filter((v) => v.medewerkerId === m.id && v.van >= eerste && v.van < dezeWeek).reduce((a, v) => a + verlofUrenPerWeek(v, m.contract).size * m.contract, 0);
          for (let t = 0; t < 30 && gepland < doel; t++) {
            const van = addDays(eerste, 7 * R.int(0, voorbij - 1));
            if (vrij(m, van, 1)) { neem(m, van, 1, R.uniform() < 0.2 ? 'adv' : 'vakantie'); gepland += m.contract; }
          }
        }
      }
    }
    for (const regio of REGIONS) {
      const team = medewerkers.filter((m) => m.regio === regio);
      const cellen: Cellen = {};
      // alleen waar de verlofruimte het toelaat
      const ctx = { normen: state.normen, beleid: state.beleid, medewerkers, verlof, schoolvakanties: state.schoolvakanties };
      team.forEach((m, i) => {
        if (R.uniform() > 0.55) return;
        const van = fromDay(mondayOf(toDay(addDays(vandaag, 7 * ((i * 3 + R.int(0, 2)) % 9) + 7))));
        const tot = addDays(van, R.uniform() < 0.3 ? 2 : 6);
        const v = goedgekeurd(m, van, tot);
        const uren = [...verlofUrenPerWeek(v, m.contract).values()].reduce((a, b) => a + b, 0);
        const w = verlofRuimte(ctx, regio, van, 1)[0];
        if (w && w.over < uren) return;
        verlof.push(v);
        cellen[m.id] = Object.fromEntries(isoRange(van, tot).map((d) => [d, 'V' as DienstCode]));
      });
      // de demo laat een verlofruil zien (Utrecht, binnen 70 dagen); in een krappe tijd van het jaar kan de verlofruimte
      // daarvoor te weinig verlof overlaten, dan komen er twee korte verlofperiodes bij
      if (regio === 'Utrecht') {
        const binnen = (v: Verlof) => v.regio === regio && v.status === 'goedgekeurd' && v.van > vandaag && v.van < addDays(vandaag, 70);
        const mensen = new Set(verlof.filter(binnen).map((v) => v.medewerkerId));
        const vrij = team.filter((m) => !m.extern && !mensen.has(m.id) && !verlof.some((v) => v.medewerkerId === m.id && binnen(v)));
        for (const [k, m] of vrij.slice(0, Math.max(0, 2 - mensen.size)).entries()) {
          const van = fromDay(mondayOf(toDay(addDays(vandaag, 21 + 14 * k))));
          const tot = addDays(van, 1);
          verlof.push(goedgekeurd(m, van, tot));
          cellen[m.id] = { ...cellen[m.id], ...Object.fromEntries(isoRange(van, tot).map((d) => [d, 'V' as DienstCode])) };
        }
      }
      for (const m of team.slice(2, 8)) {
        const d = addDays(vandaag, R.int(3, 40));
        wensen.push({ id: nieuwId(), medewerkerId: m.id, regio, datum: d, soort: R.pick(['vrij', 'vrij', 'ochtend', 'middag', 'werken'] as WensSoort[]), gemaakt: nowStamp() });
      }
      for (const m of team.slice(0, 3)) {
        const van = fromDay(mondayOf(toDay(`2027-07-${String(R.int(5, 26)).padStart(2, '0')}`)));
        if (verlofRuimte(ctx, regio, van, 2).some((w) => w.over < m.contract)) continue;
        verlof.push(goedgekeurd(m, van, addDays(van, 11)));
      }
    }

    stap('Roosters maken volgens het beleid');
    const basisData = getRunSync(basis.meta.id), laatsteData = getRunSync(laatste.meta.id);
    const extra = a.runs.map((r) => getRunSync(r.meta.id));
    for (const regio of REGIONS) {
      const team = medewerkers.filter((m) => m.regio === regio);
      const cellen: Cellen = {};
      for (const v of verlof) if (v.regio === regio && v.van <= eind && v.tot >= start) for (const d of isoRange(v.van, v.tot)) (cellen[v.medewerkerId] ??= {})[d] = 'V';
      const behoefte = behoefteVoor({ basis: basisData, laatste: laatsteData, extra, norm: state.normen, verschuivingen: state.verschuivingen }, regio, periode, { alphaRegio: state.beleid.alphaRegio, tegen: 'basis' });
      const w = voorstel({ team, dates: periode, cellen, behoefte, wensen: wensen.filter((x) => x.regio === regio), beleid: beleidVoor(state.beleid, regio, state.normen), profielen, nadruk: 'balans', seed: 7 });
      rooster[regio] = pasToe(cellen, w);
      const ext = team.find((m) => m.extern);
      if (ext) {
        let n = 0;
        for (const d of isoRange(addDays(vandaag, 3), addDays(vandaag, 28))) {
          const k = behoefte[d]?.k;
          if (k == null || n >= 3 || weekday(toDay(d)) % 6 === 0) continue;
          const p = team.reduce((a, m) => a + DIENSTEN[rooster[regio][m.id]?.[d] ?? '-'].plekken, 0);
          if (p < k) { (rooster[regio][ext.id] ??= {})[d] = '1'; n++; }
        }
      }
    }

    stap('Bijvoorspelling, ziekte en verstoringen');
    // een paar regeldiensten zijn later weggevallen, zodat de toets iets vindt
    for (const regio of REGIONS.filter((_, i) => i % 5 === 1)) {
      const cel = rooster[regio];
      const team = medewerkers.filter((m) => m.regio === regio);
      let weg = 0;
      for (const m of team) {
        for (const d of isoRange(addDays(vandaag, 2), addDays(vandaag, 12))) {
          if (weg >= 3 || !['1', '1M'].includes(cel[m.id]?.[d] ?? '')) continue;
          if (R.uniform() < 0.2) { delete cel[m.id][d]; weg++; }
        }
      }
    }
    // en iemand een week op Dg zonder vrije dag
    {
      const regio = REGIONS[7], cel = rooster[regio], m = medewerkers.filter((x) => x.regio === regio && x.functie !== 'UL')[3];
      const van = fromDay(mondayOf(toDay(addDays(vandaag, 14))));
      for (const d of isoRange(van, addDays(van, 7))) (cel[m.id] ??= {})[d] = 'DG2';
    }
    // in een deel van de regio's is de maand daarna nog niet ingepland
    for (const regio of REGIONS.filter((_, i) => i % 4 === 2)) {
      const grens = maandStart(M2);
      for (const rij of Object.values(rooster[regio])) for (const d of Object.keys(rij)) if (d >= grens && rij[d] !== 'V') delete rij[d];
    }
    const publicaties: Record<string, Publicatie> = {};
    REGIONS.forEach((regio, i) => {
      const pubTot = maandEind(i % 4 === 2 || i % 6 === 5 ? M1 : M2);
      const cellen: Cellen = {};
      for (const [mid, rij] of Object.entries(rooster[regio])) cellen[mid] = Object.fromEntries(Object.entries(rij).filter(([d]) => d <= pubTot));
      publicaties[regio] = { regio, op: nowStamp(), door: 'demo', van: start, tot: pubTot, cellen };
    });
    const ziekmeldingen: Ziekmelding[] = [];
    for (const regio of REGIONS.filter((_, i) => i % 3 === 0)) {
      const cel = rooster[regio];
      const m = medewerkers.find((x) => x.regio === regio && x.functie !== 'UL' && ['1', '1M', 'DG2'].includes(cel[x.id]?.[vandaag] ?? ''));
      if (!m) continue;
      const tot = addDays(vandaag, R.int(0, 2));
      const vervangen: Record<string, DienstCode> = {};
      for (const d of isoRange(vandaag, tot)) {
        const x = cel[m.id]?.[d];
        if (x && DIENSTEN[x].werk) {
          vervangen[d] = x; cel[m.id][d] = 'Z';
          if (publicaties[regio] && d <= publicaties[regio].tot) (publicaties[regio].cellen[m.id] ??= {})[d] = 'Z';
        }
      }
      ziekmeldingen.push({ id: nieuwId(), medewerkerId: m.id, regio, van: vandaag, tot, gemeld: nowStamp(), door: 'demo', vervangen, status: 'ziek' });
    }
    // na publicatie nog een paar wijzigingen, zodat "ongepubliceerde wijzigingen" zichtbaar is
    for (const regio of [REGIONS[0], REGIONS[12]]) {
      const team = medewerkers.filter((m) => m.regio === regio);
      const d = isoRange(addDays(vandaag, 3), addDays(vandaag, 10)).find((x) => weekday(toDay(x)) % 6 !== 0)!;
      // alleen wie het zonder ATW-bezwaar kan doen (anders zou het rooster per ongeluk afgekeurd worden)
      const dg = (m: Medewerker): DienstCode => (m.functie === 'UL' ? 'DG1' : 'DG2');
      const vrij = team.filter((m) => !rooster[regio][m.id]?.[d] && ruilToets({ team, cellen: rooster[regio], wijzigingen: [[m.id, d, dg(m)]], beleid: state.beleid }).ok).slice(0, 2);
      for (const m of vrij) (rooster[regio][m.id] ??= {})[d] = dg(m);
    }

    stap('Tijden en goedkeuring');
    const tijden: AppState['tijden'] = {};
    for (const regio of REGIONS) {
      const t: AppState['tijden'][string] = {};
      for (const m of medewerkers.filter((x) => x.regio === regio)) {
        for (const [d, c] of Object.entries(rooster[regio][m.id] ?? {})) {
          if (c !== 'DG1' && c !== 'DG2' || d < vandaag || d > addDays(vandaag, 11)) continue;
          const kans = d <= addDays(vandaag, 3) ? 0.96 : 0.35;
          if (R.uniform() > kans) continue;
          // alleen tijden die de rust rond de dag niet breken (zoals de app ze ook alleen toelaat)
          for (const start of [R.pick([8.5, 9, 9, 9.5, 10, 13]), 9, 10, 8.5]) {
            const tijd = { start, eind: start + DIENSTEN[c].uren + (c === 'DG2' ? R.pick([0, 0, 0.5]) : 0), code: c };
            if (tijdBevindingen(rooster[regio], t, m.id, d, tijd, state.beleid).length) continue;
            (t[m.id] ??= {})[d] = tijd;
            break;
          }
        }
      }
      tijden[regio] = t;
    }
    const goedkeuringen: AppState['goedkeuringen'] = {};
    REGIONS.forEach((regio, i) => {
      const team = medewerkers.filter((m) => m.regio === regio).map((m) => m.id);
      const pub = publicaties[regio];
      const per: Record<string, Goedkeuring> = {};
      const g = (maand: string, status: Goedkeuring['status'], kleur: AdviesKleur, toelichting?: string): Goedkeuring => {
        const op = status === 'goedgekeurd' ? pub!.op : nowStamp();
        const advies = { kleur, toelichting, voorstel: kleur, door: 'Planner (demo)', op };
        return {
          regio, maand, status, versie: versieVan(status === 'goedgekeurd' ? pub!.cellen : rooster[regio], team, maandStart(maand), maandEind(maand)), cijfer: 8.7, hard: 0, aangevraagd: op, door: 'Planner (demo)', advies,
          ...(status === 'goedgekeurd' ? { beoordeeld: op, beoordeelaar: 'Regiomanager (demo)' } : {}),
          geschiedenis: [{ soort: 'advies', op, door: 'Planner (demo)', kleur, toelichting, cijfer: 8.7 }, ...(status === 'goedgekeurd' ? [{ soort: 'goedgekeurd' as const, op, door: 'Regiomanager (demo)' }] : [])],
        };
      };
      for (const m of maandenTussen(vandaag, pub.tot)) per[m] = g(m, 'goedgekeurd', i % 4 === 1 ? 'oranje' : 'groen', i % 4 === 1 ? 'Een paar dagen met alleen de 1B als reserve; verder op orde.' : undefined);
      if (i % 6 === 5) {
        const kleur = (['oranje', 'rood', 'groen', 'oranje'] as const)[Math.floor(i / 6) % 4];
        per[M2] = g(M2, 'ter_goedkeuring', kleur, kleur === 'rood' ? `In de tweede en derde week van ${maandNaam(M2, false)} kunnen we drie dagen niet dekken door verlof en een langdurig zieke collega. Inzet van een externe of een buurregio is nodig.`
          : kleur === 'oranje' ? 'Twee dagen zijn krap; daar staat een 1B als achtervang. Eén collega heeft deze maand vaker een weekend dan de rest.' : undefined);
      }
      goedkeuringen[regio] = per;
    });

    stap('Aanvragen, ruilen en rondes');
    for (const regio of REGIONS.slice(0, 8)) {
      const team = medewerkers.filter((m) => m.regio === regio);
      const m = team[4];
      // een aanvraag kan alleen nog op dagen zonder dienst: na een goedgekeurd rooster gaat vrij nemen via een ruil
      const vrijeDag = (d: string) => !DIENSTEN[rooster[regio]?.[m.id]?.[d] ?? '-'].werk;
      const van = Array.from({ length: 37 }, (_, k) => addDays(vandaag, 14 + ((R.int(0, 36) + k) % 37))).find((d) => [0, 1, 2, 3].every((k) => vrijeDag(addDays(d, k))))
        ?? Array.from({ length: 37 }, (_, k) => addDays(vandaag, 14 + k)).find(vrijeDag);
      if (!van) continue;
      if (verlof.some((v) => v.medewerkerId === m.id && v.van <= addDays(van, 3) && v.tot >= van)) continue;
      verlof.push({ id: nieuwId(), medewerkerId: m.id, regio, van, tot: addDays(van, R.int(0, 3)), soort: R.pick(['vakantie', 'adv', 'bijzonder'] as VerlofSoort[]), status: 'aangevraagd', aangevraagd: nowStamp(), opmerking: R.pick(['Familiebezoek', 'Bruiloft', '', 'Verhuizing']) || undefined });
    }
    const zomer: Vakantieronde = {
      id: nieuwId(), naam: 'Zomervakantie 2027', cluster: 'NL', van: '2027-06-01', tot: '2027-09-30',
      data: { aanvragen: '2026-11-17', analyse: '2026-11-27', advies: '2026-12-04', gesprek: '2026-12-11', besluit: '2026-12-17' },
      fase: 'planning', gemaakt: nowStamp(), door: 'demo',
    };
    for (const m of medewerkers) {
      if (R.uniform() > 0.7) continue;
      const van = fromDay(mondayOf(toDay(`2027-0${R.pick([7, 7, 7, 8, 8, 6])}-${String(R.int(1, 24)).padStart(2, '0')}`)));
      if (verlof.some((v) => v.medewerkerId === m.id && v.van <= addDays(van, 20) && v.tot >= van)) continue;
      verlof.push({ id: nieuwId(), medewerkerId: m.id, regio: m.regio, van, tot: addDays(van, R.pick([6, 13, 13, 20])), soort: 'vakantie', status: 'aangevraagd', aangevraagd: `${addDays(vandaag, -R.int(0, 6))}T${String(R.int(8, 20)).padStart(2, '0')}:00:00`, rondeId: zomer.id });
    }
    const ruil: Ruil[] = [];
    for (const regio of REGIONS.slice(0, 6)) {
      const team = medewerkers.filter((m) => m.regio === regio && m.functie !== 'UL');
      const cel = rooster[regio];
      for (let i = 5; i < team.length && ruil.filter((x) => x.regio === regio).length < 2; i++) {
        const a1 = team[i];
        const d = Object.keys(cel[a1.id] ?? {}).find((x) => x > addDays(vandaag, 5) && ['1', '1M', 'DG2'].includes(cel[a1.id][x]) && weekday(toDay(x)) !== 0);
        if (!d) continue;
        const r: Ruil = { id: nieuwId(), regio, soort: 'aanbieden', aanbiederId: a1.id, datum: d, dienst: cel[a1.id][d], status: 'open', gemaakt: nowStamp(), opmerking: R.pick(['Afspraak bij de tandarts', 'Verjaardag van mijn moeder', 'Ouderavond school', 'Cursusdag']) };
        if (ruil.length % 2 === 1) {
          const toets = (b: Medewerker) => ruilToets({ team, cellen: cel, wijzigingen: [[a1.id, d, '-'], [b.id, d, r.dienst]], beleid: state.beleid });
          const kandidaten = team.filter((x) => x.id !== a1.id && !cel[x.id]?.[d]).map((b) => ({ b, t: toets(b) })).filter((x) => x.t.ok);
          const keuze = kandidaten.find((x) => !x.t.bevindingen.length) ?? kandidaten[0];
          if (keuze) {
            r.status = 'wacht_planner';
            r.ontvangerId = keuze.b.id;
            r.geaccepteerd = nowStamp();
            r.toets = keuze.t;
          }
        }
        ruil.push(r);
      }
    }
    {
      const ut = verlof.filter((v) => v.regio === 'Utrecht' && v.status === 'goedgekeurd' && v.van > vandaag && v.van < addDays(vandaag, 70));
      const [va, vb] = ut.filter((v, i, l) => l.findIndex((x) => x.medewerkerId === v.medewerkerId) === i);
      if (va && vb && va.van !== vb.van) {
        ruil.push({ id: nieuwId(), regio: 'Utrecht', soort: 'verlof', aanbiederId: va.medewerkerId, datum: va.van, dienst: 'V', ontvangerId: vb.medewerkerId, tegenDatum: vb.van, tegenDienst: 'V', verlofId: va.id, tegenVerlofId: vb.id, tot: va.tot, tegenTot: vb.tot, opmerking: 'Mijn kinderen hebben die week een kamp', status: 'open', gemaakt: nowStamp() });
      }
    }
    const rondes: Voorkeurronde[] = [];
    {
      stap('Rooster nabestaandendesk');
      const nbd = nbdDemo({ vandaag, van: maandStart(M0), tot: eind, p: state.nbd, normen: state.normen, basis: basisData, laatste: laatsteData, maakId: nieuwId, minVrijeWeekenden: state.beleid.minVrijeWeekenden, stempel: nowStamp() });
      medewerkers.push(...nbd.team);
      Object.assign(profielen, nbd.profielen);
      wensen.push(...nbd.wensen);
      verlof.push(...nbd.verlof);
      rooster[NBD] = nbd.cellen;
      tijden[NBD] = nbd.tijden;
      const pubTot = maandEind(M1), op = nowStamp();
      const pubCellen: Cellen = {};
      for (const [mid, rij] of Object.entries(nbd.cellen)) pubCellen[mid] = Object.fromEntries(Object.entries(rij).filter(([d]) => d <= pubTot));
      publicaties[NBD] = { regio: NBD, op, door: 'demo', van: maandStart(M0), tot: pubTot, cellen: pubCellen };
      const ids = nbd.team.map((m) => m.id), per: Record<string, Goedkeuring> = {};
      for (const m of maandenTussen(vandaag, pubTot)) {
        const advies = { kleur: 'groen' as const, voorstel: 'groen' as const, door: 'Planner (demo)', op };
        per[m] = {
          regio: NBD, maand: m, status: 'goedgekeurd', versie: versieRegio(NBD, pubCellen, nbd.tijden, ids, maandStart(m), maandEind(m)), cijfer: 9.2, hard: 0, aangevraagd: op, door: 'Planner (demo)', advies,
          beoordeeld: op, beoordeelaar: 'Regiomanager (demo)',
          geschiedenis: [{ soort: 'advies', op, door: 'Planner (demo)', kleur: 'groen', cijfer: 9.2 }, { soort: 'goedgekeurd', op, door: 'Regiomanager (demo)' }],
        };
      }
      goedkeuringen[NBD] = per;
      const a1 = nbd.team[6], d = Object.keys(nbd.cellen[a1.id] ?? {}).sort().find((x) => x > addDays(vandaag, 5) && x <= pubTot && nbd.cellen[a1.id][x] === 'N');
      if (d) ruil.push({ id: nieuwId(), regio: NBD, soort: 'aanbieden', aanbiederId: a1.id, datum: d, dienst: 'N', status: 'open', gemaakt: nowStamp(), opmerking: 'Afspraak bij de huisarts' });
    }
    for (const regio of ['Utrecht', 'Amsterdam', 'Rotterdam', 'Groningen']) {
      const team = medewerkers.filter((m) => m.regio === regio);
      const ingediend: Record<string, string> = {};
      team.forEach((m, i) => { if (i % 3 !== 0 && m.regio !== 'Groningen') ingediend[m.id] = nowStamp(); });
      const M3 = volgendeMaand(M0, 3);
      rondes.push({ id: nieuwId(), regio, van: maandStart(M3), tot: maandEind(M3), deadline: addDays(vandaag, 7), status: 'open', geopend: nowStamp(), door: 'demo', ingediend });
    }
    set({
      profielen, rondes, ziekmeldingen, vakantierondes: [zomer], tijden, goedkeuringen,
      medewerkers, rooster, verlof, wensen, ruil, publicaties,
      roosterbasis: { runId: basis.meta.id, vastgelegd: nowStamp(), door: 'demo' },
      laatsteAuto: vandaag,
      activiteit: [
        ...ziekmeldingen.map((z) => log('ziek', `${medewerkers.find((m) => m.id === z.medewerkerId)?.naam} ziek gemeld vandaag`, { regio: z.regio, door: 'demo' })),
        log('verlof', 'Vakantieronde Zomervakantie 2027 geopend: vraag je vakantie aan vóór 17 nov', { door: 'demo' }),
        log('systeem', `Demo klaargezet: historie, ${a.runs.length} voorspellingen, 25 teams en roosters volgens het beleid, en de nabestaandendesk`),
      ],
    });
  });
}

export async function maakBackup(): Promise<Blob> {
  const runs: Record<string, RunData> = {};
  for (const m of state.runs) {
    const d = await getRun(m.id);
    if (d) runs[m.id] = d;
  }
  const { geladen: _g, ...rest } = state;
  return new Blob([JSON.stringify({ app: 'grip-regelplekken', versie: 1, gemaakt: nowStamp(), state: rest, runs })], { type: 'application/json' });
}

export async function zetBackupTerug(tekst: string) {
  alleenLokaal('Een back-up terugzetten');
  const js = JSON.parse(tekst);
  if (js.app !== 'grip-regelplekken' || !js.state) throw new Error('Dit is geen back-up van GRIP Regelplekken');
  await idb.clear();
  runCache.clear();
  for (const [id, d] of Object.entries<RunData>(js.runs ?? {})) {
    runCache.set(id, d);
    await idb.set(`run:${id}`, d);
  }
  state = vulAan({ ...LEEG, ...js.state, geladen: true });
  set({}, ['core', 'meldingen', 'extern']);
}

export async function wisAlles() {
  alleenLokaal('Alles wissen');
  await idb.clear();
  runCache.clear();
  state = { ...LEEG, geladen: true };
  emit();
}

