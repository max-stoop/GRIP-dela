import { describe, it, expect } from 'vitest';
import { bijsturen, type BijstuurOpties } from '@/lib/rooster/bijsturen';
import { ruilToets } from '@/lib/rooster/ruil';
import { addDays } from '@/lib/dates';
import { STANDAARD_BELEID, type Behoefte, type Cellen, type DagVoorkeur, type DienstCode, type Medewerker, type TweeVoorkeur, type Voorkeurprofiel } from '@/lib/rooster/types';
import type { Verlof } from '@/lib/store/types';

const B = STANDAARD_BELEID;
const vandaag = '2026-10-06';
const d = '2026-10-20'; // dinsdag, binnen 28 dagen
let n = 0;
const mw = (extra: Partial<Medewerker> = {}): Medewerker => ({ id: `b${++n}`, regio: 'Utrecht', naam: `Mw ${n}`, contract: 36, voorkeur: 'O', weekendgroep: 0, actief: true, ...extra });

// 5 plekken (1M, 1, 1, 1, 1B), twee DG2 (4 voorgangen), twee vrij en een uitvaartleider
const team = [mw(), mw(), mw(), mw(), mw(), mw(), mw(), mw(), mw(), mw({ functie: 'UL', contract: 20 })];
const codes: DienstCode[] = ['1M', '1', '1', '1', '1B', 'DG2', 'DG2', '-', '-', '-'];
const cellen: Cellen = Object.fromEntries(team.map((e, i): [string, Record<string, DienstCode>] => [e.id, codes[i] === '-' ? {} : { [d]: codes[i] }]));
const behoefte = (k: number): Behoefte => ({ [d]: { k, lam: 4, bron: 'basis' } });

