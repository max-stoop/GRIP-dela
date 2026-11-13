'use client';
import { useEffect, useState } from 'react';
import { useConcept, vasteJson } from '@/lib/concept';
import { Copy, Save } from 'lucide-react';
import { Groep, Segment, Veld } from '@/components/ui';
import { useActie } from '@/components/toast';
import { bewaarProfiel, useApp } from '@/lib/store/store';
import { DAG_KORT, DAG_LANG, fmtMoment, isoWeek, toDay, todayIso } from '@/lib/dates';
import { tijdvakken } from '@/lib/nbd/parameters';
import { maxUren } from '@/lib/nbd/capaciteit';
import { AANTAL_VAKKEN, graagUren, leegPatroon, leegUren, metDienst, SNELDIENSTEN, weektype, zetVak, type UurKeuze, type Weektype } from '@/lib/nbd/voorkeuren';
import { uurTekst } from '@/lib/rooster/tijden';
import { cx, nlUren } from '@/lib/format';
import type { DagVoorkeur, Medewerker, UurVoorkeuren } from '@/lib/rooster/types';

/** Maandag eerst. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export const UUR_KEUZE: Record<UurKeuze, { label: string; kleur: string }> = {
  g: { label: 'Graag', kleur: 'color-mix(in srgb, var(--teal) 55%, var(--card))' },
  n: { label: 'Kan niet', kleur: 'color-mix(in srgb, var(--red) 45%, var(--card))' },
  '.': { label: 'Geen voorkeur', kleur: 'var(--soft)' },
};

const VAK = tijdvakken();
const vakTekst = (i: number) => `${uurTekst(VAK[i].van)}–${uurTekst(VAK[i].tot)}`;

/** Alles behalve 'kan niet'. */
function beschikbareUren(uren: UurVoorkeuren, type: Weektype): number {
  return uren[type].reduce((a, rij) => a + [...rij].reduce((b, c, i) => b + (c !== 'n' ? VAK[i].tot - VAK[i].van : 0), 0), 0);
}

/** De weekdagen afgeleid van de uren: een dag die in geen enkele week kan, is 'kan niet'; met graag-uren 'graag'. */
function dagenUit(uren: UurVoorkeuren): DagVoorkeur[] {
  return Array.from({ length: 7 }, (_, wd) => {
    const rijen = [uren.even[wd], uren.oneven[wd]];
    if (rijen.every((r) => !r.includes('g') && !r.includes('.'))) return 'niet';
    return rijen.some((r) => r.includes('g')) ? 'graag' : 'neutraal';
  });
}

export function UurVoorkeurEditor(props: { medewerker: Medewerker; onOpgeslagen?: () => void }) {
  // een andere medewerker is een nieuw formulier
  return <UurVoorkeurFormulier key={props.medewerker.id} {...props} />;
}

interface Invoer { uren: UurVoorkeuren; maxDagen: number | null; opmerking: string }
const verschillen = (u: UurVoorkeuren) => JSON.stringify(u.even) !== JSON.stringify(u.oneven);

