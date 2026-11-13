'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, AlertTriangle, CalendarClock, ArrowLeftRight, Send, Database, Anchor, CheckCircle2, CalendarHeart, LineChart, CalendarDays, Compass, Route, Thermometer, Palmtree, Clock, BadgeCheck } from 'lucide-react';
import { useSessie, useVerlofBesluiter } from '@/components/sessie';
import { Box, GeenToegang, Laden, Leeg, PaginaKop, Pill, Sectie, Segment } from '@/components/ui';
import { RoostersPerMaand } from '@/components/dashboard/RoostersPerMaand';
import { ForecastChart, Legenda } from '@/components/voorspelling/ForecastChart';
import { getState, useApp } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import { normRun } from '@/lib/capaciteit/normrun';
import { som } from '@/lib/store/afgeleid';
import { komendeMaanden, regioOverzicht, type MaandRegel } from '@/lib/store/overzicht';
import { VASTSTELLING } from '@/lib/rooster/vaststelling';
import { zomerDeadline } from '@/lib/capaciteit/jaarplan';
import { maandNaam, maandVan, publicatieVereistTot, type Maand } from '@/lib/rooster/maand';
import { CLUSTER_NAAM, REGION_CLUSTER, REGIONS } from '@/lib/model/config';
import { addDays, diffDays, fmtD, fmtLang, fmtMoment, todayIso, uurNu } from '@/lib/dates';
import { VAKANTIE_FASE } from '@/lib/store/types';
import { cx, nl, nlInt, pctS, plural } from '@/lib/format';
import { Activiteiten } from '@/components/Activiteiten';
import { NaarNbd } from '@/components/nbd/NaarNbd';
import { useBewaard } from '@/components/verdeling/bewaard';
import { useLandelijk, useWerkregio } from '@/lib/werkregio';

/** Hoe ver vooruit de grafiek kijkt, in dagen. Voorbij de voorspelling: de vastgestelde regelplekken. */
const VOORUIT = ['30', '60', '90', '150'] as const;
type Vooruit = (typeof VOORUIT)[number];

export default function DashboardPagina() {
  return <Suspense fallback={<Laden />}><NaarNbd naar="/nbd"><Dashboard /></NaarNbd></Suspense>;
}

