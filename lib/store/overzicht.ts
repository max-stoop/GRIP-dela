/** Overzichtscijfers per regio voor het dashboard. */
import type { AdviesKleur } from '../rooster/advies';
import { maandDagen, maandenTussen, maandEind, maandStart, maandVan, publicatieVereistTot, volgendeMaand, type Maand } from '../rooster/maand';
import { vaststellingVan, type Vaststelling } from '../rooster/vaststelling';
import { addDays, isoRange, mondayOf, fromDay, toDay } from '../dates';
import { toets, type Toets } from '../rooster/toets';
import { DIENSTEN } from '../rooster/diensten';
import { bijsturen, type Bijsturing } from '../rooster/bijsturen';
import { beleidVoor, inRooster, type Cellen, type Medewerker } from '../rooster/types';
import { inLopendeRonde, type AppState, type Publicatie } from './types';
import { behoefteVoor, type BehoefteBronnen } from './afgeleid';
import { inSchoolvakantie, verlofRuimte } from '../capaciteit/verlof';
import { openTijden } from '../rooster/tijden';

export interface MaandRegel {
  maand: Maand;
  /** Zoals op de roosterpagina: de lopende maand vanaf vandaag; null zonder diensten. */
  toets: Toets | null;
  vaststelling: Vaststelling;
  /** Bij een afgekeurde maand niet meer geldig. */
  advies: AdviesKleur | null;
  cijferBijAdvies: number | null;
  publicatie: 'ja' | 'deels' | 'nee';
}

export interface RegioRegel {
  regio: string;
  team: number;
  /** De komende vier weken. */
  toets: Toets;
  maanden: MaandRegel[];
  tekortDagen14: number;
  dekking: number | null;
  gepland7: number;
  nodig7: number;
  openVerlof: number;
  openRuil: number;
  ongepubliceerd: number;
  /** Over de gepubliceerde periode (of 28 dagen), tegen de laatste voorspelling. */
  bijsturing: Bijsturing;
  publicatieTot: string | null;
  publicatieOk: boolean;
  ziek: number;
  /** Uren na goedgekeurd verlof, de komende 8 weken. */
  verlofKrap: number | null;
  /** Zonder verlof; negatief: de bezetting dekt de vastgestelde plekken niet. */
  ruimteMin: number | null;
  /** § 5.1 */
  goedkeuring: 'geen' | 'wacht' | 'goed' | 'afgekeurd';
  goedkeuringMaand: Maand;
  advies: AdviesKleur | null;
  /** Al binnen de termijn, en binnenkort. */
  tijdenTeLaat: number;
  tijdenBinnenkort: number;
}

/** Binnen de gepubliceerde periode. */
export function wijzigingenSindsPublicatie(cellen: Cellen, pub: Publicatie | undefined, team: Medewerker[]): number {
  if (!pub) return 0;
  let n = 0;
  for (const e of team) {
    const a = cellen[e.id] ?? {}, b = pub.cellen[e.id] ?? {};
    for (const d of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (d < pub.van || d > pub.tot) continue;
      if ((a[d] ?? '-') !== (b[d] ?? '-')) n++;
    }
  }
  return n;
}

export function komendeMaanden(vandaag: string, n = 4): Maand[] {
  return Array.from({ length: n }, (_, i) => volgendeMaand(maandVan(vandaag), i));
}

/** De toets rekent zoals de roosterpagina: de lopende maand vanaf vandaag, tegen de roosterbasis. */
export function maandRegels(state: AppState, regio: string, bronnen: BehoefteBronnen, maanden: Maand[], vandaag: string): MaandRegel[] {
  const team = state.medewerkers.filter((m) => m.regio === regio && inRooster(m));
  const cellen = state.rooster[regio] ?? {};
  const metNorm = { ...bronnen, norm: state.normen, verschuivingen: state.verschuivingen };
  const wensen = state.wensen.filter((w) => w.regio === regio);
  const pub = state.publicaties[regio];
  return maanden.map((maand) => {
    const alle = maandDagen(maand);
    const dagen = alle.some((d) => d >= vandaag) ? alle.filter((d) => d >= vandaag) : alle;
    const g = state.goedkeuringen[regio]?.[maand];
    const vaststelling = vaststellingVan(g);
    const heeftRooster = team.some((m) => dagen.some((d) => DIENSTEN[cellen[m.id]?.[d] ?? '-'].werk));
    const t = heeftRooster ? toets({
      team, dates: dagen, cellen, behoefte: behoefteVoor(metNorm, regio, dagen, { alphaRegio: state.beleid.alphaRegio, tegen: 'basis' }),
      wensen, beleid: beleidVoor(state.beleid, regio, state.normen), profielen: state.profielen, tijden: state.tijden[regio],
      schoolvakantie: (d) => inSchoolvakantie(state.schoolvakanties, regio, d),
    }) : null;
    return {
      maand,
      toets: t,
      vaststelling,
      advies: vaststelling === 'afgekeurd' ? null : g?.advies?.kleur ?? null,
      cijferBijAdvies: g?.advies ? g.cijfer : null,
      publicatie: !pub || pub.tot < maandStart(maand) ? 'nee' : pub.tot >= maandEind(maand) ? 'ja' : 'deels',
    };
  });
}

