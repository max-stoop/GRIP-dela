'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Undo2, Redo2, Copy, Eraser, Wand2, Send, Download, Printer, UserPlus, Users, CalendarHeart, Sparkles, BookOpen, FileUp, ArrowLeftRight, Maximize2, Minimize2 } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { Vaststellen } from '@/components/rooster/Vaststellen';
import { adviesVoorstel } from '@/lib/rooster/advies';
import { useActie, useToast } from '@/components/toast';
import { GeenToegang, Laden, Leeg, Modal, PaginaKop, Segment } from '@/components/ui';
import { RoosterGrid } from '@/components/rooster/RoosterGrid';
import { MedewerkerModal, ScorePaneel, type MedewerkerInvoer } from '@/components/rooster/Panelen';
import { Analyse } from '@/components/rooster/Analyse';
import { ClusterOverzicht } from '@/components/rooster/ClusterOverzicht';
import { clusterStand } from '@/lib/rooster/cluster';
import { JaarroosterImport } from '@/components/rooster/JaarroosterImport';
import { PlekkenDag } from '@/components/voorspelling/Plekken';
import { PlanModal } from '@/components/rooster/PlanModal';
import { Verbeteren } from '@/components/rooster/Verbeteren';
import { Verschuiven, verschuivingenVoor, verschuivingTekst } from '@/components/rooster/Verschuiven';
import { useBewaard } from '@/components/verdeling/bewaard';
import { bewaarMedewerker, getState, publiceer, useApp, verwijderMedewerker, voorbeeldTeamToevoegen, zetCellen, zetVolgorde, useOpslagwijze } from '@/lib/store/store';
import { komendeMaanden, maandRegels } from '@/lib/store/overzicht';
import { useRuns } from '@/lib/store/hooks';
import { behoefteVoor, type ToetsTegen } from '@/lib/store/afgeleid';
import { wijzigingenSindsPublicatie } from '@/lib/store/overzicht';
import { CLUSTERS, CLUSTER_NAAM, REGIONS } from '@/lib/model/config';
import { kans1BPerDag, kans1BUitleg } from '@/lib/rooster/kans1b';
import { DAG_KORT, fmtD, fmtDag, fmtDJ, fromDay, isoWeek, toDay, todayIso, weekday, weekIndex } from '@/lib/dates';
import { DIENSTEN, PALET, dienstTijd } from '@/lib/rooster/diensten';
import { BEHOEFTE_BRON, LEGE_CELLEN, beleidVoor, inRooster, opContract, opVolgorde, schuif, weekendCadans, type Cellen } from '@/lib/rooster/types';
import { cel, toets as toetsRooster } from '@/lib/rooster/toets';
import { type Wijziging } from '@/lib/rooster/voorstel';
import type { DienstCode, Medewerker } from '@/lib/rooster/types';
import { cx, nl, plural } from '@/lib/format';
import { isMaand, maandDagen, maandEind, maandNaam, maandVan, periodeNaam, volgendeMaand, type Maand } from '@/lib/rooster/maand';
import { afdrukken, downloadXlsx } from '@/lib/export';
import { plekkenNorm } from '@/lib/capaciteit/norm';
import { vaststellingVan } from '@/lib/rooster/vaststelling';
import { useRegioUitAdres } from '@/lib/werkregio';
import { inSchoolvakantie } from '@/lib/capaciteit/verlof';
import { NaarNbd } from '@/components/nbd/NaarNbd';

/** Het rooster van de regio's, met regelplekken. De nabestaandendesk heeft een eigen module (/nbd/rooster). */
export default function RoosterPagina() {
  return <Suspense fallback={<Laden />}><NaarNbd naar="/nbd/rooster"><Rooster /></NaarNbd></Suspense>;
}