function UurVoorkeurFormulier({ medewerker, onOpgeslagen }: { medewerker: Medewerker; onOpgeslagen?: () => void }) {
  const actie = useActie();
  const opgeslagen = useApp((x) => x.profielen[medewerker.id]) ?? null;
  // de invoer blijft staan tot je opslaat, ook als de app intussen gegevens van collega's bijleest
  // de toelichting zoals hij wordt bewaard (zonder spaties eromheen): na opslaan staat er dan niets meer open
  const { waarde: invoer, zet: setInvoer, versie } = useConcept<Invoer>({ uren: opgeslagen?.uren ?? leegUren(), maxDagen: opgeslagen?.maxDagenPerWeek ?? null, opmerking: opgeslagen?.opmerking ?? '' }, (x) => vasteJson({ ...x, opmerking: x.opmerking.trim() }));
  const { uren, maxDagen, opmerking } = invoer;
  const setUren = (f: (u: UurVoorkeuren) => UurVoorkeuren) => setInvoer((x) => ({ ...x, uren: f(x.uren) }));
  const setMaxDagen = (v: number | null) => setInvoer((x) => ({ ...x, maxDagen: v }));
  const setOpmerking = (v: string) => setInvoer((x) => ({ ...x, opmerking: v }));
  const [apart, setApart] = useState(() => verschillen(invoer.uren));
  const [type, setType] = useState<Weektype>('even');
  const [verf, setVerf] = useState<UurKeuze>('g');
  const [sleep, setSleep] = useState<UurKeuze | null>(null);
  // een nieuwe opgeslagen versie overgenomen: even en oneven opnieuw bepalen
  useEffect(() => { if (versie) setApart(verschillen(invoer.uren)); }, [versie]); // eslint-disable-line react-hooks/exhaustive-deps
  // slepen stopt ook als de muis buiten het rooster wordt losgelaten
  useEffect(() => {
    const los = () => setSleep(null);
    window.addEventListener('pointerup', los);
    return () => window.removeEventListener('pointerup', los);
  }, []);

  const toon: Weektype = apart ? type : 'even';
  const patroon = uren[toon];
  /** In de getoonde week, of in beide als ze gelijk zijn. */
  const zetDag = (wd: number, rij: string) => {
    setUren((u) => {
      const zet = (p: string[]) => p.map((r, i) => (i === wd ? rij : r));
      return apart ? { ...u, [toon]: zet(u[toon]) } : { even: zet(u.even), oneven: zet(u.even) };
    });
  };
  const verfVak = (wd: number, vak: number, keuze: UurKeuze) => zetDag(wd, zetVak(patroon[wd], vak, keuze));
  const snel = (wd: number, wat: string) => {
    if (!wat) return;
    const leeg = '.'.repeat(AANTAL_VAKKEN);
    if (wat === 'heel') zetDag(wd, 'g'.repeat(AANTAL_VAKKEN));
    else if (wat === 'niet') zetDag(wd, 'n'.repeat(AANTAL_VAKKEN));
    else if (wat === 'wis') zetDag(wd, leeg);
    else {
      const d = SNELDIENSTEN.find((x) => x.naam === wat);
      if (d) zetDag(wd, metDienst(leeg, d.van, d.tot));
    }
  };
  const kopieerWerkdagen = () => { for (const wd of [2, 3, 4, 5]) zetDag(wd, patroon[1]); };
  const wisselApart = (aan: boolean) => {
    setApart(aan);
    // weer gelijk: de getoonde week geldt voor beide
    if (!aan) setUren((u) => ({ even: [...u[toon]], oneven: [...u[toon]] }));
  };

  const vandaag = todayIso();
  const nu = weektype(vandaag);
  const graag = { even: graagUren(uren, 'even'), oneven: graagUren(uren, 'oneven') };
  const kan = { even: beschikbareUren(uren, 'even'), oneven: beschikbareUren(uren, 'oneven') };
  const contract = medewerker.contract;
  const krap = Math.min(kan.even, kan.oneven) < contract;
  const gewijzigd = JSON.stringify(uren) !== JSON.stringify(opgeslagen?.uren ?? null) || maxDagen !== (opgeslagen?.maxDagenPerWeek ?? null) || opmerking.trim() !== (opgeslagen?.opmerking ?? '');

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        actie(() => {
          bewaarProfiel(medewerker.id, { uren, dagen: dagenUit(uren), dienst: 'geen', maxDagenPerWeek: maxDagen, opmerking: opmerking.trim() || undefined });
          onOpgeslagen?.();
        }, 'Voorkeuren opgeslagen.');
      }}
    >
      <div className="flex flex-wrap items-end gap-4">
        <Groep label="Invullen met">
          <Segment label="Invullen met" waarde={verf} onChange={setVerf} opties={[['g', 'Graag'], ['n', 'Kan niet'], ['.', 'Geen voorkeur']]} />
        </Groep>
        <label className="flex items-center gap-2 text-[14.5px]">
          <input type="checkbox" className="h-4 w-4 accent-[color:var(--teal)]" checked={apart} onChange={(e) => wisselApart(e.target.checked)} />
          Even en oneven weken verschillen
        </label>
        {apart && (
          <Groep label="Week">
            <Segment label="Week" waarde={type} onChange={setType} opties={[['even', 'Even weken'], ['oneven', 'Oneven weken']]} />
          </Groep>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-muted">{apart ? `${toon === 'even' ? 'Even' : 'Oneven'} weken` : 'Elke week'} <span className="font-normal">· tik of sleep over de uren; de desk is open van 7:00 tot 22:30</span></span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={kopieerWerkdagen}><Copy size={14} /> Maandag ook voor di t/m vr</button>
        </div>
        <div className="scroll">
          <table className="uurraster" onPointerLeave={() => setSleep(null)}>
            <thead>
              <tr>
                <th className="dag" />
                {VAK.map((v, i) => <th key={i} title={vakTekst(i)}>{v.van}</th>)}
                <th className="snel"><span className="sr-only">Snel invullen</span></th>
              </tr>
            </thead>
            <tbody>
              {WEEK.map((wd) => (
                <tr key={wd}>
                  <th className="dag" scope="row">{DAG_KORT[wd]}</th>
                  {[...patroon[wd]].map((c, i) => {
                    const k = c as UurKeuze;
                    return (
                      <td key={i} className={cx(i === AANTAL_VAKKEN - 1 && 'half')}>
                        <button
                          type="button"
                          className="vak"
                          style={{ background: UUR_KEUZE[k].kleur }}
                          aria-label={`${DAG_LANG[wd]} ${vakTekst(i)}: ${UUR_KEUZE[k].label}`}
                          title={`${DAG_LANG[wd]} ${vakTekst(i)}: ${UUR_KEUZE[k].label}`}
                          onPointerDown={(e) => { e.preventDefault(); const w = k === verf ? '.' : verf; setSleep(w); verfVak(wd, i, w); }}
                          onPointerEnter={() => { if (sleep) verfVak(wd, i, sleep); }}
                          onClick={(e) => { if (e.detail === 0) verfVak(wd, i, k === verf ? '.' : verf); }}
                        >
                          {k === 'n' ? '×' : ''}
                        </button>
                      </td>
                    );
                  })}
                  <td className="snel">
                    <select className="input input-sm" value="" onChange={(e) => snel(wd, e.target.value)} aria-label={`${DAG_LANG[wd]} snel invullen`}>
                      <option value="">Snel…</option>
                      {SNELDIENSTEN.map((d) => <option key={d.naam} value={d.naam}>{d.naam} {uurTekst(d.van)}–{uurTekst(d.tot)}</option>)}
                      <option value="heel">Hele dag graag</option>
                      <option value="niet">Hele dag kan niet</option>
                      <option value="wis">Wissen</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
          {(['g', 'n', '.'] as UurKeuze[]).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm border border-line" style={{ background: UUR_KEUZE[k].kleur }} />{UUR_KEUZE[k].label}</span>)}
          <span>Deze week (week {isoWeek(toDay(vandaag))}) is een {nu} week.</span>
        </div>
      </div>

      <div className="grid gap-1 rounded-lg bg-soft p-3 text-[14.5px]">
        <div>Graag: <b>{nlUren(graag.even)}</b> uur per week{apart ? <> in even weken, <b>{nlUren(graag.oneven)}</b> in oneven weken</> : null}. Contract {nlUren(contract)} uur{maxUren(medewerker) > contract ? `, maximaal ${nlUren(maxUren(medewerker))}` : ''}.</div>
        {krap
          ? <div className="text-rood">Op de uren die wel kunnen, past het contract niet ({nlUren(Math.min(kan.even, kan.oneven))} uur). Overleg dit met de planner.</div>
          : Math.min(graag.even, graag.oneven) < contract
          ? <div className="note">Minder graag-uren dan het contract: het rooster kan ook uren zonder voorkeur gebruiken, nooit uren die niet kunnen.</div>
          : <div className="note">Het rooster zoekt de graag-uren op en plant nooit op uren die niet kunnen.</div>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Veld label="Liefst niet meer dan">
          <select className="input w-auto" value={maxDagen ?? ''} onChange={(e) => setMaxDagen(e.target.value ? Number(e.target.value) : null)}>
            <option value="">geen voorkeur</option>
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} dagen per week</option>)}
          </select>
        </Veld>
        <Veld label="Toelichting (optioneel)">
          <input className="input" value={opmerking} maxLength={200} onChange={(e) => setOpmerking(e.target.value)} placeholder="Bijvoorbeeld: dinsdag studiedag" />
        </Veld>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={!gewijzigd}><Save size={16} /> Voorkeuren opslaan</button>
        {opgeslagen?.bijgewerkt && <span className="note">Laatst opgeslagen {fmtMoment(opgeslagen.bijgewerkt)}</span>}
      </div>
    </form>
  );
}

/** Eén week, voor in tabellen. */
export function UurPatroonMini({ uren, type }: { uren: UurVoorkeuren | undefined; type: Weektype }) {
  const patroon = uren?.[type] ?? leegPatroon();
  return (
    <span className="grid gap-px" aria-hidden style={{ gridTemplateColumns: `repeat(${AANTAL_VAKKEN}, 5px)` }}>
      {WEEK.flatMap((wd) => [...patroon[wd]].map((c, i) => <i key={`${wd}-${i}`} className="block h-[5px] w-[5px]" style={{ background: c === '.' ? 'var(--line)' : UUR_KEUZE[c as UurKeuze].kleur }} />))}
    </span>
  );
}

export function uurSamenvatting(uren: UurVoorkeuren | undefined) {
  if (!uren) return null;
  const niet = (t: Weektype) => uren[t].reduce((a, rij) => a + [...rij].reduce((b, c, i) => b + (c === 'n' ? VAK[i].tot - VAK[i].van : 0), 0), 0);
  return { graag: { even: graagUren(uren, 'even'), oneven: graagUren(uren, 'oneven') }, niet: { even: niet('even'), oneven: niet('oneven') } };
}
