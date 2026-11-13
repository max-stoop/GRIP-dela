'use client';
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Send, Palmtree } from 'lucide-react';
import { Modal, Pill, Segment, Veld } from '@/components/ui';
import { useApp, toetsRuil, zichtbaarRooster } from '@/lib/store/store';
import type { Ruil, RuilStatus, Verlof } from '@/lib/store/types';
import type { RuilToets } from '@/lib/rooster/ruil';
import { DIENSTEN, dienstTijd } from '@/lib/rooster/diensten';
import { cel } from '@/lib/rooster/toets';
import { addDays, fmtD, fmtDag, isoRange, isWeekend, todayIso, toDay } from '@/lib/dates';
import { maandEind, maandVan, volgendeMaand } from '@/lib/rooster/maand';
import { LEGE_CELLEN, type DienstCode, type Medewerker, inRooster } from '@/lib/rooster/types';
import { cx } from '@/lib/format';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { dienstTekst, pauzeTekst, uitTijd } from '@/lib/nbd/dienst';

export const RUIL_STATUS: Record<RuilStatus, [React.ComponentProps<typeof Pill>['soort'], string]> = {
  open: ['info', 'Open'], wacht_planner: ['warn', 'Wacht op planner'], goedgekeurd: ['ok', 'Goedgekeurd'], afgewezen: ['bad', 'Afgewezen'], ingetrokken: ['neutral', 'Ingetrokken'], verlopen: ['neutral', 'Verlopen'],
};

export function Dienst({ code, klein }: { code: DienstCode; klein?: boolean }) {
  return <span className={cx('inline-block rounded px-1.5 text-center font-semibold tabular-nums', klein ? 'min-w-[30px] text-[12.5px]' : 'min-w-[38px] text-[14px] leading-6', `c-${code}`)}>{code === '-' ? 'vrij' : code === 'N' ? 'NBD' : code}</span>;
}

/** De tijden van een NBD-dienst ("09:00–17:30, pauze 13:00–13:30"), of leeg als die er niet zijn. */
function useNbdTijd(mid: string | undefined, datum: string | undefined, metPauze = true): string {
  const t = useApp((x) => (mid && datum ? x.tijden[NBD]?.[mid]?.[datum] : undefined));
  const d = uitTijd(t);
  return d ? (metPauze ? `${dienstTekst(d)}, ${pauzeTekst(d)}` : dienstTekst(d)) : '';
}

export function DienstOmschrijving({ code, mid, datum }: { code: DienstCode; mid: string; datum: string }) {
  const nbd = useNbdTijd(code === 'N' ? mid : undefined, datum);
  const tijd = code === 'N' ? nbd : dienstTijd(code);
  return <>{DIENSTEN[code].naam}{tijd ? `, ${tijd}` : ''}</>;
}

function NbdTijd({ mid, datum }: { mid: string; datum: string }) {
  const t = useNbdTijd(mid, datum, false);
  return t ? <> {t}</> : null;
}

/** "Noord-Holland" of "de NBD" */
export const regioNaam = (regio: string) => (regio === NBD ? `de ${NBD_NAAM.toLowerCase()}` : regio);

/** "12 t/m 16 okt (5 werkdagen)" */
export function periode(van: string, tot?: string) {
  if (!tot || tot === van) return fmtD(van);
  return `${fmtD(van)} t/m ${fmtD(tot)}`;
}

function werkdagen(van: string, tot: string) {
  return isoRange(van, tot).filter((d) => !isWeekend(toDay(d))).length;
}

export function ToetsUitkomst({ t }: { t: RuilToets | undefined }) {
  if (!t) return null;
  if (!t.bevindingen.length) return <div><Pill soort="ok">Geen bezwaren volgens ATW, CAO en dekking</Pill></div>;
  return (
    <ul className="grid gap-1">
      {t.bevindingen.map((b, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <Pill soort={b.ernst === 'hard' ? 'bad' : 'warn'}>{b.ernst === 'hard' ? 'ATW/CAO' : 'Let op'}</Pill>
          <span>{b.tekst}</span>
        </li>
      ))}
    </ul>
  );
}