export function regioOverzicht(state: AppState, regios: string[], bronnen: BehoefteBronnen, vandaag: string, dagen = 28): RegioRegel[] {
  const maanden = komendeMaanden(vandaag);
  const periode = isoRange(vandaag, addDays(vandaag, dagen - 1));
  const week = new Set(periode.slice(1, 8));
  const twee = new Set(periode.slice(0, 14));
  const metNorm = { ...bronnen, norm: state.normen, verschuivingen: state.verschuivingen };
  return regios.map((regio) => {
    const team = state.medewerkers.filter((m) => m.regio === regio && inRooster(m));
    const cellen = state.rooster[regio] ?? {};
    const behoefte = behoefteVoor(metNorm, regio, periode, { alphaRegio: state.beleid.alphaRegio, tegen: 'basis' });
    const t = toets({
      team, dates: periode, cellen, behoefte, wensen: state.wensen.filter((w) => w.regio === regio), beleid: beleidVoor(state.beleid, regio, state.normen), profielen: state.profielen,
      tijden: state.tijden[regio], schoolvakantie: (d) => inSchoolvakantie(state.schoolvakanties, regio, d),
    });
    let gepland7 = 0, nodig7 = 0, tekort = 0, cov = 0, nCov = 0;
    for (const p of t.perDag) {
      if (week.has(p.datum)) { gepland7 += p.p; nodig7 += p.k ?? 0; }
      if (twee.has(p.datum) && p.k != null && p.p < p.k) tekort++;
      if (p.cov != null) { cov += p.cov; nCov++; }
    }
    const pub = state.publicaties[regio];
    const stuurTot = pub && pub.tot > vandaag ? pub.tot : addDays(vandaag, dagen - 1);
    const stuurDagen = isoRange(vandaag, stuurTot);
    const bij = bijsturen({
      team, cellen, dates: stuurDagen, beleid: beleidVoor(state.beleid, regio, state.normen), vandaag, maxActies: 0, tijden: state.tijden[regio],
      basis: behoefteVoor(metNorm, regio, stuurDagen, { alphaRegio: state.beleid.alphaRegio, tegen: 'basis' }),
      nu: behoefteVoor(metNorm, regio, stuurDagen, { alphaRegio: state.beleid.alphaRegio, tegen: 'laatste' }),
    });
    const open = openTijden(team, cellen, state.tijden[regio], vandaag, state.beleid);
    const ruimte = team.length ? verlofRuimte({ normen: state.normen, beleid: state.beleid, medewerkers: state.medewerkers, verlof: state.verlof, schoolvakanties: state.schoolvakanties, nbd: state.nbd }, regio, fromDay(mondayOf(toDay(vandaag)) + 7), 8) : [];
    return {
      regio,
      team: team.length,
      toets: t,
      maanden: team.length ? maandRegels(state, regio, bronnen, maanden, vandaag) : [],
      tekortDagen14: tekort,
      dekking: nCov ? cov / nCov : null,
      gepland7,
      nodig7,
      openVerlof: state.verlof.filter((v) => v.regio === regio && v.status === 'aangevraagd' && !inLopendeRonde(v, state.vakantierondes)).length,
      openRuil: state.ruil.filter((r) => r.regio === regio && r.status === 'wacht_planner').length,
      ongepubliceerd: wijzigingenSindsPublicatie(cellen, pub, team),
      bijsturing: bij,
      publicatieTot: pub?.tot ?? null,
      publicatieOk: !!pub && pub.tot >= publicatieVereistTot(vandaag, state.beleid.publicatieMaanden),
      ziek: team.filter((m) => cellen[m.id]?.[vandaag] === 'Z').length,
      verlofKrap: ruimte.length ? Math.min(...ruimte.map((w) => w.over)) : null,
      ruimteMin: ruimte.length ? Math.min(...ruimte.map((w) => w.ruimte)) : null,
      ...(() => { const g = goedkeuringStatus(state, regio, vandaag); return { goedkeuring: g.status, goedkeuringMaand: g.maand, advies: g.advies }; })(),
      tijdenTeLaat: open.filter((o) => o.teLaat).length,
      tijdenBinnenkort: open.filter((o) => !o.teLaat).length,
    };
  });
}

/** Eerst wat op de regiomanager wacht, dan de eerste maand binnen de publicatietermijn zonder vaststelling. */
function goedkeuringStatus(state: AppState, regio: string, vandaag: string): { status: RegioRegel['goedkeuring']; maand: Maand; advies: AdviesKleur | null } {
  const maanden = maandenTussen(vandaag, publicatieVereistTot(vandaag, state.beleid.publicatieMaanden));
  const per = state.goedkeuringen[regio] ?? {};
  const wacht = maanden.find((m) => per[m]?.status === 'ter_goedkeuring' && per[m]?.advies);
  if (wacht) return { status: 'wacht', maand: wacht, advies: per[wacht].advies!.kleur };
  const open = maanden.find((m) => !(per[m]?.status === 'goedgekeurd' && per[m]?.advies));
  if (!open) return { status: 'goed', maand: maanden[maanden.length - 1], advies: per[maanden[maanden.length - 1]]?.advies?.kleur ?? null };
  return { status: per[open]?.status === 'afgekeurd' ? 'afgekeurd' : 'geen', maand: open, advies: null };
}
