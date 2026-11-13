/**
 * Jaarplanning verlof per regio: per medewerker het verlof, per week de ruimte die de vastgestelde regelplekken
 * overlaten (§ 4.3), schoolvakanties en de mijlpalen van het vakantieproces. Verlofrecht en -saldo staan bewust niet
 * in GRIP: die lopen via de personeelsadministratie.
 */
import { addDays, diffDays, feestdagenVan, fromDay, isoRange, isoWeek, mondayOf, toDay, weekdayMon } from '../dates';
import { SCHOOLREGIO, verlofRuimte, type Schoolvakantie, type VerlofContext, type WeekRuimte } from './verlof';
import { REGION_CLUSTER } from '../model/config';
import { opVolgorde, type Medewerker } from '../rooster/types';

/** Minder dan een werkweek van één medewerker. */
const KRAP_UREN = 32;

export type WeekStatus = 'ruim' | 'krap' | 'vol';

export interface JaarWeek {
  maandag: string;
  week: number;
  /** 0-11, volgens de donderdag zoals bij ISO-weken. */
  maand: number;
  ruimte: WeekRuimte;
  /** Na goedgekeurd en aangevraagd verlof. */
  rest: number;
  status: WeekStatus;
  weg: number;
  feestdagen: { datum: string; naam: string }[];
  verleden: boolean;
  huidig: boolean;
}

export interface JaarCel {
  /** Ma t/m vr. */
  dagen: number;
  uren: number;
  status: 'goedgekeurd' | 'aangevraagd';
  ids: string[];
}

export interface JaarRij {
  m: Medewerker;
  weken: Record<string, JaarCel>;
  open: number;
  /** Minstens 3 werkdagen. */
  schoolWeken: number;
  /** Dit jaar en vorig jaar; null als die niet bekend is. */
  zomer: boolean | null;
  zomerVorigJaar: boolean | null;
}

export interface Mijlpaal {
  datum: string;
  tekst: string;
  /** Uit een vakantieronde in GRIP, of het advies uit het roosterbeleid. */
  bron: 'ronde' | 'beleid';
  paragraaf: string;
}

export interface Periode { van: string; tot: string; weken: number; uren: number }

export interface Signaal { ernst: 'bad' | 'warn' | 'info'; tekst: string; href?: string }

export interface Jaarplan {
  jaar: number;
  regio: string;
  weken: JaarWeek[];
  rijen: JaarRij[];
  totaal: { ruimte: number; norm: number; goedgekeurd: number; aangevraagd: number; open: number };
  /** uren = grootste tekort. */
  knelpunten: (Periode & { alleenGoedgekeurd: boolean })[];
  /** Buiten de schoolvakanties: daar past verlof het beste. */
  rustig: Periode[];
  mijlpalen: Mijlpaal[];
  signalen: Signaal[];
}

interface RondeData {
  naam: string;
  cluster: string;
  van: string;
  tot: string;
  fase: string;
  data: { aanvragen: string; analyse: string; advies: string; gesprek: string; besluit: string };
}

export function jaarWeken(jaar: number): { eerste: string; aantal: number } {
  const eerste = mondayOf(toDay(`${jaar}-01-04`));
  const laatste = mondayOf(toDay(`${jaar}-12-28`));
  return { eerste: fromDay(eerste), aantal: (laatste - eerste) / 7 + 1 };
}

/** De roosters van juli en augustus zijn klaar op de eerste van de maand, `maanden` voor juli (§ 4.2). */
export function zomerDeadline(jaar: number, maanden: number): string {
  const m = 7 - Math.round(maanden);
  const j = jaar + Math.floor((m - 1) / 12), mm = ((m - 1) % 12 + 12) % 12 + 1;
  return `${j}-${String(mm).padStart(2, '0')}-01`;
}

