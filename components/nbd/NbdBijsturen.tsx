'use client';
import { useMemo, useState } from 'react';
import { CalendarDays, Check, ClipboardList, Compass, LineChart, Lock, RefreshCw, ShieldCheck, Stethoscope, Thermometer } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Activiteiten } from '@/components/Activiteiten';
import { ZiekModal } from '@/components/bijsturen/ZiekModal';
import { Stap } from '@/components/bijsturen/Stap';
import { DagBeeld } from '@/components/nbd/DagBeeld';
import { GeenToegang, Laden, Leeg, PaginaKop, Pill, Sectie } from '@/components/ui';
import { herstelZiek, meldZiek, pasBijsturingToe, pasNbdBijsturingToe, useApp } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import { addDays, diffDays, fmtD, fmtDag, isoRange, todayIso } from '@/lib/dates';
import { NBD, type NbdParameters } from '@/lib/nbd/parameters';
import { LEGE_CELLEN, type Cellen, type Medewerker, type Tijden, inRooster } from '@/lib/rooster/types';
import { nbdBehoefte, type NbdDag } from '@/lib/nbd/behoefte';
import { nbdDienst } from '@/lib/nbd/blokken';
import type { NbdDienst } from '@/lib/nbd/dienst';
import { nbdBijsturen, NBD_ACTIE_LABEL, type NbdActie, type NbdBijstuurDag } from '@/lib/nbd/bijsturen';
import { maandNaam, maandVan, publicatieVereistTot } from '@/lib/rooster/maand';
import { cx, nl, nlUren, pct, pctS, plural } from '@/lib/format';

