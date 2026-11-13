'use client';
/** Voor de regio's en de NBD; de beoordeling per aanvraag verschilt (plekken of uren aan de telefoon) en komt als kaart mee. */
import { useMemo, useState, type ComponentType } from 'react';
import { CalendarPlus, Check, X, Undo2 } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { AlleenRegiomanager } from '@/components/Rechten';
import { useActie } from '@/components/toast';
import { Leeg, Modal, Pill, Segment, Veld } from '@/components/ui';
import { beoordeelVerlof, trekVerlofIn, useApp, vraagVerlofAan } from '@/lib/store/store';
import { useBehoefte } from '@/lib/store/hooks';
import { inLopendeRonde, VERLOF_SOORT, type Verlof, type VerlofSoort, type VerlofStatus } from '@/lib/store/types';
import { AdviesRegel, useAanvraagAdvies } from '@/components/verlof/Verlofplanning';
import { DAG_KORT, fmtD, fmtDJ, fmtMoment, isoRange, isWeekend, toDay, todayIso, weekday } from '@/lib/dates';
import { DIENSTEN, WENS_LABEL, wensGehonoreerd } from '@/lib/rooster/diensten';
import { cel } from '@/lib/rooster/toets';
import type { Medewerker } from '@/lib/rooster/types';
import { cx, plural } from '@/lib/format';
import { inRooster, opVolgorde } from '@/lib/rooster/types';

export const STATUS: Record<VerlofStatus, [React.ComponentProps<typeof Pill>['soort'], string]> = {
  aangevraagd: ['warn', 'Aangevraagd'], goedgekeurd: ['ok', 'Goedgekeurd'], afgewezen: ['bad', 'Afgewezen'], ingetrokken: ['neutral', 'Ingetrokken'],
};

export function werkdagen(van: string, tot: string) {
  return isoRange(van, tot).filter((d) => !isWeekend(toDay(d))).length;
}

/** Een aanvraag beoordelen: wie, wanneer, de ruimte en de dekking per dag. */
export type AanvraagKaartProps = { v: Verlof; mw?: Medewerker; onGoed: () => void; onAf: () => void };

export function TeBeoordelen({ regios, kaart: Kaart = AanvraagKaart }: { regios: string[]; kaart?: ComponentType<AanvraagKaartProps> }) {
  const door = useDoor();
  const actie = useActie();
  const lijst = useApp((x) => x.verlof.filter((v) => v.status === 'aangevraagd' && !inLopendeRonde(v, x.vakantierondes) && regios.includes(v.regio)));
  const inRonde = useApp((x) => x.verlof.filter((v) => v.status === 'aangevraagd' && inLopendeRonde(v, x.vakantierondes) && regios.includes(v.regio)).length);
  const medewerkers = useApp((x) => x.medewerkers);
  const [afwijzen, setAfwijzen] = useState<Verlof | null>(null);
  const [reden, setReden] = useState('');
  const rondeNoot = inRonde > 0 && <p className="note">{plural(inRonde, 'aanvraag valt', 'aanvragen vallen')} in een vakantieronde en {inRonde === 1 ? 'wordt' : 'worden'} daar samen beoordeeld (tab Vakantieronde).</p>;
  if (!lijst.length) return <><Leeg titel="Niets te beoordelen" icoon={<Check size={28} />}>Alle losse verlofaanvragen in deze selectie zijn afgehandeld.</Leeg>{rondeNoot}</>;
  return (
    <div className="grid gap-4">
      {rondeNoot}
      {lijst.sort((a, b) => a.van.localeCompare(b.van)).map((v) => (
        <Kaart key={v.id} v={v} mw={medewerkers.find((m) => m.id === v.medewerkerId)}
          onGoed={() => actie(() => beoordeelVerlof(v.id, 'goedgekeurd', door), 'Verlof goedgekeurd en in het rooster gezet.')}
          onAf={() => { setAfwijzen(v); setReden(''); }} />
      ))}
      <Modal open={!!afwijzen} onClose={() => setAfwijzen(null)} titel="Verlof afwijzen" voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => setAfwijzen(null)}>Annuleren</button>
        <button type="button" className="btn btn-danger" onClick={() => { actie(() => beoordeelVerlof(afwijzen!.id, 'afgewezen', door, reden.trim() || undefined), 'Verlof afgewezen.'); setAfwijzen(null); }}><X size={16} /> Afwijzen</button>
      </>}>
        <Veld label="Reden (de medewerker ziet deze)"><textarea className="input min-h-[80px]" autoFocus value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Bijvoorbeeld: al twee collega's afwezig in die week" /></Veld>
      </Modal>
    </div>
  );
}

