'use client';
import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Box, GeenToegang, GetalInvoer, Groep, PaginaKop, Pill, Sectie, Segment, Veld } from '@/components/ui';
import { useVerlofContext } from '@/components/verlof/Verlofplanning';
import { nbdTerug, useApp, zetNbd } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import type { ToetsTegen } from '@/lib/store/afgeleid';
import { DAG_KORT, DAG_LANG, addDays, fmtD, fromDay, isoWeek, mondayOf, toDay, todayIso, weekday } from '@/lib/dates';
import { BEHOEFTE_BRON } from '@/lib/rooster/types';
import { uurTekst } from '@/lib/rooster/tijden';
import { jaarWeken } from '@/lib/capaciteit/jaarplan';
import { nbdCapaciteitUitVerlof } from '@/lib/capaciteit/verlof';
import { gesprekkenPerWeek, NBD, NBD_GESPREKKEN_STANDAARD, NBD_NAAM, NBD_STANDAARD, tijdvakken, uitvaartenPerJaar, type NbdParameters } from '@/lib/nbd/parameters';
import { gewoneDag, nbdBehoefte, schaal } from '@/lib/nbd/behoefte';
import { cx, nl, nlInt, pct } from '@/lib/format';

/** Maandag eerst (index = weekdag, 0 = zondag). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const VAK = tijdvakken();
const vakTekst = (i: number) => `${uurTekst(VAK[i].van)}–${uurTekst(VAK[i].tot)}`;

export function NbdCapaciteit() {
  const s = useSessie();
  const p = useApp((x) => x.nbd);
  const normen = useApp((x) => x.normen);
  const ctx = useVerlofContext();
  const vandaag = todayIso();
  const [jaar, setJaar] = useState(Number(vandaag.slice(0, 4)));
  const [max, setMax] = useState(false);

  const norm = useMemo(() => Object.fromEntries(WEEK.map((wd) => [wd, gewoneDag(p, wd)])) as Record<number, ReturnType<typeof gewoneDag>>, [p]);
  const normUren = WEEK.reduce((a, wd) => a + norm[wd].uren, 0);
  const weken = useMemo(() => {
    const { eerste, aantal } = jaarWeken(jaar);
    return nbdCapaciteitUitVerlof(ctx, eerste, aantal);
  }, [ctx, jaar]);
  const deze = useMemo(() => nbdCapaciteitUitVerlof(ctx, vandaag, 1)[0], [ctx, vandaag]);

  if (!s.isPlanner) return <GeenToegang />;
  const team = ctx.medewerkers.filter((m) => m.regio === NBD && m.actief && !m.extern);
  const gesprekken = gesprekkenPerWeek(p);
  const sch = schaal(p, normen);

  return (
    <>
      <PaginaKop
        boven={<>{NBD_NAAM} · landelijk · elke dag open van 7:00 tot 22:30</>}
        titel={<>Capaciteit <em>en Erlang</em></>}
        lead={<>Zoals de capaciteitsplanning van de NBD: de gesprekken per uur in een gewone week, die meebewegen met de overlijdens in de regio&apos;s; per uur met Erlang C ({pct(p.serviceLevel)} binnen {p.wachttijd} seconden, {p.aht} seconden per gesprek) naar hele mensen aan de telefoon; en per week de netto uren van het team tegenover {pct(p.correctie)} van die uren. Wat overblijft, is de ruimte voor verlof.</>}
      />

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="De keten">
        {[
          ['Open', '7:00–22:30', 'elke dag, ook in het weekend; het laatste halfuur telt half'],
          ['Gesprekken per gewone week', nlInt(gesprekken), sch > 0 && Math.abs(sch - 1) > 0.005 ? `maal ${nl(sch)} voor het volume; beweegt mee met de overlijdens` : 'beweegt mee met de overlijdens in de regio\'s'],
          ['Uren aan de telefoon', nl(normUren), 'in een gewone week: Erlang C per uur, naar boven afgerond'],
          ['Netto benodigd', nl(normUren * p.correctie), `${pct(p.correctie)} van de Erlang-uren`],
          ['Verlof te geven deze week', `${nlInt(deze.ruimte)} uur`, team.length ? `netto ${nlInt(deze.netto)} beschikbaar, ${nlInt(deze.benodigd)} benodigd in week ${deze.week}` : 'nog geen team'],
        ].map(([t, v, sub], i) => (
          <li key={t} className={cx('list-none', i === 4 ? 'box-focus' : 'box')}>
            <div className="flex items-center gap-2 text-[13px] font-semibold opacity-80"><span className={cx('grid h-6 w-6 place-items-center rounded-full text-[12px]', i === 4 ? 'bg-white/15' : 'bg-soft')}>{i + 1}</span>{t}</div>
            <div className="display mt-2 text-[30px] font-semibold leading-none">{v}</div>
            <div className={cx('mt-1 text-[13px]', i === 4 ? 'opacity-80' : 'note')}>{sub}</div>
          </li>
        ))}
      </ol>

      <Normweek p={p} norm={norm} />
      <WeekMetOverlijdens p={p} />

      <Sectie
        titel={`Capaciteit per week in ${jaar}`}
        lead={<>Zoals het tabblad Capaciteit NBD: contracturen min verlof, ziekte ({pct(p.ziek)}) en overig verlof en langdurig verzuim ({nlInt(p.overigVerzuim)} uur) geeft de beschikbare uren; min training ({nl(p.training)} uur per medewerker), pauze ({pct(p.pauzeDeel)}), afspraken, taken en klachten geeft netto beschikbaar. Daartegenover {pct(p.correctie)} van de uren die Erlang C vraagt, met het seizoen van de overlijdens.</>}
        rechts={<div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[color:var(--teal)]" checked={max} onChange={(e) => setMax(e.target.checked)} /> Met maximale inzet</label>
          <Segment label="Jaar" waarde={String(jaar)} onChange={(v) => setJaar(Number(v))} opties={[0, 1].map((i) => { const j = Number(vandaag.slice(0, 4)) + i; return [String(j), String(j)] as [string, string]; })} />
        </div>}
      >
        <div className="scroll max-h-[520px]">
          <table className="tb">
            <thead>
              <tr>
                <th>Week</th><th>Vanaf</th>
                <th className="r" title={max ? 'Contracturen plus de extra uren bij een variabel rooster' : 'Contracturen van het team'}>{max ? 'Max inzet' : 'Bruto'}</th>
                <th className="r" title="Goedgekeurd verlof (aangevraagd tussen haakjes)">Verlof</th>
                <th className="r" title={`Ziekte: ${pct(p.ziek)} van de bruto uren`}>Ziek</th>
                <th className="r" title="Overig verlof en langdurig verzuim">Overig verzuim</th>
                <th className="r">Beschikbaar</th>
                <th className="r" title="Training, pauze, afspraken, taken en klachten">Overig werk</th>
                <th className="r">Netto beschikbaar</th>
                <th className="r" title="Uren aan de telefoon die Erlang C vraagt">Erlang</th>
                <th className="r" title={`${pct(p.correctie)} van de Erlang-uren`}>Netto benodigd</th>
                <th className="r" title="Netto beschikbaar plus het goedgekeurde verlof, min netto benodigd">Verlof te geven</th>
                <th className="r" title="Wat er over is na het goedgekeurde verlof">Over</th>
              </tr>
            </thead>
            <tbody>
              {weken.map((w) => {
                const ruimte = max ? w.ruimteMax : w.ruimte, over = max ? w.overMax : w.over;
                return (
                  <tr key={w.maandag} className={cx(w.maandag === deze.maandag && 'font-semibold')}>
                    <td className="font-semibold">{w.week}</td>
                    <td className="whitespace-nowrap">{fmtD(w.maandag)}</td>
                    <td className="r num">{nlInt(max ? w.brutoMax : w.bruto)}</td>
                    <td className="r num">{w.verlof ? nlInt(w.verlof) : '–'}{w.aangevraagd ? <span className="text-muted"> ({nlInt(w.aangevraagd)})</span> : ''}</td>
                    <td className="r num">{nlInt(max ? p.ziek * w.brutoMax : w.ziek)}</td>
                    <td className="r num">{nlInt(w.overigVerzuim)}</td>
                    <td className="r num">{nlInt(max ? w.beschikbaarMax : w.beschikbaar)}</td>
                    <td className="r num">{nlInt(w.overig)}</td>
                    <td className="r num">{nlInt(max ? w.nettoMax : w.netto)}</td>
                    <td className="r num">{nl(w.erlangUren)}</td>
                    <td className="r num">{nlInt(w.benodigd)}</td>
                    <td className={cx('r num font-semibold', ruimte < 0 ? 'text-rood' : 'text-teal')}>{nlInt(ruimte)}</td>
                    <td className={cx('r num', over < 0 && 'font-semibold text-rood')}>{nlInt(over)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {team.length > 0 && (
          <p className="note mt-2">
            Overig werk in week {deze.week}: training {nl(deze.training)} uur ({team.length} medewerkers × {nl(p.training)}), pauze {nl(deze.pauze)}, afspraken {nl(deze.afspraken)}, taken {nl(deze.taken)}{deze.klachten ? `, klachten ${nl(deze.klachten)}` : ''}. Verlof te geven is gemiddeld {nlInt(weken.reduce((a, w) => a + (max ? w.ruimteMax : w.ruimte), 0) / Math.max(1, weken.length))} uur per week.
          </p>
        )}
      </Sectie>

      <NbdInstellingen p={p} magWijzigen={s.isBeheerder} />
    </>
  );
}

/** Zoals het tabblad Benodigde uren. */
function Normweek({ p, norm }: { p: NbdParameters; norm: Record<number, ReturnType<typeof gewoneDag>> }) {
  const [wat, setWat] = useState<'mensen' | 'gesprekken'>('mensen');
  const maxNodig = Math.max(1, ...WEEK.flatMap((wd) => norm[wd].tijdvakken.map((v) => v.nodig)));
  const maxG = Math.max(1, ...WEEK.flatMap((wd) => norm[wd].tijdvakken.map((v) => v.gesprekken)));
  const totaal = WEEK.reduce((a, wd) => a + norm[wd].uren, 0);
  return (
    <Sectie
      titel="Een gewone week"
      lead={<>Per uur de gesprekken en de mensen aan de telefoon die Erlang C vraagt (per uur, naar boven afgerond, minstens {p.minBezetting}). Samen {nl(totaal)} uur aan de telefoon; het laatste halfuur (22:00–22:30) telt half.</>}
      rechts={<Segment label="Toon" waarde={wat} onChange={setWat} opties={[['mensen', 'Mensen'], ['gesprekken', 'Gesprekken']]} />}
    >
      <div className="scroll">
        <table className="tb">
          <thead>
            <tr><th>Uur</th>{WEEK.map((wd) => <th key={wd} className="r">{DAG_KORT[wd]}</th>)}</tr>
          </thead>
          <tbody>
            {VAK.map((_, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap font-semibold">{vakTekst(i)}</td>
                {WEEK.map((wd) => {
                  const x = norm[wd].tijdvakken[i];
                  const deel = wat === 'mensen' ? x.nodig / maxNodig : x.gesprekken / maxG;
                  return (
                    <td key={wd} className="r num" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(deel * 45)}%, transparent)` }} title={`${DAG_LANG[wd]} ${vakTekst(i)}: ${nl(x.gesprekken)} gesprekken, ${x.nodig} mensen`}>
                      {wat === 'mensen' ? x.nodig : nl(x.gesprekken)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>{wat === 'mensen' ? 'Uren per dag' : 'Gesprekken per dag'}</th>
              {WEEK.map((wd) => <td key={wd} className="r num font-semibold">{wat === 'mensen' ? nl(norm[wd].uren) : nlInt(norm[wd].gesprekken)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </Sectie>
  );
}

/** De gesprekken bewegen mee met de overlijdens. */
function WeekMetOverlijdens({ p }: { p: NbdParameters }) {
  const normen = useApp((x) => x.normen);
  const { laatsteData, basisData } = useRuns();
  const [tegen, setTegen] = useState<ToetsTegen>('laatste');
  const [week, setWeek] = useState(() => fromDay(mondayOf(toDay(todayIso()))));
  const dagen = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const b = useMemo(() => nbdBehoefte({ basis: basisData, laatste: laatsteData, norm: normen }, p, dagen, tegen), [basisData, laatsteData, normen, p, dagen, tegen]);
  const maxNodig = Math.max(1, ...dagen.flatMap((d) => b[d].tijdvakken.map((v) => v.nodig)));
  const weekUren = dagen.reduce((a, d) => a + b[d].uren, 0);
  const weekGesprekken = dagen.reduce((a, d) => a + b[d].gesprekken, 0);
  const bronnen = [...new Set(dagen.map((d) => b[d].bron))];
  return (
    <Sectie
      titel={`Week ${isoWeek(toDay(week))} met de overlijdens`}
      lead={<>Elke dag de gesprekken van een gewone dag op die weekdag, maal de overlijdens van die dag tegenover een gemiddelde dag (uit {bronnen.map((x) => BEHOEFTE_BRON[x]).join(' en ')}). Samen {nlInt(weekGesprekken)} gesprekken en {nl(weekUren)} uur aan de telefoon.</>}
      rechts={<div className="flex flex-wrap items-center gap-2">
        <Groep label="Volgens"><Segment label="Volgens" waarde={tegen} onChange={setTegen} opties={[['basis', 'Roosterbasis'], ['laatste', 'Laatste voorspelling'], ['norm', 'Gemiddeld jaar']]} /></Groep>
        <input className="input w-auto self-end" type="date" value={week} onChange={(e) => e.target.value && setWeek(fromDay(mondayOf(toDay(e.target.value))))} aria-label="Week van" />
      </div>}
    >
      <div className="scroll">
        <table className="tb">
          <thead>
            <tr>
              <th>Dag</th><th className="r" title="Overlijdens tegenover een gemiddelde dag op deze weekdag">Factor</th><th className="r">Gesprekken</th><th className="r">Uren</th>
              {VAK.map((v, i) => <th key={i} className="r text-[12px]" title={vakTekst(i)}>{v.van}</th>)}
            </tr>
          </thead>
          <tbody>
            {dagen.map((d) => {
              const dag = b[d];
              return (
                <tr key={d}>
                  <td className="whitespace-nowrap font-semibold">{DAG_KORT[weekday(toDay(d))]} {fmtD(d)}</td>
                  <td className={cx('r num', dag.factor > 1.08 ? 'text-rood' : dag.factor < 0.92 ? 'text-teal' : '')}>{nl(dag.factor, 2)}</td>
                  <td className="r num">{nlInt(dag.gesprekken)}</td>
                  <td className="r num">{nl(dag.uren)}</td>
                  {dag.tijdvakken.map((x, i) => (
                    <td key={i} className="r text-[12.5px]" style={{ background: `color-mix(in srgb, var(--accent) ${Math.round((x.nodig / maxNodig) * 45)}%, transparent)` }} title={`${vakTekst(i)}: ${nl(x.gesprekken)} gesprekken, ${x.nodig} mensen`}>{x.nodig}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sectie>
  );
}

function Getal({ label, waarde, onZet, stap = 1, min = 0, max, hint, procent, uit }: { label: string; waarde: number; onZet: (v: number) => void; stap?: number; min?: number; max?: number; hint?: string; procent?: boolean; uit?: boolean }) {
  const toon = procent ? Math.round(waarde * 10000) / 100 : waarde;
  return (
    <Veld label={label} hint={hint}>
      <GetalInvoer stap={stap} min={min} max={max ?? 1e9} waarde={toon} disabled={uit} onZet={(v) => onZet(procent ? v / 100 : v)} />
    </Veld>
  );
}

/** Alleen de beheerder past ze aan. */
function NbdInstellingen({ p, magWijzigen }: { p: NbdParameters; magWijzigen: boolean }) {
  const actie = useActie();
  const minVrij = useApp((x) => x.beleid.minVrijeWeekenden);
  const normen = useApp((x) => x.normen);
  const uit = !magWijzigen;
  const zet = (patch: Partial<NbdParameters>) => zetNbd(patch);
  const zetGesprek = (wd: number, i: number, v: number) => zet({ gesprekken: p.gesprekken.map((rij, d) => (d === wd ? rij.map((x, j) => (j === i ? Math.max(0, v) : x)) : rij)) });
  const tabelAnders = JSON.stringify(p.gesprekken) !== JSON.stringify(NBD_GESPREKKEN_STANDAARD);
  return (
    <Sectie titel="Instellingen" lead={magWijzigen ? 'Wat je hier verandert, geldt meteen voor de behoefte, de capaciteit, de toets en het automatisch roosteren van de NBD.' : 'Alleen de beheerder kan deze instellingen aanpassen.'}
      rechts={magWijzigen ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(nbdTerug, 'Terug naar de startwaarden van de capaciteitsplanning.')}><RotateCcw size={15} /> Startwaarden</button> : undefined}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Box titel="Erlang C">
          <div className="grid gap-3 sm:grid-cols-2">
            <Getal label="Gespreksduur met nawerk (seconden)" waarde={p.aht} onZet={(v) => zet({ aht: Math.max(10, v) })} stap={10} min={10} uit={uit} hint={`Capaciteitsplanning: ${NBD_STANDAARD.aht} seconden.`} />
            <Getal label="Service level (%)" waarde={p.serviceLevel} onZet={(v) => zet({ serviceLevel: Math.max(0.1, Math.min(0.99, v)) })} procent uit={uit} />
            <Getal label="Binnen (seconden)" waarde={p.wachttijd} onZet={(v) => zet({ wachttijd: Math.max(1, v) })} min={1} uit={uit} />
            <Getal label="Minimale bezetting als de desk open is" waarde={p.minBezetting} onZet={(v) => zet({ minBezetting: Math.max(0, Math.round(v)) })} uit={uit} />
            <Getal label="Netto benodigd (% van de Erlang-uren)" waarde={p.correctie} onZet={(v) => zet({ correctie: Math.max(0.1, Math.min(1.5, v)) })} procent uit={uit} hint="Capaciteitsplanning: 92%." />
          </div>
        </Box>
        <Box titel="Volume (landelijk)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Getal label="Natura-uitvaarten per jaar" waarde={p.natura} onZet={(v) => zet({ natura: v })} uit={uit} />
            <Getal label="Overlijdens per jaar (CBS)" waarde={p.overlijdens} onZet={(v) => zet({ overlijdens: v })} uit={uit} />
            <Getal label="Aandeel vrije markt (%)" waarde={p.vrijeMarkt} onZet={(v) => zet({ vrijeMarkt: Math.max(0, Math.min(1, v)) })} stap={0.01} procent uit={uit} />
            <div className="note self-end pb-2">{nlInt(uitvaartenPerJaar(p))} uitvaarten per jaar; de gesprekken maal {nl(schaal(p, normen))} tegenover de regio&apos;s.</div>
          </div>
        </Box>
        <Box titel="Capaciteit per week">
          <div className="grid gap-3 sm:grid-cols-2">
            <Getal label="Ziekte (% van de bruto uren)" waarde={p.ziek} onZet={(v) => zet({ ziek: Math.max(0, Math.min(0.5, v)) })} procent stap={0.5} uit={uit} />
            <Getal label="Overig verlof en langdurig verzuim (uur per week)" waarde={p.overigVerzuim} onZet={(v) => zet({ overigVerzuim: Math.max(0, v) })} uit={uit} />
            <Getal label="Training (uur per medewerker per week)" waarde={p.training} onZet={(v) => zet({ training: Math.max(0, v) })} stap={0.25} uit={uit} />
            <Getal label="Pauze (% van de bruto uren)" waarde={p.pauzeDeel} onZet={(v) => zet({ pauzeDeel: Math.max(0, Math.min(0.5, v)) })} procent stap={0.5} uit={uit} />
            <Getal label="Afspraken, weekly en monthly (uur per week)" waarde={p.afspraken} onZet={(v) => zet({ afspraken: Math.max(0, v) })} uit={uit} />
            <Getal label="Taken (uur per week)" waarde={p.taken} onZet={(v) => zet({ taken: Math.max(0, v) })} uit={uit} />
            <Getal label="Klachten (uur per week)" waarde={p.klachten} onZet={(v) => zet({ klachten: Math.max(0, v) })} uit={uit} />
            <Getal label="Variabel rooster: uren boven het contract" waarde={p.extraInzet} onZet={(v) => zet({ extraInzet: Math.max(0, Math.min(20, v)) })} stap={0.5} uit={uit} hint="Startwaarde voor de maximale inzet van een medewerker." />
          </div>
        </Box>
        <Box titel="Diensten">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Pill soort="info">Open van 7:00 tot 22:30, elke dag</Pill></div>
            <Getal label="Dienst minimaal (uur werk)" waarde={p.minDienst} onZet={(v) => zet({ minDienst: Math.max(1, v) })} stap={0.25} min={1} uit={uit} />
            <Getal label="Dienst maximaal (uur werk)" waarde={p.maxDienst} onZet={(v) => zet({ maxDienst: Math.min(12, v) })} stap={0.25} max={12} uit={uit} />
            <Getal label="Pauze na meer dan (uur werk)" waarde={p.pauzeNa} onZet={(v) => zet({ pauzeNa: v })} stap={0.25} uit={uit} hint="ATW: meer dan 5,5 uur werk geeft recht op pauze." />
            <Getal label="Pauze (minuten)" waarde={p.pauzeMinuten} onZet={(v) => zet({ pauzeMinuten: Math.max(0, Math.round(v / 15) * 15) })} stap={15} uit={uit} hint="Telt niet als werktijd." />
          </div>
        </Box>
        <Box titel="ATW, CAO en teamafspraken" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Getal label="Rust tussen twee diensten (uur)" waarde={p.minRust} onZet={(v) => zet({ minRust: v })} stap={0.5} uit={uit} hint="ATW: minstens 11 uur." />
            <Getal label="Aaneengesloten rust per week (uur)" waarde={p.weekRust} onZet={(v) => zet({ weekRust: v })} uit={uit} hint="ATW: 36 uur, of 72 uur in twee weken." />
            <Getal label="Werktijd per week hoogstens (uur)" waarde={p.maxWeekUren} onZet={(v) => zet({ maxWeekUren: v })} uit={uit} hint="ATW: 60 uur." />
            <Getal label="Dagen achter elkaar hoogstens" waarde={p.maxAchtereen} onZet={(v) => zet({ maxAchtereen: Math.max(1, Math.round(v)) })} min={1} uit={uit} />
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={p.aanvullenTotContract} disabled={uit} onChange={(e) => zet({ aanvullenTotContract: e.target.checked })} />
              <span>Rooster maken vult aan tot de contracturen <span className="note block">Op de drukste momenten, bovenop wat Erlang C vraagt.</span></span>
            </label>
            <p className="note sm:col-span-2">De CAO-regel van {minVrij} vrije weekenden per jaar geldt ook hier.</p>
          </div>
        </Box>
      </div>
      <Box titel="Gesprekken per uur in een gewone week" className="mt-4" rechts={magWijzigen && tabelAnders ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(() => zet({ gesprekken: NBD_GESPREKKEN_STANDAARD }), 'De gesprekken staan weer zoals in de capaciteitsplanning.')}><RotateCcw size={15} /> Zoals de capaciteitsplanning</button> : undefined}>
        <p className="note mb-2">Uit de capaciteitsplanning NBD 2026 (samen {nlInt(gesprekkenPerWeek({ gesprekken: NBD_GESPREKKEN_STANDAARD }))} per week). Dit is een gemiddelde week; elke dag beweegt mee met de overlijdens.</p>
        <div className="scroll">
          <table className="tb">
            <thead><tr><th>Dag</th>{VAK.map((v, i) => <th key={i} className="r text-[12px]" title={vakTekst(i)}>{v.van}</th>)}<th className="r">Samen</th></tr></thead>
            <tbody>
              {WEEK.map((wd) => (
                <tr key={wd}>
                  <td className="font-semibold">{DAG_KORT[wd]}</td>
                  {VAK.map((_, i) => (
                    <td key={i} className="r p-0.5">
                      <input className="input w-[68px] px-1 py-0.5 text-right text-[13px]" type="number" min={0} step={0.01} disabled={uit} aria-label={`${DAG_LANG[wd]} ${vakTekst(i)}`}
                        value={p.gesprekken[wd][i]} onChange={(e) => { const x = Number(e.target.value); if (Number.isFinite(x)) zetGesprek(wd, i, x); }} />
                    </td>
                  ))}
                  <td className="r num font-semibold">{nl(p.gesprekken[wd].reduce((a, x) => a + x, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
    </Sectie>
  );
}