export function NbdBijsturen() {
  const s = useSessie();
  const door = useDoor();
  const actie = useActie();
  const vandaag = todayIso();
  const [ziekOpen, setZiekOpen] = useState(false);
  const [alleDagen, setAlleDagen] = useState(false);

  const medewerkers = useApp((x) => x.medewerkers);
  const cellen = useApp((x) => x.rooster[NBD]) ?? LEGE_CELLEN;
  const tijden = useApp((x) => x.tijden[NBD]);
  const pub = useApp((x) => x.publicaties[NBD]);
  const p = useApp((x) => x.nbd);
  const beleid = useApp((x) => x.beleid);
  const normen = useApp((x) => x.normen);
  const profielen = useApp((x) => x.profielen);
  const wensen = useApp((x) => x.wensen);
  const verlof = useApp((x) => x.verlof);
  const ziekmeldingen = useApp((x) => x.ziekmeldingen);
  const activiteit = useApp((x) => x.activiteit);
  const { laatste, laatsteData, basis, basisData, klaar } = useRuns();

  const team = useMemo(() => medewerkers.filter((m) => m.regio === NBD && inRooster(m)).sort((a, b) => a.naam.localeCompare(b.naam)), [medewerkers]);
  const tot = pub && pub.tot > vandaag ? pub.tot : addDays(vandaag, 27);
  const dates = useMemo(() => isoRange(vandaag, tot), [vandaag, tot]);
  const bronnen = useMemo(() => ({ basis: basisData, laatste: laatsteData, norm: normen }), [basisData, laatsteData, normen]);
  const nu = useMemo(() => nbdBehoefte(bronnen, p, dates, 'laatste'), [bronnen, p, dates]);
  const was = useMemo(() => nbdBehoefte(bronnen, p, dates, 'basis'), [bronnen, p, dates]);
  const aanvragen = useMemo(() => verlof.filter((v) => v.regio === NBD && v.status === 'aangevraagd'), [verlof]);
  const nbdWensen = useMemo(() => wensen.filter((w) => w.regio === NBD), [wensen]);
  const b = useMemo(() => nbdBijsturen({
    team, cellen, tijden, dates, basis: was, nu, p, beleid, vandaag, profielen, wensen: nbdWensen, aanvragen,
  }), [team, cellen, tijden, dates, was, nu, p, beleid, vandaag, profielen, nbdWensen, aanvragen]);

  if (!s.isPlanner) return <GeenToegang />;
  if (!klaar) return <Laden />;

  const sv = b.samenvatting;
  const actieDagen = b.dagen.filter((d) => d.status !== 'ok' || d.acties.length || d.ziek.length);
  const zichtbaar = alleDagen ? b.dagen : actieDagen;
  const ziek = ziekmeldingen.filter((z) => z.regio === NBD && z.status === 'ziek');
  const pubOk = !!pub && pub.tot >= publicatieVereistTot(vandaag, beleid.publicatieMaanden);
  const open = sv.tekortDagen + sv.teveelDagen;

  const voerUit = (d: NbdBijstuurDag, a: NbdActie) => {
    const tekst = `NBD, ${fmtDag(d.datum)}: ${a.tekst}`;
    actie(
      () => (a.wijzigingen.length ? pasNbdBijsturingToe(a.wijzigingen, tekst, door, cellen) : pasBijsturingToe(NBD, [], tekst, door)),
      a.wijzigingen.length ? 'Bijgestuurd. Het rooster is aangepast en de medewerker krijgt een bericht.' : 'Genoteerd in het logboek.',
    );
  };

  return (
    <>
      <PaginaKop
        boven="Voorspellen, rooster, bijvoorspellen, bijsturen"
        titel={<>Bijsturen <em>NBD</em></>}
        lead={<>Het rooster is gemaakt op de roosterbasis. Elke nieuwe voorspelling van de overlijdens laat zien waar het anders loopt; hier stuur je bij op de mensen aan de telefoon die Erlang C per uur vraagt ({pct(p.serviceLevel)} binnen {p.wachttijd} seconden), van 7:00 tot 22:30, getoetst op ATW en CAO.</>}
      >
        <button type="button" className="btn btn-ghost self-end" onClick={() => setZiekOpen(true)} disabled={!team.length}><Thermometer size={16} /> Ziekmelding</button>
      </PaginaKop>

      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="De keten">
        <Stap nr={1} icoon={<LineChart size={17} />} titel="Voorspellen" href="/nbd/capaciteit">
          {basis ? <>Roosterbasis van <b>{fmtD(basis.uitgegeven)}</b>, {diffDays(vandaag, basis.uitgegeven)} dagen oud.</> : <>Nog geen roosterbasis vastgelegd; GRIP gebruikt de laatste voorspelling.</>}
          <span className="note block">De gesprekken bewegen mee met de overlijdens in de regio&apos;s; daarna geldt het gemiddelde jaar.</span>
        </Stap>
        <Stap nr={2} icoon={<CalendarDays size={17} />} titel="Rooster" href="/nbd/rooster">
          {pub ? <>Gepubliceerd t/m <b>{fmtD(pub.tot)}</b>.</> : <>Nog niet gepubliceerd.</>}
          <span className="mt-1 block">{pubOk ? <Pill soort="ok">{beleid.publicatieMaanden} maanden vooraf</Pill> : <Pill soort="warn">Beleid: t/m {maandNaam(maandVan(publicatieVereistTot(vandaag, beleid.publicatieMaanden)))} gepubliceerd</Pill>}</span>
        </Stap>
        <Stap nr={3} icoon={<RefreshCw size={17} />} titel="Bijvoorspellen">
          {laatste ? <>Laatste voorspelling van <b>{fmtD(laatste.uitgegeven)}</b>.</> : 'Nog geen voorspelling.'}
          <span className="block">{sv.gesprekkenVerschil != null ? <>Verwacht {pctS(sv.gesprekkenVerschil)} gesprekken t.o.v. de basis; {plural(sv.urenOmhoog + sv.urenOmlaag, 'dag', 'dagen')} met een ander aantal uren aan de telefoon ({sv.urenOmhoog} meer, {sv.urenOmlaag} minder).</> : 'Geen vergelijking mogelijk.'}</span>
        </Stap>
        <Stap nr={4} icoon={<Compass size={17} />} titel="Bijsturen" focus={open > 0 || ziek.length > 0}>
          {open || ziek.length ? (
            <>
              <b className="display text-[30px] leading-none">{open}</b> {open === 1 ? 'dag vraagt' : 'dagen vragen'} actie
              <span className="block text-[13.5px] opacity-90">{sv.tekortDagen} tekort · {sv.teveelDagen} te veel{ziek.length ? ` · ${ziek.length} ziek` : ''}</span>
            </>
          ) : <><ShieldCheck size={16} className="inline text-teal" /> Alles volgens afspraak.</>}
        </Stap>
      </ol>

      <Sectie titel="Uren aan de telefoon per dag" lead={`Van vandaag t/m ${fmtD(tot)}: gepland tegenover wat Erlang C vraagt volgens de roosterbasis en de laatste voorspelling.`}>
        <div className="box">
          <Strook dagen={b.dagen} />
        </div>
      </Sectie>

      <Sectie
        titel="Wat er te doen is"
        lead={<>Acties in een vaste volgorde: eerst wat het minst vraagt van de medewerkers. Bij te weinig: pauze verschuiven, verlengen (tot de maximale inzet), inplannen, een externe kracht, terugbellen. Bij te veel: inkorten of vrij geven. Binnen {beleid.vastDagen} dagen is vrij vrij: een vrije dag inzetten kan alleen in overleg. Binnen {beleid.tijdenDagen} dagen geldt dat ook voor andere tijden.</>}
        rechts={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={alleDagen} onChange={(e) => setAlleDagen(e.target.checked)} /> Alle dagen tonen</label>}
      >
        {!team.length ? <Leeg titel="Nog geen team">Voeg eerst medewerkers toe in het rooster.</Leeg> : zichtbaar.length ? (
          <div className="grid gap-3">
            {zichtbaar.map((d) => <DagKaart key={d.datum} d={d} dag={nu[d.datum]} vandaag={vandaag} p={p} team={team} cellen={cellen} tijden={tijden} onActie={(a) => voerUit(d, a)} />)}
          </div>
        ) : (
          <p className="box flex items-center gap-2 text-[15px]"><ShieldCheck size={18} className="text-teal" /> Elke dag haalt het service level, ook volgens de laatste voorspelling.</p>
        )}
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
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(() => herstelZiek(z.id, addDays(vandaag, 1), door), `${m?.naam} hersteld per morgen; de diensten vanaf morgen staan weer in het rooster, met hun tijden.`)}>Hersteld per morgen</button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="note">Niemand ziek gemeld bij de NBD.</p>}
        </div>
        <div className="box">
          <h3 className="kop-s mb-3 flex items-center gap-2"><ClipboardList size={18} className="text-accent" /> Logboek bijsturen</h3>
          <Activiteiten lijst={activiteit.filter((a) => a.regio === NBD && (a.soort === 'bijsturen' || a.soort === 'ziek') && !a.voor).slice(0, 10)} />
        </div>
      </div>

      <ZiekModal open={ziekOpen} onClose={() => setZiekOpen(false)} team={team} vandaag={vandaag} onMeld={(mid, van, totDag) => {
        setZiekOpen(false);
        actie(() => meldZiek(mid, van, totDag, door), (z) => `Ziek gemeld. ${plural(Object.keys(z.vervangen).length, 'dienst moet', 'diensten moeten')} worden opgevangen; zie de acties hieronder.`);
      }} />
    </>
  );
}

