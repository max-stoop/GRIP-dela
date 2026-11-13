'use client';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, CopyPlus, Eraser, Users, X } from 'lucide-react';
import { neemStandaardOver, useApp, wisWensen, zetWens } from '@/lib/store/store';
import { useActie } from '@/components/toast';
import { addDays, DAG_KORT, fmtDag, fromDay, isoWeek, mondayOf, toDay, todayIso, dayOfMonth } from '@/lib/dates';
import { maandEind, maandNaam, maandStart, maandVan, volgendeMaand, type Maand } from '@/lib/rooster/maand';
import { WENS_LABEL } from '@/lib/rooster/diensten';
import { cel } from '@/lib/rooster/toets';
import type { Medewerker, WensSoort } from '@/lib/rooster/types';
import { GEEN_TELLING, telWensen, type WensTelling } from '@/lib/rooster/wensen';
import { cx, plural } from '@/lib/format';
import { isNbd } from '@/lib/nbd/parameters';

const SOORTEN: WensSoort[] = ['werken', 'ochtend', 'middag', 'vrij', 'neutraal', 'overig8', 'overig4'];
/** De NBD is tot 22:30 open: daar kan ook een avond. */
const SOORTEN_NBD: WensSoort[] = ['werken', 'ochtend', 'middag', 'avond', 'vrij', 'neutraal'];
const KLEUR: Record<WensSoort, string> = {
  vrij: 'color-mix(in srgb, var(--gold) 24%, var(--card))',
  ochtend: 'color-mix(in srgb, var(--accent) 16%, var(--card))',
  middag: 'color-mix(in srgb, var(--teal) 24%, var(--card))',
  avond: 'color-mix(in srgb, var(--plum) 22%, var(--card))',
  werken: 'color-mix(in srgb, var(--teal) 45%, var(--card))',
  neutraal: 'color-mix(in srgb, var(--muted) 16%, var(--card))',
  overig8: 'var(--dov)',
  overig4: 'var(--dov)',
};
const KORT: Record<WensSoort, string> = { vrij: 'Vrij', ochtend: 'Ochtend', middag: 'Middag', avond: 'Avond', werken: 'Werken', neutraal: 'Geen vk.', overig8: 'Overig 8u', overig4: 'Overig 4u' };
/** Wat het team voor een dag heeft opgegeven: wil werken, liever vrij, geen voorkeur, of al een overige dienst. */
const TEAM: { sleutel: keyof WensTelling; kleur: string; een: string; meer: string }[] = [
  { sleutel: 'werken', kleur: 'var(--teal)', een: 'wil werken', meer: 'willen werken' },
  { sleutel: 'vrij', kleur: 'var(--gold)', een: 'liever vrij', meer: 'liever vrij' },
  { sleutel: 'neutraal', kleur: 'var(--muted)', een: 'geen voorkeur', meer: 'geen voorkeur' },
  { sleutel: 'overig', kleur: 'var(--plum)', een: 'heeft een overige dienst', meer: 'hebben een overige dienst' },
];

/** "3 willen werken, 1 liever vrij, 2 geen voorkeur, 4 nog niet ingevuld". */
export function teamTekst(t: WensTelling, team: number): string {
  const open = Math.max(0, team - t.werken - t.vrij - t.neutraal - t.overig);
  const delen = TEAM.filter((x) => t[x.sleutel] > 0).map((x) => `${t[x.sleutel]} ${t[x.sleutel] === 1 ? x.een : x.meer}`);
  if (!delen.length) return `Nog geen van je ${plural(team, 'collega', "collega's")} heeft deze dag ingevuld`;
  return `${delen.join(', ')}${open ? `, ${open} nog niet ingevuld` : ''}`;
}

/** Zo ver vooruit kan een medewerker wensen opgeven (en verder als een voorkeurenronde verder loopt). */
const VOORUIT_MAANDEN = 12;