function AanvraagKaart({ v, mw, onGoed, onAf }: AanvraagKaartProps) {
  const magBesluiten = useSessie().mag('verlof.besluiten');
  const cellen = useApp((x) => x.rooster[v.regio]) ?? {};
  const team = useApp((x) => x.medewerkers.filter((m) => m.regio === v.regio && inRooster(m)));
  const ander = useApp((x) => x.verlof.filter((o) => o.regio === v.regio && o.id !== v.id && o.status === 'goedgekeurd' && o.van <= v.tot && o.tot >= v.van));
  const dagen = useMemo(() => isoRange(v.van, v.tot), [v.van, v.tot]);
  const { behoefte } = useBehoefte(v.regio, dagen, 'basis');
  const advies = useAanvraagAdvies(v);
  const impact = dagen.map((d) => {
    const p = team.reduce((a, e) => a + DIENSTEN[cel(cellen, e.id, d)].plekken, 0);
    const eigen = mw ? DIENSTEN[cel(cellen, mw.id, d)] : DIENSTEN['-'];
    const na = p - eigen.plekken, k = behoefte[d]?.k ?? null;
    const afwezig = ander.filter((o) => d >= o.van && d <= o.tot).length;
    // een dag zonder enige dienst is nog niet geroosterd: dan zegt 0 plekken niets over een tekort
    const geroosterd = team.some((e) => cel(cellen, e.id, d) !== '-');
    return { d, p, na, k, werk: eigen.werk, afwezig, geroosterd, door: eigen.plekken > 0 };
  });
  const tekortDag = (i: (typeof impact)[number]) => i.geroosterd && i.k != null && i.na < i.k;
  const tekortDoor = impact.filter((i) => tekortDag(i) && i.door).length;
  const tekortAl = impact.filter((i) => tekortDag(i) && !i.door).length;
  const ongeroosterd = impact.filter((i) => !i.geroosterd).length;
  const ingeroosterd = impact.filter((i) => i.werk).length;
  return (
    <div className="box">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{mw?.naam ?? 'Onbekend'} <span className="note font-normal">· {v.regio}</span></div>
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
          {tekortDoor ? <Pill soort="bad">Tekort op {plural(tekortDoor, 'dag', 'dagen')} door deze aanvraag</Pill> : ongeroosterd === impact.length ? <Pill soort="info">Rooster nog niet gemaakt; oordeel op de verlofruimte</Pill> : <Pill soort="ok">Dekking blijft op orde</Pill>}
          {tekortAl > 0 && <Pill soort="warn">{plural(tekortAl, 'dag', 'dagen')} al tekort, los van deze aanvraag</Pill>}
          {ongeroosterd > 0 && ongeroosterd < impact.length && <Pill soort="neutral">{plural(ongeroosterd, 'dag', 'dagen')} nog niet geroosterd</Pill>}
          {ongeroosterd < impact.length && <Pill soort="neutral">{ingeroosterd ? `${plural(ingeroosterd, 'dienst vervalt', 'diensten vervallen')}` : 'Niet ingeroosterd in deze periode'}</Pill>}
          {ander.length > 0 && <Pill soort="warn">{plural(ander.length, 'collega', 'collega\'s')} ook met verlof</Pill>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {impact.map((i) => (
            <div
              key={i.d}
              className={cx('min-w-[64px] rounded-lg border px-2 py-1 text-center text-[13px]', i.k == null || !i.geroosterd ? 'border-dashed border-line text-muted' : tekortDag(i) ? (i.door ? 'border-rood' : 'border-gold') : 'border-line')}
              style={tekortDag(i) && i.door ? { background: 'color-mix(in srgb, var(--red) 8%, var(--card))' } : undefined}
              title={i.k == null ? 'Geen voorspelling voor deze dag' : !i.geroosterd ? `Nog geen rooster; afgesproken ${i.k} plekken` : `${i.na} van ${i.k} plekken na goedkeuren${i.afwezig ? `, ${i.afwezig} anderen afwezig` : ''}`}
            >
              <div className="font-semibold">{DAG_KORT[weekday(toDay(i.d))]} {i.d.slice(8)}</div>
              <div className="num">{i.k == null ? '–' : !i.geroosterd ? `–/${i.k}` : `${i.na}/${i.k}`}</div>
            </div>
          ))}
        </div>
        <p className="note mt-2">Per dag: regelplekken na goedkeuren / afgesproken. Per week: verlofruimte uit de vastgestelde regelplekken, na goedgekeurd verlof.</p>
      </div>
    </div>
  );
}

export function AlleVerlof({ regios }: { regios: string[] }) {
  const magBesluiten = useSessie().mag('verlof.besluiten');
  const door = useDoor();
  const actie = useActie();
  const [status, setStatus] = useState<VerlofStatus | 'alle'>('goedgekeurd');
  const vandaag = todayIso();
  const lijst = useApp((x) => x.verlof.filter((v) => regios.includes(v.regio) && (status === 'alle' || v.status === status)));
  const medewerkers = useApp((x) => x.medewerkers);
  return (
    <>
      <div className="mb-3"><Segment label="Status" waarde={status} onChange={setStatus} opties={[['goedgekeurd', 'Goedgekeurd'], ['aangevraagd', 'Aangevraagd'], ['afgewezen', 'Afgewezen'], ['alle', 'Alles']]} /></div>
      {lijst.length ? (
        <div className="scroll">
          <table className="tb">
            <thead><tr><th>Medewerker</th><th>Regio</th><th>Periode</th><th>Soort</th><th>Status</th><th>Beoordeeld</th><th /></tr></thead>
            <tbody>
              {lijst.sort((a, b) => a.van.localeCompare(b.van)).map((v) => (
                <tr key={v.id}>
                  <td className="font-semibold">{medewerkers.find((m) => m.id === v.medewerkerId)?.naam ?? '–'}</td>
                  <td>{v.regio}</td>
                  <td className="whitespace-nowrap">{fmtD(v.van)}{v.tot !== v.van ? ` t/m ${fmtD(v.tot)}` : ''}</td>
                  <td>{VERLOF_SOORT[v.soort]}</td>
                  <td><Pill soort={STATUS[v.status][0]}>{STATUS[v.status][1]}</Pill></td>
                  <td className="note">{v.beoordeeld ? `${fmtMoment(v.beoordeeld)}${v.beoordeelaar && v.beoordeelaar !== 'demo' ? ` · ${v.beoordeelaar}` : ''}` : ''}{v.reden ? ` · ${v.reden}` : ''}</td>
                  <td className="r">{v.status === 'goedgekeurd' && v.tot >= vandaag && magBesluiten && <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(() => trekVerlofIn(v.id, door), 'Verlof ingetrokken; de oorspronkelijke diensten staan weer in het rooster.')}><Undo2 size={14} /> Intrekken</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Leeg titel="Geen verlof in deze selectie" />}
    </>
  );
}

export function WensenOverzicht({ regios }: { regios: string[] }) {
  const vandaag = todayIso();
  // "geen voorkeur" is geen wens om te honoreren: die staat niet in dit overzicht
  const wensen = useApp((x) => x.wensen.filter((w) => regios.includes(w.regio) && w.datum >= vandaag && w.soort !== 'neutraal'));
  const medewerkers = useApp((x) => x.medewerkers);
  const rooster = useApp((x) => x.rooster);
  if (!wensen.length) return <Leeg titel="Geen wensen">Er zijn geen wensen doorgegeven voor de komende periode.</Leeg>;
  const rijen = wensen.sort((a, b) => a.datum.localeCompare(b.datum)).map((w) => {
    const s = cel(rooster[w.regio] ?? {}, w.medewerkerId, w.datum);
    return { w, s, ok: wensGehonoreerd(w.soort, s) };
  });
  const ok = rijen.filter((r) => r.ok !== false).length;
  return (
    <>
      <p className="lead mb-3">{ok} van {rijen.length} wensen passen in het huidige rooster.</p>
      <div className="scroll">
        <table className="tb">
          <thead><tr><th>Datum</th><th>Medewerker</th><th>Regio</th><th>Wens</th><th>In het rooster</th><th /></tr></thead>
          <tbody>
            {rijen.map(({ w, s, ok }) => (
              <tr key={w.id}>
                <td className="whitespace-nowrap">{DAG_KORT[weekday(toDay(w.datum))]} {fmtD(w.datum)}</td>
                <td className="font-semibold">{medewerkers.find((m) => m.id === w.medewerkerId)?.naam}</td>
                <td>{w.regio}</td>
                <td>{WENS_LABEL[w.soort]}{w.opmerking ? <span className="note"> · {w.opmerking}</span> : null}</td>
                <td><span className={cx('inline-block min-w-[34px] rounded px-1.5 py-0.5 text-center text-[12.5px] font-semibold', `c-${s}`)}>{s === '-' ? 'vrij' : s}</span></td>
                <td>{ok === false ? <Pill soort="warn">Niet gehonoreerd</Pill> : <Pill soort="ok">Past</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function VerlofInvoeren({ regios }: { regios: string[] }) {
  const magBesluiten = useSessie().mag('verlof.besluiten');
  const door = useDoor();
  const actie = useActie();
  const vandaag = todayIso();
  const medewerkers = useApp((x) => x.medewerkers.filter((m) => inRooster(m) && regios.includes(m.regio)).sort((a, b) => a.regio.localeCompare(b.regio) || opVolgorde(a, b)));
  const [keuze, setF] = useState({ mid: '', van: vandaag, tot: vandaag, soort: 'vakantie' as VerlofSoort, opmerking: '', direct: true });
  const f = { ...keuze, direct: keuze.direct && magBesluiten };
  return (
    <form
      className="box grid max-w-xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        actie(() => {
          const v = vraagVerlofAan({ medewerkerId: f.mid, van: f.van, tot: f.tot, soort: f.soort, opmerking: f.opmerking.trim() || undefined }, door, { planner: true });
          if (f.direct) beoordeelVerlof(v.id, 'goedgekeurd', door);
          setF({ ...f, mid: '', opmerking: '' });
        }, f.direct ? 'Verlof ingevoerd en goedgekeurd.' : 'Verlof ingevoerd als aanvraag.');
      }}
    >
      <h2 className="kop-s">Verlof invoeren namens een medewerker</h2>
      <Veld label="Medewerker">
        <select className="input" required value={f.mid} onChange={(e) => setF({ ...f, mid: e.target.value })}>
          <option value="">Kies een medewerker</option>
          {medewerkers.map((m) => <option key={m.id} value={m.id}>{m.naam} · {m.regio}</option>)}
        </select>
      </Veld>
      <div className="grid grid-cols-2 gap-3">
        <Veld label="Van"><input className="input" type="date" required value={f.van} onChange={(e) => setF({ ...f, van: e.target.value, tot: f.tot < e.target.value ? e.target.value : f.tot })} /></Veld>
        <Veld label="Tot en met"><input className="input" type="date" required min={f.van} value={f.tot} onChange={(e) => setF({ ...f, tot: e.target.value })} /></Veld>
      </div>
      <Veld label="Soort">
        <select className="input" value={f.soort} onChange={(e) => setF({ ...f, soort: e.target.value as VerlofSoort })}>
          {Object.entries(VERLOF_SOORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Veld>
      <Veld label="Toelichting (optioneel)"><input className="input" value={f.opmerking} onChange={(e) => setF({ ...f, opmerking: e.target.value })} /></Veld>
      {magBesluiten
        ? <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" className="h-4 w-4 accent-[color:var(--teal)]" checked={f.direct} onChange={(e) => setF({ ...f, direct: e.target.checked })} /> Direct goedkeuren en in het rooster zetten</label>
        : <AlleenRegiomanager wat="Goedkeuren" paragraaf="4.1" />}
      <div><button className="btn btn-teal" disabled={!f.mid || f.tot < f.van}><CalendarPlus size={16} /> Invoeren</button></div>
    </form>
  );
}
