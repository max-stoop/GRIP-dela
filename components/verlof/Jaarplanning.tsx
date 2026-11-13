'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarPlus, Check, ChevronLeft, ChevronRight, Info, Sun, Undo2, X } from 'lucide-react';
import { useDoor, useSessie, useVerlofBesluiter } from '@/components/sessie';
import { AlleenRegiomanager } from '@/components/Rechten';
import { useActie } from '@/components/toast';
import { Laden, Modal, PaginaKop, Pill, Sectie, Veld } from '@/components/ui';
import { JaarKalender, JaarLegenda } from '@/components/verlof/JaarKalender';
import { AdviesRegel, Verlofplanning, useAanvraagAdvies, useVerlofContext } from '@/components/verlof/Verlofplanning';
import { beoordeelVerlof, trekVerlofIn, useApp, vraagVerlofAan } from '@/lib/store/store';
import { jaarplan, jaarWeken, type Jaarplan, type JaarRij, type Signaal } from '@/lib/capaciteit/jaarplan';
import { CLUSTERS, REGIONS, REGION_CLUSTER, CLUSTER_NAAM } from '@/lib/model/config';
import { inLopendeRonde, VERLOF_SOORT, type Verlof, type VerlofSoort, type VerlofStatus } from '@/lib/store/types';
import type { Medewerker } from '@/lib/rooster/types';
import { addDays, feestdagenVan, fmtD, fmtDJ, isoWeek, MAAND_KORT, toDay, todayIso } from '@/lib/dates';
import { feestdagStand } from '@/lib/rooster/feestdagen';
import { vakantieNaam } from '@/lib/capaciteit/verlof';
import { useRegioUitAdres, zetWerkregio } from '@/lib/werkregio';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { cx, nlInt, plural } from '@/lib/format';

const STATUS: Record<VerlofStatus, [React.ComponentProps<typeof Pill>['soort'], string]> = {
  aangevraagd: ['warn', 'Aangevraagd'], goedgekeurd: ['ok', 'Goedgekeurd'], afgewezen: ['bad', 'Afgewezen'], ingetrokken: ['neutral', 'Ingetrokken'],
};

/** Voor de planner het team van een regio of de NBD; voor een medewerker het eigen verlofjaar. */
export function Jaarplanning({ nbd = false }: { nbd?: boolean }) {
  const s = useSessie();
  return s.isPlanner ? <PlannerJaar nbd={nbd} /> : <MijnJaar />;
}

function useJaar(): number {
  const params = useSearchParams();
  const j = Number(params.get('jaar'));
  return Number.isInteger(j) && j >= 2020 && j <= 2100 ? j : Number(todayIso().slice(0, 4));
}

/** De jaarplanning van elke regio in het cluster die deze gebruiker ziet: de schoolvakanties vallen in het hele cluster tegelijk. */
function useClusterPlan(regios: string[], jaar: number): Jaarplan[] {
  const ctx = useVerlofContext();
  const rondes = useApp((x) => x.vakantierondes);
  const vooruit = useApp((x) => x.beleid.zomerVooruitMaanden);
  const vandaag = todayIso();
  const sleutel = regios.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => regios.map((regio) => jaarplan({ ctx, regio, jaar, vandaag, rondes, zomerVooruitMaanden: vooruit })), [ctx, sleutel, jaar, vandaag, rondes, vooruit]);
}

