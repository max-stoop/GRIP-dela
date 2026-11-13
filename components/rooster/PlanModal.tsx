'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wand2, Check, Shuffle } from 'lucide-react';
import { Modal, Pill, Segment, Spinner, Veld } from '@/components/ui';
import { addDays, fmtD, fmtDag, fmtDJ, isoRange, isWeekend, toDay, todayIso } from '@/lib/dates';
import { maandEind, maandVan, volgendeMaand } from '@/lib/rooster/maand';
import { cx, nl, plural } from '@/lib/format';
import { GEWICHT, type Wijziging } from '@/lib/rooster/voorstel';
import { beschikbaarPerMedewerker, eigenMeldingVoorgaan, maakRooster, voorgangenPerDag, POGINGEN, REKENT_MET, urenBovenContract, werkEnBezetting, type RoosterVoorstel } from '@/lib/rooster/maak';
import { pasToe } from '@/lib/rooster/ruil';
import { binnen24Uur, clusterGenoeg, val1B } from '@/lib/rooster/kans1b';
import { procenten } from '@/lib/capaciteit/plekkans';
import type { ClusterDag } from '@/lib/capaciteit/beschikbaarheid';
import { voorstelBasis } from '@/lib/rooster/vingerafdruk';
import { toets, type Toets } from '@/lib/rooster/toets';
import type { Behoefte, Beleid, Cellen, Medewerker, Voorkeurprofiel, Voorkeurronde, Wens } from '@/lib/rooster/types';
import { useApp } from '@/lib/store/store';
import { inSchoolvakantie } from '@/lib/capaciteit/verlof';

type Gewicht = 'dekking' | 'balans' | 'medewerker';
const GEWICHT_NAAM: [Gewicht, string][] = [['dekking', 'Lichter'], ['balans', 'Volgens beleid'], ['medewerker', 'Zwaarder']];

