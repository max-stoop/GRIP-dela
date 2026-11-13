'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { DAG_KORT, fmtD, fmtDag, toDay, weekday, dayOfMonth, isoWeek, MAAND_KORT, month } from '@/lib/dates';
import { cx, pct } from '@/lib/format';
import { DIENSTEN, TOETS_DIENST, WENS_LABEL, dienstTijd, wensGehonoreerd } from '@/lib/rooster/diensten';
import { cel, REGELS, type Toets } from '@/lib/rooster/toets';
import { BEHOEFTE_BRON, dagVoorkeurOp, roosterGroep, type Beleid, type Cellen, type DagVoorkeur, type DienstCode, type Medewerker, type Tijden, type Voorkeurprofiel, type Wens } from '@/lib/rooster/types';
import { weekendNaam } from '@/lib/rooster/weekend';
import { uurTekst } from '@/lib/rooster/tijden';
import type { Wijziging } from '@/lib/rooster/voorstel';
import type { Verlof } from '@/lib/store/types';
import type { ClusterDag } from '@/lib/capaciteit/beschikbaarheid';
import type { ClusterStand } from '@/lib/rooster/cluster';

const TOETS: Record<string, DienstCode> = { ...TOETS_DIENST, '-': '-', Delete: '-', Backspace: '-' };

interface GridProps {
  team: Medewerker[];
  dates: string[];
  cellen: Cellen;
  toets: Toets;
  vandaag: string;
  wensen: Wens[];
  aanvragen: Verlof[];
  profielen?: Record<string, Voorkeurprofiel>;
  /** Dg, voor de tooltip en een klokje in het vakje. */
  tijden?: Tijden;
  beleid: Beleid;
  verf: DienstCode;
  alleenLezen?: boolean;
  onZet: (w: Wijziging[]) => void;
  onNaam?: (id: string) => void;
  /** Binnen de uitvaartverzorgers of de uitvaartleiders. */
  onSchuif?: (id: string, richting: -1 | 1) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Per dag (zoals dates), met de uitleg voor de tooltip. */
  kans1B?: ({ dag: ClusterDag; uitleg: string } | null)[];
  /** Klik op het aantal plekken of de kans op een 1B van een dag: de uitleg per plek. */
  onUitleg?: (datum: string) => void;
  /** Gepland en wat het moet, onder het rooster van de regio. */
  cluster?: { naam: string; stand: ClusterStand };
  /** De hele maand in de breedte: smallere kolommen. */
  passend?: boolean;
}

const VK_KLASSE: Record<DagVoorkeur, string> = { niet: 'vk-niet', liever_niet: 'vk-lieverniet', graag: 'vk-graag', neutraal: '' };
const VK_TEKST: Record<DagVoorkeur, string> = { niet: 'Kan niet op deze weekdag', liever_niet: 'Werkt liever niet op deze weekdag', graag: 'Werkt graag op deze weekdag', neutraal: '' };

