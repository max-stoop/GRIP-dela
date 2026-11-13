/**
 * Wensen per datum als team: een wens voor een datum gaat voor de vaste voorkeur van de weekdag, "geen voorkeur" is
 * een eigen wens, de vaste voorkeuren zijn in een week over te nemen en het team telt per dag wat is opgegeven.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { addDays, fromDay, isoRange, mondayOf, toDay, todayIso, weekday } from '@/lib/dates';
import { voorstel } from '@/lib/rooster/voorstel';
import { pasToe } from '@/lib/rooster/ruil';
import { cel } from '@/lib/rooster/toets';
import { maakContext, medewerkerScore } from '@/lib/rooster/analyse';
import { geenExtraWerk } from '@/lib/rooster/bijsturen';
import { DIENSTEN, WENS_LABEL, wensGehonoreerd } from '@/lib/rooster/diensten';
import { standaardWens, standaardWensen, telWensen, wensGroep } from '@/lib/rooster/wensen';
import { nbdWensOk } from '@/lib/nbd/toets';
import { AANTAL_VAKKEN, leegUren, metDienst } from '@/lib/nbd/voorkeuren';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { STANDAARD_BELEID, LEEG_PROFIEL, dagVoorkeurOp, wensUitPatroon, type DagVoorkeur, type Medewerker, type Voorkeurprofiel, type Wens, type WensSoort } from '@/lib/rooster/types';
import { bewaarMedewerker, bewaarProfiel, beoordeelVerlof, getState, neemStandaardOver, vraagVerlofAan, wisWensen, zetWens } from '@/lib/store/store';

beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });

const B = { ...STANDAARD_BELEID, kanNietBegrensd: false };
let n = 0;
const mw = (extra: Partial<Medewerker> = {}): Medewerker => ({ id: `t${++n}`, regio: 'Utrecht', naam: `Test ${n}`, contract: 32, voorkeur: 'O', weekendgroep: (n % 2) as 0 | 1, actief: true, ...extra });
const wens = (medewerkerId: string, datum: string, soort: WensSoort): Wens => ({ id: `w${++n}`, medewerkerId, regio: 'Utrecht', datum, soort, gemaakt: '' });

describe('een wens voor een datum gaat voor de vaste voorkeur van de weekdag', () => {
  it('de regel per combinatie', () => {
    const alle: DagVoorkeur[] = ['graag', 'neutraal', 'liever_niet', 'niet'];
    // zonder wens: het patroon
    expect(alle.map((p) => dagVoorkeurOp(p))).toEqual(alle);
    expect(dagVoorkeurOp(undefined)).toBe('neutraal');
    // wil werken (of een dagdeel): "liever niet" en "kan niet" vervallen, "graag" blijft
    for (const w of ['werken', 'ochtend', 'middag', 'avond'] as WensSoort[]) expect(alle.map((p) => dagVoorkeurOp(p, w))).toEqual(['graag', 'neutraal', 'neutraal', 'neutraal']);
    // geen voorkeur: de weekdag telt die dag niet
    expect(alle.map((p) => dagVoorkeurOp(p, 'neutraal'))).toEqual(['neutraal', 'neutraal', 'neutraal', 'neutraal']);
    // liever vrij: een dag die niet kan, blijft een dag die niet kan
    expect(alle.map((p) => dagVoorkeurOp(p, 'vrij'))).toEqual(['neutraal', 'neutraal', 'liever_niet', 'niet']);
  });

  it('"geen voorkeur" valt niet te honoreren en heeft een eigen naam', () => {
    expect(WENS_LABEL.neutraal).toBe('Geen voorkeur');
    expect(wensGehonoreerd('neutraal', '1')).toBeNull();
    expect(wensGehonoreerd('neutraal', '-')).toBeNull();
    expect(nbdWensOk('neutraal', null, true)).toBeNull();
    expect(nbdWensOk('neutraal', { start: 9, eind: 17, pauze: 30 }, true)).toBeNull();
  });

  // een team van acht; één collega kan volgens het weekpatroon op geen enkele dag
  const dates = isoRange('2026-10-05', '2026-11-01');
  const behoefte = behoefteVoor({ norm: NORM_STANDAARD }, 'Utrecht', dates, { alphaRegio: B.alphaRegio, tegen: 'norm' });
  const team = Array.from({ length: 8 }, () => mw());
  const nooit = team[0];
  const profielen: Record<string, Voorkeurprofiel> = { [nooit.id]: { ...LEEG_PROFIEL(nooit.id), dagen: Array(7).fill('niet'), bijgewerkt: 'x' } };
  const dinsdag = '2026-10-13';
  const maak = (wensen: Wens[]) => pasToe({}, voorstel({ team, dates, cellen: {}, behoefte, wensen, profielen, beleid: B, nadruk: 'balans', seed: 11 }));
  const werkt = (cellen: ReturnType<typeof maak>, d: string) => DIENSTEN[cel(cellen, nooit.id, d)].werk;

  it('zonder wens wordt wie nooit kan nergens ingeroosterd', () => {
    const c = maak([]);
    expect(dates.filter((d) => werkt(c, d))).toEqual([]);
  });

  it('wil die ene dinsdag wel werken: dan staat hij er die dag op, en alleen die dag', () => {
    const c = maak([wens(nooit.id, dinsdag, 'werken')]);
    expect(dates.filter((d) => werkt(c, d))).toEqual([dinsdag]);
  });

  it('"geen voorkeur" op die dinsdag maakt de dag ook beschikbaar; "liever vrij" niet', () => {
    expect(dates.filter((d) => werkt(maak([wens(nooit.id, dinsdag, 'neutraal')]), d))).toEqual([dinsdag]);
    expect(dates.filter((d) => werkt(maak([wens(nooit.id, dinsdag, 'vrij')]), d))).toEqual([]);
  });

  it('de analyse telt een dag met zo\'n wens niet als "tegen het weekpatroon"', () => {
    const week = isoRange('2026-10-12', '2026-10-18');
    const p: Voorkeurprofiel = { ...LEEG_PROFIEL(nooit.id), dagen: ['neutraal', 'neutraal', 'niet', 'liever_niet', 'neutraal', 'neutraal', 'neutraal'], bijgewerkt: 'x' };
    const rij = ['-', '1', '1', '-', '-', '-', '-'] as const; // dinsdag (kan niet) en woensdag (liever niet)
    const zonder = medewerkerScore(maakContext(nooit, p, [], week, B), [...rij]);
    expect(zonder.details.patroon).toMatchObject({ niet: 1, lieverNiet: 1 });
    const met = medewerkerScore(maakContext(nooit, p, [{ datum: dinsdag, soort: 'werken' }, { datum: '2026-10-14', soort: 'neutraal' }], week, B), [...rij]);
    expect(met.details.patroon).toMatchObject({ niet: 0, lieverNiet: 0 });
    expect(met.delen.patroon).toBe(1);
  });

  it('bijsturen stelt wie die dag wil werken wel voor, ook op een weekdag die normaal niet kan', () => {
    const o = { profielen, wensen: [wens(nooit.id, dinsdag, 'werken')] };
    expect(geenExtraWerk({ profielen }, nooit.id, dinsdag)).toBe('kan niet op deze weekdag');
    expect(geenExtraWerk(o, nooit.id, dinsdag)).toBeNull();
    expect(geenExtraWerk({ profielen, wensen: [wens(nooit.id, dinsdag, 'vrij')] }, nooit.id, dinsdag)).toBe('wil die dag vrij');
  });
});

describe('standaard overnemen', () => {
  it('de vaste voorkeur als wens: graag is wil werken, liever niet en kan niet zijn liever vrij, de rest geen voorkeur', () => {
    expect((['graag', 'neutraal', 'liever_niet', 'niet', undefined] as const).map(wensUitPatroon)).toEqual(['werken', 'neutraal', 'vrij', 'vrij', 'neutraal']);
    const p: Voorkeurprofiel = { ...LEEG_PROFIEL('x'), dagen: ['niet', 'graag', 'neutraal', 'liever_niet', 'neutraal', 'graag', 'neutraal'] };
    const week = isoRange('2026-10-12', '2026-10-18'); // ma t/m zo
    expect(week.map((d) => standaardWens(p, d))).toEqual(['werken', 'neutraal', 'vrij', 'neutraal', 'werken', 'neutraal', 'vrij']);
    expect(week.map((d) => standaardWens(undefined, d))).toEqual(Array(7).fill('neutraal'));
    // dagen met een wens of verlof worden overgeslagen
    expect(standaardWensen(p, week, new Set([week[0], week[2]])).map((w) => w.datum)).toEqual([week[1], week[3], week[4], week[5], week[6]]);
  });

  it('bij de nabestaandendesk uit de voorkeuren per uur', () => {
    const uren = leegUren();
    for (const type of ['even', 'oneven'] as const) {
      uren[type][1] = metDienst(uren[type][1], 17, 22.5); // maandag graag de avond
      uren[type][0] = 'n'.repeat(AANTAL_VAKKEN); // zondag nooit
    }
    const p: Voorkeurprofiel = { ...LEEG_PROFIEL('x'), dagen: Array(7).fill('graag'), uren };
    expect(standaardWens(p, '2026-10-12')).toBe('werken');
    expect(standaardWens(p, '2026-10-13')).toBe('neutraal');
    expect(standaardWens(p, '2026-10-18')).toBe('vrij');
  });

  it('in de app: alleen lege dagen, niet in het verleden en niet tijdens verlof; daarna verandert er niets meer', () => {
    const id = bewaarMedewerker({ regio: 'Utrecht', naam: 'Sanne Standaard', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    bewaarProfiel(id, { dagen: ['niet', 'graag', 'neutraal', 'liever_niet', 'neutraal', 'graag', 'neutraal'] });
    const maandag = fromDay(mondayOf(toDay(todayIso())) + 21), week = isoRange(maandag, addDays(maandag, 6));
    zetWens(id, week[1], 'middag', 'zelf gekozen');
    const v = vraagVerlofAan({ medewerkerId: id, van: week[4], tot: week[4], soort: 'adv' }, 'test');
    const mijn = () => getState().wensen.filter((w) => w.medewerkerId === id).map((w) => `${weekday(toDay(w.datum))} ${w.soort}`).sort();
    expect(neemStandaardOver(id, week)).toBe(5);
    // dinsdag hield de eigen wens, vrijdag (verlof aangevraagd) bleef leeg
    expect(mijn()).toEqual(['0 vrij', '1 werken', '2 middag', '3 vrij', '4 neutraal', '6 neutraal']);
    expect(getState().wensen.find((w) => w.medewerkerId === id && w.datum === week[1])?.opmerking).toBe('zelf gekozen');
    expect(neemStandaardOver(id, week)).toBe(0);
    // wordt het verlof afgewezen, dan vult een tweede keer alleen die dag aan
    beoordeelVerlof(v.id, 'afgewezen', 'planner', 'geen ruimte');
    expect(neemStandaardOver(id, week)).toBe(1);
    // de lopende week: wat voorbij is, blijft leeg
    const dezeWeek = isoRange(fromDay(mondayOf(toDay(todayIso()))), addDays(fromDay(mondayOf(toDay(todayIso()))), 6));
    expect(neemStandaardOver(id, dezeWeek)).toBe(dezeWeek.filter((d) => d >= todayIso()).length);
    expect(wisWensen(id, week)).toBe(7);
    expect(getState().wensen.filter((w) => w.medewerkerId === id && week.includes(w.datum))).toEqual([]);
    expect(neemStandaardOver('bestaat-niet', week)).toBe(0);
  });
});

describe('wat het team heeft opgegeven', () => {
  it('per dag: wil werken (ook een dagdeel), liever vrij, geen voorkeur; alleen de collega\'s', () => {
    expect((['werken', 'ochtend', 'middag', 'avond', 'vrij', 'neutraal', 'overig8', 'overig4'] as WensSoort[]).map(wensGroep)).toEqual(['werken', 'werken', 'werken', 'werken', 'vrij', 'neutraal', 'overig', 'overig']);
    const wensen = [wens('a', '2026-10-13', 'werken'), wens('b', '2026-10-13', 'ochtend'), wens('c', '2026-10-13', 'vrij'), wens('ik', '2026-10-13', 'vrij'), wens('a', '2026-10-14', 'neutraal'), wens('a', '2026-10-01', 'vrij')];
    expect(telWensen([...wensen, wens('b', '2026-10-14', 'overig4'), wens('c', '2026-10-14', 'overig8')], new Set(['a', 'b', 'c']), '2026-10-05')).toEqual({ '2026-10-13': { werken: 2, vrij: 1, neutraal: 0, overig: 0 }, '2026-10-14': { werken: 0, vrij: 0, neutraal: 1, overig: 2 } });
    expect(telWensen(wensen, new Set())).toEqual({});
  });
});