function Dashboard() {
  const s = useSessie();
  const besluiter = useVerlofBesluiter();
  const router = useRouter();
  const { laatste, laatsteData, basis, basisData, klaar } = useRuns();
  const state = useApp((x) => x);
  const vandaag = todayIso();
  const mijnRegios = REGIONS.filter((r) => s.regios.includes(r));
  const [werk] = useWerkregio(mijnRegios);
  const landelijk = useLandelijk();
  // de regiomanager ziet het cluster van de werkregio, tenzij links Landelijk is gekozen; beheerder en planner het land
  const cluster = s.rol === 'regiomanager' && !landelijk ? REGION_CLUSTER[werk] ?? null : null;
  const regios = cluster ? mijnRegios.filter((r) => REGION_CLUSTER[r] === cluster) : mijnRegios;
  const heelCluster = !!cluster && regios.length === REGIONS.filter((r) => REGION_CLUSTER[r] === cluster).length;
  const kanLandelijk = new Set(mijnRegios.map((r) => REGION_CLUSTER[r])).size > 1;
  // het rooster van welke maand: cijfer, toets en vaststelling gaan over één kalendermaand
  const maanden = komendeMaanden(vandaag);
  const [maandKeuze, setMaand] = useState<Maand>(maanden[0]);
  const maand = maanden.includes(maandKeuze) ? maandKeuze : maanden[0];
  const [vooruitKeuze, setVooruit] = useBewaard<Vooruit>('grip-dashboard-vooruit', '60');
  const dagen = Number(VOORUIT.includes(vooruitKeuze) ? vooruitKeuze : '60');

  const rijen = useMemo(
    () => (klaar ? regioOverzicht(getState(), regios, { basis: basisData, laatste: laatsteData }, vandaag) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [klaar, basisData, laatsteData, state.rooster, state.medewerkers, state.verlof, state.ruil, state.wensen, state.beleid, state.normen, state.publicaties, state.goedkeuringen, state.profielen, state.tijden, vandaag, regios.join('|')],
  );

  if (!s.isPlanner) return <GeenToegang />;
  if (!regios.length) return <Leeg titel="Geen regio's">Het dashboard gaat over de regio&apos;s. Je hebt nog geen regio; de beheerder geeft toegang.</Leeg>;
  if (!klaar) return <Laden />;

  const week = Array.from({ length: 7 }, (_, i) => addDays(vandaag, i + 1));
  // zonder eigen voorspelling: de vastgestelde regelplekken
  const voorspelling = laatsteData ?? normRun(state.normen, vandaag).data;
  const verwacht7 = week.reduce((a, d) => a + (som(voorspelling, regios, d) ?? 0), 0);
  const basis7 = laatsteData ? week.reduce((a, d) => a + (som(laatsteData, regios, d, true) ?? 0), 0) : null;
  const gepland7 = rijen.reduce((a, r) => a + r.gepland7, 0), nodig7 = rijen.reduce((a, r) => a + r.nodig7, 0);
  const metTekort = rijen.filter((r) => r.tekortDagen14 > 0);
  const metTeam = rijen.filter((r) => r.team > 0);
  // het rooster van de gekozen maand, per regio (null: nog geen diensten in die maand)
  const vanMaand = (r: { maanden: MaandRegel[] }) => r.maanden.find((x) => x.maand === maand) ?? null;
  const metRooster = metTeam.filter((r) => vanMaand(r)?.toets);
  const toetsVan = (r: { maanden: MaandRegel[] }) => vanMaand(r)!.toets!;
  const gemCijfer = metRooster.length ? metRooster.reduce((a, r) => a + toetsVan(r).cijfer, 0) / metRooster.length : null;
  const overtredingen = metRooster.filter((r) => toetsVan(r).hard > 0).length;
  // overtredingen van ATW/CAO in een van de komende maanden
  const metOvertreding = metTeam.flatMap((r) => r.maanden.filter((x) => x.toets && x.toets.hard > 0).map((x) => ({ regio: r.regio, maand: x.maand })));
  const openVerlof = rijen.reduce((a, r) => a + r.openVerlof, 0), openRuil = rijen.reduce((a, r) => a + r.openRuil, 0);
  const ongepubliceerd = rijen.filter((r) => r.ongepubliceerd > 0);
  const bronFout = Object.values(state.bronStatus).filter((b) => !b.ok);
  const basisLeeftijd = basis ? diffDays(vandaag, basis.uitgegeven) : null;

  // de komende dagen: de eigen voorspelling zolang die loopt, daarna de vastgestelde regelplekken
  const norm = normRun(state.normen, vandaag, dagen).data;
  const eigen = laatsteData ?? norm;
  const normVanaf = laatsteData ? norm.dates.findIndex((d) => som(laatsteData, regios, d) == null) : -1;
  const reeks = {
    dates: norm.dates,
    nu: norm.dates.map((d) => som(eigen, regios, d) ?? som(norm, regios, d) ?? 0),
    basis: norm.dates.map((d) => som(eigen, regios, d, true)),
    roosterbasis: laatsteData && basisData && basisData.id !== laatsteData.id ? norm.dates.map((d) => som(basisData, regios, d)) : null,
    normVanaf: normVanaf >= 0 ? normVanaf : null,
  };

  const metBijsturen = rijen.filter((r) => r.bijsturing.samenvatting.tekortDagen + r.bijsturing.samenvatting.teveelDagen + r.bijsturing.samenvatting.voorgangTekort > 0);
  const bijDagen = rijen.reduce((a, r) => a + r.bijsturing.samenvatting.tekortDagen + r.bijsturing.samenvatting.teveelDagen, 0);
  const kVeranderd = rijen.reduce((a, r) => a + r.bijsturing.samenvatting.kVeranderd, 0);
  const lamB = rijen.map((r) => r.bijsturing.samenvatting.lamVerschil).filter((x): x is number => x != null);
  const ziekNu = rijen.reduce((a, r) => a + r.ziek, 0);
  const pubKort = metTeam.filter((r) => !r.publicatieOk);
  const formatieKrap = metTeam.filter((r) => r.ruimteMin != null && r.ruimteMin < 0);
  const verlofKrap = metTeam.filter((r) => r.verlofKrap != null && r.verlofKrap < 0 && !(r.ruimteMin != null && r.ruimteMin < 0));
  const gem = (k: 'cont' | 'eff' | 'mw' | 'klant') => (metRooster.length ? metRooster.reduce((a, r) => a + toetsVan(r).sub[k], 0) / metRooster.length : null);
  const rondes = state.vakantierondes.filter((r) => r.fase !== 'besloten' && (r.cluster === 'NL' || regios.some((x) => REGION_CLUSTER[x] === r.cluster)));
  const clusters = [...new Set(metTeam.map((r) => REGION_CLUSTER[r.regio]))].map((cluster) => {
    const rs = metTeam.filter((r) => REGION_CLUSTER[r.regio] === cluster);
    const mr = rs.filter((r) => vanMaand(r)?.toets);
    return {
      cluster, naam: CLUSTER_NAAM[cluster] ?? cluster, regios: rs.length,
      cijfer: mr.length ? mr.reduce((a, r) => a + toetsVan(r).cijfer, 0) / mr.length : null,
      tekort: rs.reduce((a, r) => a + r.tekortDagen14, 0),
      bijsturen: rs.reduce((a, r) => a + r.bijsturing.samenvatting.tekortDagen + r.bijsturing.samenvatting.teveelDagen, 0),
      ziek: rs.reduce((a, r) => a + r.ziek, 0),
      verlof: rs.reduce((a, r) => a + (r.verlofKrap ?? 0), 0),
    };
  });

  const acties: { icoon: React.ReactNode; tekst: React.ReactNode; href: string; ernst: 'bad' | 'warn' | 'info' }[] = [];
  if (ziekNu) acties.push({ icoon: <Thermometer size={18} />, tekst: <>{plural(ziekNu, 'medewerker is', 'medewerkers zijn')} vandaag ziek: vang de diensten op</>, href: `/bijsturen?regio=${encodeURIComponent(rijen.find((r) => r.ziek)!.regio)}`, ernst: 'bad' });
  if (metTekort.length) acties.push({ icoon: <AlertTriangle size={18} />, tekst: <>{plural(metTekort.length, 'regio heeft', "regio's hebben")} een tekort in de komende 14 dagen</>, href: `/bijsturen?regio=${encodeURIComponent(metTekort.sort((a, b) => b.tekortDagen14 - a.tekortDagen14)[0].regio)}`, ernst: 'bad' });
  if (metOvertreding.length) acties.push({ icoon: <AlertTriangle size={18} />, tekst: <>{plural(metOvertreding.length, 'maandrooster heeft', 'maandroosters hebben')} een overtreding van ATW/CAO ({[...new Set(metOvertreding.map((x) => maandNaam(x.maand, false)))].join(', ')})</>, href: `/rooster?regio=${encodeURIComponent(metOvertreding[0].regio)}&maand=${metOvertreding[0].maand}`, ernst: 'bad' });
  const tijdenLaat = metTeam.filter((r) => r.tijdenTeLaat > 0), tijdenN = metTeam.reduce((a, r) => a + r.tijdenTeLaat, 0);
  if (tijdenN) acties.push({ icoon: <Clock size={18} />, tekst: <>{plural(tijdenN, 'Dg-dienst heeft', 'Dg-diensten hebben')} binnen {state.beleid.tijdenDagen} dagen nog geen vaste tijden (ATW)</>, href: `/bijsturen?regio=${encodeURIComponent(tijdenLaat[0].regio)}`, ernst: 'bad' });
  const wachtGoed = metTeam.filter((r) => r.goedkeuring === 'wacht');
  if (wachtGoed.length) acties.push(s.mag('rooster.goedkeuren')
    ? { icoon: <BadgeCheck size={18} />, tekst: <>{plural(wachtGoed.length, 'maandrooster wacht', 'maandroosters wachten')} op jouw goedkeuring{adviesTelling(wachtGoed)}</>, href: roosterLink(wachtGoed.find((r) => r.advies === 'rood') ?? wachtGoed[0]), ernst: wachtGoed.some((r) => r.advies === 'rood') ? 'bad' : 'warn' }
    : { icoon: <BadgeCheck size={18} />, tekst: <>{plural(wachtGoed.length, 'maandrooster wacht', 'maandroosters wachten')} op goedkeuring door de regiomanager</>, href: roosterLink(wachtGoed[0]), ernst: 'info' });
  // maandroosters binnen de publicatietermijn zonder advies van de planner
  const zonderAdvies = metTeam.filter((r) => r.goedkeuring === 'geen' || r.goedkeuring === 'afgekeurd');
  if (zonderAdvies.length && s.mag('rooster.advies')) acties.push({ icoon: <BadgeCheck size={18} />, tekst: <>{plural(zonderAdvies.length, 'maandrooster heeft', 'maandroosters hebben')} nog geen advies van jou{zonderAdvies.some((r) => r.goedkeuring === 'afgekeurd') ? ' (of is afgekeurd)' : ''}</>, href: roosterLink(zonderAdvies[0]), ernst: 'warn' });
  // § 4.2: de roosters van juli en augustus 4 maanden vooraf klaar
  {
    const jaar = Number(vandaag.slice(0, 4)) + (vandaag.slice(5, 7) > '08' ? 1 : 0);
    const julEind = `${jaar}-08-31`, julBegin = `${jaar}-07-01`;
    const deadline = zomerDeadline(jaar, state.beleid.zomerVooruitMaanden);
    const dagenTot = diffDays(deadline, vandaag);
    const nietKlaar = metTeam.filter((r) => !r.publicatieTot || r.publicatieTot < julEind);
    if (dagenTot <= 75 && vandaag < julBegin && nietKlaar.length) acties.push({ icoon: <CalendarClock size={18} />, tekst: <>Rooster juli en augustus {jaar}: uiterlijk {fmtD(deadline)} klaar (§ 4.2), nog {plural(nietKlaar.length, 'regio', "regio's")}</>, href: '/verlof?tab=vakantie', ernst: dagenTot < 0 ? 'bad' : 'warn' });
  }
  if (metBijsturen.length) acties.push({ icoon: <Compass size={18} />, tekst: <>Bijsturen in {plural(metBijsturen.length, 'regio', "regio's")}: de laatste voorspelling vraagt op {plural(bijDagen, 'dag', 'dagen')} een ander aantal plekken</>, href: `/bijsturen?regio=${encodeURIComponent(metBijsturen[0].regio)}`, ernst: 'warn' });
  if (openVerlof) acties.push(s.mag('verlof.besluiten')
    ? { icoon: <CalendarClock size={18} />, tekst: <>{plural(openVerlof, 'verlofaanvraag wacht', 'verlofaanvragen wachten')} op jouw besluit</>, href: '/verlof', ernst: 'warn' }
    : { icoon: <CalendarClock size={18} />, tekst: <>{plural(openVerlof, 'verlofaanvraag wacht', 'verlofaanvragen wachten')} op een besluit van {besluiter}</>, href: '/verlof', ernst: 'info' });
  if (openRuil) acties.push({ icoon: <ArrowLeftRight size={18} />, tekst: <>{plural(openRuil, 'ruil wacht', 'ruilen wachten')} op goedkeuring</>, href: '/ruilen', ernst: 'warn' });
  for (const r of rondes) {
    const tegoed = r.fase === 'planning' ? r.data.aanvragen : r.fase === 'analyse' ? r.data.analyse : r.fase === 'advies' ? r.data.advies : r.fase === 'gesprek' ? r.data.gesprek : r.data.besluit;
    const dagenTot = diffDays(tegoed, vandaag);
    acties.push({ icoon: <Palmtree size={18} />, tekst: <>{r.naam}: {VAKANTIE_FASE[r.fase].naam.toLowerCase()}, {dagenTot < 0 ? `${-dagenTot} dagen over de datum` : `nog ${dagenTot} dagen`} ({fmtD(tegoed)})</>, href: '/verlof?tab=vakantie', ernst: dagenTot < 0 ? 'warn' : 'info' });
  }
  if (pubKort.length) acties.push({ icoon: <Send size={18} />, tekst: <>{plural(pubKort.length, 'rooster staat', 'roosters staan')} nog niet t/m {maandNaam(maandVan(publicatieVereistTot(vandaag, state.beleid.publicatieMaanden)))} online ({state.beleid.publicatieMaanden} maanden vooraf)</>, href: `/rooster?regio=${encodeURIComponent(pubKort[0].regio)}`, ernst: 'info' });
  if (verlofKrap.length) acties.push({ icoon: <Palmtree size={18} />, tekst: <>In {plural(verlofKrap.length, 'regio', "regio's")} is er de komende 8 weken meer verlof goedgekeurd dan er ruimte is</>, href: `/jaarplanning?regio=${encodeURIComponent(verlofKrap[0].regio)}`, ernst: 'info' });
  if (formatieKrap.length) acties.push({ icoon: <Palmtree size={18} />, tekst: <>In {plural(formatieKrap.length, 'regio', "regio's")} dekt de bezetting de komende 8 weken de vastgestelde plekken niet, ook zonder verlof</>, href: '/capaciteit', ernst: 'info' });
  if (ongepubliceerd.length) acties.push({ icoon: <Send size={18} />, tekst: <>{plural(ongepubliceerd.length, 'rooster heeft', 'roosters hebben')} ongepubliceerde wijzigingen</>, href: `/rooster?regio=${encodeURIComponent(ongepubliceerd[0].regio)}`, ernst: 'info' });
  if (bronFout.length && s.isBeheerder) acties.push({ icoon: <Database size={18} />, tekst: <>{plural(bronFout.length, 'bron is', 'bronnen zijn')} niet bijgewerkt</>, href: '/model', ernst: 'info' });
  for (const r of state.rondes.filter((x) => x.status === 'open' && regios.includes(x.regio))) {
    const team = state.medewerkers.filter((m) => m.regio === r.regio && m.actief && !m.extern);
    const n = team.filter((m) => r.ingediend[m.id]).length;
    const dagenTot = diffDays(r.deadline, vandaag);
    if (n === team.length || dagenTot < 0) acties.push({ icoon: <CalendarHeart size={18} />, tekst: <>Voorkeurenronde {r.regio}: {n === team.length ? 'iedereen heeft ingediend' : `deadline verstreken (${n} van ${team.length})`}, maak het rooster</>, href: `/rooster?regio=${encodeURIComponent(r.regio)}&plan=1`, ernst: 'warn' });
    else if (dagenTot <= 3) acties.push({ icoon: <CalendarHeart size={18} />, tekst: <>Voorkeurenronde {r.regio}: nog {team.length - n} niet ingediend, deadline {dagenTot === 0 ? 'vandaag' : `over ${dagenTot} ${dagenTot === 1 ? 'dag' : 'dagen'}`}</>, href: '/verlof?tab=voorkeuren', ernst: 'info' });
  }
  if (basisLeeftijd != null && basisLeeftijd > 28) acties.push({ icoon: <Anchor size={18} />, tekst: <>De roosterbasis is {basisLeeftijd} dagen oud</>, href: '/voorspelling', ernst: 'info' });

  // de meldingen van vandaag binnen het overzicht (de verdeling zelf is landelijk)
  const verdelingVandaag = state.verdelingen[vandaag];
  const meldingenVandaag = (verdelingVandaag?.meldingen ?? []).filter((m) => !cluster || regios.includes(m.regio));
  const verdeeldVandaag = meldingenVandaag.filter((m) => verdelingVandaag!.toewijzingen.some((t) => t.meldingId === m.id)).length;
  const teVerdelen = meldingenVandaag.length - verdeeldVandaag;

  const uur = uurNu();
  const groet = uur < 6 ? 'Goedenacht' : uur < 12 ? 'Goedemorgen' : uur < 18 ? 'Goedemiddag' : 'Goedenavond';

  return (
    <>
      <PaginaKop titel={`${groet}${s.naam && s.echt.modus !== 'lokaal' ? `, ${s.naam.split(' ')[0]}` : ''}`} lead={<>Stand van zaken op {fmtLang(vandaag)}.{cluster ? <> Je ziet {heelCluster ? `cluster ${CLUSTER_NAAM[cluster]}` : `je regio's in cluster ${CLUSTER_NAAM[cluster]}`}{kanLandelijk ? '; kies links Landelijk voor het hele land' : ''}.</> : null} {laatste ? <>Laatste voorspelling van {fmtMoment(`${laatste.uitgegeven}T${laatste.gemaakt.slice(11, 16)}`)}{basis ? <>, roosterbasis van {fmtMoment(`${basis.uitgegeven}T${basis.gemaakt.slice(11, 16)}`)}</> : ''}.</> : 'Nog geen eigen voorspelling: GRIP rekent met de vastgestelde regelplekken.'}</>} />

      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="De keten">
        <KetenStap nr={1} icoon={<LineChart size={17} />} titel="Voorspellen" href="/voorspelling" focus={!!laatste && diffDays(vandaag, laatste.uitgegeven) > 3}>
          <b className="display text-[26px] leading-none">{nlInt(verwacht7)}</b> meldingen verwacht, komende 7 dagen
          <span className="note block">{basis7 ? `${pctS(verwacht7 / basis7 - 1)} t.o.v. wat normaal is` : 'volgens de vastgestelde regelplekken'}</span>
        </KetenStap>
        <KetenStap nr={2} icoon={<CalendarDays size={17} />} titel="Rooster" href={pubKort[0] ? `/rooster?regio=${encodeURIComponent(pubKort[0].regio)}` : '/rooster'} focus={pubKort.length > 0 || metTekort.length > 0}>
          <b className="display text-[26px] leading-none">{nlInt(gepland7)}/{nlInt(nodig7)}</b> regelplekken gepland, komende 7 dagen
          <span className="note block">{metTeam.length - pubKort.length} van {metTeam.length} roosters t/m {maandNaam(maandVan(publicatieVereistTot(vandaag, state.beleid.publicatieMaanden)), false)} gepubliceerd</span>
        </KetenStap>
        <KetenStap nr={3} icoon={<Compass size={17} />} titel="Bijvoorspellen en bijsturen" href={metBijsturen[0] ? `/bijsturen?regio=${encodeURIComponent(metBijsturen[0].regio)}` : '/bijsturen'} focus={metBijsturen.length > 0 || ziekNu > 0}>
          <b className="display text-[26px] leading-none">{metBijsturen.length}</b> {metBijsturen.length === 1 ? 'regio' : "regio's"} met actie
          <span className="note block">{bijDagen} dagen te weinig of te veel{ziekNu ? ` · ${ziekNu} ziek vandaag` : ''}</span>
          <span className="note block">{lamB.length ? `${pctS(lamB.reduce((a, b) => a + b, 0) / lamB.length)} verwacht t.o.v. de roosterbasis` : 'Nog geen vergelijking met de roosterbasis'}{kVeranderd ? `, ${plural(kVeranderd, 'regiodag', 'regiodagen')} met een ander aantal plekken` : ''}</span>
        </KetenStap>
        <KetenStap nr={4} icoon={<Route size={17} />} titel="Verdelen" href="/verdeling" focus={!!teVerdelen}>
          {meldingenVandaag.length ? (
            <><b className="display text-[26px] leading-none">{nlInt(verdeeldVandaag)}/{nlInt(meldingenVandaag.length)}</b> meldingen van vandaag verdeeld</>
          ) : <><b className="display text-[26px] leading-none">0</b> meldingen van vandaag ingevoerd</>}
          <span className="note block">{teVerdelen ? `${teVerdelen} nog te verdelen` : 'Om 07:00 alle meldingen in één keer, gesprekken om 10:00 of 13:00'}</span>
        </KetenStap>
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="text-[14px] font-semibold">Roostercijfers van</span>
        <Segment label="Maand van het rooster" waarde={maand} onChange={setMaand} opties={maanden.map((m): [Maand, string] => [m, maandNaam(m, false).replace(/^./, (c) => c.toUpperCase())])} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="box-focus">
          <div className="text-[13.5px] font-semibold opacity-80">Gemiddeld roostercijfer</div>
          <div className="display mt-1 text-[46px] font-semibold leading-none">{gemCijfer != null ? nl(gemCijfer) : '–'}</div>
          <div className="mt-1 text-[13px] opacity-80">rooster {maandNaam(maand, false)}{overtredingen ? ` · ${overtredingen} met overtreding ATW/CAO` : ''}{metRooster.length < metTeam.length ? ` · ${metTeam.length - metRooster.length} nog zonder rooster` : ''}</div>
        </div>
        {([['cont', 'Continuïteit', 'past het werk, binnen wet en beleid'], ['eff', 'Efficiency', 'binnen de normen'], ['mw', 'Medewerkers', 'voorkeuren en eerlijke verdeling'], ['klant', 'Klanten', 'binnen 24 uur geholpen']] as const).map(([k, l, sub]) => {
          const v = gem(k);
          return (
            <div key={k} className="box">
              <div className="text-[13.5px] font-semibold">{l}</div>
              <div className="display mt-1 text-[34px] font-semibold leading-none" style={{ color: v == null ? undefined : v >= 0.75 ? 'var(--teal)' : v >= 0.6 ? 'var(--gold)' : 'var(--red)' }}>{v != null ? Math.round(v * 100) : '–'}</div>
              <div className="note mt-1">{sub}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 lg:col-span-2">
          {reeks && (
            <Box
              titel={`${regios.length === REGIONS.length ? 'Landelijke drukte' : heelCluster ? `Drukte in cluster ${CLUSTER_NAAM[cluster!]}` : 'Drukte in jouw regio\'s'}, komende ${dagen} dagen`}
              rechts={(
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                  <Segment label="Dagen vooruit" waarde={String(dagen) as Vooruit} onChange={setVooruit} opties={VOORUIT.map((v): [Vooruit, string] => [v, v])} />
                  <Link href="/voorspelling" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">Voorspelling <ArrowRight size={15} /></Link>
                </div>
              )}
            >
              <ForecastChart reeks={reeks} hoogte={200} compact onSel={() => router.push('/voorspelling')} />
              <Legenda roosterbasis={!!reeks.roosterbasis} norm={reeks.normVanaf != null} compact />
            </Box>
          )}
          {clusters.length > 1 && (
            <Box titel="Per cluster" rechts={<span className="note">cijfer: {maandNaam(maand, false)}; de rest: komende weken</span>}>
              <div className="scroll border-0">
                <table className="tb">
                  <thead><tr><th>Cluster</th><th className="r">Regio&apos;s</th><th className="r">Cijfer</th><th className="r">Tekort 14 d</th><th className="r">Bijsturen</th><th className="r">Ziek</th><th className="r" title="Som van de laagste verlofruimte per regio in de komende 8 weken">Verlofruimte</th></tr></thead>
                  <tbody>
                    {clusters.map((c) => (
                      <tr key={c.cluster}>
                        <td className="font-semibold">{c.naam}</td>
                        <td className="r num">{c.regios}</td>
                        <td className="r num">{c.cijfer != null ? nl(c.cijfer) : '–'}</td>
                        <td className={cx('r num', c.tekort > 0 && 'text-rood')}>{c.tekort || ''}</td>
                        <td className={cx('r num', c.bijsturen > 0 && 'text-gold')}>{c.bijsturen ? `${c.bijsturen} d` : ''}</td>
                        <td className={cx('r num', c.ziek > 0 && 'text-rood')}>{c.ziek || ''}</td>
                        <td className={cx('r num', c.verlof < 0 && 'text-rood')}>{nlInt(c.verlof)} u</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note mt-2">Binnen een cluster kan een regio met ruimte bijspringen bij een buurregio (roosterbeleid § 3.9).</p>
            </Box>
          )}
        </div>
        <Box titel="Actie nodig">
          {acties.length ? (
            <ul className="grid gap-2">
              {acties.map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-[14.5px] hover:bg-soft">
                    <span className={cx(a.ernst === 'bad' && 'text-rood', a.ernst === 'warn' && 'text-gold', a.ernst === 'info' && 'text-info')}>{a.icoon}</span>
                    <span className="flex-1">{a.tekst}</span>
                    <ArrowRight size={15} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-[15px]"><CheckCircle2 size={18} className="text-teal" /> Alles bijgewerkt. Niets dat nu aandacht vraagt.</p>
          )}
        </Box>
      </div>

      <Sectie titel="Roosters per maand" lead="Per regio de komende vier maanden: is het rooster vastgesteld, wat is het cijfer en wat adviseerde de planner. Tik op een maand om dat rooster te openen.">
        <RoostersPerMaand rijen={rijen} maanden={maanden} gekozen={maand} onMaand={setMaand} />
      </Sectie>

      <Sectie titel={<>Regio&apos;s · rooster {maandNaam(maand)}</>} lead={<>Cijfer, toets en vaststelling gaan over het rooster van {maandNaam(maand, false)} (kies hierboven een andere maand). Tekort, bijsturen, verlofruimte en open aanvragen gaan over nu en de komende weken. Klik op een regio om het rooster te openen.</>}>
        <div className="scroll">
          <table className="tb">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] bg-card">Regio</th><th>Cluster</th><th className="r">Team</th><th className="r">Cijfer</th><th>Toets</th><th>Vaststelling</th>
                <th className="r" title="Continuïteit: past het werk, binnen wet en beleid">Cont.</th><th className="r" title="Efficiency: binnen de normen">Eff.</th><th className="r" title="Medewerkerstevredenheid">Mdw.</th><th className="r" title="Klanttevredenheid: binnen 24 uur geholpen">Klant</th>
                <th className="r" title="Dagen met te weinig plekken in de komende 14 dagen">Tekort 14 d</th><th className="r" title="Dagen waarop de laatste voorspelling een ander aantal plekken vraagt dan gepland">Bijsturen</th><th className="r" title="Laagste verlofruimte (uren) in de komende 8 weken">Verlofruimte</th><th>Online t/m</th><th className="r">Open</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((r) => {
                const bs = r.bijsturing.samenvatting;
                const bij = bs.tekortDagen + bs.teveelDagen;
                const mr = vanMaand(r), mt = mr?.toets ?? null;
                const href = `/rooster?regio=${encodeURIComponent(r.regio)}&maand=${maand}`;
                return (
                  <tr key={r.regio} className="klik" onClick={() => router.push(href)}>
                    <td className="sticky left-0 z-[1] whitespace-nowrap bg-card font-semibold"><Link href={href}>{r.regio}</Link>{r.ziek > 0 && <span title={`${r.ziek} ziek vandaag`}> <Thermometer size={13} className="inline text-rood" /></span>}</td>
                    <td className="text-muted">{CLUSTER_NAAM[REGION_CLUSTER[r.regio]]}</td>
                    <td className="r">{r.team}</td>
                    <td className="r"><b className="display text-[19px]">{mt ? nl(mt.cijfer) : '–'}</b></td>
                    <td>{!r.team ? <Pill>Geen team</Pill> : mt ? <Pill soort={mt.status[0]}>{mt.status[1]}</Pill> : <span className="note">nog geen rooster</span>}</td>
                    <td className="whitespace-nowrap">{mr ? <span className="inline-flex items-center gap-1.5" title={VASTSTELLING[mr.vaststelling].lang}>
                      <i className={cx('inline-block h-2 w-2 rounded-full', mr.vaststelling === 'goed' ? 'bg-teal' : mr.vaststelling === 'wacht' ? 'bg-gold' : mr.vaststelling === 'afgekeurd' ? 'bg-rood' : 'bg-line')} aria-hidden />
                      {VASTSTELLING[mr.vaststelling].kort}{mr.advies ? <span className={cx('font-semibold', mr.advies === 'groen' ? 'text-teal' : mr.advies === 'oranje' ? 'text-gold' : 'text-rood')}> · {mr.advies}</span> : null}
                    </span> : <span className="text-muted">–</span>}</td>
                    {(['cont', 'eff', 'mw', 'klant'] as const).map((k) => <td key={k} className="r"><PijlerGetal v={mt ? mt.sub[k] : null} /></td>)}
                    <td className={cx('r', r.tekortDagen14 > 0 && 'font-bold text-rood')}>{r.team ? r.tekortDagen14 : '–'}</td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>{bij ? <Link href={`/bijsturen?regio=${encodeURIComponent(r.regio)}`} className="font-semibold text-gold">{bij} dag{bij > 1 ? 'en' : ''}</Link> : <span className="text-muted">–</span>}</td>
                    <td className={cx('r num', r.verlofKrap != null && r.verlofKrap < 0 && 'text-rood')} title={r.ruimteMin != null && r.ruimteMin < 0 ? `Ook zonder verlof ${nlInt(r.ruimteMin)} uur: de bezetting dekt de vastgestelde plekken niet` : 'Laagste verlofruimte per week in de komende 8 weken, na goedgekeurd verlof'}>{r.verlofKrap != null ? `${nlInt(r.verlofKrap)} u` : '–'}{r.ruimteMin != null && r.ruimteMin < 0 ? ' *' : ''}</td>
                    <td className="whitespace-nowrap" title={r.publicatieOk ? 'Online volgens het beleid' : `Het beleid vraagt online t/m ${maandNaam(maandVan(publicatieVereistTot(vandaag, state.beleid.publicatieMaanden)))}`}>
                      {r.publicatieTot ? <span className={cx(!r.publicatieOk && 'text-gold')}>{fmtD(r.publicatieTot)}</span> : <span className="note">nog niet</span>}{r.ongepubliceerd ? <> <Pill soort="info" title={`${r.ongepubliceerd} wijzigingen sinds publicatie`}>{r.ongepubliceerd}</Pill></> : null}
                    </td>
                    <td className="r">{r.openVerlof + r.openRuil || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {formatieKrap.length > 0 && <p className="note mt-2">* Ook zonder verlof dekt de bezetting (contracturen min {Math.round(state.beleid.verzuimNorm * 1000) / 10}% verzuim) hier in minstens één week de vastgestelde plekken niet. Zie <Link className="font-semibold text-accent" href="/capaciteit">Capaciteit</Link>.</p>}
      </Sectie>

      <div className="mt-9 grid gap-5 lg:grid-cols-2">
        <Box titel="Recente activiteit">
          <Activiteiten lijst={state.activiteit.filter((a) => !a.regio || (cluster ? regios : s.regios).includes(a.regio)).slice(0, 10)} />
        </Box>
        <Box titel="Bronnen" rechts={s.isBeheerder ? <Link href="/model" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">Bronnen en model <ArrowRight size={15} /></Link> : undefined}>
          {Object.keys(state.bronStatus).length ? (
            <ul className="grid gap-2 text-[15px]">
              {Object.values(state.bronStatus).filter((b) => !b.bron.endsWith('archief')).map((b) => (
                <li key={b.bron} className="flex items-center justify-between gap-3">
                  <span>{BRON_NAAM[b.bron] ?? b.bron}</span>
                  <span className="flex items-center gap-2"><span className="note">{fmtMoment(b.opgehaald)}</span>{b.ok ? <Pill soort="ok">ok</Pill> : <Pill soort="bad" title={b.melding}>fout</Pill>}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">Nog niet ververst. De bronnen worden bij het eerste gebruik van de dag automatisch opgehaald.</p>
          )}
        </Box>
      </div>
    </>
  );
}

const BRON_NAAM: Record<string, string> = {
  weer: 'Weersverwachting', lucht: 'Luchtkwaliteit', seizoen: 'Seizoensverwachting', riool: 'Rioolwater COVID', cbs: 'CBS-sterfte', normalen: 'Klimaatnormalen',
};

function PijlerGetal({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted">–</span>;
  const kleur = v >= 0.75 ? 'var(--teal)' : v >= 0.6 ? 'var(--gold)' : 'var(--red)';
  return <b className="num" style={{ color: kleur }}>{Math.round(v * 100)}</b>;
}

/** Een stap van de keten. Vraagt een stap nu iets, dan staat er "Actie nodig" bij. */
function KetenStap({ nr, icoon, titel, href, focus, children }: { nr: number; icoon: React.ReactNode; titel: string; href: string; focus?: boolean; children: React.ReactNode }) {
  return (
    <li className="list-none">
      <Link href={href} className="box flex h-full flex-col text-inherit no-underline hover:bg-soft" style={focus ? { borderColor: 'var(--gold)' } : undefined}>
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-soft text-[13px] font-semibold">{nr}</span>
          <span className="flex items-center gap-1.5 font-semibold">{icoon} {titel}</span>
          <ArrowRight size={15} className="ml-auto shrink-0 opacity-60" />
        </div>
        <div className="text-[14px] leading-snug">{children}</div>
        {focus && <div className="mt-auto pt-3"><Pill soort="warn">Actie nodig</Pill></div>}
      </Link>
    </li>
  );
}

/** "(1 rood, 2 oranje)" bij roosters die op goedkeuring wachten. */
function adviesTelling(rs: { advies: string | null }[]): string {
  const n = (k: string) => rs.filter((r) => r.advies === k).length;
  const delen = [n('rood') && `${n('rood')} rood`, n('oranje') && `${n('oranje')} oranje`].filter(Boolean);
  return delen.length ? ` (advies ${delen.join(', ')})` : '';
}

/** Link naar het rooster van de regio, in de maand waar de vaststelling over gaat. */
function roosterLink(r: { regio: string; goedkeuringMaand: string }): string {
  return `/rooster?regio=${encodeURIComponent(r.regio)}&maand=${r.goedkeuringMaand}`;
}
