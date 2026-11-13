'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CalendarRange, Check, X } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { AlleenRegiomanager } from '@/components/Rechten';
import { GeenToegang, PaginaKop, Pill, Segment } from '@/components/ui';
import { AdviesRegel, useAanvraagAdvies } from '@/components/verlof/Verlofplanning';
import { AlleVerlof, TeBeoordelen, VerlofInvoeren, WensenOverzicht, werkdagen, type AanvraagKaartProps } from '@/components/verlof/VerlofBeheer';
import { useApp } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import { VERLOF_SOORT } from '@/lib/store/types';
import { DAG_KORT, fmtDJ, fmtMoment, isoRange, toDay, weekday } from '@/lib/dates';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { nbdBehoefte } from '@/lib/nbd/behoefte';
import { nbdDienst } from '@/lib/nbd/blokken';
import { netto, type NbdDienst } from '@/lib/nbd/dienst';
import { dekking } from '@/lib/nbd/toets';
import { LEGE_CELLEN, inRooster } from '@/lib/rooster/types';
import { cx, nl, plural } from '@/lib/format';

type Tab = 'open' | 'alle' | 'wensen' | 'invoeren';

export function NbdVerlof() {
  const s = useSessie();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>('open');
  useEffect(() => {
    const t = params.get('tab');
    if (t && ['open', 'alle', 'wensen', 'invoeren'].includes(t)) setTab(t as Tab);
  }, [params]);
  const open = useApp((x) => x.verlof.filter((v) => v.status === 'aangevraagd' && v.regio === NBD).length);
  if (!s.isPlanner) return <GeenToegang />;
  const regios = [NBD];
  return (
    <>
      <PaginaKop
        boven={<>{NBD_NAAM} · landelijk</>}
        titel={<>Verlof <em>NBD</em></>}
        lead={<>Verlofaanvragen beoordelen met de ruimte uit de capaciteitsplanning (netto uren tegenover 92% van wat Erlang C vraagt) en de uren aan de telefoon per dag. Het hele jaar staat in de <Link href="/nbd/jaarplanning" className="font-semibold text-accent">jaarplanning</Link>.</>}
      >
        <Link href="/nbd/jaarplanning" className="btn btn-ghost self-end"><CalendarRange size={16} /> Jaarplanning</Link>
      </PaginaKop>
      <div className="mb-5">
        <Segment label="Onderdeel" waarde={tab} onChange={setTab} opties={[['open', `Te beoordelen${open ? ` (${open})` : ''}`], ['alle', 'Alle verlof'], ['wensen', 'Wensen'], ['invoeren', 'Verlof invoeren']]} />
      </div>
      {tab === 'open' && <TeBeoordelen regios={regios} kaart={NbdAanvraagKaart} />}
      {tab === 'alle' && <AlleVerlof regios={regios} />}
      {tab === 'wensen' && <WensenOverzicht regios={regios} />}
      {tab === 'invoeren' && <VerlofInvoeren regios={regios} />}
    </>
  );
}

