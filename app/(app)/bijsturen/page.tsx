'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { LineChart, CalendarDays, Compass, Check, Lock, Thermometer, ClipboardList, ShieldCheck, Stethoscope, Route } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { GeenToegang, Laden, Leeg, PaginaKop, Pill, Sectie } from '@/components/ui';
import { Activiteiten } from '@/components/Activiteiten';
import { ZiekModal } from '@/components/bijsturen/ZiekModal';
import { Stap } from '@/components/bijsturen/Stap';
import { NaarNbd } from '@/components/nbd/NaarNbd';
import { herstelZiek, meldZiek, pasBijsturingToe, useApp } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { CLUSTERS, CLUSTER_NAAM, REGION_CLUSTER, REGIONS } from '@/lib/model/config';
import { addDays, diffDays, fmtD, fmtDag, isoRange, todayIso } from '@/lib/dates';
import { bijsturen, ACTIE_LABEL, type Actie, type BijstuurDag } from '@/lib/rooster/bijsturen';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { cel } from '@/lib/rooster/toets';
import type { Cellen, Medewerker } from '@/lib/rooster/types';
import { cx, nl, pctS, plural } from '@/lib/format';
import { useRegioUitAdres } from '@/lib/werkregio';
import { OpenTijden } from '@/components/rooster/Tijden';
import { maandNaam, maandVan, publicatieVereistTot } from '@/lib/rooster/maand';
import { beleidVoor, inRooster, opVolgorde } from '@/lib/rooster/types';

/** Bijsturen in de regio's, op regelplekken. De nabestaandendesk heeft een eigen module (/nbd/bijsturen). */
export default function BijsturenPagina() {
  return <Suspense fallback={<Laden />}><NaarNbd naar="/nbd/bijsturen"><Bijsturen /></NaarNbd></Suspense>;
}

function telPlekken(team: Medewerker[], c: Cellen, d: string) {
  return team.reduce((s, e) => s + DIENSTEN[cel(c, e.id, d)].plekken, 0);
}