export function RuilRegel({ r, namen }: { r: Ruil; namen: Record<string, string> }) {
  const a = namen[r.aanbiederId] ?? '?', b = r.ontvangerId ? namen[r.ontvangerId] ?? '?' : null;
  if (r.soort === 'verlof') return (
    <span>
      <b>{a}</b> ruilt verlof <Dienst code="V" klein /> <b>{periode(r.datum, r.tot)}</b> tegen het verlof van <b>{b}</b>, <b>{periode(r.tegenDatum ?? r.datum, r.tegenTot)}</b>
    </span>
  );
  return (
    <span>
      <b>{a}</b> {r.soort === 'aanbieden' ? 'biedt' : 'ruilt'} <Dienst code={r.dienst} klein />{r.dienst === 'N' && <NbdTijd mid={r.status === 'goedgekeurd' && r.ontvangerId ? r.ontvangerId : r.aanbiederId} datum={r.datum} />} van <b>{fmtDag(r.datum)}</b>
      {r.soort === 'ruilen' && r.tegenDatum ? <> {r.tegenDatum === r.datum ? 'tegen de dienst van' : <>tegen <b>{fmtDag(r.tegenDatum)}</b> van</>} <b>{b}</b></> : b ? <> aan <b>{b}</b></> : <> aan collega&apos;s</>}
    </span>
  );
}