/** De rondes in GRIP, aangevuld met de data uit het beleid. */
export function mijlpalen(jaar: number, rondes: RondeData[], cluster: string, zomerVooruitMaanden: number): Mijlpaal[] {
  const vanJaar = `${jaar}-01-01`, totJaar = `${jaar}-12-31`;
  const uit: Mijlpaal[] = [];
  for (const r of rondes) {
    if (r.cluster !== 'NL' && r.cluster !== cluster) continue;
    if (r.data.aanvragen >= vanJaar && r.data.aanvragen <= totJaar) uit.push({ datum: r.data.aanvragen, tekst: `${r.naam}: aanvragen binnen`, bron: 'ronde', paragraaf: '4.1' });
    if (r.data.besluit >= vanJaar && r.data.besluit <= totJaar) uit.push({ datum: r.data.besluit, tekst: `${r.naam}: besluit`, bron: 'ronde', paragraaf: '4.1' });
  }
  const beleid: Mijlpaal[] = [
    { datum: zomerDeadline(jaar, zomerVooruitMaanden), tekst: `Roosters juli en augustus ${jaar} klaar (${zomerVooruitMaanden} maanden vooraf)`, bron: 'beleid', paragraaf: '4.2' },
    { datum: `${jaar}-06-17`, tekst: `Vakantieaanvragen oktober ${jaar} t/m mei ${jaar + 1} binnen`, bron: 'beleid', paragraaf: '4.1' },
    { datum: `${jaar}-07-17`, tekst: `Besluit vakanties oktober ${jaar} t/m mei ${jaar + 1}`, bron: 'beleid', paragraaf: '4.1' },
    { datum: `${jaar}-11-17`, tekst: `Vakantieaanvragen zomer ${jaar + 1} binnen`, bron: 'beleid', paragraaf: '4.1' },
    { datum: `${jaar}-12-17`, tekst: `Besluit vakanties zomer ${jaar + 1}`, bron: 'beleid', paragraaf: '4.1' },
  ];
  // het advies uit het beleid alleen als er geen ronde in GRIP in de buurt ligt
  const uitRondes = [...uit];
  for (const b of beleid) if (b.paragraaf === '4.2' || !uitRondes.some((u) => Math.abs(diffDays(u.datum, b.datum)) <= 45)) uit.push(b);
  return uit.sort((a, b) => a.datum.localeCompare(b.datum));
}

function periodes(weken: JaarWeek[], waarde: (w: JaarWeek) => number): Periode[] {
  const uit: Periode[] = [];
  let huidig: Periode | null = null, vorige = '';
  for (const w of weken) {
    if (huidig && addDays(vorige, 7) === w.maandag) {
      huidig.tot = addDays(w.maandag, 6);
      huidig.weken++;
      huidig.uren += waarde(w);
    } else {
      huidig = { van: w.maandag, tot: addDays(w.maandag, 6), weken: 1, uren: waarde(w) };
      uit.push(huidig);
    }
    vorige = w.maandag;
  }
  return uit;
}

function zomervakantie(vakanties: Schoolvakantie[], regio: string, jaar: number): Schoolvakantie | null {
  const sr = SCHOOLREGIO[regio];
  return vakanties.find((v) => /zomer/i.test(v.naam) && (v.regio === 'alle' || v.regio === sr) && v.van.startsWith(String(jaar))) ?? null;
}