function Rooster() {
  const s = useSessie();
  const opslag = useOpslagwijze();
  const door = useDoor();
  const actie = useActie();
  const toon = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const vandaag = todayIso();

  const mijnRegios = REGIONS.filter((r) => s.regios.includes(r));
  const regio = useRegioUitAdres(params.get('regio'), mijnRegios);
  const goedkeuringenRegio = useApp((x) => x.goedkeuringen[regio]);
  const publicatieMaanden = useApp((x) => x.beleid.publicatieMaanden);
  // standaard de eerste maand binnen de publicatietermijn die nog vastgesteld moet worden, anders deze maand
  const standaardMaand = useMemo(() => {
    const m0 = maandVan(vandaag);
    // op de laatste dag van de maand valt er in deze maand niets meer te plannen
    const eerste = maandEind(m0) > vandaag ? 0 : 1;
    for (let i = eerste; i <= publicatieMaanden; i++) { const m = volgendeMaand(m0, i); if (!(goedkeuringenRegio?.[m]?.status === 'goedgekeurd' && goedkeuringenRegio[m].advies)) return m; }
    return m0;
  }, [goedkeuringenRegio, vandaag, publicatieMaanden]);
  const maandParam = params.get('maand');
  const maand: Maand = isMaand(maandParam) ? maandParam : standaardMaand;
  const naarMaand = (m: Maand) => router.replace(`/rooster?regio=${encodeURIComponent(regio)}&maand=${m}`, { scroll: false });
  // de gekozen maand vastzetten in het adres, zodat de weergave niet verspringt als de maand wordt vastgesteld
  useEffect(() => {
    if (regio && !isMaand(maandParam)) router.replace(`/rooster?${new URLSearchParams({ ...Object.fromEntries(params), regio, maand: standaardMaand })}`, { scroll: false });
  }, [regio, maandParam, standaardMaand, params, router]);
  const [versie, setVersie] = useState<ToetsTegen>('basis');
  const [weergave, setWeergave] = useState<'rooster' | 'cluster' | 'analyse'>('rooster');
  const [verf, setVerf] = useState<DienstCode>('1');
  const [undo, setUndo] = useState<Wijziging[][]>([]);
  const [redo, setRedo] = useState<Wijziging[][]>([]);
  const [bewerk, setBewerk] = useState<Medewerker | null | 'nieuw'>(null);
  const [bevestig, setBevestig] = useState<null | 'leeg' | 'publiceer'>(null);
  const [pubPeriode, setPubPeriode] = useState<{ van: string; tot: string } | null>(null);
  const [importeer, setImporteer] = useState(false);
  const [uitlegDag, setUitlegDag] = useState<string | null>(null);
  const [plan, setPlan] = useState(false);
  const [verbeter, setVerbeter] = useState(false);
  const [verschuif, setVerschuif] = useState(false);
  // per kijker onthouden: de hele maand in beeld (het zijpaneel eronder) en de volgorde van de namen
  const [heleMaand, setHeleMaand] = useBewaard('grip-rooster-hele-maand', true);
  const [volgorde, setVolgorde] = useBewaard<'eigen' | 'contract'>('grip-rooster-volgorde', 'eigen');

  const medewerkers = useApp((x) => x.medewerkers);
  const cellen = useApp((x) => x.rooster[regio]) ?? LEGE_CELLEN;
  const roosters = useApp((x) => x.rooster);
  const tijdenRegio = useApp((x) => x.tijden[regio]);
  const schoolvakanties = useApp((x) => x.schoolvakanties);
  const goedkeuring = goedkeuringenRegio?.[maand];
  const inVakantie = useCallback((d: string) => inSchoolvakantie(schoolvakanties, regio, d), [schoolvakanties, regio]);
  const wensenAlle = useApp((x) => x.wensen);
  const verlofAlle = useApp((x) => x.verlof);
  const profielen = useApp((x) => x.profielen);
  const beleidAlg = useApp((x) => x.beleid);
  const normen = useApp((x) => x.normen);
  // met het eigen minimum aan Dg-diensten en de voorgaansplekken van deze regio
  const beleid = useMemo(() => beleidVoor(beleidAlg, regio, normen), [beleidAlg, regio, normen]);
  const pub = useApp((x) => x.publicaties[regio]);
  const ronde = useApp((x) => x.rondes.find((r) => r.regio === regio && r.status === 'open') ?? null);
  const { laatste, laatsteData, basis, basisData, klaar } = useRuns();

  useEffect(() => { setUndo([]); setRedo([]); }, [regio]);
  useEffect(() => { if (params.get('plan')) setPlan(true); }, [params]);

  const team = useMemo(() => medewerkers.filter((m) => m.regio === regio && inRooster(m)).sort(volgorde === 'contract' ? opContract : opVolgorde), [medewerkers, regio, volgorde]);
  const dates = useMemo(() => maandDagen(maand), [maand]);
  const start = toDay(dates[0]);
  const toetsDates = useMemo(() => dates.filter((d) => d >= vandaag), [dates, vandaag]);
  const wensen = useMemo(() => wensenAlle.filter((w) => w.regio === regio), [wensenAlle, regio]);
  const aanvragen = useMemo(() => verlofAlle.filter((v) => v.regio === regio && v.status === 'aangevraagd'), [verlofAlle, regio]);
  const verschuivingen = useApp((x) => x.verschuivingen);
  const bronnen = useMemo(() => ({ basis: basisData, laatste: laatsteData, norm: normen, verschuivingen }), [basisData, laatsteData, normen, verschuivingen]);
  const behoefteVan = useCallback((ds: string[]) => behoefteVoor(bronnen, regio, ds, { alphaRegio: beleid.alphaRegio, tegen: versie }), [bronnen, regio, beleid.alphaRegio, versie]);
  const behoefte = useMemo(() => behoefteVan(dates), [behoefteVan, dates]);
  const laatsteVoorspelling = laatsteData ? laatsteData.dates[laatsteData.dates.length - 1] : null;
  const verbeterDates = useMemo(() => (dates.some((d) => d >= vandaag) ? dates.filter((d) => d >= vandaag) : dates), [dates, vandaag]);
  const verbeterBehoefte = useMemo(() => behoefteVan(verbeterDates), [behoefteVan, verbeterDates]);
  const verbeterToets = useMemo(() => (verbeter ? toetsRooster({ team, dates: verbeterDates, cellen, behoefte: verbeterBehoefte, wensen, beleid, profielen }) : null), [verbeter, team, verbeterDates, cellen, verbeterBehoefte, wensen, beleid, profielen]);
  const t = useMemo(() => toetsRooster({ team, dates: toetsDates, cellen, behoefte, wensen, beleid, profielen, tijden: tijdenRegio, schoolvakantie: inVakantie }), [team, toetsDates, cellen, behoefte, wensen, beleid, profielen, tijdenRegio, inVakantie]);
  // de komende vier maanden: cijfer, advies en vaststelling (zoals op het dashboard)
  const maandenOverzicht = useMemo(() => (team.length ? maandRegels(getState(), regio, bronnen, komendeMaanden(vandaag), vandaag) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [team, regio, bronnen, vandaag, cellen, goedkeuringenRegio, pub, wensen, beleid, profielen, tijdenRegio, schoolvakanties]);
  // de kans dat een 1B valt: het hele cluster, met de roosters die deze gebruiker ziet en anders de vastgestelde plekken
  const cluster = Object.keys(CLUSTERS).find((c) => CLUSTERS[c].includes(regio)) ?? '';
  // de afgesproken plekken van elke regio in het cluster, voor de kans op een 1B en de clusterregels
  const behoeften = useMemo(() => new Map((CLUSTERS[cluster] ?? [regio]).map((r) => [r, r === regio ? behoefte : behoefteVoor(bronnen, r, dates, { alphaRegio: beleid.alphaRegio, tegen: versie })])),
    [cluster, regio, behoefte, bronnen, dates, beleid.alphaRegio, versie]);
  const kans1B = useMemo(() => {
    const regios = CLUSTERS[cluster] ?? [];
    const dagen = kans1BPerDag({
      normen, cluster, regios, dates,
      lam: (r, d) => behoeften.get(r)?.[d]?.lam,
      rooster: (r) => {
        const c = r === regio ? cellen : roosters[r];
        const team = medewerkers.filter((m) => m.regio === r && inRooster(m)).map((m) => m.id);
        return c && team.length ? { cellen: c, team } : null;
      },
    });
    return dagen.map((dag) => (dag ? { dag, uitleg: kans1BUitleg(dag, regio, CLUSTER_NAAM[cluster] ?? cluster, normen.uitval) } : null));
  }, [cluster, regio, behoeften, dates, normen, cellen, roosters, medewerkers]);
  // dezelfde kans voor een ander rooster of een andere periode: Rooster maken laat zien hoe vaak de 1B dan valt
  const kans1BVan = useCallback((c: Cellen, dagen: string[]) => {
    const regios = CLUSTERS[cluster] ?? [];
    const b = new Map(regios.map((r) => [r, r === regio ? behoefteVan(dagen) : behoefteVoor(bronnen, r, dagen, { alphaRegio: beleid.alphaRegio, tegen: versie })]));
    return kans1BPerDag({
      normen, cluster, regios, dates: dagen,
      lam: (r, d) => b.get(r)?.[d]?.lam,
      rooster: (r) => {
        const x = r === regio ? c : roosters[r];
        const ids = medewerkers.filter((m) => m.regio === r && inRooster(m)).map((m) => m.id);
        return x && ids.length ? { cellen: x, team: ids } : null;
      },
    });
  }, [cluster, regio, behoefteVan, bronnen, beleid.alphaRegio, versie, normen, roosters, medewerkers]);
  // hoe het cluster plant: per regio gepland tegenover afgesproken (de regio's die deze gebruiker ziet)
  const clusterRegios = useMemo(() => (CLUSTERS[cluster] ?? [regio]).filter((r) => r === regio || mijnRegios.includes(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cluster, regio, mijnRegios.join()]);
  const stand = useMemo(() => clusterStand(dates, clusterRegios.map((r) => {
    const b = behoeften.get(r);
    return { regio: r, team: medewerkers.filter((m) => m.regio === r && inRooster(m)), cellen: (r === regio ? cellen : roosters[r]) ?? LEGE_CELLEN, behoefte: (d: string) => b?.[d] ?? null };
  }), { alphaCluster: beleid.alphaCluster, speling: beleid.clusterSpeling, minDG: beleidAlg.minDG, dgPerRegio: beleidAlg.dgPerRegio }), [dates, clusterRegios, behoeften, regio, medewerkers, cellen, roosters, beleid.alphaCluster, beleid.clusterSpeling, beleidAlg.minDG, beleidAlg.dgPerRegio]);
  // onder het rooster van de regio alleen als het hele cluster te zien is (een regiomanager ziet alleen de eigen regio)
  const heelCluster = clusterRegios.length === (CLUSTERS[cluster] ?? []).length;
  const gridToets = useMemo(() => {
    // voor de voetregels ook de dagen vóór vandaag laten zien
    const alles = toetsRooster({ team, dates, cellen, behoefte, wensen, beleid, profielen, tijden: tijdenRegio, schoolvakantie: inVakantie });
    return { ...t, perDag: alles.perDag };
  }, [t, team, dates, cellen, behoefte, wensen, beleid, profielen, tijdenRegio, inVakantie]);

  const adviesInfo = useMemo(() => ({
    voorstel: adviesVoorstel(t, vandaag),
    samenvatting: `Cijfer ${nl(t.cijfer)} · ${t.wensen.totaal ? `${t.wensen.gehonoreerd} van ${t.wensen.totaal} wensen gehonoreerd` : 'geen wensen'}.`,
  }), [t, vandaag]);

  const zet = useCallback((w: Wijziging[], bewaarUndo = true) => {
    if (!w.length) return;
    const terug: Wijziging[] = w.map(([m, d]) => [m, d, cel(cellen, m, d)]);
    zetCellen(regio, w);
    if (bewaarUndo) { setUndo((u) => [...u.slice(-49), terug]); setRedo([]); }
    return terug;
  }, [cellen, regio]);

  const doeUndo = useCallback(() => {
    const stap = undo[undo.length - 1];
    if (!stap) return;
    const terug = zet(stap, false);
    setUndo((u) => u.slice(0, -1));
    if (terug) setRedo((r) => [...r, terug]);
  }, [undo, zet]);
  const doeRedo = useCallback(() => {
    const stap = redo[redo.length - 1];
    if (!stap) return;
    const terug = zet(stap, false);
    setRedo((r) => r.slice(0, -1));
    if (terug) setUndo((u) => [...u, terug]);
  }, [redo, zet]);

  if (!s.isPlanner) return <GeenToegang />;
  if (!klaar) return <Laden />;

  const bewerkbaar = dates.filter((d) => d >= vandaag);
  const toekomst = dates.filter((d) => d > vandaag);
  const bronWeek = dates.findIndex((d, i) => i % 7 === 0 && d > vandaag);
  const bronnenGebruikt = [...new Set(t.perDag.map((p) => p.bron).filter(Boolean))] as (keyof typeof BEHOEFTE_BRON)[];
  const versieTekst = versie === 'norm'
    ? 'de vastgestelde regelplekken'
    : `${versie === 'basis' && basis ? `roosterbasis van ${fmtD(basis.uitgegeven)}` : laatste ? `laatste voorspelling van ${fmtD(laatste.uitgegeven)}` : 'de vastgestelde regelplekken'}${bronnenGebruikt.length > 1 ? `, verder ${bronnenGebruikt.filter((b) => b !== versie).map((b) => BEHOEFTE_BRON[b]).join(' en ')}` : ''}`;
  const wijzigingen = wijzigingenSindsPublicatie(cellen, pub, team);
  const geenVoorspelling = !laatsteData;

  const kopieerWeek = () => {
    if (bronWeek < 0) return;
    const bron = dates.slice(bronWeek, bronWeek + 7);
    const w: Wijziging[] = [];
    for (const e of team) {
      dates.slice(bronWeek + 7).forEach((d, i) => {
        const src = cel(cellen, e.id, bron[i % 7]);
        // verlof en ziekte blijven staan, en worden ook niet naar andere weken gekopieerd
        const doel = cel(cellen, e.id, d);
        if (doel !== 'V' && doel !== 'Z' && src !== 'V' && src !== 'Z' && doel !== src) w.push([e.id, d, src]);
      });
    }
    zet(w);
    toon(`Week ${isoWeek(toDay(bron[0]))} gekopieerd naar de volgende weken (${plural(w.length, 'wijziging', 'wijzigingen')}). Verlof en ziekte bleven staan.`);
  };

  const leegmaken = () => {
    const w: Wijziging[] = [];
    for (const e of team) for (const d of toekomst) { const x = cel(cellen, e.id, d); if (x !== '-' && x !== 'V' && x !== 'Z') w.push([e.id, d, '-']); }
    zet(w);
    setBevestig(null);
    toon(`${plural(w.length, 'dienst', 'diensten')} gewist. Verlof en ziekte bleven staan. Ongedaan maken kan.`);
  };

  /**
   * Het jaarrooster downloaden in het eigen format: per cluster een werkmap met per regio het rooster en het
   * urenblad, zonder namen. Het jaar is het jaar van de gekozen maand.
   */
  const exporteer = async () => {
    const [{ jaarroosterBladen }, { schrijfXlsx }] = await Promise.all([import('@/lib/rooster/jaarExport'), import('@/lib/xlsx')]);
    const st = getState();
    const jaar = Number(maand.slice(0, 4));
    const regios = (CLUSTERS[cluster] ?? [regio]).filter((r) => r === regio || s.regios.includes(r));
    const invoer = regios.map((r) => {
      const teamR = st.medewerkers.filter((m) => m.regio === r && inRooster(m)).sort(opVolgorde);
      const cellenR = st.rooster[r] ?? {};
      const gepland = new Set(teamR.flatMap((e) => Object.keys(cellenR[e.id] ?? {}).map((d) => d.slice(0, 7))));
      return {
        regio: r, team: teamR, cellen: cellenR,
        plekken: (d: string) => plekkenNorm(st.normen, r, d),
        status: (m: Maand) => (vaststellingVan(st.goedkeuringen[r]?.[m]) === 'goed' ? 'Definitief' : gepland.has(m) ? 'concept' : ''),
      };
    });
    const data = await schrijfXlsx(jaarroosterBladen(jaar, invoer), regios.indexOf(regio));
    downloadXlsx(data, `${jaar}_Jaarrooster_${cluster || regio.replace(/\W+/g, '-')}`);
  };

  const printen = () => afdrukken({
    titel: `Rooster ${regio}`,
    ondertitel: `${fmtDJ(dates[0])} t/m ${fmtDJ(dates[dates.length - 1])} · cijfer ${nl(t.cijfer)} (${t.status[1].toLowerCase()}) · getoetst tegen ${versieTekst}`,
    kop: ['Medewerker', ...dates.map((d) => `${DAG_KORT[weekday(toDay(d))]} ${d.slice(8)}`)],
    rijen: team.map((e) => [e.naam, ...dates.map((d) => { const x = cel(cellen, e.id, d); return x === '-' ? '' : x; })]),
    klassen: team.map((e) => [undefined, ...dates.map((d) => { const x = cel(cellen, e.id, d); return x !== '-' ? `d${x}` : weekday(toDay(d)) % 6 === 0 ? 'we' : undefined; })]),
    voet: [['Gepland', ...gridToets.perDag.map((p) => p.p)], ['Afgesproken', ...gridToets.perDag.map((p) => p.k ?? '')], ['Voorgangen', ...gridToets.perDag.map((p) => (p.zondag ? '' : p.voorgangen))]],
  });

  return (
    <>
      <PaginaKop
        boven={<>Planning · cluster {CLUSTER_NAAM[Object.keys(CLUSTERS).find((c) => CLUSTERS[c].includes(regio)) ?? ''] ?? ''}</>}
        titel={<>Rooster <em>{regio}</em></>}
        lead={<>We roosteren per maand. Laat het rooster maken volgens het beleid en de voorkeuren van het team, of zet zelf diensten neer. Het cijfer rekent direct mee: continuïteit, efficiency, medewerkers en klanten. <Link href="/beleid#p-3.7" className="font-semibold text-accent">Roosterproces</Link></>}
      >
        <label className="label"><span>Regio</span>
          <select className="input w-auto min-w-[210px]" value={regio} onChange={(e) => router.replace(`/rooster?regio=${encodeURIComponent(e.target.value)}${maandParam ? `&maand=${maand}` : ''}`)}>
            {Object.keys(CLUSTERS).map((c) => {
              const rs = CLUSTERS[c].filter((r) => mijnRegios.includes(r));
              return rs.length ? <optgroup key={c} label={`Cluster ${CLUSTER_NAAM[c]}`}>{rs.map((r) => <option key={r}>{r}</option>)}</optgroup> : null;
            })}
          </select>
        </label>
        <label className="label"><span>Toetsen tegen</span>
          <select className="input w-auto" value={versie} onChange={(e) => setVersie(e.target.value as ToetsTegen)}>
            <option value="basis">Roosterbasis</option><option value="laatste">Laatste voorspelling</option><option value="norm">Vastgestelde regelplekken</option>
          </select>
        </label>
      </PaginaKop>

      {geenVoorspelling && versie !== 'norm' && <div className="banner banner-info mb-4">Er is nog geen voorspelling. Het rooster wordt getoetst tegen de vastgestelde regelplekken.</div>}
      {ronde && (
        <div className="banner banner-ok mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <CalendarHeart size={18} className="text-accent" />
          <span>Voorkeurenronde {periodeNaam(ronde)}: <b>{Object.keys(ronde.ingediend).length} van {team.length}</b> ingediend, deadline {fmtD(ronde.deadline)}.</span>
          <span className="flex-1" />
          <Link href="/verlof?tab=voorkeuren" className="text-sm font-semibold text-accent">Voorkeuren bekijken</Link>
          <button type="button" className="btn btn-teal btn-sm" onClick={() => setPlan(true)}><Wand2 size={15} /> Rooster maken uit voorkeuren</button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segment label="Weergave" waarde={weergave} onChange={setWeergave} opties={[['rooster', 'Rooster'], ['cluster', `Cluster ${CLUSTER_NAAM[cluster] ?? ''}`], ['analyse', `Analyse · ${nl(t.cijfer)}`]]} />
        <div className="ml-2 flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => naarMaand(volgendeMaand(maand, -1))} aria-label="Vorige maand"><ChevronLeft size={17} /></button>
          <span className="display min-w-[150px] text-center text-[19px] font-semibold capitalize" aria-live="polite">{maandNaam(maand)}</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => naarMaand(volgendeMaand(maand))} aria-label="Volgende maand"><ChevronRight size={17} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => naarMaand(maandVan(vandaag))} disabled={maand === maandVan(vandaag)}>Deze maand</button>
        </div>
        <div className="flex-1" />
        {(CLUSTERS[cluster] ?? []).length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVerschuif(true)} title="Regelplekken van de ene regio in het cluster naar de andere"><ArrowLeftRight size={15} /> Plekken verschuiven</button>
        )}
        {weergave !== 'cluster' && (
          <>
            <button type="button" className="btn btn-ghost btn-icon" onClick={doeUndo} disabled={!undo.length} title="Ongedaan maken (Ctrl+Z)" aria-label="Ongedaan maken"><Undo2 size={17} /></button>
            <button type="button" className="btn btn-ghost btn-icon" onClick={doeRedo} disabled={!redo.length} title="Opnieuw (Ctrl+Y)" aria-label="Opnieuw"><Redo2 size={17} /></button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={kopieerWeek} disabled={!team.length || bronWeek < 0 || bronWeek + 7 >= dates.length}><Copy size={15} /> Week {bronWeek >= 0 ? isoWeek(toDay(dates[bronWeek])) : ''} kopiëren</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBevestig('leeg')} disabled={!team.length || !toekomst.length}><Eraser size={15} /> Leegmaken</button>
          </>
        )}
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => actie(exporteer)} title="Jaarrooster downloaden (Excel, zonder namen)" aria-label="Jaarrooster downloaden" disabled={!team.length}><Download size={17} /></button>
        {weergave !== 'cluster' && (
          <>
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => actie(printen)} title="Afdrukken of PDF" aria-label="Afdrukken of PDF" disabled={!team.length}><Printer size={17} /></button>
            <button type="button" className="btn btn-ghost" onClick={() => setImporteer(true)}><FileUp size={16} /> Importeren</button>
            <button type="button" className="btn btn-ghost" onClick={() => setVerbeter(true)} disabled={!team.length}><Sparkles size={16} className="text-plum" /> Verbeteren</button>
            <button type="button" className="btn btn-teal" onClick={() => setPlan(true)} disabled={!team.length}><Wand2 size={16} /> Rooster maken</button>
          </>
        )}
      </div>

      {weergave === 'rooster' && verschuivingenVoor(verschuivingen, regio, dates[0], dates[dates.length - 1]).map((v) => (
        <div key={v.id} className="banner banner-info mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px]">
          <ArrowLeftRight size={16} />
          <span className="flex-1">Afspraak in het cluster: {verschuivingTekst(v, regio)}{v.opmerking ? ` (${v.opmerking})` : ''}. De plekken hieronder zijn daarop aangepast.</span>
          <button type="button" className="text-sm font-semibold text-accent" onClick={() => setVerschuif(true)}>Bekijken</button>
        </div>
      ))}

      {weergave === 'rooster' && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Dienst kiezen">
          {PALET.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={verf === c}
              onClick={() => setVerf(c)}
              title={`${DIENSTEN[c].naam}${dienstTijd(c) ? `, ${dienstTijd(c)}` : ''}. ${DIENSTEN[c].uitleg}`}
              className={cx('min-w-[44px] rounded-md border border-line bg-card px-2 py-1.5 text-[13px] font-semibold', `c-${c}`, verf === c && 'outline outline-[3px] outline-offset-1 outline-[color:var(--plum)]')}
            >
              {c === '-' ? 'Vrij' : c}
            </button>
          ))}
          <span className="note ml-2 hidden 2xl:inline">{DIENSTEN[verf].naam}{dienstTijd(verf) ? `, ${dienstTijd(verf)}` : ''}. Sleep over de vakjes, of gebruik pijltjes en de toetsen 1, M, 2, B, D (DG2), L (DG1), O, T, V, Z en 0.</span>
          <span className="flex-1" />
          <Segment label="Volgorde" waarde={volgorde} onChange={setVolgorde} opties={[['eigen', 'Eigen volgorde'], ['contract', 'Op contract']]} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHeleMaand(!heleMaand)} aria-pressed={heleMaand} title={heleMaand ? 'Het zijpaneel weer naast het rooster' : 'De hele maand in beeld, het zijpaneel eronder'}>
            {heleMaand ? <Minimize2 size={15} /> : <Maximize2 size={15} />} {heleMaand ? 'Met zijpaneel' : 'Hele maand'}
          </button>
        </div>
      )}

      {weergave === 'cluster' ? (
        <ClusterOverzicht
          naam={CLUSTER_NAAM[cluster] ?? cluster} dates={dates} vandaag={vandaag} stand={stand} minDG={beleid.minDG} kans1B={kans1B.map((k) => k?.dag.cluster.gemiddeld ?? null)}
          zonderInzage={(CLUSTERS[cluster] ?? []).filter((r) => !clusterRegios.includes(r))}
          onRegio={(r) => { setWeergave('rooster'); router.replace(`/rooster?regio=${encodeURIComponent(r)}&maand=${maand}`); }}
        />
      ) : weergave === 'analyse' ? (
        team.length ? <Analyse t={t} team={team} beleid={beleid} magInstellen={s.isBeheerder} /> : <Leeg titel="Nog geen team">Voeg eerst medewerkers toe.</Leeg>
      ) : (
        <div className={heleMaand ? 'grid items-start gap-5' : 'grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]'}>
          <div className="min-w-0">
            {team.length ? (
              <RoosterGrid
                passend={heleMaand}
                team={team} dates={dates} cellen={cellen} toets={gridToets} vandaag={vandaag} wensen={wensen} aanvragen={aanvragen} profielen={profielen}
                  tijden={tijdenRegio} beleid={beleid}
                verf={verf} onZet={(w) => zet(w)} onNaam={(id) => setBewerk(team.find((m) => m.id === id) ?? null)} onSchuif={volgorde === 'eigen' ? (id, richting) => { const plek = schuif(team, id, richting); if (plek) zetVolgorde(plek); } : undefined} onUndo={doeUndo} onRedo={doeRedo}
                kans1B={kans1B} onUitleg={setUitlegDag} cluster={heelCluster && clusterRegios.length > 1 ? { naam: CLUSTER_NAAM[cluster] ?? cluster, stand } : undefined}
              />
            ) : (
              <Leeg titel={`Nog geen medewerkers in ${regio}`} icoon={<Users size={28} />} actie={
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn" onClick={() => setBewerk('nieuw')}><UserPlus size={16} /> Medewerker toevoegen</button>
                  {opslag !== 'database' && <button type="button" className="btn btn-ghost" onClick={() => voorbeeldTeamToevoegen(regio)}>Voorbeeldteam toevoegen</button>}
                </div>
              }>{opslag !== 'database' ? 'Voeg medewerkers toe, of start met een voorbeeldteam om de app te verkennen.' : 'Voeg de medewerkers van deze regio toe. Daarna kun je het rooster maken.'}</Leeg>
            )}
            {team.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
                {beleid.omHetWeekend && (() => {
                  // per weekendcadans in het team: welke groep werkt het eerste weekend van deze maand
                  const za = start + ((6 - weekday(start) + 7) % 7), w = weekIndex(za);
                  const cadansen = [...new Set(team.map((m) => weekendCadans(m)))].filter((c) => c > 1).sort();
                  if (!cadansen.length) return null;
                  return <span>Weekend {fmtD(fromDay(za))}: {cadansen.map((c) => `${c === 2 ? 'om het weekend' : `1 op ${c}`} groep ${'ABCD'[w % c]}`).join(', ')} werkt</span>;
                })()}
                <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent" style={{ borderTopColor: 'var(--gold)' }} />wens (goud = niet gehonoreerd)</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block h-[5px] w-[5px] rounded-full bg-teal" />graag-dag</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: 'var(--red)' }} />liever niet</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ backgroundImage: 'linear-gradient(135deg, transparent 46%, var(--red) 46% 54%, transparent 54%)' }} />kan niet</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ outline: '2px dashed var(--gold)' }} />verlof aangevraagd</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ boxShadow: 'inset 0 0 0 2px var(--red)' }} />ATW/CAO</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ boxShadow: 'inset 0 0 0 2px var(--gold)' }} />let op (beleid)</span>
                <span className="inline-flex items-center gap-1.5 italic">schuin = vastgestelde plekken</span>
                <span className="inline-flex items-center gap-1.5"><span className="underline decoration-dotted underline-offset-2">DG2</span> = tijden vastgelegd</span>
                <Link href="/beleid" className="inline-flex items-center gap-1 font-semibold text-accent"><BookOpen size={14} /> Beleid</Link>
                <button type="button" className="ml-auto inline-flex items-center gap-1.5 font-semibold text-accent" onClick={() => setBewerk('nieuw')}><UserPlus size={15} /> Medewerker toevoegen</button>
              </div>
            )}
          </div>

          <aside className={heleMaand ? 'grid items-start gap-4 lg:grid-cols-2' : 'grid gap-4'}>
            {team.length > 0 && <ScorePaneel t={t} versieTekst={versieTekst} onAnalyse={() => setWeergave('analyse')} />}
            {team.length > 0 && (
              <Vaststellen
                regio={regio}
                maand={maand}
                maanden={goedkeuringenRegio}
                overzicht={maandenOverzicht}
                onMaand={naarMaand}
                tot={dates[dates.length - 1]}
                t={t}
                advies={adviesInfo}
                pub={pub}
                wijzigingen={wijzigingen}
                goedkeuring={goedkeuring}
                verplicht={beleid.goedkeuringVerplicht}
                publicatieMaanden={beleid.publicatieMaanden}
                bewerkbaar={bewerkbaar.length > 0}
                onPubliceer={(van, tot) => { setPubPeriode({ van, tot }); setBevestig('publiceer'); }}
              />
            )}
          </aside>
        </div>
      )}

      <Verschuiven
        open={verschuif}
        onClose={() => setVerschuif(false)}
        regio={regio}
        clusterNaam={CLUSTER_NAAM[cluster] ?? cluster}
        clusterRegios={CLUSTERS[cluster] ?? [regio]}
        mag={(a, b) => s.isPlanner && mijnRegios.includes(a) && mijnRegios.includes(b)}
        standaardVan={dates[0]}
        standaardTot={dates[dates.length - 1]}
      />

      <PlanModal
        open={plan}
        onClose={() => { setPlan(false); if (params.get('plan')) router.replace(`/rooster?regio=${encodeURIComponent(regio)}&maand=${maand}`); }}
        regio={regio}
        team={team}
        cellen={cellen}
        behoefteVan={behoefteVan}
        kans1BVan={kans1BVan}
        uitval={normen.uitval}
        clusterNaam={CLUSTER_NAAM[cluster] ?? cluster}
        laatsteVoorspelling={laatsteVoorspelling}
        wensen={wensen}
        profielen={profielen}
        beleid={beleid}
        ronde={ronde}
        standaardVan={dates[0]}
        standaardTot={dates[dates.length - 1]}
        onToepassen={(w, oms) => {
          // verlof of ziekte dat intussen is binnengekomen, blijft staan
          const veilig = w.filter(([m, d]) => { const nu = cel(cellen, m, d); return nu !== 'V' && nu !== 'Z'; });
          zet(veilig);
          setPlan(false);
          if (params.get('plan')) router.replace(`/rooster?regio=${encodeURIComponent(regio)}&maand=${maand}`);
          const over = w.length - veilig.length;
          toon(`Rooster gemaakt (${oms}).${over ? ` ${plural(over, 'dag bleef', 'dagen bleven')} staan: daar is intussen verlof of ziekte ingevoerd.` : ''} Je kunt alles nog aanpassen of ongedaan maken.`);
        }}
      />

      <JaarroosterImport open={importeer} onClose={() => setImporteer(false)} />

      <Modal open={!!uitlegDag} onClose={() => setUitlegDag(null)} breed titel={uitlegDag ? `${regio}, ${fmtDag(uitlegDag)}: plekken en 1B` : ''}>
        {uitlegDag && (() => {
          const i = dates.indexOf(uitlegDag), p = gridToets.perDag[i];
          const nodig = p?.lam != null && p.k != null ? { lam: p.lam, alpha: p.bron === 'norm' ? normen.dekkingRegio : beleid.alphaRegio, k: p.k, bron: p.bron ? `de ${BEHOEFTE_BRON[p.bron]}` : undefined } : null;
          return <PlekkenDag dag={kans1B[i]?.dag} regio={regio} clusterNaam={CLUSTER_NAAM[cluster] ?? cluster} uitval={normen.uitval} nodig={nodig} />;
        })()}
      </Modal>

      {verbeterToets && (
        <Verbeteren
          open={verbeter}
          onClose={() => setVerbeter(false)}
          regio={regio}
          team={team}
          dates={verbeterDates}
          cellen={cellen}
          behoefte={verbeterBehoefte}
          wensen={wensen}
          profielen={profielen}
          beleid={beleid}
          t={verbeterToets}
          vandaag={vandaag}
          onToepassen={(w, tekst) => { zet(w); toon(`${tekst}. Ongedaan maken kan.`); }}
        />
      )}

      <MedewerkerModal
        open={bewerk !== null}
        mw={bewerk === 'nieuw' ? null : bewerk}
        regio={regio}
        onClose={() => setBewerk(null)}
        onBewaar={(m: MedewerkerInvoer) => { bewaarMedewerker({ ...m, regio }); setBewerk(null); toon(`${m.naam} is opgeslagen.`); }}
        onVerwijder={(id) => { verwijderMedewerker(id); setBewerk(null); toon('Medewerker verwijderd.'); }}
      />

      <Modal
        open={bevestig !== null}
        onClose={() => setBevestig(null)}
        titel={bevestig === 'leeg' ? 'Rooster leegmaken?' : `Rooster ${regio} publiceren?`}
        voet={<>
          <button type="button" className="btn btn-ghost" onClick={() => setBevestig(null)}>Annuleren</button>
          {bevestig === 'leeg'
            ? <button type="button" className="btn btn-danger" onClick={leegmaken}><Eraser size={16} /> Leegmaken</button>
            : <button type="button" className="btn" onClick={() => actie(() => { publiceer(regio, pubPeriode?.van ?? vandaag, pubPeriode?.tot ?? dates[dates.length - 1], door); setBevestig(null); }, 'Rooster gepubliceerd. Medewerkers zien de nieuwe versie.')}><Send size={16} /> Publiceren</button>}
        </>}
      >
        {bevestig === 'leeg'
          ? <p>Alle diensten vanaf morgen in {maandNaam(maand)} worden gewist. Verlof blijft staan. Je kunt dit ongedaan maken zolang je op deze pagina blijft.</p>
          : <>
              <p>Het rooster van {fmtD(pubPeriode?.van ?? vandaag)} t/m {fmtD(pubPeriode?.tot ?? dates[dates.length - 1])} wordt zichtbaar voor de medewerkers van {regio}.</p>
              {t.hard > 0 && <p className="banner banner-err mt-3">Let op: dit rooster heeft {plural(t.hard, 'harde overtreding', 'harde overtredingen')} van ATW of CAO.</p>}
            </>}
      </Modal>
    </>
  );
}