/**
 * Wensen per maand: kies de maand, tik op een dag en kies de wens (of haal hem weg). Tik op het weeknummer om je
 * vaste voorkeuren in die week over te nemen en pas daarna losse dagen aan. Bij elke dag staat wat de collega's in de
 * regio al hebben opgegeven, zodat het team onderling kan schuiven.
 */
export function WensKalender({ medewerker, tot, ronde }: { medewerker: Medewerker; tot?: string; ronde?: { van: string; tot: string } | null }) {
  const vandaag = todayIso();
  const actie = useActie();
  const deze = maandVan(vandaag);
  const laatste = [volgendeMaand(deze, VOORUIT_MAANDEN - 1), tot ? maandVan(tot) : ''].sort().at(-1)!;
  const maanden: Maand[] = [];
  for (let m = deze; m <= laatste; m = volgendeMaand(m)) maanden.push(m);
  // eerst de maand van een lopende voorkeurenronde, anders volgende maand: die wordt als eerste geroosterd
  const [maand, setMaand] = useState<Maand>(() => (ronde && maandVan(ronde.van) >= deze ? maandVan(ronde.van) : volgendeMaand(deze)));
  /** Een datum: de keuze voor die dag; "wk" met de maandag: de keuze voor die week. */
  const [open, setOpen] = useState<string | null>(null);

  const start = fromDay(mondayOf(toDay(maandStart(maand))));
  const eind = maandEind(maand);
  const weken = Math.ceil((toDay(eind) - toDay(start) + 1) / 7);
  const alleWensen = useApp((x) => x.wensen);
  const wensen = alleWensen.filter((w) => w.medewerkerId === medewerker.id);
  const pub = useApp((x) => x.publicaties[medewerker.regio]);
  const verlof = useApp((x) => x.verlof.filter((v) => v.medewerkerId === medewerker.id && ['aangevraagd', 'goedgekeurd'].includes(v.status)));
  // het team: de collega's in de eigen regio die in het rooster staan (geen ZZP'ers, niemand die uit dienst is)
  const collegas = useApp((x) => x.medewerkers.filter((m) => m.regio === medewerker.regio && m.id !== medewerker.id && m.actief && !m.extern));
  const teamUitDb = useApp((x) => x.wensenTeam);
  const ids = new Set(collegas.map((m) => m.id));
  // een medewerker leest alleen de eigen wensen en krijgt van het team de aantallen; wie alle wensen leest, telt zelf
  const team = alleWensen.some((w) => ids.has(w.medewerkerId)) ? telWensen(alleWensen, ids, vandaag) : teamUitDb ?? {};
  const map = new Map(wensen.map((w) => [w.datum, w.soort]));
  const soorten = isNbd(medewerker.regio) ? SOORTEN_NBD : SOORTEN;
  const inMaand = wensen.filter((w) => maandVan(w.datum) === maand).length;
  const i = maanden.indexOf(maand);

  const neemOver = (maandag: string) => {
    const week = isoWeek(toDay(maandag));
    void actie(() => neemStandaardOver(medewerker.id, Array.from({ length: 7 }, (_, j) => addDays(maandag, j))),
      (n) => (n ? `Je vaste voorkeuren staan in week ${week}: ${plural(n, 'dag', 'dagen')} ingevuld. Pas aan wat deze week anders is.` : `In week ${week} viel niets meer in te vullen: elke dag heeft al een wens (of is voorbij of verlof).`));
    setOpen(null);
  };
  const maakLeeg = (maandag: string) => {
    const week = isoWeek(toDay(maandag));
    void actie(() => wisWensen(medewerker.id, Array.from({ length: 7 }, (_, j) => addDays(maandag, j))), (n) => `${plural(n, 'wens', 'wensen')} weggehaald in week ${week}.`);
    setOpen(null);
  };

  return (
    <div className="box p-3 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-icon" disabled={i <= 0} onClick={() => setMaand(maanden[i - 1])} aria-label="Vorige maand">‹</button>
        <select className="input w-auto min-w-[170px]" value={maand} onChange={(e) => { setMaand(e.target.value); setOpen(null); }} aria-label="Maand">
          {maanden.map((m) => <option key={m} value={m}>{maandNaam(m)}</option>)}
        </select>
        <button type="button" className="btn btn-ghost btn-icon" disabled={i >= maanden.length - 1} onClick={() => setMaand(maanden[i + 1])} aria-label="Volgende maand">›</button>
        <span className="note ml-1">{inMaand ? `${inMaand} ${inMaand === 1 ? 'wens' : 'wensen'} in ${maandNaam(maand, false)}` : `Nog geen wensen in ${maandNaam(maand, false)}`}</span>
      </div>
      <p className="note mb-3">Tik op een dag om je wens te kiezen. Tik op het weeknummer om je vaste voorkeuren in die week over te nemen; daarna pas je alleen de dagen aan die anders zijn.</p>
      <div className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] gap-1 sm:gap-1.5">
        <div />
        {[1, 2, 3, 4, 5, 6, 0].map((w) => <div key={w} className="pb-1 text-center text-[13px] font-semibold text-muted">{DAG_KORT[w]}</div>)}
        {Array.from({ length: weken }, (_, wk) => {
          const maandag = addDays(start, wk * 7), week = isoWeek(toDay(maandag)), sleutel = `wk${maandag}`;
          const dagen = Array.from({ length: 7 }, (_, j) => addDays(maandag, j));
          const voorbij = dagen[6] < vandaag;
          const aantal = dagen.filter((d) => d >= vandaag && map.has(d)).length;
          return (
          <Fragment key={wk}>
            <div className="relative flex items-stretch pr-1 sm:pr-2">
              <button
                type="button"
                disabled={voorbij}
                data-week={maandag}
                onClick={() => setOpen(open === sleutel ? null : sleutel)}
                aria-haspopup="menu"
                aria-expanded={open === sleutel}
                aria-label={`Week ${week}: vaste voorkeuren overnemen`}
                title={voorbij ? `Week ${week}` : `Week ${week}: je vaste voorkeuren overnemen`}
                className={cx('flex w-full flex-col items-center justify-center gap-1 rounded-lg border px-1 text-[12px] font-semibold text-muted transition-colors sm:px-1.5', voorbij ? 'cursor-default border-transparent opacity-45' : 'border-line hover:border-[color:var(--accent)] hover:text-ink', open === sleutel && 'border-[color:var(--accent)] text-ink')}
              >
                <span className="whitespace-nowrap">wk {week}</span>
                {!voorbij && <CopyPlus size={14} aria-hidden />}
              </button>
              {open === sleutel && (
                <Uitklap label={`Week ${week}`} rechts={false} breed onSluit={() => setOpen(null)}>
                  <div className="px-2 pb-1 pt-0.5 text-[12px] font-semibold text-muted">Week {week}</div>
                  <button type="button" role="menuitem" onClick={() => neemOver(maandag)} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[14px] hover:bg-soft">
                    <CopyPlus size={15} className="mt-0.5 shrink-0" />
                    <span><span className="block font-semibold">Standaard overnemen</span><span className="block text-[12.5px] text-muted">Je vaste voorkeuren op de dagen die nog leeg zijn.</span></span>
                  </button>
                  {aantal > 0 && (
                    <button type="button" role="menuitem" onClick={() => maakLeeg(maandag)} className="mt-0.5 flex items-center gap-2 rounded-lg border-t border-line px-2 py-1.5 text-left text-[14px] text-muted hover:bg-soft">
                      <Eraser size={14} /> Week leegmaken ({plural(aantal, 'wens', 'wensen')})
                    </button>
                  )}
                </Uitklap>
              )}
            </div>
            {dagen.map((d, j) => {
              if (maandVan(d) !== maand) return <div key={d} aria-hidden />;
              const wens = map.get(d) ?? null, verleden = d < vandaag;
              const dienst = pub && d >= pub.van && d <= pub.tot ? cel(pub.cellen, medewerker.id, d) : null;
              const vl = verlof.find((v) => d >= v.van && d <= v.tot);
              const inRonde = !!ronde && d >= ronde.van && d <= ronde.tot;
              const t = team[d] ?? GEEN_TELLING, ingevuld = t.werken + t.vrij + t.neutraal + t.overig;
              const toonTeam = !verleden && collegas.length > 0;
              return (
                <div key={d} className="relative">
                  <button
                    type="button"
                    disabled={verleden}
                    data-dag={d}
                    onClick={() => setOpen(open === d ? null : d)}
                    aria-haspopup="menu"
                    aria-expanded={open === d}
                    title={`${fmtDag(d)}${dienst && dienst !== '-' ? `, ingeroosterd: ${dienst}` : ''}${wens ? `, wens: ${WENS_LABEL[wens]}` : ''}${vl ? `, verlof ${vl.status}` : ''}${toonTeam ? `\nTeam: ${teamTekst(t, collegas.length)}` : ''}`}
                    className={cx('flex min-h-[64px] w-full flex-col rounded-lg border p-1.5 text-left transition-colors sm:min-h-[82px] sm:p-2', verleden ? 'cursor-default border-transparent opacity-45' : 'border-line hover:border-[color:var(--accent)]', d === vandaag && 'ring-2 ring-[color:var(--teal)]', open === d && 'border-[color:var(--accent)]')}
                    style={{ background: wens ? KLEUR[wens] : 'var(--card)', boxShadow: inRonde ? 'inset 0 3px 0 var(--teal)' : undefined }}
                  >
                    <span className="flex min-w-0 items-baseline justify-between gap-1">
                      <span className="text-[13px] font-bold">{dayOfMonth(toDay(d))}</span>
                      {dienst && dienst !== '-' && <span className={cx('hidden rounded px-1 text-[11.5px] font-semibold leading-4 sm:inline', `c-${dienst}`)}>{dienst}</span>}
                    </span>
                    {/* op een smalle telefoon past de code niet: dan een gekleurd streepje */}
                    {dienst && dienst !== '-' && <span className={cx('mt-1 block h-1.5 w-full rounded-sm sm:hidden', `c-${dienst}`)} aria-hidden />}
                    <span className="mt-auto text-[11px] font-semibold leading-tight sm:text-[12px]">
                      {vl ? <span className="text-muted">Verlof{vl.status === 'aangevraagd' ? '?' : ''}</span> : wens === 'neutraal' ? <><span className="sm:hidden">{KORT.neutraal}</span><span className="hidden sm:inline">Geen voorkeur</span></> : wens ? KORT[wens] : ''}
                    </span>
                    {toonTeam && ingevuld > 0 && <TeamStand t={t} team={collegas.length} />}
                  </button>
                  {open === d && (
                    <Uitklap label={`Wens voor ${fmtDag(d)}`} rechts={j >= 4} onSluit={() => setOpen(null)}>
                      <div className="px-2 pb-1 pt-0.5 text-[12px] font-semibold text-muted">{fmtDag(d)}</div>
                      {soorten.map((s) => (
                        <button key={s} type="button" role="menuitem" onClick={() => { zetWens(medewerker.id, d, s); setOpen(null); }} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[14px] hover:bg-soft">
                          <i className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-line" style={{ background: KLEUR[s] }} />
                          <span className="flex-1">{WENS_LABEL[s]}</span>
                          {wens === s && <Check size={15} aria-label="gekozen" />}
                        </button>
                      ))}
                      {wens && (
                        <button type="button" role="menuitem" onClick={() => { zetWens(medewerker.id, d, null); setOpen(null); }} className="mt-0.5 flex items-center gap-2 rounded-lg border-t border-line px-2 py-1.5 text-left text-[14px] text-muted hover:bg-soft">
                          <X size={14} /> Wens weghalen
                        </button>
                      )}
                      {toonTeam && (
                        <div className="mt-0.5 flex items-start gap-2 border-t border-line px-2 pb-1 pt-2 text-[12.5px] leading-snug text-muted" data-testid="team-stand">
                          <Users size={14} className="mt-0.5 shrink-0" aria-hidden />
                          <span><b className="font-semibold text-ink">Je team:</b> {teamTekst(t, collegas.length)}.</span>
                        </div>
                      )}
                    </Uitklap>
                  )}
                </div>
              );
            })}
          </Fragment>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
        {soorten.map((w) => <span key={w} className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm border border-line" style={{ background: KLEUR[w] }} />{WENS_LABEL[w]}</span>)}
        <span>De code rechtsboven (op de telefoon het gekleurde streepje) is je gepubliceerde dienst.</span>
        {ronde && <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm border border-line" style={{ boxShadow: 'inset 0 3px 0 var(--teal)' }} />periode van de voorkeurenronde</span>}
      </div>
      {collegas.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><Users size={14} aria-hidden /> Je team ({plural(collegas.length, 'collega', "collega's")} in {medewerker.regio}):</span>
          {TEAM.map((x) => <span key={x.sleutel} className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: x.kleur }} />{x.meer}</span>)}
          <span>Onderaan elke dag staat hoeveel collega&apos;s dat al hebben opgegeven (op de telefoon een balkje; tik op de dag voor de aantallen). Je ziet alleen aantallen, geen namen.</span>
        </div>
      )}
    </div>
  );
}

/** Wat de collega's voor deze dag hebben opgegeven: op een breed scherm de aantallen, op de telefoon een balkje. */
function TeamStand({ t, team }: { t: WensTelling; team: number }) {
  const open = Math.max(0, team - t.werken - t.vrij - t.neutraal - t.overig);
  return (
    <span className="mt-1 block" aria-hidden data-testid="team-telling">
      <span className="hidden items-center gap-x-1.5 text-[11.5px] font-semibold leading-none sm:flex">
        {TEAM.map((x) => (
          <span key={x.sleutel} className={cx('inline-flex items-center gap-0.5', !t[x.sleutel] && 'opacity-40')}>
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: x.kleur, boxShadow: '0 0 0 1px var(--card)' }} />{t[x.sleutel]}
          </span>
        ))}
      </span>
      <span className="flex h-1.5 w-full overflow-hidden rounded-sm sm:hidden" style={{ background: 'var(--card)', boxShadow: '0 0 0 1px var(--line)' }}>
        {TEAM.map((x) => (t[x.sleutel] ? <i key={x.sleutel} className="block h-full" style={{ background: x.kleur, flexGrow: t[x.sleutel] }} /> : null))}
        {open > 0 && <i className="block h-full" style={{ flexGrow: open }} />}
      </span>
    </span>
  );
}

/** Een keuzelijstje onder de dag of het weeknummer; Escape of ernaast tikken sluit het. */
function Uitklap({ label, rechts, breed, onSluit, children }: { label: string; rechts: boolean; breed?: boolean; onSluit: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const weg = (e: PointerEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onSluit(); };
    const toets = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit(); };
    document.addEventListener('pointerdown', weg);
    document.addEventListener('keydown', toets);
    return () => { document.removeEventListener('pointerdown', weg); document.removeEventListener('keydown', toets); };
  }, [onSluit]);
  return (
    <div ref={ref} role="menu" aria-label={label} className={cx('absolute top-full z-20 mt-1 grid gap-0.5 rounded-xl border border-line bg-card p-1.5 shadow-lg', breed ? 'w-60' : 'w-52', rechts ? 'right-0' : 'left-0')}>
      {children}
    </div>
  );
}