export function jaarplan(o: {
  ctx: VerlofContext;
  regio: string;
  jaar: number;
  vandaag: string;
  rondes?: RondeData[];
  zomerVooruitMaanden?: number;
}): Jaarplan {
  const { ctx, regio, jaar, vandaag } = o;
  const { eerste, aantal } = jaarWeken(jaar);
  const team = ctx.medewerkers.filter((m) => m.regio === regio && m.actief && !m.extern).sort(opVolgorde);
  const ids = new Set(team.map((m) => m.id));
  const verlof = ctx.verlof.filter((v) => ids.has(v.medewerkerId) && (v.status === 'goedgekeurd' || v.status === 'aangevraagd'));
  const ruimte = verlofRuimte(ctx, regio, eerste, aantal);
  const huidigeMaandag = fromDay(mondayOf(toDay(vandaag)));
  const feest = [...feestdagenVan(jaar - 1), ...feestdagenVan(jaar), ...feestdagenVan(jaar + 1)];
  const jaarVan = eerste, jaarTot = addDays(eerste, aantal * 7 - 1);

  const cellen = new Map<string, Record<string, JaarCel>>(team.map((m) => [m.id, {}]));
  const contract = new Map(team.map((m) => [m.id, m.contract]));
  const open = new Map<string, number>();
  for (const v of verlof) {
    if (v.tot < jaarVan || v.van > jaarTot) continue;
    if (v.status === 'aangevraagd') open.set(v.medewerkerId, (open.get(v.medewerkerId) ?? 0) + 1);
    const perDag = (contract.get(v.medewerkerId) ?? 0) / 5;
    for (const d of isoRange(v.van < jaarVan ? jaarVan : v.van, v.tot > jaarTot ? jaarTot : v.tot)) {
      const n = toDay(d);
      if (weekdayMon(n) > 4) continue;
      const ma = fromDay(mondayOf(n));
      const rij = cellen.get(v.medewerkerId)!;
      const c = (rij[ma] ??= { dagen: 0, uren: 0, status: 'goedgekeurd', ids: [] });
      c.dagen++;
      c.uren += perDag;
      if (v.status === 'aangevraagd') c.status = 'aangevraagd';
      if (!c.ids.includes(v.id)) c.ids.push(v.id);
    }
  }

  const weken: JaarWeek[] = ruimte.map((r) => {
    const zondag = addDays(r.maandag, 6);
    const rest = r.ruimte - r.goedgekeurd - r.aangevraagd;
    return {
      maandag: r.maandag,
      week: isoWeek(toDay(r.maandag)),
      maand: Number(addDays(r.maandag, 3).slice(5, 7)) - 1,
      ruimte: r,
      rest,
      status: rest < 0 ? 'vol' : rest < KRAP_UREN ? 'krap' : 'ruim',
      weg: team.filter((m) => cellen.get(m.id)![r.maandag]).length,
      feestdagen: feest.filter((f) => f.datum >= r.maandag && f.datum <= zondag),
      verleden: zondag < vandaag,
      huidig: r.maandag === huidigeMaandag,
    };
  });

  const zomerNu = zomervakantie(ctx.schoolvakanties, regio, jaar), zomerToen = zomervakantie(ctx.schoolvakanties, regio, jaar - 1);
  const zomerDagen = (mid: string, z: Schoolvakantie) => ctx.verlof.filter((v) => v.medewerkerId === mid && (v.status === 'goedgekeurd' || (v.status === 'aangevraagd' && z === zomerNu)) && v.van <= z.tot && v.tot >= z.van)
    .reduce((s, v) => s + isoRange(v.van < z.van ? z.van : v.van, v.tot > z.tot ? z.tot : v.tot).filter((d) => weekdayMon(toDay(d)) < 5).length, 0);

  const rijen: JaarRij[] = team.map((m) => {
    const rij = cellen.get(m.id)!;
    return {
      m, weken: rij, open: open.get(m.id) ?? 0,
      schoolWeken: weken.filter((w) => w.ruimte.schoolvakantie && (rij[w.maandag]?.dagen ?? 0) >= 3).length,
      zomer: zomerNu ? zomerDagen(m.id, zomerNu) >= 5 : null,
      zomerVorigJaar: zomerToen ? zomerDagen(m.id, zomerToen) >= 5 : null,
    };
  });

  const toekomst = weken.filter((w) => !w.verleden);
  const knelpunten = periodes(toekomst.filter((w) => w.rest < 0), () => 0).map((p) => {
    const binnen = toekomst.filter((w) => w.maandag >= p.van && w.maandag <= p.tot);
    return { ...p, uren: Math.max(...binnen.map((w) => -w.rest)), alleenGoedgekeurd: binnen.some((w) => w.ruimte.over < 0) };
  });
  // vanaf volgende week: voor deze week is het te laat om nog verlof te plannen
  const volgendeWeek = addDays(huidigeMaandag, 7);
  const rustig = periodes(toekomst.filter((w) => w.maandag >= volgendeWeek && !w.ruimte.schoolvakantie && w.rest >= KRAP_UREN), (w) => w.rest)
    .sort((a, b) => b.uren / b.weken - a.uren / a.weken || b.weken - a.weken)
    .slice(0, 3)
    .map((p) => ({ ...p, uren: p.uren / p.weken }))
    .sort((a, b) => a.van.localeCompare(b.van));

  const cluster = REGION_CLUSTER[regio];
  const lijst = mijlpalen(jaar, o.rondes ?? [], cluster, o.zomerVooruitMaanden ?? 4);

  const signalen: Signaal[] = [];
  const wk = (p: Periode) => (p.weken === 1 ? `Week ${isoWeek(toDay(p.van))}` : `Week ${isoWeek(toDay(p.van))} t/m ${isoWeek(toDay(addDays(p.tot, -6)))}`);
  for (const k of knelpunten.slice(0, 3)) {
    signalen.push({ ernst: k.alleenGoedgekeurd ? 'bad' : 'warn', tekst: `${wk(k)}: tot ${Math.round(k.uren)} uur meer verlof dan ruimte${k.alleenGoedgekeurd ? ', al met goedgekeurd verlof' : ' als de aanvragen worden goedgekeurd'}` });
  }
  if (knelpunten.length > 3) signalen.push({ ernst: 'warn', tekst: `En nog ${knelpunten.length - 3} andere periodes met te weinig ruimte` });
  const totRuimte = weken.reduce((s, w) => s + w.ruimte.ruimte, 0);
  const komend = lijst.find((x) => x.datum >= vandaag && diffDays(x.datum, vandaag) <= 45);
  if (komend) signalen.push({ ernst: 'info', tekst: `Over ${diffDays(komend.datum, vandaag)} dagen: ${komend.tekst.charAt(0).toLowerCase()}${komend.tekst.slice(1)} (§ ${komend.paragraaf})`, href: komend.paragraaf === '4.1' ? '/verlof?tab=vakantie' : undefined });
  // zomer: is er een ronde voor de zomer van volgend jaar, als die aanvragen eraan komen?
  const zomerVolgend = `${jaar + 1}-07-15`;
  const rondeZomer = (o.rondes ?? []).some((r) => (r.cluster === 'NL' || r.cluster === cluster) && r.van <= zomerVolgend && r.tot >= zomerVolgend);
  if (!rondeZomer && vandaag >= `${jaar}-10-15` && vandaag <= `${jaar}-11-17`) signalen.push({ ernst: 'warn', tekst: `Er is nog geen vakantieronde voor de zomer van ${jaar + 1}. Open die, zodat aanvragen op 17 november binnen zijn (§ 4.1).`, href: '/verlof?tab=vakantie' });
  const tweeKeer = rijen.filter((r) => r.zomer && r.zomerVorigJaar), geenKeer = rijen.filter((r) => r.zomer === false && r.zomerVorigJaar === false);
  if (tweeKeer.length && geenKeer.length) signalen.push({ ernst: 'info', tekst: `${tweeKeer.length === 1 ? '1 medewerker heeft' : `${tweeKeer.length} medewerkers hebben`} vorig jaar en dit jaar zomervakantie, ${geenKeer.length === 1 ? '1 medewerker' : `${geenKeer.length} medewerkers`} in geen van beide` });

  return {
    jaar, regio, weken, rijen,
    totaal: {
      ruimte: totRuimte,
      norm: weken.reduce((s, w) => s + w.ruimte.normVerlof, 0),
      goedgekeurd: weken.reduce((s, w) => s + w.ruimte.goedgekeurd, 0),
      aangevraagd: weken.reduce((s, w) => s + w.ruimte.aangevraagd, 0),
      open: rijen.reduce((s, r) => s + r.open, 0),
    },
    knelpunten, rustig, mijlpalen: lijst, signalen,
  };
}

