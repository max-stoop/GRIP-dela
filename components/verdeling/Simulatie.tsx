'use client';
/** Simulatie van de verdeling met fictieve meldingen, om de gewichten te begrijpen en af te stellen. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Shuffle } from 'lucide-react';
import { Box, Pill, Sectie, Segment, Spinner, Veld } from '@/components/ui';
import { useApp } from '@/lib/store/store';
import { useRuns } from '@/lib/store/hooks';
import { lam as lamUitRun } from '@/lib/store/afgeleid';
import { CLUSTER_NAAM, CLUSTERS, REGIONS } from '@/lib/model/config';
import { addDays, fmtLang, fmtMoment, todayIso } from '@/lib/dates';
import { cx, nl, nlInt } from '@/lib/format';
import { pc4 } from '@/lib/verdeling/geo';
import { HOGE_WERKDRUK, uur, type Kengetallen } from '@/lib/verdeling/verdeel';
import { verdeelInAchtergrond } from '@/lib/verdeling/client';
import type { Resultaat } from '@/lib/verdeling/werk';
import { STANDAARD_PARAMETERS, type Parameters, type Toewijzing } from '@/lib/verdeling/types';
import { useBewaard } from './bewaard';
import { Gewichten, type GewichtVeld } from './Gewichten';
import { Uitleg } from './Uitleg';
import { Woonplaatsen } from './Woonplaatsen';

type Drukte = 'rustig' | 'normaal' | 'druk' | 'piek';
const DRUKTE: Record<Drukte, number> = { rustig: 0.7, normaal: 1, druk: 1.3, piek: 1.6 };
const GEWICHTEN: GewichtVeld[] = [
  { key: 'maxReistijd', label: 'Langste reis (min)', hint: 'Verder weg komt niet in aanmerking.' },
  { key: 'terugreis', label: 'Terugreis telt voor', hint: '1 = net zo zwaar als de heenreis.' },
  { key: 'werkdruk', label: 'Werkdruk', hint: 'Een extra dossier kost dit x (2 x recent + 1) / fte².' },
  { key: 'reeks', label: 'Dagen achter elkaar', hint: 'Per dag vanaf de derde dag op rij.' },
  { key: 'buitenRegio', label: 'Buiten de regio', hint: 'Minuten extra die dat mag kosten.' },
  { key: 'buitenCluster', label: 'Buiten het cluster', hint: 'Bovenop buiten de regio.' },
  { key: 'inzet1B', label: '1B inzetten', hint: 'De achtervang valt; daarna geen reserve.' },
  { key: 'tekort', label: 'Prijs van een tekort', hint: 'Een latere melding die geen plek meer krijgt.' },
  { key: 'aandeelOchtend', label: 'Komt nog voor de ochtend', hint: 'Deel van de dag dat na 00:00 binnenkomt en nog een ochtendplek kan krijgen.', pct: true },
  { key: 'aandeelMiddag', label: 'Komt nog voor de middag', hint: 'Deel dat alleen nog een middagplek kan krijgen.', pct: true },
  { key: 'klantMiddag', label: 'Middag i.p.v. ochtend', hint: 'De familie wacht langer.' },
  { key: 'voorkeur', label: 'Afwijken van voorkeur', hint: 'Dagdeel dat de familie liever had.' },
  { key: 'gesprekDuur', label: 'Duur regelgesprek (min)', hint: 'Bepaalt of een tweede gesprek of voorgang past.' },
  { key: 'marge', label: 'Marge per reis (min)', hint: 'Parkeren en onvoorzien.' },
];

export function Simulatie() {
  const normen = useApp((x) => x.normen);
  const medewerkers = useApp((x) => x.medewerkers);
  const rooster = useApp((x) => x.rooster);
  const { laatste, laatsteData } = useRuns();
  const [datum, setDatum] = useState(() => addDays(todayIso(), 1));
  const [drukte, setDrukte] = useState<Drukte>('normaal');
  const [variant, setVariant] = useState(1);
  const [bron, setBron] = useState<'tabel' | 'live'>('tabel');
  const [gewichten, setGewichten, gewichtenGeladen] = useBewaard<Partial<Parameters>>('grip-verdeling-gewichten', {});
  const [aanbieder, setAanbieder] = useState<string | null>(null);
  const [res, setRes] = useState<Resultaat | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const volgnr = useRef(0);
  // de woonplaatsen zoals bewaard bij de medewerkers; zonder postcode een fictieve plek in de regio
  const postcodes = useMemo(() => Object.fromEntries(medewerkers.filter((m) => m.postcode).map((m) => [m.id, m.postcode!])), [medewerkers]);

  useEffect(() => {
    fetch('/api/reistijd').then((r) => (r.ok ? r.json() : { aanbieder: null })).then((j) => setAanbieder(j.aanbieder ?? null)).catch(() => setAanbieder(null));
  }, []);

  // de verwachting voor de dag uit de laatste voorspelling, als die zo ver reikt; anders rekent de simulatie met de norm
  const lam = useMemo(() => {
    if (!laatsteData) return undefined;
    const uit: Record<string, number> = {};
    for (const r of REGIONS) {
      const v = lamUitRun(laatsteData, r, datum);
      if (v != null) uit[r] = v;
    }
    return Object.keys(uit).length === REGIONS.length ? uit : undefined;
  }, [laatsteData, datum]);

  const reken = useCallback(async () => {
    if (!gewichtenGeladen) return;
    const nr = ++volgnr.current;
    setBezig(true);
    setFout(null);
    try {
      const r = await verdeelInAchtergrond({ datum, normen, medewerkers, rooster, postcodes, lam, drukte: DRUKTE[drukte], seed: variant, parameters: gewichten, bron });
      // alleen de laatste opdracht telt (wie snel doorklikt, ziet geen oude uitkomst)
      if (nr === volgnr.current) setRes(r);
    } catch (e) {
      console.error('Verdeling', e);
      if (nr === volgnr.current) setFout('De verdeling kon niet worden berekend. Probeer het opnieuw.');
    } finally {
      if (nr === volgnr.current) setBezig(false);
    }
  }, [gewichtenGeladen, datum, normen, medewerkers, rooster, postcodes, lam, drukte, variant, gewichten, bron]);

  useEffect(() => { reken(); }, [reken]);

  return (
    <>
      <Sectie
        className="mt-0"
        titel="Simulatie met fictieve meldingen"
        lead="Om 00:00 alle bekende meldingen landelijk over de regelplekken van de dag: op reistijd vanaf huis of de vorige afspraak, op werkdruk, en met ruimte voor wat later op de dag binnenkomt. Naast elkaar: deze slimme verdeling en wat 'dichtstbij' zou doen."
        rechts={<button type="button" className="btn btn-ghost" onClick={() => setVariant(variant + 1)} disabled={bezig}><Shuffle size={16} /> Andere meldingen</button>}
      >
      <Box>
        <div className="flex flex-wrap items-end gap-4">
          <Veld label="Plandag">
            <input className="input" type="date" value={datum} onChange={(e) => e.target.value && setDatum(e.target.value)} />
          </Veld>
          <div className="label">
            <span>Drukte</span>
            <Segment label="Drukte" waarde={drukte} onChange={setDrukte} opties={[['rustig', 'Rustig'], ['normaal', 'Verwacht'], ['druk', 'Druk'], ['piek', 'Piek']]} />
          </div>
          <div className="label">
            <span>Reistijd</span>
            {aanbieder ? (
              <Segment label="Reistijd" waarde={bron} onChange={setBron} opties={[['tabel', 'Schatting'], ['live', 'Live verkeer']]} />
            ) : (
              <span className="note max-w-[360px] font-normal">Geschat over de weg: om water heen via bruggen, dammen en tunnels, en met de veerboot naar de eilanden.</span>
            )}
          </div>
          {bezig && <span className="inline-flex items-center gap-2 text-sm text-muted"><Spinner /> Verdelen…</span>}
        </div>
        {fout && <p className="mt-3 text-sm text-rood">{fout}</p>}
        {res && (
          <p className="note mt-3">
            {fmtLang(res.datum)} · {res.meldingen.length} meldingen om 00:00 · {res.plekken} regelplekken bij {res.personen.filter((p) => p.slots.length).length} mensen ·{' '}
            {res.echt.length ? `${res.echt.length <= 3 ? res.echt.join(', ') : `${res.echt.length} regio's`} uit het rooster` : 'geen rooster'}{res.aangevuld.length ? `, ${res.aangevuld.length} regio's aangevuld uit de vastgestelde regelplekken` : ''} ·{' '}
            verwachting uit {res.verwachting === 'voorspelling' ? `de laatste voorspelling${laatste ? ` van ${fmtMoment(`${laatste.uitgegeven}T${laatste.gemaakt.slice(11, 16)}`)}` : ''}` : 'de vastgestelde regelplekken'}
            {res.reistijd.bron === 'live' && <> · {nlInt(res.reistijd.live)} reistijden met live verkeer, de rest geschat</>}
            {res.reistijd.fout && <span className="text-rood"> · live verkeer niet beschikbaar, reistijden geschat</span>}
          </p>
        )}
      </Box>
      </Sectie>

      {res && <Vergelijking res={res} />}
      {res && <Clusters res={res} />}
      {res && <Toewijzingen res={res} />}

      <Gewichten
        lead="Alles in minuten reistijd: hoeveel minuten extra rijden het waard is om iets anders te vermijden. Bewaard in deze browser."
        velden={GEWICHTEN} standaard={STANDAARD_PARAMETERS} gewichten={gewichten} setGewichten={setGewichten} bezig={bezig}
      />

      <Woonplaatsen />

      <Sectie titel="Hoe het werkt">
        <div className="box grid gap-2 text-[14.5px] leading-relaxed">
          <p><b>Dagroute.</b> Een ochtendgesprek begint thuis; een middaggesprek waar iemand daarvoor was: het ochtendgesprek of een voorgang. Een gesprek mag een voorgang niet in de weg zitten, en moet binnen de openstelling van de plek en binnen 24 uur na de melding beginnen.</p>
          <p><b>Reistijd.</b> Over de weg vanaf het midden van het postcodegebied, om water heen: de Westerscheldetunnel, de Zeeuwse dammen en bruggen, de Moerdijkbruggen, de Afsluitdijk en de Houtribdijk, de pont bij Maassluis, en de veerboot naar de Waddeneilanden.</p>
          <p><b>Niet altijd de dichtstbijzijnde.</b> Wie de laatste dagen veel dossiers had (naar contract), krijgt een extra dossier minder snel. Dat weegt zwaarder naarmate het er meer zijn.</p>
          <p><b>Ruimte voor later.</b> Na 00:00 komen er nog meldingen. Per cluster rekenen we uit de voorspelling het verwachte tekort later op de dag uit. Een middagplek kan nog een melding van de ochtend opvangen, een ochtendplek die leeg blijft meestal niet. Daarom kiest de verdeling liever iemand om 10:00 die iets verder weg woont dan iemand om 12:00. Die van 12:00 houden we vrij.</p>
          <p><b>1B als laatste.</b> De beschikbaarheidsdienst valt alleen als er geen gewone plek is die past, en een melding gaat eerst naar de eigen regio, dan het cluster.</p>
          <p><b>Fictief in deze simulatie:</b> de meldingen, woonplaatsen zonder ingevulde postcode, voorgangen en recente dossiers van aangevulde regio&apos;s. Echt: de diensten uit het rooster, de vastgestelde regelplekken en de verwachting.</p>
        </div>
      </Sectie>
    </>
  );
}

const KPI: { key: keyof Kengetallen; label: string; fmt: (v: number) => string; lager: boolean; uitleg?: string }[] = [
  { key: 'ingepland', label: 'Ingepland', fmt: nlInt, lager: false },
  { key: 'nietIngepland', label: 'Geen plek', fmt: nlInt, lager: true },
  { key: 'gemReistijd', label: 'Gemiddelde reistijd', fmt: (v) => `${nl(v)} min`, lager: true },
  { key: 'maxReistijd', label: 'Langste reis', fmt: (v) => `${nlInt(v)} min`, lager: true },
  { key: 'middag', label: 'Middagplekken gebruikt', fmt: nlInt, lager: true, uitleg: 'Een middagplek kan later op de dag nog een melding opvangen.' },
  { key: 'buitenRegio', label: 'Buiten de eigen regio', fmt: nlInt, lager: true },
  { key: 'buitenCluster', label: 'Buiten het eigen cluster', fmt: nlInt, lager: true },
  { key: 'inzet1B', label: '1B ingezet', fmt: nlInt, lager: true },
  { key: 'gemWerkdruk', label: 'Werkdruk van wie een gesprek krijgt', fmt: (v) => nl(v, 2), lager: true, uitleg: 'Gemiddeld: recente dossiers plus vandaag, per fte.' },
  { key: 'hogeWerkdruk', label: 'Gesprek bij hoge werkdruk', fmt: nlInt, lager: true, uitleg: `Mensen die daarmee boven ${HOGE_WERKDRUK} recente dossiers per fte komen.` },
  { key: 'verwachtTekort', label: 'Verwacht tekort later op de dag', fmt: (v) => nl(v), lager: true, uitleg: 'Meldingen die na 00:00 binnenkomen en geen plek meer vinden, opgeteld over de clusters.' },
  { key: 'doel', label: 'Totaal (model, in minuten)', fmt: nlInt, lager: true },
];

function Vergelijking({ res }: { res: Resultaat }) {
  const dicht = new Map(res.dicht.uitkomst.toewijzingen.map((t) => [t.meldingId, t.slotId]));
  const verschil = res.slim.uitkomst.toewijzingen.filter((t) => dicht.get(t.meldingId) !== t.slotId).length;
  return (
    <Sectie titel="Slim tegenover dichtstbij" lead={`Dichtstbij = op volgorde van binnenkomst naar wie het dichtst bij woont en nog een plek heeft (een 1B als laatste). ${verschil} van de ${res.slim.uitkomst.toewijzingen.length} meldingen gaan bij slim naar een ander.`}>
      <div className="scroll">
        <table className="tb">
          <thead><tr><th /><th className="r">Slim</th><th className="r">Dichtstbij</th></tr></thead>
          <tbody>
            {KPI.map((k) => {
              const a = res.slim.k[k.key], b = res.dicht.k[k.key];
              const beter = Math.abs(a - b) < 1e-9 ? 0 : (a < b) === k.lager ? 1 : -1;
              return (
                <tr key={k.key}>
                  <td title={k.uitleg}>{k.label}{k.uitleg && <span className="note"> · {k.uitleg}</span>}</td>
                  <td className={cx('r font-semibold', beter > 0 && 'text-teal', beter < 0 && 'text-rood')}>{k.fmt(a)}</td>
                  <td className="r">{k.fmt(b)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note mt-2">Slim rijdt soms iets meer, om de middagplekken, de 1B&apos;s en mensen met veel recente dossiers te sparen. Het totaal telt alles in minuten reistijd, met de gewichten hieronder.</p>
    </Sectie>
  );
}

function Clusters({ res }: { res: Resultaat }) {
  const d = new Map(res.dicht.uitkomst.clusters.map((c) => [c.cluster, c]));
  return (
    <Sectie titel="Ruimte per cluster na de verdeling" lead="Vrije plekken voor wat na 00:00 binnenkomt, en het verwachte tekort volgens de verwachting voor de dag.">
      <div className="scroll">
        <table className="tb">
          <thead>
            <tr><th>Cluster</th><th className="r">Vrij ochtend</th><th className="r">Vrij middag</th><th className="r">Waarvan 1B</th><th className="r">Nog verwacht</th><th className="r">Verwacht tekort</th><th className="r">Bij dichtstbij</th></tr>
          </thead>
          <tbody>
            {res.slim.uitkomst.clusters.map((c) => {
              const x = d.get(c.cluster)!;
              return (
                <tr key={c.cluster}>
                  <td className="font-semibold">{CLUSTER_NAAM[c.cluster] ?? c.cluster}</td>
                  <td className="r">{c.vrijOchtend}</td>
                  <td className="r">{c.vrijMiddag}</td>
                  <td className="r">{c.vrij1B}</td>
                  <td className="r">{nl(c.verwachtOchtend + c.verwachtMiddag)}</td>
                  <td className={cx('r font-semibold', c.verwachtTekort < x.verwachtTekort - 1e-9 && 'text-teal')}>{nl(c.verwachtTekort, 2)}</td>
                  <td className="r">{nl(x.verwachtTekort, 2)} <span className="note">({x.vrijOchtend} / {x.vrijMiddag})</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sectie>
  );
}

function Toewijzingen({ res }: { res: Resultaat }) {
  const [cluster, setCluster] = useState<string>('alle');
  const [alleenAnders, setAlleenAnders] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const personen = useMemo(() => new Map(res.personen.map((p) => [p.id, p])), [res]);
  const soort = useMemo(() => new Map(res.personen.flatMap((p) => p.slots.map((sl) => [sl.id, sl.soort] as const))), [res]);
  const regioVan = useMemo(() => new Map(res.meldingen.map((m) => [m.id, m.regio])), [res]);
  const dicht = useMemo(() => new Map(res.dicht.uitkomst.toewijzingen.map((t) => [t.meldingId, t])), [res]);
  const per = useMemo(() => new Map(res.slim.uitkomst.toewijzingen.map((t) => [t.meldingId, t])), [res]);
  const niet = useMemo(() => new Map(res.slim.uitkomst.nietIngepland.map((n) => [n.meldingId, n.reden])), [res]);
  const meldingen = res.meldingen
    .filter((m) => cluster === 'alle' || m.cluster === cluster)
    .filter((m) => !alleenAnders || per.get(m.id)?.slotId !== dicht.get(m.id)?.slotId)
    .sort((a, b) => REGIONS.indexOf(a.regio) - REGIONS.indexOf(b.regio) || a.id.localeCompare(b.id));
  const naam = (t?: Toewijzing) => {
    if (!t) return '—';
    const p = personen.get(t.persoonId)!;
    return <>{p.naam}{p.fictief && <span className="note"> (fictief)</span>}{p.regio !== regioVan.get(t.meldingId) && <span className="note"> · {p.regio}</span>}</>;
  };
  return (
    <Sectie
      titel="Per melding"
      lead="Open een melding voor de uitleg: waarom deze persoon en dit dagdeel, en wat het alternatief had gekost."
      rechts={
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={alleenAnders} onChange={(e) => setAlleenAnders(e.target.checked)} /> Alleen waar het verschilt</label>
          <select className="input w-auto" value={cluster} onChange={(e) => setCluster(e.target.value)} aria-label="Cluster">
            <option value="alle">Alle clusters</option>
            {Object.keys(CLUSTERS).map((c) => <option key={c} value={c}>{CLUSTER_NAAM[c]}</option>)}
          </select>
        </div>
      }
    >
      <div className="scroll">
        <table className="tb">
          <thead>
            <tr><th>Melding</th><th>Plaats</th><th className="r">Uiterlijk</th><th>Slim</th><th>Wanneer</th><th className="r">Reistijd</th><th>Dichtstbij</th><th className="r">Reistijd</th></tr>
          </thead>
          <tbody>
            {meldingen.map((m) => {
              const t = per.get(m.id), d = dicht.get(m.id);
              const anders = t?.slotId !== d?.slotId;
              const isOpen = open === m.id;
              return (
                <Fragment key={m.id}>
                  <tr className={cx('klik', isOpen && 'bg-soft')} onClick={() => setOpen(isOpen ? null : m.id)}>
                    <td className="whitespace-nowrap font-semibold">
                      <button type="button" className="inline-flex items-center gap-1 font-semibold" aria-expanded={isOpen} aria-label={`Uitleg bij ${m.id}`} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : m.id); }}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {m.id}
                      </button>
                      {m.voorkeurDagdeel && <span className="note"> · liefst {m.voorkeurDagdeel}</span>}
                    </td>
                    <td className="whitespace-nowrap">{m.plek.plaats ?? m.plek.postcode} <span className="note">{pc4(m.plek.postcode)} · {m.regio}</span></td>
                    <td className="r">{m.uiterlijk != null ? uur(m.uiterlijk) : '—'}</td>
                    <td className={cx('whitespace-nowrap', anders && 'font-semibold')}>{t ? naam(t) : <Pill soort="bad">geen plek</Pill>}</td>
                    <td className="whitespace-nowrap">{t ? <>{t.dagdeel} {uur(t.start)}{soort.get(t.slotId) === '1B' && <> <Pill soort="warn">1B</Pill></>}</> : niet.get(m.id)}</td>
                    <td className="r whitespace-nowrap">{t ? <>{nlInt(t.reistijd)} min{t.vanaf !== 'thuis' && <span className="note"> v.a. {t.vanaf}</span>}</> : ''}</td>
                    <td className="whitespace-nowrap text-muted">{naam(d)}{d && <span className="note"> · {d.dagdeel}</span>}</td>
                    <td className="r text-muted">{d ? `${nlInt(d.reistijd)} min` : ''}</td>
                  </tr>
                  {isOpen && t && (
                    <tr><td colSpan={8} className="bg-soft"><Uitleg u={res.uitleg[m.id]} kosten={t.kosten} /></td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sectie>
  );
}