export function AanbiedModal({ open, onClose, ik, datum, onVerstuur }: { open: boolean; onClose: () => void; ik: Medewerker; datum: string | null; onVerstuur: (r: { soort: 'aanbieden' | 'ruilen'; datum: string; ontvangerId?: string; tegenDatum?: string; opmerking?: string }) => void }) {
  const [soort, setSoort] = useState<'aanbieden' | 'ruilen'>('aanbieden');
  const [collega, setCollega] = useState('');
  const [tegen, setTegen] = useState('');
  const [opmerking, setOpmerking] = useState('');
  // wat de medewerker ziet: het gepubliceerde rooster (wie plant: het concept)
  const cellen = useApp((x) => zichtbaarRooster(x, ik.regio)) ?? LEGE_CELLEN;
  const team = useApp((x) => x.medewerkers.filter((m) => m.regio === ik.regio && inRooster(m) && m.id !== ik.id)).sort((a, b) => a.naam.localeCompare(b.naam));
  const vandaag = todayIso();
  const opties = useMemo(() => {
    if (!collega || !datum) return [];
    // tot en met de laatste maand waarvoor geroosterd wordt
    return isoRange(addDays(vandaag, 1), maandEind(volgendeMaand(maandVan(vandaag), 3))).filter((d) => {
      const zijn = cel(cellen, collega, d);
      if (!DIENSTEN[zijn].werk) return false;
      // jij moet die dag vrij zijn (niet ziek of met verlof)
      return d === datum || cel(cellen, ik.id, d) === '-';
    });
  }, [collega, datum, cellen, ik.id, vandaag]);
  const mijnDienst = datum ? cel(cellen, ik.id, datum) : '-';
  const nbdTijden = useApp((x) => (ik.regio === NBD ? x.tijden[NBD] : undefined));
  const optieTekst = (mid: string, d: string) => {
    const c = cel(cellen, mid, d), t = c === 'N' ? uitTijd(nbdTijden?.[mid]?.[d]) : null;
    return t ? `NBD ${dienstTekst(t)}` : c;
  };
  const voorbeeld = useMemo(() => {
    if (!datum || soort !== 'ruilen' || !collega || !tegen) return undefined;
    const r: Ruil = { id: 'voorbeeld', regio: ik.regio, soort, aanbiederId: ik.id, datum, dienst: mijnDienst, ontvangerId: collega, tegenDatum: tegen, status: 'open', gemaakt: '' };
    return toetsRuil(r, collega);
  }, [datum, soort, collega, tegen, ik, mijnDienst]);
  const reset = () => { setSoort('aanbieden'); setCollega(''); setTegen(''); setOpmerking(''); };
  if (!datum) return null;
  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      titel={<>Dienst <Dienst code={mijnDienst} /> van {fmtDag(datum)}</>}
      voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => { reset(); onClose(); }}>Annuleren</button>
        <button type="button" className="btn btn-teal" disabled={soort === 'ruilen' && (!collega || !tegen)} onClick={() => { onVerstuur({ soort, datum, ontvangerId: soort === 'ruilen' ? collega : undefined, tegenDatum: soort === 'ruilen' ? tegen : undefined, opmerking: opmerking.trim() || undefined }); reset(); }}>
          {soort === 'aanbieden' ? <Send size={16} /> : <ArrowLeftRight size={16} />} {soort === 'aanbieden' ? 'Aanbieden' : 'Ruilverzoek sturen'}
        </button>
      </>}
    >
      <div className="grid gap-4">
        <p className="note"><DienstOmschrijving code={mijnDienst} mid={ik.id} datum={datum} />.</p>
        <Segment label="Soort" waarde={soort} onChange={setSoort} opties={[['aanbieden', "Aanbieden aan collega's"], ['ruilen', 'Ruilen met een collega']]} />
        {soort === 'aanbieden' ? (
          <p className="text-[15px]">Iedereen in {regioNaam(ik.regio)} ziet je aanbod en kan het overnemen. Daarna keurt de planner het goed; de toets op ATW en CAO gebeurt automatisch.</p>
        ) : (
          <>
            <Veld label="Collega">
              <select className="input" value={collega} onChange={(e) => { setCollega(e.target.value); setTegen(''); }}>
                <option value="">Kies een collega</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
              </select>
            </Veld>
            {collega && (
              <Veld label="Welke dienst neem jij terug?" hint={opties.length ? undefined : 'Deze collega heeft geen dienst op een dag dat jij vrij bent.'}>
                <select className="input" value={tegen} onChange={(e) => setTegen(e.target.value)}>
                  <option value="">Kies een dienst</option>
                  {opties.map((d) => <option key={d} value={d}>{fmtDag(d)} · {optieTekst(collega, d)}{d === datum ? ' (zelfde dag, diensten wisselen)' : ''}</option>)}
                </select>
              </Veld>
            )}
            {voorbeeld && <div><div className="mb-1.5 text-sm font-semibold text-muted">Toets vooraf</div><ToetsUitkomst t={voorbeeld} /></div>}
          </>
        )}
        <Veld label="Toelichting (optioneel)"><input className="input" value={opmerking} onChange={(e) => setOpmerking(e.target.value)} maxLength={200} /></Veld>
      </div>
    </Modal>
  );
}

