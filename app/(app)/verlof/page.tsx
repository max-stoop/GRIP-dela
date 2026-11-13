'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarPlus, CalendarRange, Undo2, Palmtree, ArrowLeftRight } from 'lucide-react';
import { useDoor, useSessie, useVerlofBesluiter } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { PaginaKop, Pill, Sectie, Segment, Veld, Laden } from '@/components/ui';
import { WensKalender } from '@/components/verlof/WensKalender';
import { ProfielEditor, RondeBanner } from '@/components/voorkeur/Voorkeuren';
import { VoorkeurenPlanner } from '@/components/voorkeur/VoorkeurenPlanner';
import { trekVerlofIn, useApp, vraagVerlofAan } from '@/lib/store/store';
import { inLopendeRonde, VAKANTIE_FASE, VERLOF_SOORT, type VerlofSoort } from '@/lib/store/types';
import { REGION_CLUSTER } from '@/lib/model/config';
import { isNbd } from '@/lib/nbd/parameters';
import { NaarNbd } from '@/components/nbd/NaarNbd';
import { UurVoorkeurEditor } from '@/components/nbd/UurVoorkeuren';
import { AdviesRegel, Vakantierondes, useAanvraagAdvies } from '@/components/verlof/Verlofplanning';
import { AlleVerlof, STATUS, TeBeoordelen, VerlofInvoeren, WensenOverzicht, werkdagen } from '@/components/verlof/VerlofBeheer';
import { addDays, fmtD, fmtMoment, isoRange, todayIso } from '@/lib/dates';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { cel } from '@/lib/rooster/toets';
import { plural } from '@/lib/format';

export default function VerlofPagina() {
  const s = useSessie();
  return <Suspense fallback={<Laden />}>{s.rol === 'medewerker' ? <MijnVerlof /> : <NaarNbd naar="/nbd/verlof"><VerlofPlanner /></NaarNbd>}</Suspense>;
}