describe('bijsturen', () => {
  it('een dag die past vraagt geen actie', () => {
    const b = bijsturen({ team, cellen, dates: [d], basis: behoefte(5), nu: behoefte(5), beleid: B, vandaag });
    expect(b.dagen[0].status).toBe('ok');
    expect(b.dagen[0].acties).toEqual([]);
    expect(b.samenvatting.kVeranderd).toBe(0);
  });

  it('meer meldingen: acties in de volgorde van het stroomschema, elk getoetst', () => {
    const b = bijsturen({ team, cellen, dates: [d], basis: behoefte(5), nu: behoefte(6), beleid: B, vandaag });
    const dag = b.dagen[0];
    expect(dag.status).toBe('tekort');
    expect(b.samenvatting).toMatchObject({ tekortDagen: 1, kVeranderd: 1, kOmhoog: 1 });
    const soorten = dag.acties.map((a) => a.soort);
    expect(soorten[0]).toBe('opschalen');
    expect(soorten).toContain('extra-regeling');
    for (const a of dag.acties) {
      if (!a.wijzigingen.length) continue;
      expect(ruilToets({ team, cellen, wijzigingen: a.wijzigingen, beleid: B }).ok).toBe(true);
    }
  });

  it('een vrije medewerker inplannen kan binnen 28 dagen alleen in overleg', () => {
    const b = bijsturen({ team, cellen, dates: [d], basis: behoefte(5), nu: behoefte(6), beleid: B, vandaag, maxActies: 10 });
    const inplannen = b.dagen[0].acties.find((a) => a.soort === 'inplannen')!;
    expect(inplannen).toBeTruthy();
    expect(inplannen.overleg).toBe(true);
    const ul = team[9];
    expect(b.dagen[0].acties.some((a) => a.wijzigingen.some(([m, , s]) => m === ul.id && ['1', '1M', '2', '1B'].includes(s)))).toBe(false);
  });

  it('een extra regeling alleen als er nog twee enkele regeldiensten overblijven', () => {
    const krap: Cellen = { ...cellen, [team[2].id]: { [d]: 'DG1' }, [team[3].id]: { [d]: 'DG1' } }; // nog 1M en één 1
    const b = bijsturen({ team, cellen: krap, dates: [d], basis: behoefte(5), nu: behoefte(6), beleid: B, vandaag, maxActies: 10 });
    expect(b.dagen[0].acties.some((a) => a.soort === 'extra-regeling')).toBe(false);
  });

  it('minder meldingen: een 2 terug naar een 1 of een regeldienst naar Dg, nooit naar 1B', () => {
    const met2: Cellen = { ...cellen, [team[1].id]: { [d]: '2' } }; // 6 plekken
    const b = bijsturen({ team, cellen: met2, dates: [d], basis: behoefte(6), nu: behoefte(5), beleid: B, vandaag });
    const dag = b.dagen[0];
    expect(dag.status).toBe('teveel');
    expect(dag.acties[0].soort).toBe('twee-terug');
    expect(dag.acties.some((a) => a.soort === 'afschalen')).toBe(true);
    expect(dag.acties.some((a) => a.wijzigingen.some(([, , s]) => s === '1B'))).toBe(false);
  });

  it('ziekte: telt mee en vraagt om voorgangen', () => {
    const ziek: Cellen = { ...cellen, [team[5].id]: { [d]: 'Z' } }; // een DG2 valt uit: 2 van 4 voorgangen
    const b = bijsturen({ team, cellen: ziek, dates: [d], basis: behoefte(5), nu: behoefte(5), beleid: B, vandaag });
    expect(b.dagen[0].ziek).toEqual([team[5].naam]);
    expect(b.samenvatting.voorgangTekort).toBe(1);
    expect(b.dagen[0].acties.some((a) => a.soort === 'voorgang')).toBe(true);
  });

  it('buurregio met ruimte wordt genoemd', () => {
    const b = bijsturen({ team, cellen, dates: [d], basis: behoefte(5), nu: behoefte(6), beleid: B, vandaag, maxActies: 10, buren: () => [{ regio: 'Amersfoort', over: 2 }] });
    expect(b.dagen[0].acties.find((a) => a.soort === 'buurregio')?.tekst).toContain('Amersfoort');
  });

  it('niet inplannen bij een verlofaanvraag, een wens om vrij te zijn of "kan niet"; dan de volgende', () => {
    const [a, b2] = [team[7], team[8]];
    const inplannen = (extra: Partial<BijstuurOpties>) =>
      bijsturen({ team, cellen, dates: [d], basis: behoefte(5), nu: behoefte(6), beleid: B, vandaag, maxActies: 10, ...extra }).dagen[0].acties.find((x) => x.soort === 'inplannen');
    expect(inplannen({})?.wijzigingen[0][0]).toBe(a.id);
    expect(inplannen({ wensen: [{ id: 'w', medewerkerId: a.id, regio: 'Utrecht', datum: d, soort: 'vrij', gemaakt: '' }] })?.wijzigingen[0][0]).toBe(b2.id);
    const aanvraag: Verlof = { id: 'v', medewerkerId: a.id, regio: 'Utrecht', van: addDays(d, -1), tot: addDays(d, 2), soort: 'vakantie', status: 'aangevraagd', aangevraagd: '' };
    const profiel = (mid: string, dag: DagVoorkeur, twee?: TweeVoorkeur): Voorkeurprofiel => ({
      medewerkerId: mid, dagen: [0, 1, 2, 3, 4, 5, 6].map((i) => (i === 2 ? dag : 'neutraal')), dienst: 'geen', beschikbaarheid: 'neutraal', maxDagenPerWeek: null, twee, bijgewerkt: '',
    });
    expect(inplannen({ aanvragen: [aanvraag], profielen: { [b2.id]: profiel(b2.id, 'niet') } })).toBeUndefined();
    // een afgewezen aanvraag telt niet
    expect(inplannen({ aanvragen: [{ ...aanvraag, status: 'afgewezen' }] })?.wijzigingen[0][0]).toBe(a.id);
    // liever niet: achteraan, en dat staat erbij
    expect(inplannen({ profielen: { [a.id]: profiel(a.id, 'liever_niet') } })?.wijzigingen[0][0]).toBe(b2.id);
    const alleenA = inplannen({ profielen: { [a.id]: profiel(a.id, 'liever_niet'), [b2.id]: profiel(b2.id, 'niet') } });
    expect(alleenA?.wijzigingen[0][0]).toBe(a.id);
    expect(alleenA?.tekst).toContain('liever niet');
  });

  it('komt de eerste niet door de toets (te veel diensten achter elkaar), dan de volgende', () => {
    const [a, b2] = [team[7], team[8]];
    const vol: Cellen = { ...cellen, [a.id]: Object.fromEntries(Array.from({ length: B.maxAchtereen }, (_, i) => [addDays(d, -1 - i), '1' as DienstCode])) };
    const x = bijsturen({ team: team.map((e) => (e.id === a.id ? { ...e, contract: 60 } : e)), cellen: vol, dates: [d], basis: behoefte(5), nu: behoefte(6), beleid: B, vandaag, maxActies: 10 });
    expect(x.dagen[0].acties.find((y) => y.soort === 'inplannen')?.wijzigingen[0][0]).toBe(b2.id);
  });

  it('een extra regeling niet bij wie geen dubbele dienst kan, liefst bij wie het graag doet', () => {
    const p = (mid: string, twee: TweeVoorkeur): Voorkeurprofiel => ({ medewerkerId: mid, dagen: Array(7).fill('neutraal'), dienst: 'geen', beschikbaarheid: 'neutraal', maxDagenPerWeek: null, twee, bijgewerkt: '' });
    const extra = (profielen: Record<string, Voorkeurprofiel>) => bijsturen({ team, cellen, dates: [d], basis: behoefte(5), nu: behoefte(6), beleid: B, vandaag, maxActies: 10, profielen })
      .dagen[0].acties.find((x) => x.soort === 'extra-regeling');
    const [e1, e2, e3] = [team[1], team[2], team[3]];
    expect(extra({ [e3.id]: p(e3.id, 'graag') })?.wijzigingen[0][0]).toBe(e3.id);
    expect(extra({ [e1.id]: p(e1.id, 'niet'), [e2.id]: p(e2.id, 'niet'), [e3.id]: p(e3.id, 'niet') })).toBeUndefined();
  });
});
