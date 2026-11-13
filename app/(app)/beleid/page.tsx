'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { CheckCircle2, FileText, Info, AlertTriangle, ArrowRight } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { Box, Laden, PaginaKop, Pill } from '@/components/ui';
import { useApp } from '@/lib/store/store';
import { useBehoefte } from '@/lib/store/hooks';
import { REGIONS } from '@/lib/model/config';
import { addDays, fmtD, isoRange, todayIso } from '@/lib/dates';
import { BELEID, BELEID_VERSIE, DOELEN, WIJZIGINGEN_2027, type Blok } from '@/lib/beleid/tekst';
import { DIENSTEN, PALET } from '@/lib/rooster/diensten';
import { REGELS, toets, type Check, type RegelId } from '@/lib/rooster/toets';
import { cx, plural } from '@/lib/format';
import { useWerkregio } from '@/lib/werkregio';
import { inRooster } from '@/lib/rooster/types';

const WEKEN = 8;

export default function BeleidPagina() {
  const s = useSessie();
  const vandaag = todayIso();
  const ik = useApp((x) => x.medewerkers.find((m) => m.id === s.medewerkerId) ?? null);
  const mijnRegios = s.isPlanner ? REGIONS.filter((r) => s.regios.includes(r)) : ik ? [ik.regio] : [];
  const [regio, setRegio] = useWerkregio(mijnRegios);
  const dates = useMemo(() => isoRange(vandaag, addDays(vandaag, WEKEN * 7 - 1)), [vandaag]);
  const { behoefte, klaar } = useBehoefte(regio, dates, 'basis');
  const medewerkers = useApp((x) => x.medewerkers);
  const cellen = useApp((x) => x.rooster[regio]);
  const wensen = useApp((x) => x.wensen);
  const beleid = useApp((x) => x.beleid);
  const profielen = useApp((x) => x.profielen);

  const checks = useMemo(() => {
    if (!regio || !s.isPlanner) return null;
    const team = medewerkers.filter((m) => m.regio === regio && inRooster(m));
    if (!team.length) return null;
    const t = toets({ team, dates, cellen: cellen ?? {}, behoefte, wensen: wensen.filter((w) => w.regio === regio), beleid, profielen });
    return new Map(t.checks.map((c) => [c.id, c]));
  }, [regio, s.isPlanner, medewerkers, dates, cellen, behoefte, wensen, beleid, profielen]);

  if (!klaar) return <Laden />;

  return (
    <>
      <PaginaKop
        boven="Roosterbeleid uitvaartverzorging"
        titel={<>Het beleid, <em>en hoe GRIP het controleert</em></>}
        lead={<>{BELEID_VERSIE}. Bij elke regel die GRIP toetst zie je {s.isPlanner ? 'hoe de gekozen regio er de komende acht weken voor staat' : 'wat er wordt gecontroleerd'}.</>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-6 grid max-h-[calc(100vh-3rem)] gap-3 overflow-y-auto text-[14px]" aria-label="Inhoud">
            {s.isPlanner && mijnRegios.length > 1 && (
              <label className="label">
                <span>Status voor regio</span>
                <select className="input" value={regio} onChange={(e) => setRegio(e.target.value)}>
                  {mijnRegios.map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
            )}
            {BELEID.map((h) => (
              <div key={h.nr}>
                <a href={`#h-${h.nr}`} className="font-semibold text-ink no-underline hover:underline">{h.nr}. {h.titel}</a>
                <ul className="mt-1 grid gap-0.5 border-l border-line pl-3">
                  {h.paragrafen.map((p) => <li key={p.id}><a href={`#p-${p.id}`} className="text-muted no-underline hover:text-ink">{p.id} {p.titel}</a></li>)}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div className="grid min-w-0 grid-cols-1 gap-6">
          <Box className="border-l-4" titel="Wijzigingen voor 2027">
            <ul className="grid gap-1.5 text-[15px]">
              {WIJZIGINGEN_2027.map((w) => <li key={w} className="flex gap-2"><Info size={16} className="mt-1 shrink-0 text-plum" />{w}</li>)}
            </ul>
          </Box>

          {s.isPlanner && mijnRegios.length > 1 && (
            <label className="label lg:hidden">
              <span>Status voor regio</span>
              <select className="input" value={regio} onChange={(e) => setRegio(e.target.value)}>
                {mijnRegios.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
          )}

          {BELEID.map((h) => (
            <section key={h.nr} id={`h-${h.nr}`} className="scroll-mt-20 lg:scroll-mt-6">
              <h2 className="kop mb-3">{h.nr}. {h.titel}</h2>
              <div className="grid grid-cols-1 gap-4">
                {h.paragrafen.map((p) => (
                  <article key={p.id} id={`p-${p.id}`} className="box min-w-0 scroll-mt-20 lg:scroll-mt-6">
                    <h3 className="kop-s mb-3"><span className="text-muted">{p.id}</span> {p.titel}</h3>
                    <div className="grid min-w-0 grid-cols-1 gap-3 text-[15.5px] leading-relaxed">
                      {p.blokken.map((b, i) => <BlokWeergave key={i} b={b} checks={checks} regio={regio} />)}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          <p className="note flex items-center gap-2"><FileText size={15} /> Bron: Roosterbeleid 1.3 en Nieuwe vastgestelde regelplekken 2027.</p>
        </div>
      </div>
    </>
  );
}

function BlokWeergave({ b, checks, regio }: { b: Blok; checks: Map<RegelId, Check> | null; regio: string }) {
  switch (b.soort) {
    case 'p':
      return <p className="m-0 max-w-[78ch]">{b.tekst}</p>;
    case 'lijst':
      return <ul className="m-0 grid max-w-[78ch] list-disc gap-1 pl-5">{b.items.map((x) => <li key={x}>{x}</li>)}</ul>;
    case 'stappen':
      return (
        <ol className="m-0 grid gap-2 pl-0">
          {b.stappen.map((x, i) => (
            <li key={x} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-soft text-[13px] font-semibold">{i + 1}</span>
              <span className="max-w-[74ch]">{x}</span>
            </li>
          ))}
        </ol>
      );
    case 'tabel':
      return (
        <div>
          <div className="scroll">
            <table className="tb">
              <thead><tr>{b.kop.map((k) => <th key={k}>{k}</th>)}</tr></thead>
              <tbody>{b.rijen.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {b.noot && <p className="note mt-2">{b.noot}</p>}
        </div>
      );
    case 'grip':
      return (
        <div className="flex gap-3 rounded-lg bg-soft px-4 py-3 text-[14.5px]">
          <span className="mt-0.5 shrink-0 text-[12px] font-bold uppercase tracking-wide text-accent">In GRIP</span>
          <span className="max-w-[74ch]">{b.tekst}</span>
        </div>
      );
    case 'doelen':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {DOELEN.map((d) => (
            <div key={d.naam} className="rounded-lg border border-line p-4" style={{ borderTop: `4px solid ${d.kleur}` }}>
              <div className="kop-s">{d.naam}</div>
              <p className="note m-0 mt-1.5 text-[14px]">{d.tekst}</p>
            </div>
          ))}
        </div>
      );
    case 'diensten':
      return (
        <div className="scroll">
          <table className="tb">
            <thead><tr><th>Code</th><th>Dienst</th><th>Tijden</th><th>Open voor regelgesprek</th><th className="r">Plekken</th><th className="r">Uren</th></tr></thead>
            <tbody>
              {PALET.filter((c) => ['1', '1M', '2', '1B', 'DG1', 'DG2'].includes(c)).map((c) => {
                const d = DIENSTEN[c];
                return (
                  <tr key={c}>
                    <td><span className={cx('inline-grid h-7 min-w-[40px] place-items-center rounded px-1 text-[12.5px] font-semibold', `c-${c}`)}>{c}</span></td>
                    <td><b>{d.naam}</b><div className="note">{d.uitleg}</div></td>
                    <td className="whitespace-nowrap">{d.start != null ? `${d.start}:00–${d.eind}:00` : '–'}{!d.tijdenVast && <div className="note">indicatief, tijden 4 dagen vooraf</div>}</td>
                    <td>{d.open ?? '–'}</td>
                    <td className="r">{d.plekken || (d.voorgangen ? `${d.voorgangen} voorg.` : '–')}</td>
                    <td className="r">{d.uren}{c === '1B' && <div className="note">gewogen</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    case 'regel':
      return (
        <div className="rounded-lg border border-line p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-[70ch] font-semibold">{b.tekst}</div>
            <div className="flex flex-wrap gap-1.5">
              {b.regels.map((id) => <RegelStatus key={id} id={id} c={checks?.get(id)} regio={regio} />)}
            </div>
          </div>
          {b.gewijzigd && <div className="mt-1.5"><Pill soort="info">{b.gewijzigd}</Pill></div>}
          <div className="note mt-1.5">{REGELS[b.regels[0]].niveau}{checks ? '' : ' · GRIP controleert dit bij elk rooster, elke ruil en elke bijsturing'}</div>
        </div>
      );
  }
}

function RegelStatus({ id, c, regio }: { id: RegelId; c: Check | undefined; regio: string }) {
  if (!c) return null;
  const n = c.items.length;
  const hard = REGELS[id].niveau === 'ATW en CAO';
  if (!n) return <Pill soort="ok"><CheckCircle2 size={13} /> {regio}: in orde</Pill>;
  const datums = c.items.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return (
    <Link href={`/rooster?regio=${encodeURIComponent(regio)}`} className="no-underline" title={c.items.slice(0, 8).map((x) => (/^\d{4}-/.test(x) ? fmtD(x) : x)).join(', ')}>
      <Pill soort={hard ? 'bad' : 'warn'}>
        <AlertTriangle size={13} /> {regio}: {datums.length === n ? plural(n, 'dag', 'dagen') : plural(n, 'punt', 'punten')}
        <ArrowRight size={13} />
      </Pill>
    </Link>
  );
}