function Bijsturen() {
  const s = useSessie();
  const door = useDoor();
  const actie = useActie();
  const router = useRouter();
  const params = useSearchParams();
  const vandaag = todayIso();
  const mijnRegios = REGIONS.filter((r) => s.regios.includes(r));
  const regio = useRegioUitAdres(params.get('regio'), mijnRegios);
  const [ziekOpen, setZiekOpen] = useState(params.get('ziek') === '1');
  const [alleDagen, setAlleDagen] = useState(false);

  const medewerkers = useApp((x) => x.medewerkers);
  const rooster = useApp((x) => x.rooster);
  const pub = useApp((x) => x.publicaties[regio]);
  const tijdenRegio = useApp((x) => x.tijden[regio]);
  const beleidAlg = useApp((x) => x.beleid);
  const normen = useApp((x) => x.normen);
  const beleid = useMemo(() => beleidVoor(beleidAlg, regio, normen), [beleidAlg, regio, normen]);
  const ziekmeldingen = useApp((x) => x.ziekmeldingen);
  const verdelingVandaag = useApp((x) => x.verdelingen[todayIso()]);
  const profielen = useApp((x) => x.profielen);
  const alleWensen = useApp((x) => x.wensen);
  const verlof = useApp((x) => x.verlof);
  const wensen = useMemo(() => alleWensen.filter((w) => w.regio === regio), [alleWensen, regio]);
  const aanvragen = useMemo(() => verlof.filter((v) => v.regio === regio && v.status === 'aangevraagd'), [verlof, regio]);
  const activiteit = useApp((x) => x.activiteit);
  const { laatste, laatsteData, basis, basisData, klaar } = useRuns();

  const team = useMemo(() => medewerkers.filter((m) => m.regio === regio && inRooster(m)).sort(opVolgorde), [medewerkers, regio]);
  const cellen = useMemo(() => rooster[regio] ?? {}, [rooster, regio]);
  const tot = pub && pub.tot > vandaag ? pub.tot : addDays(vandaag, 27);
  const dates = useMemo(() => isoRange(vandaag, tot), [vandaag, tot]);
  const verschuivingen = useApp((x) => x.verschuivingen);
  const bronnen = useMemo(() => ({ basis: basisData, laatste: laatsteData, norm: normen, verschuivingen }), [basisData, laatsteData, normen, verschuivingen]);

  // plekken over in de andere regio's van het cluster (voor "vraag de buurregio")
  const buren = useMemo(() => {
    const cluster = REGION_CLUSTER[regio];
    const andere = (CLUSTERS[cluster] ?? []).filter((r) => r !== regio);
    const m = new Map<string, { regio: string; over: number }[]>();
    for (const r of andere) {
      const t = medewerkers.filter((x) => x.regio === r && inRooster(x));
      const nu = behoefteVoor(bronnen, r, dates, { alphaRegio: beleid.alphaRegio, tegen: 'laatste' });
      for (const d of dates) {
        const k = nu[d]?.k;
        if (k == null) continue;
        const over = telPlekken(t, rooster[r] ?? {}, d) - k;
        if (over > 0) m.set(d, [...(m.get(d) ?? []), { regio: r, over }]);
      }
    }
    return m;
  }, [regio, medewerkers, rooster, bronnen, dates, beleid.alphaRegio]);

  const b = useMemo(() => bijsturen({
    team, cellen, dates, beleid, vandaag,
    basis: behoefteVoor(bronnen, regio, dates, { alphaRegio: beleid.alphaRegio, tegen: 'basis' }),
    nu: behoefteVoor(bronnen, regio, dates, { alphaRegio: beleid.alphaRegio, tegen: 'laatste' }),
    buren: (d) => buren.get(d) ?? [],
    tijden: tijdenRegio, profielen, wensen, aanvragen,
  }), [team, cellen, dates, beleid, vandaag, bronnen, regio, buren, tijdenRegio, profielen, wensen, aanvragen]);

  if (!s.isPlanner) return <GeenToegang />;
  if (!klaar) return <Laden />;

  const sv = b.samenvatting;
  const actieDagen = b.dagen.filter((d) => d.status !== 'ok' || d.acties.length || d.ziek.length);
  const zichtbaar = alleDagen ? b.dagen : actieDagen;
  const ziek = ziekmeldingen.filter((z) => z.regio === regio && z.status === 'ziek');
  const pubOk = !!pub && pub.tot >= publicatieVereistTot(vandaag, beleid.publicatieMaanden);
  const open = sv.tekortDagen + sv.teveelDagen + sv.voorgangTekort;
  const vandaagMeldingen = (verdelingVandaag?.meldingen ?? []).filter((m) => m.regio === regio);
  const verdeeldVandaag = new Set((verdelingVandaag?.toewijzingen ?? []).map((t) => t.meldingId));

  const voerUit = (d: BijstuurDag, a: Actie) => {
    const tekst = `${regio}, ${fmtDag(d.datum)}: ${a.tekst}`;
    actie(() => pasBijsturingToe(regio, a.wijzigingen, tekst, door, cellen), a.wijzigingen.length ? 'Bijgestuurd. Het rooster is aangepast en de medewerker krijgt een bericht.' : 'Genoteerd in het logboek.');
  };

  return (
    <>
      <PaginaKop
        boven="Voorspellen, rooster, bijsturen, verdelen"
        titel={<>Bijsturen <em>{regio}</em></>}
        lead="Het rooster is gemaakt op de roosterbasis. Elke nieuwe voorspelling laat zien waar het anders loopt; hier stuur je bij volgens het stroomschema dagsturing, getoetst op ATW en beleid."
      >
        <label className="label"><span>Regio</span>
          <select className="input w-auto min-w-[210px]" value={regio} onChange={(e) => router.replace(`/bijsturen?regio=${encodeURIComponent(e.target.value)}`)}>
            {Object.keys(CLUSTERS).map((c) => {
              const rs = CLUSTERS[c].filter((r) => mijnRegios.includes(r));
              return rs.length ? <optgroup key={c} label={`Cluster ${CLUSTER_NAAM[c]}`}>{rs.map((r) => <option key={r}>{r}</option>)}</optgroup> : null;
            })}
          </select>
        </label>
        <button type="button" className="btn btn-ghost self-end" onClick={() => setZiekOpen(true)} disabled={!team.length}><Thermometer size={16} /> Ziekmelding</button>
      </PaginaKop>

      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="De keten">
        <Stap nr={1} icoon={<LineChart size={17} />} titel="Voorspellen" href="/voorspelling">
          {basis ? <>Roosterbasis van <b>{fmtD(basis.uitgegeven)}</b>, {diffDays(vandaag, basis.uitgegeven)} dagen oud.</> : <>Nog geen roosterbasis vastgelegd; GRIP gebruikt de laatste voorspelling.</>}
          <span className="note block">Daarna gelden de vastgestelde regelplekken.</span>
        </Stap>
        <Stap nr={2} icoon={<CalendarDays size={17} />} titel="Rooster" href={`/rooster?regio=${encodeURIComponent(regio)}`}>
          {pub ? <>Gepubliceerd t/m <b>{fmtD(pub.tot)}</b>.</> : <>Nog niet gepubliceerd.</>}
          <span className="mt-1 block">{pubOk ? <Pill soort="ok">{beleid.publicatieMaanden} maanden vooraf</Pill> : <Pill soort="warn">Beleid: t/m {maandNaam(maandVan(publicatieVereistTot(vandaag, beleid.publicatieMaanden)))} gepubliceerd</Pill>}</span>
        </Stap>
        <Stap nr={3} icoon={<Compass size={17} />} titel="Bijvoorspellen en bijsturen" focus={open > 0 || ziek.length > 0}>
          {open || ziek.length ? (
            <>
              <b className="display text-[30px] leading-none">{open}</b> {open === 1 ? 'dag vraagt' : 'dagen vragen'} actie
              <span className="block text-[13.5px] opacity-90">{sv.tekortDagen} tekort · {sv.teveelDagen} te veel · {sv.voorgangTekort} voorgangen{ziek.length ? ` · ${ziek.length} ziek` : ''}</span>
            </>
          ) : <><ShieldCheck size={16} className="inline text-teal" /> Alles volgens afspraak.</>}
          <span className="mt-1 block text-[13.5px] opacity-90">
            {laatste ? <>Laatste voorspelling van {fmtD(laatste.uitgegeven)}{sv.lamVerschil != null ? <>: verwacht {pctS(sv.lamVerschil)} t.o.v. de basis, {plural(sv.kVeranderd, 'dag', 'dagen')} met een ander aantal plekken</> : ''}.</> : 'Nog geen voorspelling.'}
          </span>
        </Stap>
        <Stap nr={4} icoon={<Route size={17} />} titel="Verdelen" href="/verdeling">
          {vandaagMeldingen.length ? (
            <><b>{vandaagMeldingen.filter((m) => verdeeldVandaag.has(m.id)).length}</b> van {vandaagMeldingen.length} {vandaagMeldingen.length === 1 ? 'melding' : 'meldingen'} in {regio} vandaag verdeeld.</>
          ) : <>Vandaag nog geen meldingen in {regio} verdeeld.</>}
          <span className="note block">Om 07:00 alle meldingen in één keer, gesprekken om 10:00 of 13:00.</span>
        </Stap>
      </ol>

      <Sectie titel="Plekken per dag" lead={`Van vandaag t/m ${fmtD(tot)}: gepland tegenover wat de roosterbasis en de laatste voorspelling vragen.`}>
        <div className="box">
          <Strook dagen={b.dagen} />
        </div>
      </Sectie>

      <Sectie
        titel="Wat er te doen is"
        lead={<>Acties in de volgorde van het stroomschema (<Link href="/beleid#p-3.9" className="text-accent">§ 3.9</Link>). Binnen {beleid.vastDagen} dagen is vrij vrij: een vrije dag inzetten kan alleen in overleg. Binnen {beleid.tijdenDagen} dagen geldt dat ook voor andere tijden.</>}
        rechts={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={alleDagen} onChange={(e) => setAlleDagen(e.target.checked)} /> Alle dagen tonen</label>}
      >
        {!team.length ? <Leeg titel="Nog geen team">Voeg eerst medewerkers toe in het rooster.</Leeg> : zichtbaar.length ? (
          <div className="grid gap-3">
            {zichtbaar.map((d) => <DagKaart key={d.datum} d={d} vandaag={vandaag} onActie={(a) => voerUit(d, a)} />)}
          </div>
        ) : (
          <p className="box flex items-center gap-2 text-[15px]"><ShieldCheck size={18} className="text-teal" /> Elke dag heeft de afgesproken regelplekken en voorgangen, ook volgens de laatste voorspelling.</p>
        )}
      </Sectie>

      <Sectie titel="Diensttijden vastleggen" lead={<>De ATW vraagt dat begin- en eindtijden {beleid.tijdenDagen} dagen vooraf bekend zijn (<Link href="/beleid#p-1.2" className="text-accent">§ 1.2</Link>). Bij Dg-diensten leg je ze later vast; de medewerker kan dat ook zelf in Mijn rooster.</>}>
        <div className="box"><OpenTijden regio={regio} team={team} /></div>
      </Sectie>

      <div className="mt-9 grid gap-5 lg:grid-cols-2">
        <div className="box">
          <h3 className="kop-s mb-3 flex items-center gap-2"><Stethoscope size={18} className="text-rood" /> Ziekmeldingen</h3>
          {ziek.length ? (
            <ul className="divide-y divide-[color:var(--line)]">
              {ziek.map((z) => {
                const m = medewerkers.find((x) => x.id === z.medewerkerId);
                return (
                  <li key={z.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{m?.naam}</div>
                      <div className="note">{z.van === z.tot ? fmtDag(z.van) : `${fmtD(z.van)} t/m ${z.tot ? fmtD(z.tot) : 'onbekend'}`} · {plural(Object.keys(z.vervangen).length, 'dienst', 'diensten')} op te vangen</div>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(() => herstelZiek(z.id, addDays(vandaag, 1), door), `${m?.naam} hersteld per morgen; de diensten vanaf morgen staan weer in het rooster.`)}>Hersteld per morgen</button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="note">Niemand ziek gemeld in {regio}.</p>}
        </div>
        <div className="box">
          <h3 className="kop-s mb-3 flex items-center gap-2"><ClipboardList size={18} className="text-accent" /> Logboek bijsturen</h3>
          <Activiteiten lijst={activiteit.filter((a) => a.regio === regio && (a.soort === 'bijsturen' || a.soort === 'ziek') && !a.voor).slice(0, 10)} />
        </div>
      </div>

      <ZiekModal open={ziekOpen} onClose={() => setZiekOpen(false)} team={team} vandaag={vandaag} onMeld={(mid, van, totDag) => {
        setZiekOpen(false);
        actie(() => meldZiek(mid, van, totDag, door), (z) => `Ziek gemeld. ${plural(Object.keys(z.vervangen).length, 'dienst moet', 'diensten moeten')} worden opgevangen; zie de acties hieronder.`);
      }} />
    </>
  );
}

function DagKaart({ d, vandaag, onActie }: { d: BijstuurDag; vandaag: string; onActie: (a: Actie) => void }) {
  const beleidNu = useApp((x) => x.beleid);
  const verschil = d.kNu != null ? d.p - d.kNu : 0;
  return (
    <div className={cx('box', d.status === 'tekort' && 'border-l-4 border-l-[color:var(--red)]', d.status === 'teveel' && 'border-l-4 border-l-[color:var(--gold)]')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[16px]">{fmtDag(d.datum)}</b>
            {d.datum === vandaag && <Pill soort="info">vandaag</Pill>}
            {d.status === 'tekort' && <Pill soort="bad">{-verschil} plek{-verschil > 1 ? 'ken' : ''} tekort</Pill>}
            {d.status === 'teveel' && <Pill soort="warn">{verschil} plek{verschil > 1 ? 'ken' : ''} te veel</Pill>}
            {d.ziek.length > 0 && <Pill soort="bad"><Thermometer size={12} /> {d.ziek.join(', ')}</Pill>}
            {d.binnenVast && <span className="inline-flex items-center gap-1 text-[12.5px] text-muted"><Lock size={12} /> binnen {d.binnenTijden ? beleidNu.tijdenDagen : beleidNu.vastDagen} dagen</span>}
          </div>
          <div className="note mt-1">
            Gepland {d.p} plekken · basis {d.kBasis ?? '–'}{d.lamBasis != null ? ` (verwacht ${nl(d.lamBasis)})` : ''} · nu {d.kNu ?? '–'}{d.lamNu != null ? ` (verwacht ${nl(d.lamNu)})` : ''}{d.kNorm != null ? ` · vastgesteld ${d.kNorm}` : ''} · {d.voorgangen} voorgangen
          </div>
        </div>
      </div>
      {d.acties.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {d.acties.map((a, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-soft px-3 py-2 text-[14px]">
              <Pill soort="neutral">{ACTIE_LABEL[a.soort]}</Pill>
              <span className="min-w-[200px] flex-1">
                {a.tekst}
                {a.overleg && <span className="note"> · alleen in overleg</span>}
                {a.bevindingen.length > 0 && <span className="note"> · let op: {a.bevindingen.map((x) => x.tekst).join('; ')}</span>}
              </span>
              <button type="button" className={cx('btn btn-sm', a.wijzigingen.length ? '' : 'btn-ghost')} onClick={() => onActie(a)}>
                {a.wijzigingen.length ? <><Check size={14} /> Toepassen</> : <><ClipboardList size={14} /> Noteren</>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Per dag: gepland (staaf), afgesproken volgens de laatste voorspelling (streep) en volgens de basis (stippel). */
function Strook({ dagen }: { dagen: BijstuurDag[] }) {
  const W = Math.max(640, dagen.length * 22), H = 170, pl = 28, pb = 30, pt = 10;
  const max = Math.max(4, ...dagen.map((d) => Math.max(d.p, d.kNu ?? 0, d.kBasis ?? 0))) + 1;
  const bw = (W - pl - 6) / Math.max(1, dagen.length);
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / max);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart block h-auto min-w-[640px] w-full" role="img" aria-label="Regelplekken per dag: gepland en afgesproken">
        {[0, Math.round(max / 2), max].map((v) => <g key={v}><line x1={pl} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={pl - 6} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        {dagen.map((d, i) => {
          const x = pl + i * bw + 2, w = Math.max(3, bw - 4);
          const kleur = d.status === 'tekort' ? 'var(--red)' : d.status === 'teveel' ? 'var(--gold)' : 'var(--d1m)';
          return (
            <g key={d.datum}>
              <title>{`${fmtDag(d.datum)}: ${d.p} gepland, ${d.kNu ?? '–'} nu nodig, ${d.kBasis ?? '–'} volgens de basis`}</title>
              <path d={`M${x},${y(0)} V${y(d.p) + 3} Q${x},${y(d.p)} ${x + 3},${y(d.p)} H${x + w - 3} Q${x + w},${y(d.p)} ${x + w},${y(d.p) + 3} V${y(0)} Z`} fill={kleur} opacity={d.status === 'ok' ? 1 : 0.8} />
              {d.kBasis != null && <line x1={x - 1} x2={x + w + 1} y1={y(d.kBasis)} y2={y(d.kBasis)} stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="3 2" />}
              {d.kNu != null && <line x1={x - 1} x2={x + w + 1} y1={y(d.kNu)} y2={y(d.kNu)} stroke="var(--plum)" strokeWidth={2.5} strokeLinecap="round" />}
              {(i === 0 || new Date(d.datum).getUTCDay() === 1) && <text x={x + w / 2} y={H - 10} textAnchor="middle">{fmtD(d.datum)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[13px] text-muted">
        <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--d1m)' }} /> Gepland</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-[3px] w-4 rounded" style={{ background: 'var(--plum)' }} /> Nodig volgens de laatste voorspelling</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--muted)' }} /> Volgens de roosterbasis</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--red)' }} /> Tekort</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--gold)' }} /> Te veel</span>
      </div>
    </div>
  );
}