/** De ruimte per week en per dag de uren aan de telefoon na goedkeuren. */
function NbdAanvraagKaart({ v, mw, onGoed, onAf }: AanvraagKaartProps) {
  const magBesluiten = useSessie().mag('verlof.besluiten');
  const cellen = useApp((x) => x.rooster[NBD]) ?? LEGE_CELLEN;
  const tijden = useApp((x) => x.tijden[NBD]);
  const p = useApp((x) => x.nbd);
  const normen = useApp((x) => x.normen);
  const team = useApp((x) => x.medewerkers.filter((m) => m.regio === NBD && inRooster(m)));
  const ander = useApp((x) => x.verlof.filter((o) => o.regio === NBD && o.id !== v.id && o.status === 'goedgekeurd' && o.van <= v.tot && o.tot >= v.van));
  const { basisData, laatsteData } = useRuns();
  const dagen = useMemo(() => isoRange(v.van, v.tot), [v.van, v.tot]);
  const behoefte = useMemo(() => nbdBehoefte({ basis: basisData, laatste: laatsteData, norm: normen }, p, dagen, 'basis'), [basisData, laatsteData, normen, p, dagen]);
  const advies = useAanvraagAdvies(v);
  const impact = dagen.map((d) => {
    const diensten = team.map((m) => [m.id, nbdDienst(cellen, tijden, m.id, d)] as const).filter((x): x is readonly [string, NbdDienst] => !!x[1]);
    const eigen = mw ? diensten.find(([id]) => id === mw.id)?.[1] ?? null : null;
    const nodig = behoefte[d]?.kwartieren.map((k) => k.nodig) ?? [];
    const tekortUren = (cov: number[]) => nodig.reduce((a, n, i) => a + Math.max(0, n - (cov[i] ?? 0)), 0) / 4;
    const voor = dekking(p, diensten.map(([, x]) => x));
    const na = dekking(p, diensten.filter(([id]) => id !== mw?.id).map(([, x]) => x));
    return {
      d, nodigUren: behoefte[d]?.uren ?? 0, gepland: na.reduce((a, x) => a + x, 0) / 4, geroosterd: diensten.length > 0,
      tekortVoor: tekortUren(voor), tekortNa: tekortUren(na), eigen, afwezig: ander.filter((o) => d >= o.van && d <= o.tot).length,
    };
  });
  const door = impact.filter((i) => i.geroosterd && i.tekortNa > i.tekortVoor + 0.25);
  const ongeroosterd = impact.filter((i) => !i.geroosterd).length;
  const ingeroosterd = impact.filter((i) => i.eigen).length;
  return (
    <div className="box">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{mw?.naam ?? 'Onbekend'} <span className="note font-normal">· NBD</span></div>
          <div className="text-[15px]">{fmtDJ(v.van)}{v.tot !== v.van ? ` t/m ${fmtDJ(v.tot)}` : ''} · {VERLOF_SOORT[v.soort]} · {plural(werkdagen(v.van, v.tot), 'werkdag', 'werkdagen')}</div>
          {v.opmerking && <div className="note mt-1">“{v.opmerking}”</div>}
          <div className="note mt-1">Aangevraagd {fmtMoment(v.aangevraagd)}</div>
        </div>
        {magBesluiten ? (
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onAf}><X size={16} /> Afwijzen</button>
            <button type="button" className="btn btn-teal" onClick={onGoed}><Check size={16} /> Goedkeuren</button>
          </div>
        ) : <AlleenRegiomanager wat="Het besluit" paragraaf="4.1" />}
      </div>
      <div className="mt-4">
        <div className="mb-3"><AdviesRegel advies={advies} /></div>
        {advies && advies.weken.length > 0 && advies.weken.length <= 6 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {advies.weken.map((w) => (
              <div key={w.maandag} className={cx('rounded-lg border px-2.5 py-1 text-[13px]', w.over < 0 ? 'border-rood' : 'border-line')} title={`Ruimte ${Math.round(w.ruimte)} uur, al goedgekeurd ${Math.round(w.goedgekeurd)}, andere aanvragen ${Math.round(w.aangevraagd)}`}>
                <div className="font-semibold">wk {w.week}{w.schoolvakantie ? ' · vakantie' : ''}</div>
                <div className="num">{Math.round(w.over)} uur over</div>
              </div>
            ))}
          </div>
        )}
        <div className="mb-2 flex flex-wrap gap-2">
          {door.length ? <Pill soort="bad">Minder mensen aan de telefoon dan nodig op {plural(door.length, 'dag', 'dagen')} door deze aanvraag</Pill> : ongeroosterd === impact.length ? <Pill soort="info">Rooster nog niet gemaakt; oordeel op de verlofruimte</Pill> : <Pill soort="ok">Bezetting blijft op orde</Pill>}
          {ongeroosterd > 0 && ongeroosterd < impact.length && <Pill soort="neutral">{plural(ongeroosterd, 'dag', 'dagen')} nog niet geroosterd</Pill>}
          {ongeroosterd < impact.length && <Pill soort="neutral">{ingeroosterd ? `${plural(ingeroosterd, 'dienst vervalt', 'diensten vervallen')}` : 'Niet ingeroosterd in deze periode'}</Pill>}
          {ander.length > 0 && <Pill soort="warn">{plural(ander.length, 'collega', 'collega\'s')} ook met verlof</Pill>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {impact.map((i) => (
            <div
              key={i.d}
              className={cx('min-w-[72px] rounded-lg border px-2 py-1 text-center text-[13px]', !i.geroosterd ? 'border-dashed border-line text-muted' : i.tekortNa > i.tekortVoor + 0.25 ? 'border-rood' : 'border-line')}
              title={!i.geroosterd ? `Nog geen rooster; ${nl(i.nodigUren)} uur aan de telefoon nodig` : `${nl(i.gepland)} uur aan de telefoon na goedkeuren, ${nl(i.nodigUren)} nodig${i.eigen ? `; de dienst van ${nl(netto(i.eigen))} uur vervalt` : ''}${i.afwezig ? `, ${i.afwezig} anderen afwezig` : ''}`}
            >
              <div className="font-semibold">{DAG_KORT[weekday(toDay(i.d))]} {i.d.slice(8)}</div>
              <div className="num">{!i.geroosterd ? `–/${Math.round(i.nodigUren)}` : `${Math.round(i.gepland)}/${Math.round(i.nodigUren)}`}</div>
            </div>
          ))}
        </div>
        <p className="note mt-2">Per dag: uren aan de telefoon na goedkeuren / nodig volgens Erlang C. Per week: verlofruimte uit de capaciteitsplanning, na goedgekeurd verlof.</p>
      </div>
    </div>
  );
}