function MijnVerlof() {
  const s = useSessie();
  const door = useDoor();
  const besluiter = useVerlofBesluiter();
  const actie = useActie();
  const params = useSearchParams();
  const ik = useApp((x) => x.medewerkers.find((m) => m.id === s.medewerkerId));
  const mijn = useApp((x) => x.verlof.filter((v) => v.medewerkerId === s.medewerkerId));
  const pub = useApp((x) => (ik ? x.publicaties[ik.regio] : undefined));
  const ronde = useApp((x) => (ik ? x.rondes.find((r) => r.regio === ik.regio && r.status === 'open') ?? null : null));
  const vakantie = useApp((x) => (ik ? x.vakantierondes.find((r) => r.fase !== 'besloten' && (r.cluster === 'NL' || r.cluster === REGION_CLUSTER[ik.regio])) ?? null : null));
  const vandaag = todayIso();
  const [tab, setTab] = useState<'voorkeuren' | 'verlof'>(params.get('tab') === 'verlof' ? 'verlof' : 'voorkeuren');
  const [f, setF] = useState({ van: addDays(vandaag, 14), tot: addDays(vandaag, 18), soort: 'vakantie' as VerlofSoort, opmerking: '' });
  const advies = useAanvraagAdvies(ik ? { medewerkerId: ik.id, regio: ik.regio, van: f.van, tot: f.tot } : null);
  if (!ik) return <Laden />;
  const geraakt = pub ? isoRange(f.van, f.tot < f.van ? f.van : f.tot).filter((d) => DIENSTEN[cel(pub.cellen, ik.id, d)].werk) : [];

  return (
    <>
      <PaginaKop titel="Verlof en voorkeuren" lead="Geef op wanneer je graag of liever niet werkt, en vraag verlof aan. Het rooster wordt gemaakt met jouw voorkeuren erbij." />
      {ronde && <RondeBanner ronde={ronde} medewerkerId={ik.id} />}
      {vakantie && (
        <div className="banner banner-info mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Palmtree size={18} className="text-accent" />
          <span><b>{vakantie.naam}</b>: {vakantie.fase === 'planning' ? <>vraag je vakantie van {fmtD(vakantie.van)} t/m {fmtD(vakantie.tot)} aan vóór <b>{fmtD(vakantie.data.aanvragen)}</b>. Je ziet meteen of er ruimte is.</> : <>{VAKANTIE_FASE[vakantie.fase].naam.toLowerCase()}; besluit uiterlijk {fmtD(vakantie.data.besluit)}.</>}</span>
          {vakantie.fase === 'planning' && <button type="button" className="btn btn-sm ml-auto" onClick={() => { setTab('verlof'); setF({ ...f, van: vakantie.van < vandaag ? vandaag : addDays(vakantie.van, 30), tot: addDays(vakantie.van < vandaag ? vandaag : addDays(vakantie.van, 30), 13), soort: 'vakantie' }); }}>Vakantie aanvragen</button>}
        </div>
      )}
      <div className="mb-5"><Segment label="Onderdeel" waarde={tab} onChange={setTab} opties={[['voorkeuren', 'Voorkeuren en wensen'], ['verlof', `Verlof${mijn.filter((v) => v.status === 'aangevraagd').length ? ` (${mijn.filter((v) => v.status === 'aangevraagd').length})` : ''}`]]} /></div>
      {tab === 'voorkeuren' && (
        <>
          {isNbd(ik.regio) ? (
            <div className="box">
              <h2 className="kop-s">Mijn voorkeuren per uur</h2>
              <p className="note mb-4 mt-1">De nabestaandendesk is elke dag open van 7:00 tot 22:30. Geef per dag en per uur aan wanneer je graag werkt en wanneer je niet kunt, zo nodig apart voor even en oneven weken. &quot;Kan niet&quot; is een harde grens voor het rooster.</p>
              <UurVoorkeurEditor medewerker={ik} />
            </div>
          ) : (
            <div className="box">
              <h2 className="kop-s">Mijn vaste voorkeuren</h2>
              <p className="note mb-4 mt-1">Gelden voor elke week. &quot;Kan niet&quot; is een harde grens voor het voorstel; &quot;liever niet&quot; wordt zoveel mogelijk vermeden.</p>
              <ProfielEditor medewerker={ik} />
            </div>
          )}
          <Sectie titel="Mijn wensen per datum" lead="Voor losse dagen: tik op een dag om een wens te kiezen. Wensen zijn geen garantie, maar het voorstel houdt er zoveel mogelijk rekening mee.">
            <WensKalender medewerker={ik} tot={ronde?.tot} ronde={ronde} />
          </Sectie>
        </>
      )}
      {tab === 'verlof' && (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
        <form
          className="box grid content-start gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            actie(() => vraagVerlofAan({ medewerkerId: ik.id, ...f, opmerking: f.opmerking.trim() || undefined }, door), `Je aanvraag is verstuurd naar ${besluiter}.`);
          }}
        >
          <h2 className="kop-s">Verlof aanvragen</h2>
          <div className="grid grid-cols-2 gap-3">
            <Veld label="Van"><input className="input" type="date" required min={vandaag} value={f.van} onChange={(e) => setF({ ...f, van: e.target.value, tot: f.tot < e.target.value ? e.target.value : f.tot })} /></Veld>
            <Veld label="Tot en met"><input className="input" type="date" required min={f.van} value={f.tot} onChange={(e) => setF({ ...f, tot: e.target.value })} /></Veld>
          </div>
          <Veld label="Soort">
            <select className="input" value={f.soort} onChange={(e) => setF({ ...f, soort: e.target.value as VerlofSoort })}>
              {Object.entries(VERLOF_SOORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Veld>
          <Veld label="Toelichting (optioneel)"><textarea className="input min-h-[70px]" value={f.opmerking} onChange={(e) => setF({ ...f, opmerking: e.target.value })} maxLength={300} /></Veld>
          <p className="note">
            {f.tot >= f.van ? `${plural(werkdagen(f.van, f.tot), 'werkdag', 'werkdagen')}. ` : ''}
          </p>
          {geraakt.length > 0 && (
            <div className="banner text-[15px]" role="alert" data-testid="verlof-via-ruil">
              <b>Het rooster is al goedgekeurd</b> en je staat ingeroosterd op {geraakt.map(fmtD).slice(0, 4).join(', ')}{geraakt.length > 4 ? ' en meer' : ''}. Vrij nemen kan dan alleen via een ruil: bied je dienst aan of ruil hem met een collega.{' '}
              <Link href={`/ruilen?dienst=${geraakt[0]}`} className="font-semibold text-accent">Naar ruilen</Link>
            </div>
          )}
          {advies && <div className="rounded-lg bg-soft p-3"><div className="mb-1 text-[13px] font-semibold text-muted">Ruimte in het team</div><AdviesRegel advies={advies} /></div>}
          <div><button className="btn btn-teal" disabled={f.tot < f.van || geraakt.length > 0}><CalendarPlus size={16} /> Aanvraag versturen</button></div>
        </form>

        <div className="box">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="kop-s">Mijn aanvragen</h2>
            <Link href="/jaarplanning" className="btn btn-ghost btn-sm"><CalendarRange size={15} /> Mijn verlofjaar</Link>
          </div>
          {mijn.length ? (
            <ul className="grid gap-3">
              {mijn.sort((a, b) => b.van.localeCompare(a.van)).map((v) => (
                <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line p-3">
                  <div>
                    <div className="font-semibold">{fmtD(v.van)}{v.tot !== v.van ? ` t/m ${fmtD(v.tot)}` : ''} <span className="note">· {VERLOF_SOORT[v.soort]}</span></div>
                    <div className="note">Aangevraagd {fmtMoment(v.aangevraagd)}{v.beoordeeld && v.status !== 'aangevraagd' ? ` · ${v.status} ${fmtMoment(v.beoordeeld)}` : ''}{v.reden ? ` · ${v.reden}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill soort={STATUS[v.status][0]}>{STATUS[v.status][1]}</Pill>
                    {v.status === 'goedgekeurd' && v.van > vandaag && (
                      <Link href={`/ruilen?tab=verlof&verlof=${v.id}`} className="btn btn-ghost btn-sm"><ArrowLeftRight size={14} /> Ruilen</Link>
                    )}
                    {/* een aanvraag trek je zelf in; goedgekeurd verlof intrekken is een besluit van de regiomanager (§ 4.1) */}
                    {v.status === 'aangevraagd' && v.tot >= vandaag && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(() => trekVerlofIn(v.id, door), 'Aanvraag ingetrokken.')}><Undo2 size={14} /> Intrekken</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="note">Nog geen aanvragen.</p>}
        </div>
      </div>
      )}
    </>
  );
}

function VerlofPlanner() {
  const s = useSessie();
  const params = useSearchParams();
  const router = useRouter();
  type Tab = 'open' | 'vakantie' | 'alle' | 'voorkeuren' | 'wensen' | 'invoeren';
  const [tab, setTab] = useState<Tab>('open');
  useEffect(() => {
    const t = params.get('tab');
    // de verlofruimte per week staat nu in de jaarplanning
    if (t === 'planning') { router.replace('/jaarplanning#ruimte'); return; }
    if (t && ['vakantie', 'voorkeuren', 'wensen', 'alle'].includes(t)) setTab(t as Tab);
  }, [params, router]);
  // alleen de regio's: de nabestaandendesk heeft een eigen verlofpagina (/nbd/verlof)
  const mijnRegios = s.regios;
  const [regio, setRegio] = useState<string>('alle');
  const regios = regio === 'alle' ? mijnRegios : [regio];
  const open = useApp((x) => x.verlof.filter((v) => v.status === 'aangevraagd' && !inLopendeRonde(v, x.vakantierondes) && regios.includes(v.regio)).length);
  const inRonde = useApp((x) => x.verlof.filter((v) => v.status === 'aangevraagd' && inLopendeRonde(v, x.vakantierondes) && regios.includes(v.regio)).length);

  return (
    <>
      <PaginaKop titel="Verlof en voorkeuren" lead={<>Verlofaanvragen beoordelen met zicht op de ruimte en de dekking per dag, de vakantieronde, voorkeuren en wensen. Het hele jaar per regio staat in de <Link href="/jaarplanning" className="font-semibold text-accent">jaarplanning</Link>.</>}>
        <label className="label"><span>Regio</span>
          <select className="input w-auto min-w-[200px]" value={regio} onChange={(e) => setRegio(e.target.value)}>
            <option value="alle">Alle regio&apos;s</option>
            {mijnRegios.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      </PaginaKop>
      <div className="mb-5">
        <Segment label="Onderdeel" waarde={tab} onChange={setTab} opties={[['open', `Te beoordelen${open ? ` (${open})` : ''}`], ['vakantie', `Vakantieronde${inRonde ? ` (${inRonde})` : ''}`], ['alle', 'Alle verlof'], ['voorkeuren', 'Voorkeuren'], ['wensen', 'Wensen'], ['invoeren', 'Verlof invoeren']]} />
      </div>
      {tab === 'open' && <TeBeoordelen regios={regios} />}
      {tab === 'vakantie' && <Vakantierondes regios={mijnRegios} />}
      {tab === 'alle' && <AlleVerlof regios={regios} />}
      {tab === 'voorkeuren' && <VoorkeurenPlanner regios={mijnRegios} regio={regio} kiesRegio={setRegio} />}
      {tab === 'wensen' && <WensenOverzicht regios={regios} />}
      {tab === 'invoeren' && <VerlofInvoeren regios={regios} />}
    </>
  );
}