/** Slepen met de muis, tikken op een tablet, of pijltjes en letters op het toetsenbord. */
export function RoosterGrid({ team, dates, cellen, toets, vandaag, wensen, aanvragen, profielen = {}, tijden, beleid, verf, alleenLezen, onZet, onNaam, onSchuif, onUndo, onRedo, kans1B, onUitleg, cluster, passend }: GridProps) {
  // per cel de regels die er worden overtreden, voor de tooltip
  const regelsOp = new Map<string, string[]>();
  for (const o of toets.overtredingen) {
    const k = `${o.mid}|${o.datum}`;
    regelsOp.set(k, [...(regelsOp.get(k) ?? []), REGELS[o.regel].kort]);
  }
  const wrap = useRef<HTMLDivElement>(null);
  const schilder = useRef<{ actief: boolean; cellen: Map<string, Wijziging> }>({ actief: false, cellen: new Map() });
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const kan = (d: string) => !alleenLezen && d >= vandaag;
  const wensMap = new Map(wensen.map((w) => [`${w.medewerkerId}|${w.datum}`, w]));
  const aanvraagSet = new Set<string>();
  for (const v of aanvragen) for (const d of dates) if (d >= v.van && d <= v.tot) aanvraagSet.add(`${v.medewerkerId}|${d}`);

  // muis: slepen schildert direct in de DOM, bij loslaten wordt alles in één keer opgeslagen
  useEffect(() => {
    const op = () => {
      const s = schilder.current;
      if (!s.actief) return;
      s.actief = false;
      const w = [...s.cellen.values()].filter(([m, d, x]) => cel(cellen, m, d) !== x);
      s.cellen.clear();
      if (w.length) onZet(w);
    };
    window.addEventListener('pointerup', op);
    return () => window.removeEventListener('pointerup', op);
  }, [cellen, onZet]);

  const verfCel = (td: HTMLElement) => {
    const m = td.dataset.m!, d = td.dataset.d!;
    if (!kan(d)) return;
    schilder.current.cellen.set(`${m}|${d}`, [m, d, verf]);
    // staat dit er al, dan niets in de pagina veranderen: React zet de kenmerken (toets, wens) dan niet terug
    if (cel(cellen, m, d) === verf) return;
    td.className = cx('s', `c-${verf}`, weekday(toDay(d)) % 6 === 0 && 'we', weekday(toDay(d)) === 1 && Number(td.dataset.c) > 0 && 'wk');
    td.textContent = verf === '-' ? '' : verf;
  };

  const zetFocus = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(team.length - 1, r)), cc = Math.max(0, Math.min(dates.length - 1, c));
    setFocus({ r: rr, c: cc });
    const td = wrap.current?.querySelector<HTMLElement>(`td[data-r="${rr}"][data-c="${cc}"]`);
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const opToets = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? onRedo : onUndo)?.(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); onRedo?.(); return; }
    if (!focus) return;
    const nav: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (nav[e.key]) { e.preventDefault(); zetFocus(focus.r + nav[e.key][0], focus.c + nav[e.key][1]); return; }
    const code = e.key === 'Enter' || e.key === ' ' ? verf : TOETS[e.key];
    if (code && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const m = team[focus.r].id, d = dates[focus.c];
      if (kan(d) && cel(cellen, m, d) !== code) onZet([[m, d, code]]);
      zetFocus(focus.r, focus.c + 1);
    }
  };

  const wk = (d: string, i: number) => (weekday(toDay(d)) === 1 && i > 0 ? 'wk' : '');
  // de regels onder het rooster blijven onderaan in beeld: de regio en (als die er is) het cluster
  const vast = cluster ? 6 : 3;
  const onder = (j: number) => ({ '--onder': `${(vast - 1 - j) * 28}px` }) as CSSProperties;
  const maandKop = dates.map((d, i) => (i === 0 || dayOfMonth(toDay(d)) === 1 ? `${MAAND_KORT[month(toDay(d)) - 1]}` : ''));

  return (
    <div ref={wrap} className="scroll max-h-[calc(100vh-180px)] focus:outline-none" tabIndex={0} onKeyDown={opToets} aria-label="Roostergrid. Pijltjestoetsen om te bewegen, letters om een dienst te zetten.">
      <table className={cx('rs', passend && 'passend')}>
        <thead>
          <tr>
            <th className="nm">
              <span className="text-[13px] text-muted">Medewerker</span>
              <small>uren gepland / norm</small>
            </th>
            {dates.map((d, i) => {
              const n = toDay(d);
              return (
                <th key={d} className={cx(weekday(n) % 6 === 0 && 'we', d === vandaag && 'vandaag', wk(d, i))} title={`${fmtDag(d)}, week ${isoWeek(n)}`}>
                  <span className="block text-[10px] font-bold uppercase leading-none opacity-70">{maandKop[i] || ' '}</span>
                  {DAG_KORT[weekday(n)]}<br />{dayOfMonth(n)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {team.map((e, r) => {
            const u = toets.uren[e.id];
            const afw = u && u.norm > 0 ? (u.gepland - u.norm) / u.norm : 0;
            return (
              <tr key={e.id}>
                <th className="nm">
                  <span className="flex items-center gap-1">
                  <button type="button" className="block min-w-0 flex-1 text-left" onClick={() => onNaam?.(e.id)} title={onNaam ? 'Klik om te bewerken' : undefined}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate">{e.naam}</span>
                      {u && <span className={cx('num text-[12px] font-bold', Math.abs(afw) > 0.1 ? 'text-rood' : 'text-muted')}>{u.gepland}/{Math.round(u.norm)}u</span>}
                    </span>
                    <small>{e.extern ? `extern · max ${e.contract} uur` : <>{e.functie === 'UL' ? 'uitvaartleider · ' : ''}{e.contract} uur · {e.functie === 'UL' ? 'alleen Dg' : e.voorkeur === 'O' ? 'ochtend' : 'middag'}{beleid.omHetWeekend ? ` · ${weekendNaam(e, dates[0])}` : ''}</>}</small>
                  </button>
                  {onSchuif && (
                    <span className="flex shrink-0 flex-col">
                      {([-1, 1] as const).map((richting) => {
                        const buur = team[r + richting];
                        const kanSchuiven = !!buur && roosterGroep(buur) === roosterGroep(e);
                        const Pijl = richting < 0 ? ChevronUp : ChevronDown;
                        return (
                          <button key={richting} type="button" className={cx('rounded text-muted hover:bg-soft hover:text-ink', !kanSchuiven && 'invisible')} disabled={!kanSchuiven}
                            aria-label={`${e.naam} ${richting < 0 ? 'omhoog' : 'omlaag'}`} title={richting < 0 ? 'Eén plek omhoog' : 'Eén plek omlaag'} onClick={() => onSchuif(e.id, richting)}>
                            <Pijl size={14} aria-hidden />
                          </button>
                        );
                      })}
                    </span>
                  )}
                  </span>
                </th>
                {dates.map((d, c) => {
                  const s = cel(cellen, e.id, d), k = `${e.id}|${d}`, w = wensMap.get(k);
                  const vk = dagVoorkeurOp(profielen[e.id]?.dagen[weekday(toDay(d))], w?.soort);
                  const ok = w ? wensGehonoreerd(w.soort, s) : null;
                  const vt = tijden?.[e.id]?.[d];
                  const vast = vt && (!vt.code || vt.code === s) ? vt : null;
                  const titel = [
                    `${e.naam}, ${fmtDag(d)}: ${DIENSTEN[s].naam}${vast ? ` (${uurTekst(vast.start)}–${uurTekst(vast.eind)}, vastgelegd)` : dienstTijd(s) ? ` (${dienstTijd(s)})` : ''}`,
                    w ? `Wens: ${WENS_LABEL[w.soort]}${w.opmerking ? ` (${w.opmerking})` : ''}${ok === false ? ', niet gehonoreerd' : ''}` : '',
                    aanvraagSet.has(k) ? 'Verlof aangevraagd, nog niet beoordeeld' : '',
                    VK_TEKST[vk],
                    regelsOp.has(k) ? `${toets.fout.has(k) ? 'Overtreding ATW/CAO' : 'Let op'}: ${[...new Set(regelsOp.get(k))].join(', ')}` : '',
                  ].filter(Boolean).join('\n');
                  return (
                    <td
                      key={d}
                      data-m={e.id}
                      data-d={d}
                      data-r={r}
                      data-c={c}
                      title={titel}
                      className={cx(
                        's', `c-${s}`, weekday(toDay(d)) % 6 === 0 && 'we', wk(d, c), toets.fout.has(k) ? 'x' : toets.aandacht.has(k) && 'let',
                        d < vandaag && 'verleden', alleenLezen && 'alleen-lezen', w && w.soort !== 'neutraal' && 'wens', ok && 'ok', VK_KLASSE[vk], vast && 'tijd',
                        focus?.r === r && focus?.c === c && 'focus', aanvraagSet.has(k) && 'outline-dashed outline-2 -outline-offset-[3px] outline-[color:var(--gold)]',
                      )}
                      onPointerDown={(ev) => {
                        setFocus({ r, c });
                        wrap.current?.focus({ preventScroll: true });
                        if (ev.pointerType !== 'mouse' || ev.button !== 0 || !kan(d)) return;
                        ev.preventDefault();
                        schilder.current.actief = true;
                        verfCel(ev.currentTarget);
                      }}
                      onPointerEnter={(ev) => { if (schilder.current.actief) verfCel(ev.currentTarget); }}
                      onClick={(ev) => {
                        // tikken op touch of pen: één vakje
                        const pt = (ev.nativeEvent as PointerEvent).pointerType;
                        if (pt && pt !== 'mouse' && kan(d) && s !== verf) onZet([[e.id, d, verf]]);
                      }}
                    >
                      {s === '-' ? '' : s}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="plak" style={onder(0)}>
            <th className="nm" title="Inclusief beschikbaarheidsdiensten (1B): die tellen als regelplek">Regelplekken gepland</th>
            {toets.perDag.map((p, i) => <td key={p.datum} className={cx(wk(p.datum, i), p.k != null && p.p < p.k && 'low', p.k != null && p.p > p.k && 'high')} title={p.k != null ? `${fmtD(p.datum)}: ${p.p} gepland (waarvan ${p.b} beschikbaarheid), ${p.k} afgesproken` : undefined}>{p.p}</td>)}
          </tr>
          <tr className="plak" style={onder(1)}>
            <th className="nm" title={onUitleg ? 'Wat de regio moet. Klik op een dag: waarom zoveel plekken, en hoe vaak elke plek en de 1B vallen' : 'Wat de regio moet'}>
              <span className="flex items-center gap-1.5">Afgesproken{onUitleg && <Info size={13} className="text-accent" aria-hidden />}</span>
            </th>
            {toets.perDag.map((p, i) => {
              const verschoven = p.verschoven ? `. ${p.verschoven > 0 ? `${p.verschoven} extra voor een andere regio in het cluster` : `${-p.verschoven} minder: een andere regio in het cluster doet ${p.verschoven === -1 ? 'die' : 'ze'}`} (afspraak)` : '';
              const titel = p.lam != null ? `Verwacht ${p.lam.toFixed(1).replace('.', ',')} meldingen, volgens ${p.bron ? BEHOEFTE_BRON[p.bron] : '–'}${p.kNorm != null && p.kNorm !== p.k ? `. Vastgesteld: ${p.kNorm}` : ''}${verschoven}` : 'Geen voorspelling';
              return (
                <td key={p.datum} className={cx(wk(p.datum, i), p.bron === 'norm' && 'font-normal italic')} title={onUitleg && p.k != null ? `${titel}. Klik voor de uitleg.` : titel}>
                  {onUitleg && p.k != null ? <button type="button" className="w-full underline decoration-dotted underline-offset-2" onClick={() => onUitleg(p.datum)} aria-label={`Uitleg plekken ${fmtDag(p.datum)}`}>{p.k}</button> : p.k ?? '–'}
                  {p.verschoven ? <span className="ml-px align-super text-[9px] font-bold text-accent" aria-hidden>{p.verschoven > 0 ? '+' : '−'}</span> : null}
                </td>
              );
            })}
          </tr>
          <tr className="plak" style={onder(2)}>
            <th className="nm" title={`Dossiergebonden diensten (DG1 en DG2). De regio moet er minstens ${beleid.minDG} per dag hebben, met samen ${beleid.voorgangenPerDag} voorgaansplekken (DG1 telt 1, DG2 telt 2); niet op zondag.`}>
              Dg gepland <span className="font-normal text-muted">· moet {beleid.minDG}</span>
            </th>
            {toets.perDag.map((p, i) => (
              <td key={p.datum} className={cx(wk(p.datum, i), !p.zondag && (p.dg < beleid.minDG || p.voorgangen < beleid.voorgangenPerDag) && 'low')}
                title={p.zondag ? 'Zondag: geen Dg-diensten' : `${fmtD(p.datum)}: ${p.dg} Dg-dienst(en), ${p.voorgangen} van ${beleid.voorgangenPerDag} voorgaansplekken; moet minstens ${beleid.minDG} Dg-diensten`}>
                {p.zondag ? '' : p.dg}
              </td>
            ))}
          </tr>
          {cluster && (
            <>
              <tr className="plak cluster" style={onder(3)}>
                <th className="nm" title={`Alle regio's van cluster ${cluster.naam} samen, met de beschikbaarheidsdiensten (1B)`}>Cluster gepland</th>
                {dates.map((d, i) => {
                  const p = cluster.stand.gepland[i], k = cluster.stand.afgesproken[i];
                  return <td key={d} className={cx(wk(d, i), k != null && p < k && 'low', k != null && p > k && 'high')} title={`Cluster ${cluster.naam}, ${fmtD(d)}: ${p} gepland${k != null ? `, ${k} afgesproken` : ''}. ${cluster.stand.regels.map((r) => `${r.regio} ${r.gepland[i]}`).join(', ')}`}>{p}</td>;
                })}
              </tr>
              <tr className="plak" style={onder(4)}>
                <th className="nm" title="Wat het cluster moet: de afgesproken plekken van de regio's samen, plus de speling die het cluster samen nodig heeft">Cluster afgesproken</th>
                {dates.map((d, i) => {
                  const k = cluster.stand.afgesproken[i], sp = cluster.stand.speling[i];
                  return <td key={d} className={wk(d, i)} title={k != null ? `${fmtD(d)}: ${cluster.stand.regels.map((r) => `${r.regio} ${r.afgesproken[i] ?? '–'}`).join(', ')}${sp ? `, plus ${sp} speling voor het cluster samen` : ''}` : undefined}>{k ?? '–'}</td>;
                })}
              </tr>
              <tr className="plak" style={onder(5)}>
                <th className="nm" title={`Dg-diensten in het cluster. Elke regio moet er minstens ${beleid.minDG} per dag hebben, behalve op zondag.`}>
                  Cluster Dg <span className="font-normal text-muted">· moet {beleid.minDG * cluster.stand.regels.length}</span>
                </th>
                {dates.map((d, i) => {
                  const n = cluster.stand.dg[i], moet = cluster.stand.dgMoet[i];
                  const kort = cluster.stand.regels.filter((r) => r.dg[i] < r.dgMoet[i]).map((r) => r.regio);
                  return (
                    <td key={d} className={cx(wk(d, i), (n < moet || kort.length > 0) && 'low')}
                      title={moet ? `${fmtD(d)}: ${n} Dg-diensten, moet ${moet}. ${cluster.stand.regels.map((r) => `${r.regio} ${r.dg[i]}`).join(', ')}${kort.length ? `. Te weinig in ${kort.join(', ')}` : ''}` : 'Zondag: geen Dg-diensten'}>
                      {moet ? n : ''}
                    </td>
                  );
                })}
              </tr>
            </>
          )}
          <tr className="los">
            <th className="nm">Kans dat het past</th>
            {toets.perDag.map((p, i) => <td key={p.datum} className={cx('text-[11px]', wk(p.datum, i))} title={p.cov != null ? `${fmtD(p.datum)}: ${pct(p.cov, 1)} kans dat alle meldingen op de dag passen` : undefined}>{p.cov != null ? Math.round(p.cov * 100) : ''}</td>)}
          </tr>
          {kans1B && (
            <tr className="los">
              <th className="nm" title={`Gemiddelde kans per 1B in het cluster dat hij valt. Een melding gaat eerst naar een vrije plek in het cluster; pas als alle reguliere plekken in het cluster bezet zijn, valt er een 1B.${onUitleg ? ' Klik op een dag voor deze regio: hoe vaak elke plek en de 1B vallen, voor de eigen regio of voor een andere.' : ''}`}>
                <span className="flex items-center gap-1.5">Kans 1B valt{onUitleg && <Info size={13} className="text-accent" aria-hidden />}</span>
              </th>
              {dates.map((d, i) => {
                const k = kans1B[i];
                return (
                  <td key={d} className={cx('text-[11px]', wk(d, i))} title={k ? `${fmtD(d)}: ${k.uitleg}${onUitleg ? ' Klik voor de uitleg per plek.' : ''}` : undefined}>
                    {k ? (onUitleg ? <button type="button" className="w-full underline decoration-dotted underline-offset-2" onClick={() => onUitleg(d)} aria-label={`Uitleg 1B ${fmtDag(d)}`}>{Math.round(k.dag.cluster.gemiddeld * 100)}</button> : Math.round(k.dag.cluster.gemiddeld * 100)) : ''}
                  </td>
                );
              })}
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}
