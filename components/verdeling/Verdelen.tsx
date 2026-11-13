'use client';
/** Om 07:00 alle meldingen van de dag verdelen; de rekenregels staan in lib/verdeling/dag.ts. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, Plus, Send, Shuffle, Trash2, Unlock } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Box, Pill, Sectie, Spinner, Veld } from '@/components/ui';
import { geefDagMeldingVrij, geefDagVerdelingDoor, useApp, verwijderDagMelding, voegDagMeldingenToe, wijzigDagMelding, zetDagVerdeling } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { CLUSTER_NAAM, CLUSTERS, REGIONS } from '@/lib/model/config';
import { addDays, fmtLang, fmtMoment, nowStamp, todayIso } from '@/lib/dates';
import { cx, nl, nlInt } from '@/lib/format';
import { kans1BPerDag } from '@/lib/rooster/kans1b';
import { inRooster } from '@/lib/rooster/types';
import { laadPostcodes, pc4, puntVan, type PostcodeTabel } from '@/lib/verdeling/geo';
import { DAG_PARAMETERS, leesLijst, regioVanPostcode, STAP_NAAM, stapVan, tweedeGesprekken, type DagMelding, type DagVerdeling, type Stap } from '@/lib/verdeling/dag';
import { uur } from '@/lib/verdeling/verdeel';
import { verdeelDagInAchtergrond } from '@/lib/verdeling/client';
import type { ClusterNa, DagResultaat } from '@/lib/verdeling/werk';
import { STANDAARD_PARAMETERS, type Parameters } from '@/lib/verdeling/types';
import { useBewaard } from './bewaard';
import { Gewichten, type GewichtVeld } from './Gewichten';
import { Uitleg } from './Uitleg';
import { Woonplaatsen } from './Woonplaatsen';

const POSTCODE = /^\s*[1-9]\d{3}(\s?[A-Za-z]{2})?\s*$/;
/** Van 10:00 tot 15:00 per half uur; leeg = 10:00 of 13:00, wat het beste past. */
const TIJDEN = Array.from({ length: 11 }, (_, i) => 600 + i * 30);
const STANDAARD_DAG: Parameters = { ...STANDAARD_PARAMETERS, ...DAG_PARAMETERS };

const INSTELLINGEN: GewichtVeld[] = [
  { key: 'aandeelOchtend', label: 'Komt na 07:00 nog voor 10:00', hint: 'Deel van de verwachte meldingen van de dag dat na het verdelen nog binnenkomt en een gesprek om 10:00 kan krijgen.', pct: true },
  { key: 'aandeelMiddag', label: 'Komt na 07:00 nog voor 13:00', hint: 'Deel dat daarna nog binnenkomt en alleen een gesprek om 13:00 kan krijgen.', pct: true },
  { key: 'maxReistijd', label: 'Langste reis (min)', hint: 'Verder weg komt niet in aanmerking.' },
  { key: 'werkdruk', label: 'Werkdruk', hint: 'Hoe zwaar recente dossiers (naar contract) tellen tegenover reistijd.' },
  { key: 'buitenRegio', label: 'Buiten de regio', hint: 'Minuten extra rijden die een plek in de eigen regio waard is.' },
  { key: 'tweedeGesprek', label: 'Tweede gesprek van een 2', hint: 'Hoger dan de langste reis: dan eerst alle eerste plekken in het cluster.' },
  { key: 'inzet1B', label: '1B inzetten', hint: 'Hoger dan het tweede gesprek plus de langste reis: de 1B pas daarna.' },
  { key: 'buitenCluster', label: 'Buiten het cluster', hint: 'Hoger dan de 1B plus de langste reis: een ander cluster als laatste.' },
  { key: 'gesprekDuur', label: 'Duur regelgesprek (min)', hint: 'Bepaalt of een tweede gesprek past.' },
];

const procent = (x: number) => (x > 0 && x < 0.005 ? '< 1%' : `${Math.round(x * 100)}%`);

