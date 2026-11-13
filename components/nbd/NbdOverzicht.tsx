'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, CalendarDays, Clock3, Compass, Gauge, Palmtree, Thermometer, Users } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { GeenToegang, Laden, Leeg, PaginaKop, Pill, Sectie } from '@/components/ui';
import { DagBeeld } from '@/components/nbd/DagBeeld';
import { useVerlofContext } from '@/components/verlof/Verlofplanning';
import { useApp } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import { addDays, DAG_KORT, DAG_LANG, fmtD, fmtLang, isoRange, isoWeek, toDay, todayIso, weekday } from '@/lib/dates';
import { BEHOEFTE_BRON, LEGE_CELLEN, inRooster } from '@/lib/rooster/types';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { nbdBehoefte } from '@/lib/nbd/behoefte';
import { nbdDienst } from '@/lib/nbd/blokken';
import type { NbdDienst } from '@/lib/nbd/dienst';
import { toetsNbd } from '@/lib/nbd/toets';
import { weektype } from '@/lib/nbd/voorkeuren';
import { nbdCapaciteitUitVerlof } from '@/lib/capaciteit/verlof';
import { cx, nl, nlInt, pct } from '@/lib/format';

/** Vandaag en de komende twee weken, wat er open staat en de ruimte voor verlof. */
export function NbdOverzicht() {
  const s = useSessie();
  const vandaag = todayIso();
  const medewerkers = useApp((x) => x.medewerkers);
  const cellen = useApp((x) => x.rooster[NBD]) ?? LEGE_CELLEN;
  const tijden = useApp((x) => x.tijden[NBD]);
  const p = useApp((x) => x.nbd);
  const normen = useApp((x) => x.normen);
  const verlof = useApp((x) => x.verlof);
  const ruil = useApp((x) => x.ruil);
  const ziek = useApp((x) => x.ziekmeldingen);
  const pub = useApp((x) => x.publicaties[NBD]);
  const ctx = useVerlofContext();
  const { laatste, laatsteData, basisData, klaar } = useRuns();
  const team = useMemo(() => medewerkers.filter((m) => m.regio === NBD && inRooster(m)).sort((a, b) => a.naam.localeCompare(b.naam)), [medewerkers]);
  const dagen = useMemo(() => isoRange(vandaag, addDays(vandaag, 13)), [vandaag]);
  const behoefte = useMemo(() => nbdBehoefte({ basis: basisData, laatste: laatsteData, norm: normen }, p, dagen, 'laatste'), [basisData, laatsteData, normen, p, dagen]);
  const t = useMemo(() => toetsNbd({ team, dates: dagen, cellen, tijden, behoefte, p }), [team, dagen, cellen, tijden, behoefte, p]);
  const cap = useMemo(() => nbdCapaciteitUitVerlof(ctx, vandaag, 1)[0], [ctx, vandaag]);

  if (!s.isPlanner) return <GeenToegang />;
  if (!klaar) return <Laden />;
  const perDag = new Map(t.perDag.map((d) => [d.datum, d]));
  const nu = perDag.get(vandaag);
  const dag = behoefte[vandaag];
  const diensten = Object.fromEntries(team.map((m) => [m.id, nbdDienst(cellen, tijden, m.id, vandaag)]).filter(([, x]) => x)) as Record<string, NbdDienst>;
  const openVerlof = verlof.filter((v) => v.regio === NBD && v.status === 'aangevraagd').length;
  const openRuil = ruil.filter((r) => r.regio === NBD && r.status === 'wacht_planner').length;
  const ziekNu = ziek.filter((z) => z.regio === NBD && z.status === 'ziek').length;
  const week = t.perDag.filter((d) => d.datum < addDays(vandaag, 7));
  const weekNodig = week.reduce((a, d) => a + d.nodigUren, 0), weekGepland = week.reduce((a, d) => a + d.geplandUren, 0);
  const krap = t.perDag.filter((d) => d.geplandUren > 0 && d.sl < p.serviceLevel - 1e-9);

  return (
    <>
      <PaginaKop
        boven={<>{NBD_NAAM} · landelijk</>}
        titel={<>Overzicht <em>NBD</em></>}
        lead={<>Elke dag open van 7:00 tot 22:30. De gesprekken bewegen mee met de overlijdens in de regio&apos;s; per uur rekent Erlang C hoeveel mensen er aan de telefoon moeten ({pct(p.serviceLevel)} binnen {p.wachttijd} seconden). {laatste ? `Laatste voorspelling van ${fmtD(laatste.uitgegeven)}.` : 'Nog geen voorspelling: het gemiddelde jaar geldt.'}</>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="box">
          <div className="text-[13.5px] font-semibold">Vandaag</div>
          <div className="display mt-1 text-[34px] font-semibold leading-none">{dag ? nlInt(dag.gesprekken) : '–'}</div>
          <div className="note mt-1">gesprekken verwacht{dag ? ` (${nl(dag.factor, 2)} × een gewone ${DAG_LANG[weekday(toDay(vandaag))]})` : ''}</div>
        </div>
        <div className="box">
          <div className="text-[13.5px] font-semibold">Aan de telefoon vandaag</div>
          <div className="display mt-1 text-[34px] font-semibold leading-none">{nu ? `${nlInt(nu.geplandUren)}/${nlInt(nu.nodigUren)}` : '–'}</div>
          <div className="note mt-1">uur gepland / nodig{nu && nu.geplandUren > 0 ? ` · verwacht ${pct(nu.sl)} binnen ${p.wachttijd} s` : ''}</div>
        </div>
        <div className="box">
          <div className="text-[13.5px] font-semibold">Komende 7 dagen</div>
          <div className="display mt-1 text-[34px] font-semibold leading-none">{nlInt(weekGepland)}/{nlInt(weekNodig)}</div>
          <div className="note mt-1">uur aan de telefoon gepland / nodig{krap.length ? ` · ${krap.length} ${krap.length === 1 ? 'dag' : 'dagen'} onder ${pct(p.serviceLevel)} (14 dagen)` : ''}</div>
        </div>
        <div className="box-focus">
          <div className="text-[13.5px] font-semibold opacity-90">Verlof te geven, week {cap.week}</div>
          <div className="display mt-1 text-[34px] font-semibold leading-none">{nlInt(cap.ruimte)} <small className="text-[16px] opacity-80">uur</small></div>
          <div className="mt-1 text-[13px] opacity-80">{nlInt(cap.verlof)} goedgekeurd, {nlInt(cap.over)} over</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/nbd/verlof" className="btn btn-ghost btn-sm"><Palmtree size={15} /> Verlof te beoordelen {openVerlof ? <Pill soort="warn">{openVerlof}</Pill> : null}</Link>
        <Link href="/nbd/ruilen" className="btn btn-ghost btn-sm"><ArrowLeftRight size={15} /> Ruilen {openRuil ? <Pill soort="warn">{openRuil}</Pill> : null}</Link>
        <Link href="/nbd/bijsturen" className="btn btn-ghost btn-sm"><Thermometer size={15} /> Ziek {ziekNu ? <Pill soort="bad">{ziekNu}</Pill> : null}</Link>
        <Link href="/nbd/voorkeuren" className="btn btn-ghost btn-sm"><Clock3 size={15} /> Voorkeuren per uur</Link>
        <Link href="/nbd/capaciteit" className="btn btn-ghost btn-sm"><Gauge size={15} /> Capaciteit en Erlang</Link>
      </div>

      {!team.length ? (
        <Sectie titel="Nog geen team">
          <Leeg titel="Nog geen medewerkers bij de NBD" icoon={<Users size={28} />} actie={<Link href="/nbd/rooster" className="btn"><CalendarDays size={16} /> Naar het rooster</Link>}>
            Voeg de medewerkers van de nabestaandendesk toe, met hun contracturen, maximale inzet en voorkeuren per uur.
          </Leeg>
        </Sectie>
      ) : (
        <>
          {dag && (
            <Sectie titel={`Vandaag, ${fmtLang(vandaag, false)}`} lead={`Per kwartier: mensen aan de telefoon tegenover wat Erlang C vraagt (uit ${BEHOEFTE_BRON[dag.bron]}). Week ${isoWeek(toDay(vandaag))} is een ${weektype(vandaag)} week.`}>
              <DagBeeld datum={vandaag} dag={dag} uitkomst={nu} team={team} p={p} diensten={diensten} />
            </Sectie>
          )}
          <Sectie titel="De komende twee weken" lead={pub ? `Gepubliceerd t/m ${fmtD(pub.tot)}.` : 'Nog niet gepubliceerd.'} rechts={<Link href="/nbd/bijsturen" className="btn btn-ghost btn-sm"><Compass size={15} /> Bijsturen</Link>}>
            <div className="scroll">
              <table className="tb">
                <thead><tr><th>Dag</th><th className="r" title="Overlijdens tegenover een gemiddelde dag">Factor</th><th className="r">Gesprekken</th><th className="r">Nodig (uur)</th><th className="r">Gepland (uur)</th><th className="r">Te weinig (uur)</th><th className="r">Service level</th></tr></thead>
                <tbody>
                  {dagen.map((d) => {
                    const u = perDag.get(d), b = behoefte[d];
                    return (
                      <tr key={d} className={cx(d === vandaag && 'font-semibold')}>
                        <td className="whitespace-nowrap"><Link href={`/nbd/rooster?maand=${d.slice(0, 7)}`} className="font-semibold">{DAG_KORT[weekday(toDay(d))]} {fmtD(d)}</Link></td>
                        <td className={cx('r num', b && b.factor > 1.08 ? 'text-rood' : b && b.factor < 0.92 ? 'text-teal' : '')}>{b ? nl(b.factor, 2) : '–'}</td>
                        <td className="r num">{b ? nlInt(b.gesprekken) : '–'}</td>
                        <td className="r num">{u ? nl(u.nodigUren) : '–'}</td>
                        <td className="r num">{u ? nl(u.geplandUren) : '–'}</td>
                        <td className={cx('r num', u && u.tekortUren > 0.5 && 'font-semibold text-rood')}>{u && u.tekortUren > 0.01 ? nl(u.tekortUren) : ''}</td>
                        <td className={cx('r num', u && u.geplandUren > 0 && u.sl < p.serviceLevel && 'font-semibold text-rood')}>{u && u.geplandUren > 0 ? pct(u.sl) : 'nog niet geroosterd'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Sectie>
        </>
      )}
    </>
  );
}