export function VerlofRuilModal({ open, onClose, ik, verlof, onVerstuur }: { open: boolean; onClose: () => void; ik: Medewerker; verlof: Verlof | null; onVerstuur: (r: { tegenVerlofId: string; ontvangerId: string; opmerking?: string }) => void }) {
  const [tegen, setTegen] = useState('');
  const [opmerking, setOpmerking] = useState('');
  const vandaag = todayIso();
  const alleVerlof = useApp((x) => x.verlof);
  const medewerkers = useApp((x) => x.medewerkers);
  const ruil = useApp((x) => x.ruil);
  const naam = useMemo(() => Object.fromEntries(medewerkers.map((m) => [m.id, m.naam])), [medewerkers]);
  const opties = useMemo(() => {
    if (!verlof) return [];
    const lopend = new Set(ruil.filter((r) => r.soort === 'verlof' && ['open', 'wacht_planner'].includes(r.status)).flatMap((r) => [r.verlofId, r.tegenVerlofId]));
    const functie = (id: string) => medewerkers.find((m) => m.id === id)?.functie ?? 'UV';
    return alleVerlof
      .filter((v) => v.regio === ik.regio && v.medewerkerId !== ik.id && v.status === 'goedgekeurd' && v.van > vandaag && !lopend.has(v.id) && functie(v.medewerkerId) === (ik.functie ?? 'UV') && medewerkers.find((m) => m.id === v.medewerkerId)?.actief)
      .sort((a, b) => a.van.localeCompare(b.van));
  }, [verlof, alleVerlof, ruil, medewerkers, ik, vandaag]);
  const gekozen = opties.find((v) => v.id === tegen);
  const voorbeeld = useMemo(() => {
    if (!verlof || !gekozen) return undefined;
    const r: Ruil = { id: 'voorbeeld', regio: ik.regio, soort: 'verlof', aanbiederId: ik.id, datum: verlof.van, dienst: 'V', ontvangerId: gekozen.medewerkerId, tegenDatum: gekozen.van, tegenDienst: 'V', verlofId: verlof.id, tegenVerlofId: gekozen.id, status: 'open', gemaakt: '' };
    return toetsRuil(r, gekozen.medewerkerId);
  }, [verlof, gekozen, ik]);
  const reset = () => { setTegen(''); setOpmerking(''); };
  if (!verlof) return null;
  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      titel={<>Verlof <Dienst code="V" /> {periode(verlof.van, verlof.tot)} ruilen</>}
      voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => { reset(); onClose(); }}>Annuleren</button>
        <button type="button" className="btn btn-teal" disabled={!gekozen || (voorbeeld && !voorbeeld.ok)} onClick={() => { onVerstuur({ tegenVerlofId: gekozen!.id, ontvangerId: gekozen!.medewerkerId, opmerking: opmerking.trim() || undefined }); reset(); }}>
          <ArrowLeftRight size={16} /> Ruilverzoek sturen
        </button>
      </>}
    >
      <div className="grid gap-4">
        <p className="text-[15px]">Je ruilt je verlofperiode met die van een collega. In beide periodes nemen jullie elkaars rooster over, dus de bezetting in je regio blijft gelijk. Je collega moet akkoord geven en daarna keurt de planner het goed (roosterbeleid § 4.3).</p>
        <Veld label="Verlof van een collega" hint={opties.length ? 'Alleen goedgekeurd verlof dat nog moet beginnen, van collega’s met dezelfde functie.' : 'Er is geen goedgekeurd verlof van collega’s in je regio om mee te ruilen.'}>
          <select className="input" value={tegen} onChange={(e) => setTegen(e.target.value)}>
            <option value="">Kies een periode</option>
            {opties.map((v) => <option key={v.id} value={v.id}>{naam[v.medewerkerId]} · {periode(v.van, v.tot)} ({werkdagen(v.van, v.tot)} werkdagen)</option>)}
          </select>
        </Veld>
        {gekozen && (
          <div className="grid gap-2 rounded-lg border border-line p-3 text-[14.5px] sm:grid-cols-2">
            <div><div className="kicker">Jij krijgt</div><div className="font-semibold"><Palmtree size={14} className="mr-1 inline" />{periode(gekozen.van, gekozen.tot)}</div><div className="note">{werkdagen(gekozen.van, gekozen.tot)} werkdagen, nu {werkdagen(verlof.van, verlof.tot)}</div></div>
            <div><div className="kicker">{naam[gekozen.medewerkerId]} krijgt</div><div className="font-semibold"><Palmtree size={14} className="mr-1 inline" />{periode(verlof.van, verlof.tot)}</div><div className="note">en neemt jouw diensten in die periode over</div></div>
          </div>
        )}
        {voorbeeld && <div><div className="mb-1.5 text-sm font-semibold text-muted">Toets vooraf</div><ToetsUitkomst t={voorbeeld} /></div>}
        <Veld label="Toelichting (optioneel)"><input className="input" value={opmerking} onChange={(e) => setOpmerking(e.target.value)} maxLength={200} /></Veld>
      </div>
    </Modal>
  );
}