/** De dag om te verdelen: vandaag, of na 19:00 alvast morgen. */
function startDag(): string {
  return Number(nowStamp().slice(11, 13)) >= 19 ? addDays(todayIso(), 1) : todayIso();
}

/** Verandert er iets, dan wordt de uitleg opnieuw gerekend. */
function sleutelVan(datum: string, toewijzingen: { meldingId: string; slotId: string }[], instellingen: Partial<Parameters>): string {
  return `${datum}|${toewijzingen.map((t) => `${t.meldingId}@${t.slotId}`).sort().join(',')}|${JSON.stringify(instellingen)}`;
}

function TijdKeuze({ waarde, onChange, label, disabled }: { waarde: number | undefined; onChange: (t: number | undefined) => void; label: string; disabled?: boolean }) {
  return (
    <select className="input w-auto" aria-label={label} disabled={disabled} value={waarde ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}>
      <option value="">10:00 of 13:00</option>
      {TIJDEN.map((t) => <option key={t} value={t}>{uur(t)}</option>)}
    </select>
  );
}

export function Verdelen() {
  const s = useSessie();
  const door = useDoor();
  const actie = useActie();
  const medewerkers = useApp((x) => x.medewerkers);
  const rooster = useApp((x) => x.rooster);
  const normen = useApp((x) => x.normen);
  const beleid = useApp((x) => x.beleid);
  const verdelingen = useApp((x) => x.verdelingen);
  const { laatsteData } = useRuns();
  const [datum, setDatum] = useState(startDag);
  const dag: DagVerdeling = useMemo(() => verdelingen[datum] ?? { datum, meldingen: [], toewijzingen: [] }, [verdelingen, datum]);
  const [tabel, setTabel] = useState<PostcodeTabel | null>(null);
  const [instellingen, setInstellingen, geladen] = useBewaard<Partial<Parameters>>('grip-verdelen-instellingen', {});
  const [res, setRes] = useState<{ sleutel: string; r: DagResultaat } | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const volgnr = useRef(0);
  const magVerdelen = s.mag('bijsturen');

  useEffect(() => { laadPostcodes().then(setTabel).catch(() => setTabel(new Map())); }, []);

  // verwachte meldingen per regio op de dag: de laatste voorspelling (bijvoorspellen), anders de vastgestelde verwachting
  const lam = useMemo(() => {
    const bronnen = { laatste: laatsteData, norm: normen };
    return Object.fromEntries(REGIONS.map((r) => [r, behoefteVoor(bronnen, r, [datum], { alphaRegio: beleid.alphaRegio, tegen: 'laatste' })[datum]?.lam ?? 0]));
  }, [laatsteData, normen, datum, beleid.alphaRegio]);

  // de kans volgens het rooster, voor het verdelen: de hele dag lag toen nog open
  const kansRooster = useMemo(() => Object.fromEntries(Object.entries(CLUSTERS).map(([c, regios]) => {
    const [k] = kans1BPerDag({
      normen, cluster: c, regios, dates: [datum], lam: (r) => lam[r],
      rooster: (r) => {
        const team = medewerkers.filter((m) => m.regio === r && inRooster(m) && m.functie !== 'UL').map((m) => m.id);
        return rooster[r] && team.length ? { cellen: rooster[r], team } : null;
      },
    });
    return [c, k?.cluster.minstensEen ?? null];
  })) as Record<string, number | null>, [normen, datum, lam, medewerkers, rooster]);

  const reken = useCallback(async (bekijk: boolean) => {
    const nr = ++volgnr.current;
    setBezig(true);
    setFout(null);
    try {
      const r = await verdeelDagInAchtergrond({ soort: 'dag', datum, medewerkers, rooster, verdelingen, verdeling: dag, lam, parameters: instellingen, bron: 'tabel', bekijk });
      if (nr !== volgnr.current) return;
      const toewijzingen = r.uitkomst.toewijzingen;
      if (!bekijk) zetDagVerdeling(datum, toewijzingen.map(({ meldingId, persoonId, slotId, start, reistijd }) => ({ meldingId, persoonId, slotId, start, reistijd })), door);
      setRes({ sleutel: sleutelVan(datum, bekijk ? dag.toewijzingen : toewijzingen, instellingen), r });
    } catch (e) {
      console.error('Verdelen', e);
      if (nr === volgnr.current) setFout('Het verdelen is niet gelukt. Probeer het opnieuw.');
    } finally {
      if (nr === volgnr.current) setBezig(false);
    }
  }, [datum, medewerkers, rooster, verdelingen, dag, lam, instellingen, door]);

  // een bewaarde verdeling (na het opnieuw openen, of van een collega): de uitleg en de kans erbij, zonder te schuiven
  const sleutel = sleutelVan(datum, dag.toewijzingen, instellingen);
  // één poging per stand: lukt het niet, dan niet steeds opnieuw
  const geprobeerd = useRef<string | null>(null);
  useEffect(() => {
    if (!geladen || bezig) return;
    if (!dag.toewijzingen.length) { if (res) setRes(null); return; }
    if (res?.sleutel === sleutel || geprobeerd.current === sleutel) return;
    geprobeerd.current = sleutel;
    reken(true);
  }, [geladen, bezig, dag.toewijzingen.length, res, sleutel, reken]);

  const r = res?.sleutel === sleutel ? res.r : null;
  const toegewezen = new Map(dag.toewijzingen.map((t) => [t.meldingId, t]));
  const geenPlek = new Set((r?.uitkomst.nietIngepland ?? []).map((n) => n.meldingId));
  const nieuw = dag.meldingen.filter((m) => !toegewezen.has(m.id) && !geenPlek.has(m.id));
  const doorgegeven = dag.toewijzingen.filter((t) => t.vast).length;
  const vandaag = datum === todayIso();

  return (
    <>
      <Box>
        <div className="flex flex-wrap items-end gap-4">
          <Veld label="Dag">
            <input className="input" type="date" value={datum} onChange={(e) => { if (e.target.value) { setDatum(e.target.value); setRes(null); } }} />
          </Veld>
          <button type="button" className="btn" disabled={!magVerdelen || bezig || !geladen || !dag.meldingen.length} onClick={() => reken(false)}>
            <Shuffle size={16} /> {dag.toewijzingen.length ? 'Opnieuw verdelen' : 'Verdelen'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={!magVerdelen || bezig || doorgegeven === dag.toewijzingen.length}
            onClick={() => actie(() => geefDagVerdelingDoor(datum, door), 'Doorgegeven: deze gesprekken blijven staan als je opnieuw verdeelt')}>
            <Send size={16} /> Doorgeven
          </button>
          {bezig && <span className="inline-flex items-center gap-2 text-sm text-muted"><Spinner /> Verdelen…</span>}
        </div>
        {fout && <p className="mt-3 text-sm text-rood">{fout}</p>}
        <p className="note mt-3">
          {fmtLang(datum)} · {dag.meldingen.length} {dag.meldingen.length === 1 ? 'melding' : 'meldingen'}
          {dag.toewijzingen.length > 0 && <> · {dag.toewijzingen.length} verdeeld{doorgegeven ? `, ${doorgegeven} doorgegeven` : ''}</>}
          {dag.verdeeld && <> · laatst verdeeld {fmtMoment(dag.verdeeld)}{dag.door ? ` door ${dag.door}` : ''}</>}
          {r && <> · {r.personen.reduce((a, p) => a + p.slots.length, 0)} plekken bij {r.personen.length} mensen in het rooster</>}
        </p>
        {dag.toewijzingen.length > 0 && nieuw.length > 0 && (
          <p className="mt-2 text-sm"><Pill soort="warn">{nieuw.length} nog niet verdeeld</Pill> Klik op Opnieuw verdelen. Wat al is doorgegeven, blijft staan.</p>
        )}
        {r && r.zonderPostcode.length > 0 && (
          <p className="note mt-2">{r.zonderPostcode.length} uitvaartverzorgers zonder woonplaats: hun reis begint in het midden van de regio. Vul hieronder bij Woonplaatsen de postcode in.</p>
        )}
      </Box>

      <ZoVerdelenWe />

      {magVerdelen && <MeldingInvoer datum={datum} tabel={tabel} />}

      <Meldingen datum={datum} dag={dag} r={r} tabel={tabel} magVerdelen={magVerdelen} />

      {r && <KansNa r={r} kansRooster={kansRooster} vandaag={vandaag} />}

      <Woonplaatsen />

      <Gewichten
        titel="Instellingen"
        lead="Hoeveel er na 07:00 nog binnenkomt, en de gewichten in minuten reistijd: hoeveel extra rijden het waard is om iets anders te vermijden. Bewaard in deze browser."
        velden={INSTELLINGEN} standaard={STANDAARD_DAG} gewichten={instellingen} setGewichten={setInstellingen} bezig={bezig} knop="Toepassen"
      />

      <Sectie titel="Meer over hoe het werkt">
        <div className="box grid gap-2 text-[14.5px] leading-relaxed">
          <p><b>Alles in één keer.</b> De verdeling zoekt de beste indeling voor alle meldingen samen, niet melding voor melding. Daardoor gaat een melding soms niet naar de allerdichtstbijzijnde uitvaartverzorger: die is dan nodig voor een andere melding, of had de laatste dagen al veel dossiers.</p>
          <p><b>Reistijd.</b> Vanaf de woonplaats van de uitvaartverzorger (de postcode bij Woonplaatsen), of vanaf het vorige gesprek. Zonder woonplaats rekenen we vanaf het midden van de regio. De reistijd is een schatting over de weg, met bruggen, tunnels en veerboten.</p>
          <p><b>Werkdruk.</b> Hoeveel dossiers iemand de afgelopen twee weken had, naar contract; de laatste dagen tellen zwaarder. Een extra dossier bij iemand met veel recente dossiers telt als extra minuten rijden. Zo spreidt het werk zich vanzelf.</p>
          <p><b>Ruimte voor later.</b> Na 07:00 komen er nog meldingen voor vandaag: standaard 5% van de verwachte meldingen van de dag op tijd voor 10:00, en 10% alleen nog voor 13:00. Daarom houdt de verdeling liever een plek om 13:00 vrij dan een plek om 10:00.</p>
          <p><b>Kans dat de 1B nog valt.</b> Volgens het rooster moest de 1B de hele dag afdekken. Na het verdelen hoeft hij alleen nog op te vangen wat na 07:00 binnenkomt en niet meer in een gewone plek past (ook niet als tweede gesprek van een 2). Die kans is daarom veel kleiner.</p>
          <p><b>Doorgeven.</b> Heb je de gesprekken aan de families en de uitvaartverzorgers doorgegeven, klik dan op Doorgeven. Die blijven staan als je later opnieuw verdeelt, bijvoorbeeld voor een melding die nog binnenkomt. Met Vrijgeven mag een gesprek weer schuiven.</p>
          <p><b>Voorgangen</b> plannen we hier (nog) niet.</p>
        </div>
      </Sectie>
    </>
  );
}

const STAPPEN: { stap: Stap; wat: string }[] = [
  { stap: 'eigen', wat: 'Een eerste plek in de regio van de melding: een 1, een 1M, of het eerste gesprek van een 2.' },
  { stap: 'cluster', wat: 'Een eerste plek in een andere regio van hetzelfde cluster.' },
  { stap: 'tweede', wat: 'Pas als alle eerste plekken in het cluster bezet zijn of niet passen: het tweede gesprek van iemand met een 2.' },
  { stap: '1B', wat: 'Daarna pas de beschikbaarheidsdienst (1B), eerst in de eigen regio, dan in het cluster.' },
  { stap: 'ander', wat: 'Alleen als er in het hele cluster niets meer past: een ander cluster.' },
];

function ZoVerdelenWe() {
  return (
    <Sectie titel="Zo verdelen we" lead="Om 07:00 vul je van elke melding de postcode van de familie in. Met één klik gaan alle meldingen tegelijk naar de uitvaartverzorgers die die dag een regelplek hebben.">
      <div className="box">
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="Volgorde van plekken">
          {STAPPEN.map((x, i) => (
            <li key={x.stap} className="list-none rounded-lg border border-line p-3">
              <div className="flex items-center gap-2 font-semibold">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-soft text-[12.5px]">{i + 1}</span>
                {STAP_NAAM[x.stap]}
              </div>
              <p className="mt-1 text-[13.5px] leading-snug text-muted">{x.wat}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 grid gap-2 text-[14.5px] leading-relaxed md:grid-cols-3">
          <p><b>Binnen elke stap: reistijd en werkdruk samen.</b> Wie dichtbij woont en de laatste dagen weinig dossiers had, krijgt het gesprek. Een plek in de eigen regio heeft de voorkeur.</p>
          <p><b>Om 10:00 of 13:00.</b> Een 1 doet één gesprek (10:00 of 13:00), een 1M en een 1B om 13:00, een 2 om 10:00 en om 13:00. Is met de familie een andere tijd afgesproken, kies die dan bij de melding.</p>
          <p><b>Daarna zie je</b> per melding wie het doet, hoe laat en waarom (klik op de melding), en per cluster hoe groot de kans nog is dat de 1B valt.</p>
        </div>
      </div>
    </Sectie>
  );
}

function MeldingInvoer({ datum, tabel }: { datum: string; tabel: PostcodeTabel | null }) {
  const actie = useActie();
  const [pc, setPc] = useState('');
  const [tijd, setTijd] = useState<number | undefined>(undefined);
  const [regio, setRegio] = useState('');
  const [lijst, setLijst] = useState('');
  const [fouten, setFouten] = useState<string[]>([]);
  const geldig = POSTCODE.test(pc);
  const plek = geldig && tabel ? puntVan(tabel, pc) : null;
  const opPostcode = geldig && tabel ? regioVanPostcode(tabel, pc) : null;

  const voegToe = (e: FormEvent) => {
    e.preventDefault();
    const r = regio || opPostcode;
    if (!geldig || !r) return;
    actie(() => voegDagMeldingenToe(datum, [{ postcode: pc4(pc)!, regio: r, ...(tijd != null ? { tijd } : {}) }]), (ids) => `Melding ${ids[0]} toegevoegd`);
    setPc('');
    setTijd(undefined);
    setRegio('');
  };

  const voegLijstToe = () => {
    if (!tabel) return;
    const { meldingen, fouten: f } = leesLijst(lijst);
    const nieuw: Omit<DagMelding, 'id'>[] = [];
    for (const m of meldingen) {
      const r = regioVanPostcode(tabel, m.postcode);
      if (!r) { f.push(`${m.postcode}: onbekende postcode`); continue; }
      nieuw.push({ ...m, regio: r });
    }
    setFouten(f);
    if (!nieuw.length) return;
    actie(() => voegDagMeldingenToe(datum, nieuw), (ids) => `${ids.length} meldingen toegevoegd`);
    if (!f.length) setLijst('');
  };

  return (
    <Sectie titel="Meldingen invoeren" lead="Per melding de postcode van de familie (4 cijfers is genoeg; we bewaren geen adres). De regio volgt uit de postcode; pas hem aan bij een grensgebied.">
      <div className="box">
        <form onSubmit={voegToe} className="flex flex-wrap items-end gap-3">
          <Veld label="Postcode" hint={pc && !geldig ? 'Geen postcode (1234 of 1234 AB)' : plek?.plaats}>
            <input className="input w-32" placeholder="3521" maxLength={7} autoComplete="off" value={pc} aria-invalid={(!!pc && !geldig) || undefined} onChange={(e) => setPc(e.target.value)} />
          </Veld>
          <Veld label="Gesprek om">
            <TijdKeuze waarde={tijd} onChange={setTijd} label="Gesprek om" />
          </Veld>
          <Veld label="Regio">
            <select className="input w-auto" aria-label="Regio" value={regio} onChange={(e) => setRegio(e.target.value)}>
              <option value="">{opPostcode ? `${opPostcode} (op postcode)` : 'Op postcode'}</option>
              {REGIONS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Veld>
          <button type="submit" className="btn" disabled={!geldig || !(regio || opPostcode)}><Plus size={16} /> Toevoegen</button>
        </form>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">Een lijst plakken</summary>
          <p className="note mt-2">Per regel een postcode, eventueel met een tijd: <code>3521</code>, <code>1012 AB 13:00</code> of <code>6511;10.30</code>.</p>
          <textarea className="input mt-2 min-h-[120px] font-mono text-sm" aria-label="Lijst met postcodes" value={lijst} onChange={(e) => setLijst(e.target.value)} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-ghost" disabled={!lijst.trim() || !tabel} onClick={voegLijstToe}>Lijst toevoegen</button>
            {fouten.length > 0 && <span className="text-sm text-rood">{fouten.join(' · ')}</span>}
          </div>
        </details>
      </div>
    </Sectie>
  );
}

function Meldingen({ datum, dag, r, tabel, magVerdelen }: { datum: string; dag: DagVerdeling; r: DagResultaat | null; tabel: PostcodeTabel | null; magVerdelen: boolean }) {
  const medewerkers = useApp((x) => x.medewerkers);
  const [open, setOpen] = useState<string | null>(null);
  const naam = useMemo(() => new Map(medewerkers.map((m) => [m.id, m])), [medewerkers]);
  const opgeslagen = useMemo(() => new Map(dag.toewijzingen.map((t) => [t.meldingId, t])), [dag.toewijzingen]);
  const berekend = useMemo(() => new Map((r?.uitkomst.toewijzingen ?? []).map((t) => [t.meldingId, t])), [r]);
  const soort = useMemo(() => new Map((r?.personen ?? []).flatMap((p) => p.slots.map((sl) => [sl.id, sl.soort] as const))), [r]);
  const niet = useMemo(() => new Map((r?.uitkomst.nietIngepland ?? []).map((n) => [n.meldingId, n.reden])), [r]);
  const tweede = useMemo(() => tweedeGesprekken(dag.toewijzingen), [dag.toewijzingen]);
  const stappen = useMemo(() => {
    const uit = new Map<string, Stap>();
    for (const m of dag.meldingen) {
      const t0 = opgeslagen.get(m.id), p = t0 ? naam.get(t0.persoonId) : undefined;
      if (t0 && p) uit.set(m.id, stapVan({ meldingRegio: m.regio, persoonRegio: p.regio, soort: soort.get(t0.slotId) ?? 'regel', tweede: tweede.has(m.id) }));
    }
    return uit;
  }, [dag.meldingen, opgeslagen, naam, soort, tweede]);
  if (!dag.meldingen.length) {
    return (
      <Sectie titel="Meldingen van de dag">
        <div className="box text-[14.5px] text-muted">Nog geen meldingen voor {fmtLang(datum)}. Voeg ze hierboven toe en klik op Verdelen.</div>
      </Sectie>
    );
  }
  const meldingen = [...dag.meldingen].sort((a, b) => REGIONS.indexOf(a.regio) - REGIONS.indexOf(b.regio) || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return (
    <Sectie titel="Meldingen van de dag" lead="Open een melding voor de uitleg: waarom deze uitvaartverzorger en deze tijd, en wat het alternatief had gekost.">
      {stappen.size > 0 && (
        <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]" aria-label="Verdeeld per stap">
          {STAPPEN.map((x, i) => {
            const n = [...stappen.values()].filter((v) => v === x.stap).length;
            return <span key={x.stap} className={cx(!n && 'text-muted')}>{i + 1}. {STAP_NAAM[x.stap]}: <b>{n}</b></span>;
          })}
        </p>
      )}
      <div className="scroll">
        <table className="tb">
          <thead>
            <tr><th>Melding</th><th>Postcode</th><th>Gesprek om</th><th>Uitvaartverzorger</th><th>Plek</th><th className="r">Begint</th><th className="r">Reistijd</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {meldingen.map((m) => {
              const t0 = opgeslagen.get(m.id), t = berekend.get(m.id);
              const p = t0 ? naam.get(t0.persoonId) : undefined;
              const isOpen = open === m.id && !!t;
              const plaats = tabel ? puntVan(tabel, m.postcode)?.plaats : undefined;
              const verschoven = !!t0 && !!t && t.slotId !== t0.slotId;
              return (
                <Fragment key={m.id}>
                  <tr className={cx(t && 'klik', isOpen && 'bg-soft')} onClick={() => t && setOpen(isOpen ? null : m.id)}>
                    <td className="whitespace-nowrap font-semibold">
                      {t ? (
                        <button type="button" className="inline-flex items-center gap-1 font-semibold" aria-expanded={isOpen} aria-label={`Uitleg bij ${m.id}`} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : m.id); }}>
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {m.id}
                        </button>
                      ) : <span className="pl-[18px]">{m.id}</span>}
                    </td>
                    <td className="whitespace-nowrap">{m.postcode}{plaats && <> {plaats}</>}{plaats !== m.regio && <span className="note"> · {m.regio}</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <TijdKeuze waarde={m.tijd} label={`Gesprek om bij ${m.id}`} disabled={!magVerdelen || !!t0?.vast} onChange={(tijd) => wijzigDagMelding(datum, m.id, { tijd })} />
                    </td>
                    <td className="whitespace-nowrap">
                      {p ? <>{p.naam}{p.regio !== m.regio && <span className="note"> · {p.regio}</span>}</> : '—'}
                    </td>
                    <td className="whitespace-nowrap">{stappen.has(m.id) && <StapLabel stap={stappen.get(m.id)!} />}</td>
                    <td className="r">{t0 ? uur(t0.start) : ''}</td>
                    <td className="r whitespace-nowrap">{t0 ? `${nlInt(t0.reistijd)} min` : ''}</td>
                    <td className="whitespace-nowrap">
                      {t0?.vast ? <Pill soort="ok">Doorgegeven</Pill> : t0 ? <Pill soort="info">Verdeeld</Pill> : niet.has(m.id) ? <Pill soort="bad" title={niet.get(m.id)}>Geen plek</Pill> : <Pill>Nog niet verdeeld</Pill>}
                      {(verschoven || t?.waarschuwing) && <> <Pill soort="warn" title={t?.waarschuwing}>{verschoven ? 'Plek vervallen' : 'Past niet meer'}</Pill></>}
                    </td>
                    <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      {magVerdelen && t0?.vast && (
                        <button type="button" className="btn btn-ghost btn-sm" title="Toch weer laten schuiven bij opnieuw verdelen" onClick={() => geefDagMeldingVrij(datum, m.id)}><Unlock size={14} /> Vrijgeven</button>
                      )}
                      {magVerdelen && (
                        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Verwijder ${m.id}`} disabled={!!t0?.vast} title={t0?.vast ? 'Al doorgegeven: eerst vrijgeven' : undefined} onClick={() => verwijderDagMelding(datum, m.id)}><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                  {isOpen && t && (
                    <tr><td colSpan={9} className="bg-soft"><Uitleg u={r!.uitleg[m.id]} kosten={t.kosten} /></td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {[...niet.entries()].length > 0 && (
        <ul className="note mt-2">{[...niet.entries()].map(([id, reden]) => <li key={id}>{id}: {reden}</li>)}</ul>
      )}
    </Sectie>
  );
}

/** De stap als label: hoe verder in de volgorde, hoe opvallender. */
function StapLabel({ stap }: { stap: Stap }) {
  const nr = STAPPEN.findIndex((x) => x.stap === stap) + 1;
  const soort = stap === 'eigen' ? 'ok' : stap === 'cluster' ? 'info' : stap === 'tweede' ? 'neutral' : 'warn';
  return <Pill soort={soort} title={STAPPEN[nr - 1].wat}>{nr}. {STAP_NAAM[stap]}</Pill>;
}

function vrijeTekst(c: ClusterNa): string {
  const delen = [
    c.vrij.beide ? `${c.vrij.beide} om 10:00 of 13:00` : '',
    c.vrij.tien ? `${c.vrij.tien} alleen om 10:00` : '',
    c.vrij.dertien ? `${c.vrij.dertien} om 13:00` : '',
  ].filter(Boolean);
  const gewoon = delen.length ? `${delen.join(', ')}` : 'geen gewone plekken meer';
  return `${gewoon}, en ${c.vrij.b === 1 ? '1 vrije 1B' : `${c.vrij.b} vrije 1B's`}`;
}

/** Per cluster de kans dat de 1B nog valt: volgens het rooster en na de verdeling, met de uitleg. */
function KansNa({ r, kansRooster, vandaag }: { r: DagResultaat; kansRooster: Record<string, number | null>; vandaag: boolean }) {
  const dag = vandaag ? 'vandaag' : 'die dag';
  return (
    <Sectie titel="Kans dat de 1B nog valt" lead="Na het verdelen is het grootste deel van de dag bekend. Alleen meldingen die na 07:00 nog binnenkomen, kunnen de 1B nog laten vallen.">
      <div className="grid gap-3 md:grid-cols-2">
        {r.clusters.map((c) => {
          const voor = kansRooster[c.cluster];
          return (
            <div key={c.cluster} className="box" aria-label={`Kans 1B ${CLUSTER_NAAM[c.cluster] ?? c.cluster}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="kop-s">{CLUSTER_NAAM[c.cluster] ?? c.cluster}</h3>
                {c.personen > 0 && voor != null && <span className="note">volgens het rooster {procent(voor)}</span>}
              </div>
              {c.personen === 0 ? (
                <p className="mt-2 text-[14px] text-muted">Geen regelplekken in het rooster van {dag}.</p>
              ) : (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={cx('text-3xl font-semibold tabular-nums', c.minstensEen < 0.1 ? 'text-teal' : c.minstensEen >= 0.5 ? 'text-rood' : '')}>{procent(c.minstensEen)}</span>
                    <span className="text-[14px] text-muted">{c.vrij.b ? 'kans dat de 1B nog valt' : 'kans dat er nog een plek tekortkomt'}</span>
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed">
                    {c.verdeeld} {c.verdeeld === 1 ? 'melding' : 'meldingen'} verdeeld{c.ingezet1B ? `, waarvan ${c.ingezet1B} bij een 1B` : ''}. Nog vrij: {vrijeTekst(c)}.
                    {' '}Na 07:00 verwachten we nog {nl(c.nogVerwacht)} meldingen voor {dag}: {nl(c.nogOchtend)} vroeg genoeg voor 10:00 en {nl(c.nogMiddag)} alleen nog voor 13:00.
                    {' '}{c.vrij.b ? 'Pas als er meer komen dan er gewone plekken vrij zijn (ook de tweede gesprekken van een 2), valt de 1B.' : 'Er is geen vrije 1B meer: dit is de kans dat een melding geen plek meer vindt.'}
                    {voor != null && <> Volgens het rooster was de kans {procent(voor)}: toen moest de 1B de hele dag nog afdekken.</>}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Sectie>
  );
}