export function PlanModal({ open, onClose, regio, team, cellen, behoefteVan, kans1BVan, uitval, clusterNaam, laatsteVoorspelling, wensen, profielen, beleid, ronde, standaardVan, standaardTot, onToepassen }: {
  open: boolean;
  onClose: () => void;
  regio: string;
  team: Medewerker[];
  cellen: Cellen;
  /** Roosterbasis, laatste voorspelling, dan de vastgestelde regelplekken. */
  behoefteVan: (dates: string[]) => Behoefte;
  /** De kans dat de 1B valt per dag, voor het cluster, bij dit rooster (zie lib/rooster/kans1b.ts). */
  kans1BVan?: (cellen: Cellen, dates: string[]) => (ClusterDag | null)[];
  /** Ziekte per dienst, voor de kans op de 1B. */
  uitval?: number;
  clusterNaam?: string;
  laatsteVoorspelling: string | null;
  wensen: Wens[];
  profielen: Record<string, Voorkeurprofiel>;
  beleid: Beleid;
  ronde: Voorkeurronde | null;
  /** Daar begint het voorstel standaard, niet eerder dan morgen. */
  standaardVan: string;
  standaardTot: string;
  onToepassen: (w: Wijziging[], omschrijving: string) => void;
}) {
  const tijden = useApp((x) => x.tijden[regio]);
  const schoolvakanties = useApp((x) => x.schoolvakanties);
  const inVakantie = useCallback((d: string) => inSchoolvakantie(schoolvakanties, regio, d), [schoolvakanties, regio]);
  const morgen = addDays(todayIso(), 1);
  const begin = standaardVan > morgen ? standaardVan : morgen;
  const [van, setVan] = useState(begin);
  const [tot, setTot] = useState(standaardTot);
  const [modus, setModus] = useState<'aanvullen' | 'opnieuw'>('aanvullen');
  /** Alleen zaterdag en zondag, bijvoorbeeld 3 tot 6 maanden vooruit; de rest van de maand volgt later. */
  const [weekenden, setWeekenden] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [res, setRes] = useState<RoosterVoorstel | null>(null);
  /** Hoe zwaar voorkeuren wegen; het beleid is het midden. */
  const [gewicht, setGewicht] = useState<Gewicht>('balans');
  /** Elke "andere verdeling" is een volgende ronde. */
  const [ronde2, setRonde2] = useState(0);
  /** Is dat bij toepassen anders, dan zijn de varianten verouderd. */
  const [basis, setBasis] = useState('');
  const [verouderd, setVerouderd] = useState(false);
  const alleVerlof = useApp((x) => x.verlof);
  const aanvragen = useMemo(() => alleVerlof.filter((v) => v.regio === regio && v.status === 'aangevraagd'), [alleVerlof, regio]);

  useEffect(() => {
    if (!open) return;
    setRes(null);
    setVerouderd(false);
    setWeekenden(false);
    setGewicht('balans');
    setRonde2(0);
    if (ronde) { setVan(ronde.van < morgen ? morgen : ronde.van); setTot(ronde.tot); setModus('opnieuw'); }
    else { setVan(begin); setTot(standaardTot); setModus('aanvullen'); }
  }, [open, ronde?.id, standaardTot, morgen, begin]); // eslint-disable-line react-hooks/exhaustive-deps

  const dates = useMemo(() => {
    const alle = van <= tot ? isoRange(van < morgen ? morgen : van, tot) : [];
    return weekenden ? alle.filter((d) => isWeekend(toDay(d))) : alle;
  }, [van, tot, morgen, weekenden]);
  const huidigeBasis = () => voorstelBasis({ team, dates, cellen, overig: [wensen.filter((w) => w.datum >= dates[0] && w.datum <= dates[dates.length - 1]), team.map((m) => profielen[m.id] ?? null), beleid, tijden ?? null, behoefteVan(dates), modus, weekenden, gewicht, aanvragen.map((v) => [v.medewerkerId, v.van, v.tot])] });
  const vooruit = (maanden: number) => { setWeekenden(true); setTot(maandEind(volgendeMaand(maandVan(van), maanden - 1))); setRes(null); };
  const metRonde = ronde ? Object.keys(ronde.ingediend).length : 0;
  const metProfiel = team.filter((m) => profielen[m.id]?.bijgewerkt).length;
  const wensenInPeriode = wensen.filter((w) => w.datum >= van && w.datum <= tot).length;

  const bereken = (ronde = 0) => {
    setBezig(true);
    setRes(null);
    // even de pagina laten tekenen voordat het rekenwerk begint
    setTimeout(() => {
      const behoefte = behoefteVan(dates);
      setRes(maakRooster({ team, dates, cellen, behoefte, wensen, profielen, beleid, gewicht: GEWICHT[gewicht], opnieuw: modus === 'opnieuw', tijden, aanvullen: !weekenden, aanvragen, schoolvakantie: inVakantie, ronde }));
      setRonde2(ronde);
      setBasis(huidigeBasis());
      setVerouderd(false);
      setBezig(false);
    }, 30);
  };

  const huidig = useMemo(() => (open && dates.length ? toets({ team, dates, cellen, behoefte: behoefteVan(dates), wensen, beleid, profielen, tijden, schoolvakantie: inVakantie }) : null), [open, dates, team, cellen, behoefteVan, beleid, wensen, profielen, tijden, inVakantie]);

  // eerst kijken wat er nodig is: de uren voor alle regelplekken en het minimum aan Dg-diensten tegenover de bezetting
  const werk = useMemo(() => (open && dates.length ? werkEnBezetting({ team, dates, cellen, behoefte: behoefteVan(dates), beleid }) : null), [open, dates, team, cellen, behoefteVan, beleid]);
  const na = useMemo(() => (res ? pasToe(cellen, res.wijzigingen) : null), [res, cellen]);
  // hoe vaak de 1B valt en voor wie, nu en met het voorstel
  const val = useMemo(() => {
    if (!res || !na || !kans1BVan) return null;
    const v = (c: Cellen) => { const d = kans1BVan(c, dates); return { b: val1B(d, regio, uitval ?? 0), cluster: clusterGenoeg(d), klant: binnen24Uur(d, regio, uitval ?? 0) }; };
    // staat er nu nog geen 1B in het rooster, dan valt er ook niets te vergelijken
    const nu = (beschikbaarPerMedewerker(team, dates, cellen)?.max ?? 0) > 0 ? v(cellen) : null, straks = v(na);
    return { nu: nu?.b ?? null, straks: straks.b, clusterNu: nu?.cluster ?? null, clusterStraks: straks.cluster, klantNu: nu?.klant ?? null, klantStraks: straks.klant };
  }, [res, na, kans1BVan, cellen, dates, regio, uitval, team]);
  /** Hele procenten waarvan eigen regio en cluster optellen tot het geheel. */
  const p1b = (v: { valt: number; eigen: number; cluster: number } | null) => (v ? procenten(v) : null);
  /** Eén decimaal, zo afgerond dat eigen regio, cluster en "niet" samen 100% zijn. */
  const k24 = (v: { eigen: number; cluster: number; niet: number } | null) => {
    if (!v) return null;
    const e = Math.round(v.eigen * 1000) / 10, c = Math.round(v.cluster * 1000) / 10, samen = Math.min(100, Math.round((e + c) * 10) / 10);
    return { eigen: `${nl(e, 1)}%`, cluster: `${nl(c, 1)}%`, samen: `${nl(samen, 1)}%`, niet: `${nl(Math.round((100 - samen) * 10) / 10, 1)}%` };
  };
  const pct = (x: number | null | undefined, cijfers = 0) => (x == null ? '–' : `${nl(x * 100, cijfers)}%`);
  const onder = (t: Toets) => team.filter((m) => !m.extern).reduce((a, m) => a + Math.max(0, (t.uren[m.id]?.norm ?? 0) - (t.uren[m.id]?.gepland ?? 0)), 0);
  const leeg = (t: Toets) => t.pijlers.continuiteit.dagen - t.pijlers.continuiteit.gedekt;
  const b1 = (c: Cellen) => { const x = beschikbaarPerMedewerker(team, dates, c); return x ? `${x.min} tot ${x.max}` : '–'; };
  const vgTekst = (c: Cellen) => { const x = voorgangenPerDag(team, dates, c); return x ? `werkdagen ${x.min} tot ${x.max}${x.zaterdag ? `, zaterdag ${x.zaterdag.min === x.zaterdag.max ? x.zaterdag.min : `${x.zaterdag.min} tot ${x.zaterdag.max}`}` : ''}${x.zonder ? ` (${plural(x.zonder, 'dag', 'dagen')} zonder)` : ''}` : '–'; };
  const vmTekst = (c: Cellen) => { const x = eigenMeldingVoorgaan(team, dates, c, beleid.voorgaanNaDagen); return x ? `${Math.round((100 * x.kan) / x.van)}% (${x.kan} van ${x.van})` : '–'; };
  /** kop of regel: label, nu, voorstel, is het voorstel beter (groen). */
  type Regel = { kop: string } | { label: string; nu: string; straks: string; beter?: boolean; uitleg?: string };
  const getal = (label: string, f: (t: Toets) => number, fmt: (v: number) => string, hoogBeter: boolean, uitleg?: string): Regel => {
    const a = huidig ? f(huidig) : null, z = res ? f(res.toets) : 0;
    return { label, nu: a == null ? '–' : fmt(a), straks: fmt(z), beter: a != null && Math.abs(z - a) > 1e-9 && (z > a) === hoogBeter, uitleg };
  };
  const tekst = (label: string, nu: string, straks: string, uitleg?: string): Regel => ({ label, nu, straks, uitleg });
  const rijen: Regel[] = !res || !na ? [] : [
    getal('Cijfer', (t) => t.cijfer, (v) => nl(v), true),
    getal('Harde overtredingen (ATW, CAO)', (t) => t.hard, (v) => `${v}`, false),
    getal('Punten roosterbeleid', (t) => t.beleid, (v) => `${v}`, false),
    { kop: 'Continuïteit: staan de regelplekken er' },
    getal('Continuïteit', (t) => t.sub.cont, (v) => String(Math.round(v * 100)), true),
    getal('Dagen met te weinig regelplekken', leeg, (v) => `${v} van ${res.toets.pijlers.continuiteit.dagen}`, false),
    getal('Dagen met genoeg plekken, eigen regio (kans)', (t) => t.pijlers.continuiteit.gemKans ?? -1, (v) => (v < 0 ? '–' : pct(v, 1)), true, `De kans dat op een dag alle meldingen een regelplek in ${regio} vinden, gemiddeld over de dagen. Het beleid vraagt ${Math.round(beleid.alphaRegio * 100)}%. Dit telt dagen.`),
    ...(val ? [tekst('Dagen met genoeg plekken, in het cluster (kans)', pct(val.clusterNu, 1), pct(val.clusterStraks, 1), `De kans dat alle regelplekken en 1B's in het cluster${clusterNaam ? ` ${clusterNaam}` : ''} samen genoeg zijn. Het beleid vraagt ${Math.round(beleid.alphaCluster * 100)}%. Dit telt dagen.`)] as Regel[] : []),
    tekst('Dg-diensten per dag', vgTekst(cellen), vgTekst(na), 'Het kleinste en grootste aantal Dg-diensten op een werkdag: binnen een week hoogstens één verschil. Apart de zaterdag: daar kunnen alleen wie dat weekend werken, met minstens één DG2.'),
    tekst('Kans dat je je eigen melding kunt voorgaan (zes dagen later ingepland)', vmTekst(cellen), vmTekst(na), beleid.voorgaanNaDagen > 0 ? `Het deel van de regeldiensten (1, 1M, 2) waarbij de medewerker ${beleid.voorgaanNaDagen} dagen later, op een werkdag, weer een regeldienst of Dg-dienst heeft.` : undefined),
    tekst('Beschikbaarheidsdiensten (1B) per medewerker', b1(cellen), b1(na), 'Het kleinste en grootste aantal 1B\'s per uitvaartverzorger in deze periode. Ze worden naar contract verdeeld.'),
    ...(val ? [
      tekst('De 1B valt, kans per dag', p1b(val.nu)?.valt ?? '–', p1b(val.straks)?.valt ?? '–', `Een melding gaat eerst naar een vrije plek ergens in het cluster${clusterNaam ? ` ${clusterNaam}` : ''}; pas als alles bezet is, valt er een 1B.`),
      tekst('… voor een melding uit de eigen regio', p1b(val.nu)?.eigen ?? '–', p1b(val.straks)?.eigen ?? '–'),
      tekst('… voor een andere regio in het cluster', p1b(val.nu)?.cluster ?? '–', p1b(val.straks)?.cluster ?? '–'),
      tekst('De 1B valt naar verwachting', val.nu ? `${nl(val.nu.keer, 1)} keer` : '–', val.straks ? `${nl(val.straks.keer, 1)} keer` : '–', `Opgeteld over de ${val.straks?.dagen ?? 0} dagen met een 1B.`),
    ] as Regel[] : []),
    ...(val?.klantStraks ? [
      { kop: 'Nabestaanden: hoeveel meldingen krijgen binnen 24 uur een regelgesprek' },
      tekst(`In de eigen regio`, k24(val.klantNu)?.eigen ?? '–', k24(val.klantStraks)!.eigen, `Op een regelplek of de 1B van ${regio}.`),
      tekst('Met hulp van het cluster', k24(val.klantNu)?.cluster ?? '–', k24(val.klantStraks)!.cluster, `Op een vrije plek of 1B elders in het cluster${clusterNaam ? ` ${clusterNaam}` : ''}.`),
      tekst('Samen binnen 24 uur', k24(val.klantNu)?.samen ?? '–', k24(val.klantStraks)!.samen),
      tekst('Niet binnen 24 uur', k24(val.klantNu)?.niet ?? '–', k24(val.klantStraks)!.niet, 'Die dag is er nergens in het cluster nog een plek vrij.'),
    ] as Regel[] : []),
    { kop: 'Medewerkers en uren' },
    getal('Medewerkertevredenheid', (t) => t.sub.mw, (v) => String(Math.round(v * 100)), true),
    getal('Weekpatroon gerespecteerd', (t) => avgPatroon(t) ?? -1, (v) => (v < 0 ? '–' : `${Math.round(v * 100)}%`), true),
    getal('Wensen gehonoreerd', (t) => (t.wensen.totaal ? t.wensen.gehonoreerd / t.wensen.totaal : -1), (v) => (v < 0 ? '–' : `${Math.round(v * 100)}%`), true),
    getal('Efficiency', (t) => t.sub.eff, (v) => String(Math.round(v * 100)), true),
    tekst('Uren boven contract (om de regelplekken te borgen)', `${Math.round(urenBovenContract(team, dates, cellen))} uur`, `${Math.round(res.boven)} uur`, beleid.bovenContractPct > 0 ? `De regelplekken en één voorgaansplek per dag staan er altijd. Lukt dat niet binnen de contracturen, dan plant het voorstel iemand boven zijn contract: over de periode hoogstens ${beleid.bovenContractPct}%.` : 'Staat uit: het voorstel plant nooit boven het contract.'),
    tekst('Diensten gewijzigd', '–', `${res.wijzigingen.length}`),
  ];

  return (
    <Modal open={open} onClose={onClose} breed titel={<span className="flex items-center gap-2"><Wand2 size={20} className="text-accent" /> Rooster maken voor {regio}</span>} voet={
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleren</button>
        {res ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => bereken(ronde2 + 1)} disabled={bezig} title="Een ander rooster dat net zo goed aan het beleid voldoet"><Shuffle size={16} /> Andere verdeling</button>
            <button type="button" className="btn btn-teal" onClick={() => {
              // vlak voor toepassen: is alles nog zoals toen het voorstel werd gemaakt?
              if (huidigeBasis() !== basis) { setRes(null); setVerouderd(true); return; }
              onToepassen(res.wijzigingen, `Roostervoorstel: ${plural(res.wijzigingen.length, 'wijziging', 'wijzigingen')}`);
            }}><Check size={16} /> Voorstel toepassen</button>
          </>
        ) : (
          <button type="button" className="btn btn-teal" onClick={() => bereken(0)} disabled={bezig || !dates.length || !team.length}>{bezig ? <Spinner /> : <Wand2 size={16} />} Voorstel maken</button>
        )}
      </>
    }>
      <div className="grid gap-5">
        {verouderd && (
          <div className="banner text-[15px]" role="alert">
            Het rooster of de gegevens zijn intussen gewijzigd (bijvoorbeeld door een collega, of verlof dat is goedgekeurd). Het voorstel paste daar niet meer bij en is niet toegepast. Maak het opnieuw.
          </div>
        )}
        {ronde && (
          <div className="banner banner-ok text-[15px]">
            Voorkeurenronde {fmtD(ronde.van)} t/m {fmtD(ronde.tot)}: {metRonde} van {team.length} medewerkers hebben ingediend{ronde.status === 'open' ? `, deadline ${fmtD(ronde.deadline)}` : ', ronde gesloten'}.
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Veld label="Van"><input className="input" type="date" min={morgen} value={van} onChange={(e) => { setVan(e.target.value); setRes(null); }} /></Veld>
          <Veld label="Tot en met"><input className="input" type="date" min={van} value={tot} onChange={(e) => { setTot(e.target.value); setRes(null); }} /></Veld>
          <div className="grid content-end">
            <Segment label="Werkwijze" waarde={modus} onChange={(m) => { setModus(m); setRes(null); }} opties={[['aanvullen', 'Lege vakjes aanvullen'], ['opnieuw', 'Opnieuw plannen']]} />
          </div>
        </div>
        <div className="-mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-[14.5px] font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-[color:var(--primary)]" checked={weekenden} onChange={(e) => { setWeekenden(e.target.checked); setRes(null); }} />
            Alleen de weekenden
          </label>
          <span className="note">Weekenden vooruit plannen, de rest van de maand later:</span>
          {[3, 6].map((n) => <button key={n} type="button" className="btn btn-ghost btn-sm" onClick={() => vooruit(n)}>{n} maanden</button>)}
        </div>
        {weekenden && <p className="note -mt-2">Alleen zaterdag en zondag, volgens de weekendgroepen. Er wordt niet aangevuld tot contracturen; dat gebeurt als je de maand zelf plant. Wat nu in de weekenden komt, blijft dan staan (lege vakjes aanvullen).</p>}
        <p className="note -mt-2">
          {modus === 'aanvullen'
            ? 'Bestaande diensten blijven staan; alleen lege vakjes worden gevuld.'
            : 'Alle diensten in deze periode worden opnieuw gepland. Verlof blijft staan.'}{' '}
          Er wordt rekening gehouden met {plural(metProfiel, 'vast voorkeurprofiel', 'vaste voorkeurprofielen')} en {plural(wensenInPeriode, 'wens', 'wensen')} in deze periode.
          {laatsteVoorspelling && tot > laatsteVoorspelling ? ` Na ${fmtD(laatsteVoorspelling)} is er nog geen voorspelling; daar gelden de vastgestelde regelplekken.` : ''}
        </p>
        {!dates.length && <div className="banner banner-info">In deze periode valt vanaf morgen niets meer te plannen. Kies een latere maand.</div>}

        {werk && werk.beschikbaar > 0 && (
          <div className={cx('banner text-[15px]', werk.nodig > werk.beschikbaar ? '' : 'banner-info')} data-testid="werk-bezetting">
            <b>Eerst uitrekenen hoeveel uur werk benodigd is.</b> Voor alle regelplekken en het minimum aan Dg-diensten is {Math.round(werk.nodig)} uur nodig; het team heeft {Math.round(werk.beschikbaar)} contracturen in deze periode (verlof en ziekte eraf).{' '}
            {werk.nodig > werk.beschikbaar
              ? <>Dat is te weinig bezetting: de regelplekken staan er altijd, en elke dag minstens één voorgaansplek. Waar dat niet binnen de contracturen kan, plant het voorstel boven het contract{beleid.bovenContractPct > 0 ? ` (over de periode hoogstens ${beleid.bovenContractPct}%)` : ' (staat uit)'}.</>
              : werk.nodig > 0.9 * werk.beschikbaar
                ? <>Dat past krap: na de regelplekken en Dg-diensten is er weinig over om aan te vullen.</>
                : <>Er is meer bezetting dan werk: na de regelplekken en Dg-diensten wordt aangevuld, en iedereen krijgt ongeveer hetzelfde deel van zijn contract.</>}
            {res && <> <b>Met dit voorstel komt het team {Math.round(onder(res.toets))} uur onder contract uit{res.boven > 0 ? ` en ${Math.round(res.boven)} uur erboven` : ''}.</b></>}
          </div>
        )}
        <div className="grid gap-1">
          <div className="text-[14.5px] font-semibold">Voorkeuren van medewerkers wegen</div>
          <Segment label="Voorkeuren van medewerkers wegen" waarde={gewicht} onChange={(g) => { setGewicht(g); setRes(null); }} opties={GEWICHT_NAAM} />
          <p className="note">Eén voorstel volgens het roosterbeleid. Alleen als je daar reden voor hebt, laat je voorkeuren lichter of zwaarder wegen; de regels van ATW, CAO en beleid gelden altijd.</p>
        </div>
        {bezig && <div className="flex items-center gap-3 py-6 text-[15px]"><Spinner /> Het rooster wordt gemaakt en getoetst ({POGINGEN} pogingen, de beste wint)...</div>}

        {res && (
          <div className="scroll">
            <table className="tb">
              <thead><tr><th />{huidig && <th className="r text-muted">Nu</th>}<th className="r">Voorstel{ronde2 ? ` (verdeling ${ronde2 + 1})` : ''}</th></tr></thead>
              <tbody>
                {rijen.map((r) => ('kop' in r ? (
                  <tr key={r.kop}><th colSpan={huidig ? 3 : 2} scope="colgroup" className="bg-soft text-left text-[13px] font-semibold uppercase tracking-wide text-muted">{r.kop}</th></tr>
                ) : (
                  <tr key={r.label} title={r.uitleg}>
                    <td className="font-semibold">{r.label}{r.uitleg && <span className="note block font-normal">{r.uitleg}</span>}</td>
                    {huidig && <td className="r text-muted">{r.nu}</td>}
                    <td className={cx('r', r.beter && 'font-bold text-teal')}>{r.straks}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
        {res && (
          <p className="note">
            {fmtDJ(dates[0])} t/m {fmtDJ(dates[dates.length - 1])}. Groen is beter dan nu. Na toepassen kun je alles nog met de hand aanpassen of ongedaan maken. Met <b>Andere verdeling</b> krijg je een ander rooster dat net zo goed aan het beleid voldoet.
            {res.toets.hard ? <> <Pill soort="bad">Let op</Pill> het voorstel heeft harde overtredingen, meestal door bestaande diensten of verlof.</> : null}
          </p>
        )}
        {res && res.opAanvraag > 0 && (
          <div className="banner text-[15px]" role="status">
            <b>{plural(res.opAanvraag, 'dienst staat', 'diensten staan')} op een dag waarvoor verlof is aangevraagd.</b> Er was die dag niemand anders. Beoordeel die aanvragen eerst, of pas het daarna met de hand aan.
          </div>
        )}
        {res && res.tekorten.length > 0 && (
          <div className="rounded-xl border border-line p-3" data-testid="tekorten">
            <div className="font-semibold">{plural(res.tekorten.length, 'dag', 'dagen')} met een lege regelplek, en waarom</div>
            <ul className="mt-1 grid gap-1 text-[14.5px]">
              {res.tekorten.slice(0, 8).map((t) => (
                <li key={t.datum}><b>{fmtDag(t.datum)}</b>: {plural(t.tekort, 'plek', 'plekken')} open. {t.redenen.length ? `Niet beschikbaar: ${t.redenen.slice(0, 4).map(([r, n]) => `${n}× ${r}`).join(', ')}.` : ''}</li>
              ))}
            </ul>
            {res.tekorten.length > 8 && <p className="note mt-1">En nog {res.tekorten.length - 8} dagen; je ziet ze na toepassen in het rooster.</p>}
          </div>
        )}
        <details className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer font-semibold">Waar houdt het voorstel rekening mee?</summary>
          <div className="mt-2 grid gap-3 text-[14.5px]">
            {REKENT_MET.map((g) => (
              <div key={g.kop}>
                <div className="font-semibold">{g.kop}</div>
                <ul className="ml-5 list-disc">{g.punten.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            ))}
          </div>
        </details>
      </div>
    </Modal>
  );
}

function avgPatroon(t: Toets): number | null {
  const p = Object.values(t.pijlers.medewerker.perMedewerker).map((m) => m.delen.patroon).filter((x): x is number => x != null);
  return p.length ? p.reduce((a, b) => a + b, 0) / p.length : null;
}