/** Per regio in het cluster per week: hoeveel mensen weg zijn, gekleurd naar de ruimte die er dan over is. */
function ClusterJaar({ plannen, regio, onRegio }: { plannen: Jaarplan[]; regio: string; onRegio: (r: string) => void }) {
  const weken = plannen[0]?.weken ?? [];
  const maanden: { maand: number; n: number }[] = [];
  for (const w of weken) {
    const laatste = maanden[maanden.length - 1];
    if (laatste && laatste.maand === w.maand) laatste.n++; else maanden.push({ maand: w.maand, n: 1 });
  }
  return (
    <div className="scroll">
      <table className="jk" aria-label="Verlof in het cluster">
        <thead>
          <tr>
            <th className="nm" scope="col">{plannen[0]?.jaar}</th>
            {maanden.map((m, i) => <th key={`${m.maand}-${i}`} colSpan={m.n} className="maand" scope="colgroup">{MAAND_KORT[m.maand]}</th>)}
          </tr>
          <tr>
            <th className="nm" scope="col"><small>week</small></th>
            {weken.map((w) => <th key={w.maandag} scope="col" className={cx('wkn', w.huidig && 'nu')}>{w.week}</th>)}
          </tr>
        </thead>
        <tbody>
          {plannen.map((p) => (
            <tr key={p.regio} className="ruimterij">
              <th className="nm" scope="row">
                <button type="button" className={cx('text-left font-semibold', p.regio === regio ? 'text-ink' : 'text-accent')} onClick={() => onRegio(p.regio)}>{p.regio}</button>
                <small>{plural(p.rijen.length, 'medewerker', 'medewerkers')}</small>
              </th>
              {p.weken.map((w) => (
                <td key={w.maandag} className={cx('wk', w.status, w.ruimte.schoolvakantie && 'sv', w.huidig && 'nu', w.verleden && 'oud')}
                  title={`${p.regio}, week ${w.week} (${fmtD(w.maandag)})${w.ruimte.schoolvakantie ? `, ${vakantieNaam(w.ruimte.schoolvakantie)}` : ''}: ${w.weg === 1 ? '1 medewerker' : `${w.weg} medewerkers`} met verlof, nog ${nlInt(w.rest)} uur ruimte`}>
                  {w.weg || ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function usePlan(regio: string, jaar: number): Jaarplan | null {
  const ctx = useVerlofContext();
  const rondes = useApp((x) => x.vakantierondes);
  const vooruit = useApp((x) => x.beleid.zomerVooruitMaanden);
  const vandaag = todayIso();
  return useMemo(() => (regio ? jaarplan({ ctx, regio, jaar, vandaag, rondes, zomerVooruitMaanden: vooruit }) : null), [ctx, regio, jaar, vandaag, rondes, vooruit]);
}

export function JaarKiezer({ jaar, onJaar }: { jaar: number; onJaar: (j: number) => void }) {
  const nu = Number(todayIso().slice(0, 4));
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Jaar">
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => onJaar(jaar - 1)} disabled={jaar <= nu - 1} aria-label="Vorig jaar"><ChevronLeft size={18} /></button>
      <span className="display min-w-[64px] text-center text-[22px] font-semibold" aria-live="polite">{jaar}</span>
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => onJaar(jaar + 1)} disabled={jaar >= nu + 1} aria-label="Volgend jaar"><ChevronRight size={18} /></button>
    </div>
  );
}

function Signalen({ lijst }: { lijst: Signaal[] }) {
  if (!lijst.length) return null;
  return (
    <div className="box mb-5">
      <h2 className="kop-s mb-2">Let op</h2>
      <ul className="grid gap-2">
        {lijst.map((x, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[15px]">
            {x.ernst === 'info' ? <Info size={17} className="mt-0.5 shrink-0 text-accent" /> : <AlertTriangle size={17} className={cx('mt-0.5 shrink-0', x.ernst === 'bad' ? 'text-rood' : 'text-gold')} />}
            <span className="min-w-0 flex-1">{x.tekst}</span>
            {x.href && <Link href={x.href} className="shrink-0 text-[14px] font-semibold text-accent">Bekijken</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Kaart({ titel, waarde, sub, toon }: { titel: string; waarde: React.ReactNode; sub?: React.ReactNode; toon?: 'rood' | 'gold' | 'teal' }) {
  return (
    <div className="box">
      <div className="text-[13.5px] font-semibold">{titel}</div>
      <div className={cx('display mt-1 text-[32px] font-semibold leading-none', toon === 'rood' && 'text-rood', toon === 'gold' && 'text-gold', toon === 'teal' && 'text-teal')}>{waarde}</div>
      {sub && <div className="note mt-1">{sub}</div>}
    </div>
  );
}

function periodeTekst(van: string, tot: string) {
  const a = isoWeek(toDay(van)), b = isoWeek(toDay(addDays(tot, -6)));
  return a === b ? `Week ${a}` : `Week ${a} t/m ${b}`;
}

/** Mijlpalen van het vakantieproces en de weken waar verlof het beste past. */
function Zijlijsten({ plan }: { plan: Jaarplan }) {
  const vandaag = todayIso();
  const volgende = plan.mijlpalen.find((m) => m.datum >= vandaag);
  return (
    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="box min-w-0">
        <h3 className="kop-s">Vakantieproces {plan.jaar}</h3>
        <p className="note mb-3 mt-1">Uit de vakantierondes in GRIP, aangevuld met de data die het roosterbeleid adviseert.</p>
        <ol className="grid gap-2">
          {plan.mijlpalen.map((m) => (
            <li key={`${m.datum}${m.tekst}`} className={cx('flex items-start gap-3 text-[14.5px]', m.datum < vandaag && 'opacity-60')}>
              <span className={cx('w-[64px] shrink-0 font-semibold tabular-nums', m === volgende && 'text-accent')}>{fmtD(m.datum)}</span>
              <span className="min-w-0 flex-1">{m.tekst}{m === volgende && <> <Pill soort="info">volgende</Pill></>}</span>
              <Link href={`/beleid#p-${m.paragraaf}`} className="shrink-0 text-[13px] text-muted hover:text-accent">§ {m.paragraaf}{m.bron === 'ronde' ? ' · ronde' : ''}</Link>
            </li>
          ))}
        </ol>
      </div>
      <div className="box min-w-0">
        <h3 className="kop-s flex items-center gap-2"><Sun size={18} className="text-gold" /> Waar verlof het beste past</h3>
        <p className="note mb-3 mt-1">De rustigste periodes die nog komen, buiten de schoolvakanties: daar is na het geplande verlof de meeste ruimte over.</p>
        {plan.rustig.length ? (
          <ul className="grid gap-2">
            {plan.rustig.map((p) => (
              <li key={p.van} className="flex flex-wrap items-baseline justify-between gap-2 text-[14.5px]">
                <span><b>{periodeTekst(p.van, p.tot)}</b> <span className="note">{fmtD(p.van)} t/m {fmtD(addDays(p.tot, -2))}</span></span>
                <span className="note">gemiddeld {nlInt(p.uren)} uur ruimte per week</span>
              </li>
            ))}
          </ul>
        ) : <p className="note">Er zijn dit jaar geen weken meer met ruim voldoende ruimte buiten de schoolvakanties.</p>}
        {plan.knelpunten.length > 0 && (
          <>
            <h4 className="mb-1.5 mt-4 text-[14px] font-semibold">Te weinig ruimte</h4>
            <ul className="grid gap-1.5">
              {plan.knelpunten.slice(0, 5).map((k) => (
                <li key={k.van} className="flex flex-wrap items-baseline justify-between gap-2 text-[14.5px]">
                  <span>{periodeTekst(k.van, k.tot)}</span>
                  <Pill soort={k.alleenGoedgekeurd ? 'bad' : 'warn'}>{nlInt(k.uren)} uur te veel{k.alleenGoedgekeurd ? '' : ' met aanvragen'}</Pill>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function PlannerJaar({ nbd }: { nbd: boolean }) {
  const s = useSessie();
  const besluiter = useVerlofBesluiter();
  const router = useRouter();
  const params = useSearchParams();
  const mijnRegios = useMemo(() => (nbd ? [NBD] : REGIONS.filter((r) => s.regios.includes(r))), [s.regios, nbd]);
  const gekozen = useRegioUitAdres(nbd ? null : params.get('regio'), mijnRegios);
  const regio = nbd ? NBD : gekozen;
  const jaar = useJaar();
  const plan = usePlan(regio, jaar);
  const clusterRegios = nbd ? [] : (CLUSTERS[REGION_CLUSTER[regio]] ?? []).filter((r) => mijnRegios.includes(r));
  const clusterPlannen = useClusterPlan(clusterRegios, jaar);
  // feestdagen gewerkt of ingeroosterd in dit jaar: telt mee bij verlof op een feestdag
  const cellen = useApp((x) => x.rooster[regio]);
  const verlofAlle = useApp((x) => x.verlof);
  const feestdagen = useMemo(() => {
    const dagen = feestdagenVan(jaar);
    return new Map((plan?.rijen ?? []).map((r) => [r.m.id, dagen.filter((f) => feestdagStand(r.m, cellen ?? {}, verlofAlle, f.datum).soort === 'gewerkt').length]));
  }, [plan, jaar, cellen, verlofAlle]);
  const [kies, setKies] = useState<{ mid: string; maandag: string } | null>(null);
  const ga = (r: string, j: number) => router.replace(nbd ? `/nbd/jaarplanning?jaar=${j}` : `/jaarplanning?regio=${encodeURIComponent(r)}&jaar=${j}`, { scroll: false });
  const vandaag = todayIso();

  if (!plan) return <Laden />;
  const t = plan.totaal;
  // de zomer van vorig jaar alleen als die schoolvakantie bekend is
  const metVorigJaar = plan.rijen.some((r) => r.zomerVorigJaar != null);
  const knelWeken = plan.knelpunten.reduce((a, k) => a + k.weken, 0);
  const krapWeken = plan.weken.filter((w) => !w.verleden && w.status === 'krap').length;
  const { eerste, aantal } = jaarWeken(jaar);
  const kiesRij = kies ? plan.rijen.find((r) => r.m.id === kies.mid) : undefined;

  return (
    <>
      <PaginaKop
        boven={nbd ? `Verlof · ${NBD_NAAM.toLowerCase()}` : `Verlof · cluster ${CLUSTER_NAAM[REGION_CLUSTER[regio]] ?? ''}`}
        titel={<>Jaarplanning <em>{nbd ? 'NBD' : regio}</em></>}
        lead={nbd ? 'Het hele verlofjaar van de nabestaandendesk: wie wanneer weg is, hoeveel ruimte de capaciteitsplanning per week laat (netto uren min 92% van wat Erlang C vraagt) en de schoolvakanties. Klik op een week om verlof te plannen of te beoordelen.' : 'Het hele verlofjaar van de regio: wie wanneer weg is, hoeveel ruimte de vastgestelde regelplekken per week laten, de schoolvakanties en het vakantieproces. Klik op een week om verlof te plannen of te beoordelen.'}
      >
        <JaarKiezer jaar={jaar} onJaar={(j) => ga(regio, j)} />
        {!nbd && (
          <label className="label"><span>Regio</span>
            <select className="input w-auto min-w-[210px]" value={regio} onChange={(e) => { zetWerkregio(e.target.value); ga(e.target.value, jaar); }}>
              {mijnRegios.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        )}
      </PaginaKop>

      <Signalen lijst={plan.signalen} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kaart titel={`Verlofruimte ${jaar}`} waarde={<>{nlInt(t.ruimte)} <small className="text-[16px] text-muted">uur</small></>} sub={nbd ? 'voor het hele team, uit de capaciteitsplanning' : 'voor het hele team, uit de vastgestelde regelplekken'} />
        <Kaart titel="Verlof in het rooster" waarde={<>{nlInt(t.goedgekeurd)} <small className="text-[16px] text-muted">uur</small></>} sub={t.aangevraagd ? <>goedgekeurd, plus {nlInt(t.aangevraagd)} uur aangevraagd</> : 'goedgekeurd; geen aanvragen open'} toon="teal" />
        <Kaart titel="Open aanvragen" waarde={t.open} sub={t.open ? `wachten op het besluit van ${besluiter}` : 'alles is besloten'} toon={t.open ? 'gold' : undefined} />
        <Kaart titel="Weken met te weinig ruimte" waarde={knelWeken} sub={<>nog {plural(krapWeken, 'krappe week', 'krappe weken')} dit jaar</>} toon={knelWeken ? 'rood' : undefined} />
      </div>

      <Sectie titel="Jaarkalender" lead="Per medewerker per week. De rij Ruimte telt wie er weg is en kleurt naar wat er over is na goedgekeurd en aangevraagd verlof." className="mt-7">
        <JaarKalender
          plan={plan}
          rijen={plan.rijen}
          label={`Jaarkalender verlof ${regio} ${jaar}`}
          onKies={(mid, maandag) => setKies({ mid, maandag })}
          naamExtra={(r) => <small>{r.m.contract} uur{r.open ? ` · ${plural(r.open, 'aanvraag', 'aanvragen')} open` : ''}</small>}
        />
        <JaarLegenda regio={nbd ? undefined : regio} />
      </Sectie>

      {clusterRegios.length > 1 && (
        <Sectie titel={`Cluster ${CLUSTER_NAAM[REGION_CLUSTER[regio]] ?? ''}`} lead="Per regio per week hoeveel mensen er weg zijn, gekleurd naar de ruimte die dan over is. In de schoolvakanties kijk je naar het hele cluster (§ 4.1): waar de ene regio vol zit, kan de andere misschien opvangen. Klik op een regio voor de jaarkalender daarvan.">
          <ClusterJaar plannen={clusterPlannen} regio={regio} onRegio={(r) => { zetWerkregio(r); ga(r, jaar); }} />
        </Sectie>
      )}

      <Zijlijsten plan={plan} />

      <Sectie titel="Vakanties eerlijk verdeeld" lead={nbd ? <>Wie minder verlof in schoolvakanties had, gaat voor. Hoeveel verlof iemand heeft of nog over heeft, staat niet in GRIP: dat loopt via de personeelsadministratie.</> : <>Bij een vakantieronde gaat voor wie minder verlof in schoolvakanties had (§ 4.1). Hoeveel verlof iemand heeft of nog over heeft, staat niet in GRIP: dat loopt via de personeelsadministratie.</>}>
        <div className="scroll">
          <table className="tb">
            <thead>
              <tr>
                <th>Medewerker</th>
                <th className="r" title="Weken met verlof (minstens 3 werkdagen) in een schoolvakantie">Weken in schoolvakanties</th>
                <th title="Minstens een week verlof in de zomervakantie">Zomer dit jaar</th>
                <th className="r" title="Feestdagen gewerkt of ingeroosterd dit jaar (Team > Feestdagen)">Feestdagen gewerkt</th>
                {metVorigJaar && <th>Zomer vorig jaar</th>}
                <th className="r">Open aanvragen</th>
              </tr>
            </thead>
            <tbody>
              {plan.rijen.map((r) => <MedewerkerRij key={r.m.id} r={r} metVorigJaar={metVorigJaar} feestdagen={feestdagen.get(r.m.id) ?? 0} />)}
            </tbody>
          </table>
        </div>
      </Sectie>

      <Sectie titel={<span id="ruimte" className="scroll-mt-6">Verlofruimte per week</span>} lead={nbd ? <>Zoals de capaciteitsplanning: contracturen min ziekte (5%), overig verlof en langdurig verzuim, training, pauze, afspraken en taken, min 92% van de uren die Erlang C vraagt. De gesprekken bewegen mee met de overlijdens.</> : <>Ruimte = bezetting min verzuim min de te borgen uren uit de vastgestelde regelplekken (§ 4.3). In de schoolvakanties kijk je ook naar het cluster (§ 4.1).</>}>
        <Verlofplanning regios={nbd ? [NBD] : mijnRegios} regio={regio} van={eerste} aantal={aantal} />
      </Sectie>

      {kies && kiesRij && <WeekModal m={kiesRij.m} maandag={kies.maandag} planner onClose={() => setKies(null)} />}
      <p className="note mt-6">Uren per werkdag = contract / 5. De ruimte telt alle soorten verlof. Vandaag: {fmtDJ(vandaag)}.</p>
    </>
  );
}

function MedewerkerRij({ r, metVorigJaar, feestdagen }: { r: JaarRij; metVorigJaar: boolean; feestdagen: number }) {
  const zomer = (v: boolean | null) => (v == null ? '–' : v ? 'ja' : 'nee');
  return (
    <tr>
      <td className="whitespace-nowrap font-semibold">{r.m.naam}<div className="note font-normal">{r.m.contract} uur</div></td>
      <td className="r num">{r.schoolWeken}</td>
      <td>{zomer(r.zomer)}</td>
      <td className="r num">{feestdagen}</td>
      {metVorigJaar && <td>{zomer(r.zomerVorigJaar)}</td>}
      <td className="r num">{r.open || '–'}</td>
    </tr>
  );
}

/** Verlof in een week van één medewerker: wat er staat, en nieuw verlof plannen of aanvragen. */
function WeekModal({ m, maandag, planner, onClose }: { m: Medewerker; maandag: string; planner?: boolean; onClose: () => void }) {
  const magBesluiten = useSessie().mag('verlof.besluiten');
  const besluiter = useVerlofBesluiter();
  const door = useDoor();
  const actie = useActie();
  const vandaag = todayIso();
  const vrijdag = addDays(maandag, 4), zondag = addDays(maandag, 6);
  const items = useApp((x) => x.verlof.filter((v) => v.medewerkerId === m.id && (v.status === 'goedgekeurd' || v.status === 'aangevraagd') && v.van <= zondag && v.tot >= maandag));
  const verleden = zondag < vandaag;
  const beginVan = !planner && maandag < vandaag ? vandaag : maandag;
  const [f, setF] = useState({ van: beginVan, tot: vrijdag < beginVan ? beginVan : vrijdag, soort: 'vakantie' as VerlofSoort, opmerking: '', direct: !!planner && magBesluiten });
  const advies = useAanvraagAdvies(items.length || (verleden && !planner) ? null : { medewerkerId: m.id, regio: m.regio, van: f.van, tot: f.tot });
  const magPlannen = !items.length && (planner || !verleden);

  const plan = () => actie(() => {
    const v = vraagVerlofAan({ medewerkerId: m.id, van: f.van, tot: f.tot, soort: f.soort, opmerking: f.opmerking.trim() || undefined }, door, { planner: !!planner });
    if (planner && magBesluiten && f.direct) beoordeelVerlof(v.id, 'goedgekeurd', door);
    onClose();
  }, planner ? (f.direct ? 'Verlof gepland en goedgekeurd.' : `Verlof ingevoerd als aanvraag; ${besluiter} besluit.`) : `Je aanvraag is verstuurd naar ${besluiter}.`);

  return (
    <Modal open onClose={onClose} titel={<>{planner ? m.naam : 'Verlof'} · week {isoWeek(toDay(maandag))} <span className="note font-normal">({fmtD(maandag)} t/m {fmtD(zondag)})</span></>} voet={magPlannen ? <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleren</button>
      <button type="button" className="btn btn-teal" disabled={f.tot < f.van || (!planner && f.van < vandaag)} onClick={plan}><CalendarPlus size={16} /> {planner ? (f.direct ? 'Plannen en goedkeuren' : 'Als aanvraag invoeren') : 'Aanvragen'}</button>
    </> : <button type="button" className="btn btn-ghost" onClick={onClose}>Sluiten</button>}>
      {items.length > 0 && <VerlofItems items={items as Verlof[]} planner={planner} onKlaar={onClose} />}
      {magPlannen && (
        <div className="grid gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Veld label="Van"><input className="input" type="date" required min={planner ? undefined : vandaag} value={f.van} onChange={(e) => setF({ ...f, van: e.target.value, tot: f.tot < e.target.value ? e.target.value : f.tot })} /></Veld>
            <Veld label="Tot en met"><input className="input" type="date" required min={f.van} value={f.tot} onChange={(e) => setF({ ...f, tot: e.target.value })} /></Veld>
          </div>
          <Veld label="Soort">
            <select className="input" value={f.soort} onChange={(e) => setF({ ...f, soort: e.target.value as VerlofSoort })}>
              {Object.entries(VERLOF_SOORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Veld>
          <Veld label="Toelichting (optioneel)"><input className="input" value={f.opmerking} maxLength={300} onChange={(e) => setF({ ...f, opmerking: e.target.value })} /></Veld>
          {planner && (magBesluiten
            ? <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" className="h-4 w-4 accent-[color:var(--teal)]" checked={f.direct} onChange={(e) => setF({ ...f, direct: e.target.checked })} /> Direct goedkeuren en in het rooster zetten</label>
            : <AlleenRegiomanager wat="Goedkeuren" paragraaf="4.1" />)}
          {advies && <div className="rounded-lg bg-soft p-3"><div className="mb-1 text-[13px] font-semibold text-muted">Ruimte in het team</div><AdviesRegel advies={advies} /></div>}
        </div>
      )}
      {!items.length && !magPlannen && <p className="note">Deze week is voorbij.</p>}
    </Modal>
  );
}

function VerlofItems({ items, planner, onKlaar }: { items: Verlof[]; planner?: boolean; onKlaar: () => void }) {
  const magBesluiten = useSessie().mag('verlof.besluiten');
  const rondes = useApp((x) => x.vakantierondes);
  const inRonde = (v: Verlof) => inLopendeRonde(v, rondes);
  const door = useDoor();
  const actie = useActie();
  const vandaag = todayIso();
  return (
    <ul className="grid gap-2.5">
      {items.map((v) => (
        <li key={v.id} className="rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{fmtD(v.van)}{v.tot !== v.van ? ` t/m ${fmtD(v.tot)}` : ''} <span className="note font-normal">· {VERLOF_SOORT[v.soort]}</span></div>
              {v.opmerking && <div className="note">“{v.opmerking}”</div>}
              {inRonde(v) && v.status === 'aangevraagd' && <div className="note">Valt in een vakantieronde: wordt daar samen besloten.</div>}
            </div>
            <Pill soort={STATUS[v.status][0]}>{STATUS[v.status][1]}</Pill>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {planner && v.status === 'aangevraagd' && !inRonde(v) && !magBesluiten && <AlleenRegiomanager wat="Het besluit" paragraaf="4.1" />}
            {magBesluiten && v.status === 'aangevraagd' && !inRonde(v) && <>
              <button type="button" className="btn btn-teal btn-sm" onClick={() => { actie(() => beoordeelVerlof(v.id, 'goedgekeurd', door), 'Verlof goedgekeurd en in het rooster gezet.'); onKlaar(); }}><Check size={14} /> Goedkeuren</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { actie(() => beoordeelVerlof(v.id, 'afgewezen', door), 'Verlof afgewezen.'); onKlaar(); }}><X size={14} /> Afwijzen</button>
            </>}
            {(v.status === 'aangevraagd' || v.status === 'goedgekeurd') && v.tot >= vandaag && (magBesluiten || (!planner && v.status === 'aangevraagd')) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { actie(() => trekVerlofIn(v.id, door), v.status === 'goedgekeurd' ? 'Verlof ingetrokken; de oorspronkelijke diensten staan weer in het rooster.' : 'Aanvraag ingetrokken.'); onKlaar(); }}><Undo2 size={14} /> Intrekken</button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MijnJaar() {
  const s = useSessie();
  const router = useRouter();
  const ik = useApp((x) => x.medewerkers.find((m) => m.id === s.medewerkerId));
  const jaar = useJaar();
  const plan = usePlan(ik?.regio ?? '', jaar);
  const [kies, setKies] = useState<string | null>(null);
  if (!ik || !plan) return <Laden />;
  const mijn = plan.rijen.find((r) => r.m.id === ik.id);

  return (
    <>
      <PaginaKop titel="Mijn verlofjaar" lead={<>Je verlof in {plan.jaar} en hoeveel ruimte er per week is in {ik.regio}. Groen is ruimte, oranje krap, rood vol. Klik op een week om verlof aan te vragen. Je verlofsaldo staat in de personeelsadministratie, niet in GRIP.</>}>
        <JaarKiezer jaar={jaar} onJaar={(j) => router.replace(`/jaarplanning?jaar=${j}`, { scroll: false })} />
      </PaginaKop>
      <MijnVerlof medewerkerId={ik.id} />
      <Sectie titel="Jaarkalender" lead="Je eigen verlof, en per week de ruimte in het team (het cijfer is het aantal collega's met verlof)." className="mt-7">
        <JaarKalender plan={plan} rijen={mijn ? [mijn] : []} label={`Mijn verlof ${plan.jaar}`} onKies={(_, maandag) => setKies(maandag)} />
        <JaarLegenda regio={ik.regio} />
      </Sectie>
      <Zijlijsten plan={plan} />
      {kies && <WeekModal m={ik} maandag={kies} onClose={() => setKies(null)} />}
    </>
  );
}

/** Geen saldo: dat loopt via de personeelsadministratie. */
function MijnVerlof({ medewerkerId }: { medewerkerId: string }) {
  const vandaag = todayIso();
  const besluiter = useVerlofBesluiter();
  const mijn = useApp((x) => x.verlof).filter((v) => v.medewerkerId === medewerkerId && v.tot >= vandaag && (v.status === 'goedgekeurd' || v.status === 'aangevraagd')).sort((a, b) => a.van.localeCompare(b.van));
  const volgende = mijn.find((v) => v.status === 'goedgekeurd');
  const open = mijn.filter((v) => v.status === 'aangevraagd');
  const periode = (v: Verlof) => `${fmtD(v.van)}${v.tot !== v.van ? ` t/m ${fmtD(v.tot)}` : ''}`;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Kaart titel="Volgend verlof" waarde={volgende ? fmtD(volgende.van) : '–'} sub={volgende ? <>{periode(volgende)} · {VERLOF_SOORT[volgende.soort]}</> : 'Geen goedgekeurd verlof gepland'} toon={volgende ? 'teal' : undefined} />
      <Kaart titel="Aanvragen open" waarde={open.length} sub={open.length ? <>{open.slice(0, 2).map(periode).join(', ')}{open.length > 2 ? ' en meer' : ''}: {besluiter} besluit</> : 'Niets in behandeling'} toon={open.length ? 'gold' : undefined} />
    </div>
  );
}