function DagKaart({ d, dag, vandaag, p, team, cellen, tijden, onActie }: {
  d: NbdBijstuurDag;
  dag: NbdDag | undefined;
  vandaag: string;
  p: NbdParameters;
  team: Medewerker[];
  cellen: Cellen;
  tijden: Tijden | undefined;
  onActie: (a: NbdActie) => void;
}) {
    const beleidNu = useApp((x) => x.beleid);
const [beeld, setBeeld] = useState(false);
  const diensten = useMemo(() => {
    const uit: Record<string, NbdDienst> = {};
    for (const m of team) { const x = nbdDienst(cellen, tijden, m.id, d.datum); if (x) uit[m.id] = x; }
    return uit;
  }, [team, cellen, tijden, d.datum]);
  const verschil = d.urenNu != null ? d.gepland - d.urenNu : 0;
  return (
    <div className={cx('box', d.status === 'tekort' && 'border-l-4 border-l-[color:var(--red)]', d.status === 'teveel' && 'border-l-4 border-l-[color:var(--gold)]')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[16px]">{fmtDag(d.datum)}</b>
            {d.datum === vandaag && <Pill soort="info">vandaag</Pill>}
            {d.status === 'tekort' && <Pill soort="bad">{nlUren(Math.round(d.tekort * 4) / 4)} uur tekort</Pill>}
            {d.status === 'teveel' && <Pill soort="warn">{nlUren(Math.round(verschil * 4) / 4)} uur te veel</Pill>}
            {d.ziek.length > 0 && <Pill soort="bad"><Thermometer size={12} /> {d.ziek.join(', ')}</Pill>}
            {d.binnenVast && <span className="inline-flex items-center gap-1 text-[12.5px] text-muted"><Lock size={12} /> binnen {d.binnenTijden ? beleidNu.tijdenDagen : beleidNu.vastDagen} dagen</span>}
          </div>
          <div className="note mt-1">
            Gepland {nl(d.gepland, 0)} uur · basis {d.urenBasis != null ? `${nl(d.urenBasis, 0)} uur` : '–'}{d.gesprekkenBasis != null ? ` (${Math.round(d.gesprekkenBasis)} gesprekken)` : ''} · nu {d.urenNu != null ? `${nl(d.urenNu, 0)} uur` : '–'}{d.gesprekkenNu != null ? ` (${Math.round(d.gesprekkenNu)} gesprekken)` : ''} · service level <b className={d.sl < p.serviceLevel ? 'text-rood' : 'text-teal'}>{pct(d.sl)}</b>
          </div>
        </div>
        {dag && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBeeld((x) => !x)} aria-expanded={beeld}>{beeld ? 'Dagbeeld sluiten' : 'Dagbeeld'}</button>}
      </div>
      {d.acties.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {d.acties.map((a, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-soft px-3 py-2 text-[14px]">
              <Pill soort="neutral">{NBD_ACTIE_LABEL[a.soort]}</Pill>
              <span className="min-w-[200px] flex-1">
                {a.tekst}
                {a.slNa != null && <span className="note"> · service level {pct(d.sl)} → {pct(a.slNa)}</span>}
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
      {beeld && dag && <div className="mt-3"><DagBeeld datum={d.datum} dag={dag} uitkomst={{ gepland: d.dekking, sl: d.sl }} team={team} diensten={diensten} p={p} /></div>}
    </div>
  );
}

/** Gepland (staaf), nodig volgens de laatste voorspelling (streep) en volgens de basis (stippel). */
function Strook({ dagen }: { dagen: NbdBijstuurDag[] }) {
  const W = Math.max(640, dagen.length * 22), H = 170, pl = 34, pb = 30, pt = 10;
  const top = Math.max(10, ...dagen.map((d) => Math.max(d.gepland, d.urenNu ?? 0, d.urenBasis ?? 0)));
  const max = Math.ceil((top * 1.08) / 20) * 20;
  const bw = (W - pl - 6) / Math.max(1, dagen.length);
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / max);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart block h-auto min-w-[640px] w-full" role="img" aria-label="Uren aan de telefoon per dag: gepland en nodig">
        {[0, max / 2, max].map((v) => <g key={v}><line x1={pl} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={pl - 6} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        {dagen.map((d, i) => {
          const x = pl + i * bw + 2, w = Math.max(3, bw - 4);
          const kleur = d.status === 'tekort' ? 'var(--red)' : d.status === 'teveel' ? 'var(--gold)' : 'var(--d1m)';
          return (
            <g key={d.datum}>
              <title>{`${fmtDag(d.datum)}: ${nl(d.gepland, 0)} uur gepland, ${d.urenNu != null ? nl(d.urenNu, 0) : '–'} nu nodig, ${d.urenBasis != null ? nl(d.urenBasis, 0) : '–'} volgens de basis, service level ${pct(d.sl)}`}</title>
              <path d={`M${x},${y(0)} V${y(d.gepland) + 3} Q${x},${y(d.gepland)} ${x + 3},${y(d.gepland)} H${x + w - 3} Q${x + w},${y(d.gepland)} ${x + w},${y(d.gepland) + 3} V${y(0)} Z`} fill={kleur} opacity={d.status === 'ok' ? 1 : 0.8} />
              {d.urenBasis != null && <line x1={x - 1} x2={x + w + 1} y1={y(d.urenBasis)} y2={y(d.urenBasis)} stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="3 2" />}
              {d.urenNu != null && <line x1={x - 1} x2={x + w + 1} y1={y(d.urenNu)} y2={y(d.urenNu)} stroke="var(--plum)" strokeWidth={2.5} strokeLinecap="round" />}
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
