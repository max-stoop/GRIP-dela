'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Save, RotateCcw, Download, Upload, Trash2, Sparkles, ShieldCheck, Database, Table2, CalendarRange, Plus, DownloadCloud, Check } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Box, GeenToegang, GetalInvoer, Modal, PaginaKop, Pill, Sectie, Veld } from '@/components/ui';
import { useConcept } from '@/lib/concept';
import { haalSchoolvakanties, laadDemo, maakBackup, normenTerug, useApp, wisAlles, zetBackupTerug, zetBeleid, zetNormen, zetNormRegio, zetSchoolvakanties, useOpslagwijze } from '@/lib/store/store';
import { CLUSTER_NAAM, REGIONS } from '@/lib/model/config';
import type { Schoolvakantie, SchoolRegio } from '@/lib/capaciteit/verlof';
import type { NormRegio } from '@/lib/capaciteit/parameters';
import { volumePerJaar } from '@/lib/capaciteit/norm';
import { nl } from '@/lib/format';
import { STANDAARD_BELEID, type Beleid, type Weging } from '@/lib/rooster/types';
import { DIENSTEN, PALET, dienstTijd } from '@/lib/rooster/diensten';
import { downloadBlob } from '@/lib/export';
import { fmtDJ, todayIso } from '@/lib/dates';
import { cx } from '@/lib/format';
import { mag, RECHT_BRON, RECHT_LABEL, type Recht } from '@/lib/rechten';
import { ROL_LABEL, type Rol } from '@/lib/store/types';
import { GebruikersBeheer } from '@/components/instellingen/Gebruikers';

export default function InstellingenPagina() {
  const s = useSessie();
  const opslag = useOpslagwijze();
  const actie = useActie();
  const beleid = useApp((x) => x.beleid);
  const runs = useApp((x) => x.runs.length);
  const mw = useApp((x) => x.medewerkers.filter((m) => m.actief).length);
  // het formulier houdt je invoer tot je opslaat, ook als de app intussen de instellingen bijleest
  const { waarde: f, zet: setF, gewijzigd } = useConcept<Beleid>(beleid);
  const [vraag, setVraag] = useState<null | 'wissen' | 'demo' | 'terug'>(null);
  const [backupTekst, setBackupTekst] = useState<string | null>(null);
  const bestand = useRef<HTMLInputElement>(null);

  if (!s.isBeheerder) return <GeenToegang />;

  return (
    <>
      <PaginaKop titel="Instellingen" lead="Roosterbeleid, de vastgestelde regelplekken, schoolvakanties, diensten en de gegevens." />

      <form className="box" onSubmit={(e) => { e.preventDefault(); actie(() => zetBeleid(f), 'Beleid opgeslagen. Toets, voorstel, bijsturen en verlofruimte rekenen er direct mee.'); }}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="kop-s flex items-center gap-2"><ShieldCheck size={20} className="text-accent" /> Roosterbeleid</h2>
            <p className="note mt-1">Standaard volgens Roosterbeleid 1.3 met de wijzigingen voor 2027. Geldt voor de toets, het cijfer, het voorstel, bijsturen en de ruiltoets in alle regio&apos;s. <Link href="/beleid" className="text-accent">Beleid lezen</Link></p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setF(STANDAARD_BELEID)}><RotateCcw size={16} /> Standaard</button>
            <button className="btn" disabled={!gewijzigd}><Save size={16} /> Opslaan</button>
          </div>
        </div>

        <Groep titel="Regelplekken" par="3.1 en 3.2">
          <Veld label="Dekkingsgraad per regio" hint="Plekken zodat het op zoveel procent van de dagen past.">
            <select className="input" value={f.alphaRegio} onChange={(e) => setF({ ...f, alphaRegio: Number(e.target.value) })}>{[0.7, 0.75, 0.8, 0.85, 0.9].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}</select>
          </Veld>
          <Veld label="Dekkingsgraad per cluster" hint="Voor de clusterspeling.">
            <select className="input" value={f.alphaCluster} onChange={(e) => setF({ ...f, alphaCluster: Number(e.target.value) })}>{[0.9, 0.95, 0.97, 0.99].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}</select>
          </Veld>
          <Veld label="Beschikbaarheidsdiensten per dag" hint="Tellen mee als regelplek."><GetalInvoer min={0} max={3} waarde={f.beschikbaarPerDag} onZet={(v) => setF({ ...f, beschikbaarPerDag: v })} /></Veld>
          <Veld label="Minimaal medewerkers per dag" hint="Alle diensten samen; 0 is geen minimum. Rooster maken vult aan met Dg-diensten."><GetalInvoer min={0} max={30} waarde={f.minMedewerkers} onZet={(v) => setF({ ...f, minMedewerkers: v })} /></Veld>
          <Veld label="Minimaal middag/avonddiensten per dag"><GetalInvoer min={0} max={5} waarde={f.minMiddag} onZet={(v) => setF({ ...f, minMiddag: v })} /></Veld>
          <Veld label="Maximaal keer een 2 per dag"><GetalInvoer min={0} max={5} waarde={f.maxTwee} onZet={(v) => setF({ ...f, maxTwee: v })} /></Veld>
          <Veld label="Minimaal enkele regeldiensten bij een 2" hint="Om ziekte op de dag op te vangen."><GetalInvoer min={0} max={5} waarde={f.minEnkelBijTwee} onZet={(v) => setF({ ...f, minEnkelBijTwee: v })} /></Veld>
          <Veld label="Maximaal regelplekken per weekend" hint="Per uitvaartverzorger."><GetalInvoer min={1} max={6} waarde={f.maxWeekendPlekken} onZet={(v) => setF({ ...f, maxWeekendPlekken: v })} /></Veld>
          <Vink label="Nooit meer plekken dan afgesproken" aan={f.exactePlekken} zet={(v) => setF({ ...f, exactePlekken: v })} />
        </Groep>

        <Groep titel="Dossiergebonden diensten" par="3.3">
          <Veld label="Minimaal Dg-diensten per dag" hint="Niet op zondag."><GetalInvoer min={0} max={8} waarde={f.minDG} onZet={(v) => setF({ ...f, minDG: v })} /></Veld>
          <Veld label="Voorgaansplekken per dag" hint="DG1 telt 1, DG2 telt 2. Per regio geldt het aantal uit de vastgestelde regelplekken (hieronder); dit getal alleen voor een regio die daar niet in staat."><GetalInvoer min={0} max={12} waarde={f.voorgangenPerDag} onZet={(v) => setF({ ...f, voorgangenPerDag: v })} /></Veld>
          <DgPerRegio waarde={f.dgPerRegio ?? {}} standaard={f.minDG} onZet={(dgPerRegio) => setF({ ...f, dgPerRegio })} />
        </Groep>

        <Groep titel="ATW en CAO" par="1">
          <Veld label="Minimale rust (uren)"><GetalInvoer min={11} max={16} waarde={f.minRustUren} onZet={(v) => setF({ ...f, minRustUren: v })} /></Veld>
          <Veld label="Maximaal diensten achter elkaar" hint="Wekelijkse rust."><GetalInvoer min={3} max={10} waarde={f.maxAchtereen} onZet={(v) => setF({ ...f, maxAchtereen: v })} /></Veld>
          <Veld label="Maximaal 1B per 28 dagen"><GetalInvoer min={0} max={28} waarde={f.maxBeschikbaarPer28} onZet={(v) => setF({ ...f, maxBeschikbaarPer28: v })} /></Veld>
          <Veld label="Minimaal vrije weekenden per jaar"><GetalInvoer min={0} max={52} waarde={f.minVrijeWeekenden} onZet={(v) => setF({ ...f, minVrijeWeekenden: v })} /></Veld>
          <Veld label="Werkdagen vast (dagen vooruit)"><GetalInvoer min={0} max={60} waarde={f.vastDagen} onZet={(v) => setF({ ...f, vastDagen: v })} /></Veld>
          <Veld label="Tijden vast (dagen vooruit)"><GetalInvoer min={0} max={14} waarde={f.tijdenDagen} onZet={(v) => setF({ ...f, tijdenDagen: v })} /></Veld>
          <Veld label="Publiceren (maanden vooraf)" hint="Beleid: het rooster van een maand staat 2 maanden vooraf online."><GetalInvoer min={1} max={4} waarde={f.publicatieMaanden} onZet={(v) => setF({ ...f, publicatieMaanden: v })} /></Veld>
        </Groep>

        <Groep titel="Uren en capaciteit" par="3.5 en 3.6">
          <Veld label="Verzuimnorm" hint="Van de bezetting."><input className="input" type="number" step={0.1} min={0} max={30} value={Math.round(f.verzuimNorm * 1000) / 10} onChange={(e) => setF({ ...f, verzuimNorm: Math.max(0, Math.min(0.3, Number(e.target.value) / 100)) })} /></Veld>
          <Veld label="Verlofnorm" hint="Van de bezetting."><input className="input" type="number" step={0.1} min={0} max={30} value={Math.round(f.verlofNorm * 1000) / 10} onChange={(e) => setF({ ...f, verlofNorm: Math.max(0, Math.min(0.3, Number(e.target.value) / 100)) })} /></Veld>
          <Vink label="Maximaal op contracturen plannen" aan={f.maxContract} zet={(v) => setF({ ...f, maxContract: v })} />
          <Veld label="Regelplekken en voorgaansplekken borgen: hoogstens % boven contract" hint="Lukt het niet binnen de contracturen, dan tot dit percentage over de periode (15% is 28 uur die 32 uur wordt). 0 = nooit boven het contract."><GetalInvoer min={0} max={30} waarde={f.bovenContractPct} onZet={(v) => setF({ ...f, bovenContractPct: v })} /></Veld>
          <Veld label="Voorgaansplekken per dag: maximum" hint="De streefwaarde: daarboven vult Rooster maken niet aan. Het minimum per dag staat bij de voorgaansplekken van de regio."><GetalInvoer min={1} max={20} waarde={f.voorgangenMaxPerDag} onZet={(v) => setF({ ...f, voorgangenMaxPerDag: v })} /></Veld>
          <Veld label="Zaterdag: minimaal aantal DG2" hint="Zo nodig boven contract of buiten de weekendbeurt. 0 = geen eis."><GetalInvoer min={0} max={4} waarde={f.zaterdagDG2} onZet={(v) => setF({ ...f, zaterdagDG2: v })} /></Veld>
          <Veld label="Eigen melding voorgaan: dagen na de regeldienst" hint="Wie een melding aanneemt (1, 1M of 2) werkt zoveel dagen later liefst weer (een 1 of Dg). 0 = niet op letten."><GetalInvoer min={0} max={10} waarde={f.voorgaanNaDagen} onZet={(v) => setF({ ...f, voorgaanNaDagen: v })} /></Veld>
          <Vink label="Rooster maken: uren die na hele Dg-dagen open staan (contract van 28 of 36 uur) aanvullen met een korte Dg-dag van 4 uur" aan={f.korteDagAanvullen} zet={(v) => setF({ ...f, korteDagAanvullen: v })} />
          <Vink label="Clusterspeling meetellen in de borging" aan={f.clusterSpeling} zet={(v) => setF({ ...f, clusterSpeling: v })} />
        </Groep>

        <Groep titel="Proces, vakanties en goedkeuring" par="4.2 en 5.1">
          <Vink label="Rooster pas publiceren na goedkeuring door de regiomanager" aan={f.goedkeuringVerplicht} zet={(v) => setF({ ...f, goedkeuringVerplicht: v })} />
          <Vink label="Ook de planner besluit over verlof (goedkeuren, afwijzen, intrekken en de vakantieronde), naast de regiomanager" aan={f.plannerBesluitVerlof} zet={(v) => setF({ ...f, plannerBesluitVerlof: v })} />
          <Vink label="Geen overige diensten (O, OR, VMS, TD) in schoolvakanties" aan={f.geenOverigInVakantie} zet={(v) => setF({ ...f, geenOverigInVakantie: v })} />
          <label className="label"><span>Rooster juli en augustus klaar, maanden vooraf</span><input className="input" type="number" min={2} max={6} value={f.zomerVooruitMaanden} onChange={(e) => setF({ ...f, zomerVooruitMaanden: Math.max(2, Math.min(6, Number(e.target.value) || 4)) })} /></label>
        </Groep>
        <Groep titel="Teamafspraken">
          <Vink label="Weekendcadans volgen (per medewerker: elk weekend, om het weekend, 1 op 3 of 1 op 4)" aan={f.omHetWeekend} zet={(v) => setF({ ...f, omHetWeekend: v })} />
          <Vink label="Rooster maken: in het weekend liever een 2 (binnen het beleid), zodat er minder mensen in het weekend werken" aan={f.tweeInWeekend} zet={(v) => setF({ ...f, tweeInWeekend: v })} />
          <Veld label="Zekere wensen 'liever vrij' per vier weken" hint="Zoveel zijn zo goed als zeker; meer wensen wegen mee als sterke voorkeur. 0 = geen grens."><GetalInvoer min={0} max={28} waarde={f.wensenZeker} onZet={(v) => setF({ ...f, wensenZeker: v })} /></Veld>
          <Vink label="Ruilen zonder bevindingen automatisch goedkeuren" aan={f.ruilAutomatisch} zet={(v) => setF({ ...f, ruilAutomatisch: v })} />
        </Groep>

        <div className="mt-6 border-t border-line pt-5">
          <h3 className="kop-s">Weging van het roostercijfer</h3>
          <p className="note mt-1">De vierledige doelstelling personeelsplanning. De verhouding telt, het totaal hoeft niet op 100 uit te komen.</p>
          <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {([['continuiteit', 'Continuïteit', 'Past het werk, binnen wet en beleid'], ['efficiency', 'Efficiency', 'Binnen de normen, niet meer dan nodig'], ['medewerker', 'Medewerkerstevredenheid', 'Voorkeuren, wensen, uren, ritme, eerlijk'], ['klant', 'Klanttevredenheid', 'Binnen 24 uur geholpen']] as [keyof Weging, string, string][]).map(([k, l, h]) => {
              const tot = Math.max(1, Object.values(f.weging).reduce((a, b) => a + b, 0));
              return (
                <Veld key={k} label={`${l} · ${Math.round((f.weging[k] / tot) * 100)}%`} hint={h}>
                  <input type="range" min={0} max={60} step={5} value={f.weging[k]} onChange={(e) => setF({ ...f, weging: { ...f.weging, [k]: Number(e.target.value) } })} className="w-full accent-[color:var(--primary)]" aria-label={l} />
                </Veld>
              );
            })}
          </div>
        </div>
      </form>

      <div id="normen" className="scroll-mt-6"><NormenEditor /></div>

      <SchoolvakantiesEditor />

      <Sectie titel="Diensten" lead="De diensten die in het rooster kunnen staan, volgens het roosterbeleid. Plekken tellen voor de dekking, uren voor het contract en de borging.">
        <div className="scroll">
          <table className="tb">
            <thead><tr><th>Code</th><th>Dienst</th><th>Tijd</th><th>Open voor regelgesprek</th><th className="r">Uren</th><th className="r">Plekken</th><th className="r">Voorgangen</th><th>Uitleg</th></tr></thead>
            <tbody>
              {PALET.map((c) => (
                <tr key={c}>
                  <td><span className={cx('inline-block min-w-[40px] rounded px-2 py-0.5 text-center text-[12.5px] font-semibold', `c-${c}`)}>{c === '-' ? 'vrij' : c}</span></td>
                  <td className="font-semibold">{DIENSTEN[c].naam}</td>
                  <td className="whitespace-nowrap">{dienstTijd(c) || '–'}</td>
                  <td>{DIENSTEN[c].open ?? '–'}</td>
                  <td className="r">{DIENSTEN[c].uren}</td>
                  <td className="r">{DIENSTEN[c].plekken}</td>
                  <td className="r">{DIENSTEN[c].voorgangen}</td>
                  <td className="note">{DIENSTEN[c].uitleg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sectie>

      <GebruikersBeheer />

      <RollenEnRechten />

      <Sectie titel="Gegevens">
        <div className="grid gap-4 lg:grid-cols-2">
          <Box titel={<span className="flex items-center gap-2"><Database size={20} className="text-accent" /> Opslag</span>}>
            <p className="text-[15px]">
              {opslag === 'test'
                ? 'Testomgeving: je werkt in een kopie in deze browser. Niets wordt opgeslagen in de gedeelde database.'
                : opslag === 'browser'
                ? 'Lokale modus: alle gegevens staan in deze browser.'
                : 'Alle gegevens worden centraal bewaard. Wat iemand wijzigt, zien de anderen meteen.'}
            </p>
            <p className="note mt-2">{runs} runs, {mw} actieve medewerkers.{opslag === 'browser' ? ' Maak regelmatig een back-up als je met eigen gegevens werkt.' : ''}</p>
            <div className="mt-2"><Pill soort={opslag === 'database' ? 'ok' : opslag === 'test' ? 'warn' : 'neutral'}>{opslag === 'test' ? 'Testomgeving' : opslag === 'browser' ? 'Lokale modus' : 'Gedeeld'}</Pill></div>
          </Box>
          <Box titel="Back-up en herstel">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => actie(async () => downloadBlob(await maakBackup(), `grip-backup-${todayIso()}.json`), 'Back-up gedownload.')}><Download size={16} /> Back-up downloaden</button>
              {opslag !== 'database' && <button type="button" className="btn btn-ghost" onClick={() => bestand.current?.click()}><Upload size={16} /> Back-up terugzetten</button>}
              <input ref={bestand} type="file" accept=".json,application/json" hidden onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) { setBackupTekst(await file.text()); setVraag('terug'); } }} />
            </div>
            {opslag !== 'database' ? (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <button type="button" className="btn btn-ghost" onClick={() => setVraag('demo')}><Sparkles size={16} /> Demo opnieuw laden</button>
                <button type="button" className="btn btn-danger" onClick={() => setVraag('wissen')}><Trash2 size={16} /> Alles wissen</button>
              </div>
            ) : <p className="note mt-3">De back-up is een kopie van wat jij ziet.</p>}
          </Box>
        </div>
      </Sectie>

      <Modal open={vraag !== null} onClose={() => setVraag(null)} titel={vraag === 'wissen' ? 'Alles wissen?' : vraag === 'demo' ? 'Demo opnieuw laden?' : 'Back-up terugzetten?'} voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => setVraag(null)}>Annuleren</button>
        {vraag === 'wissen' && <button type="button" className="btn btn-danger" onClick={() => { setVraag(null); actie(wisAlles, 'Alle gegevens in deze browser zijn gewist.'); }}><Trash2 size={16} /> Wissen</button>}
        {vraag === 'demo' && <button type="button" className="btn btn-teal" onClick={() => { setVraag(null); actie(laadDemo, 'Demo opnieuw klaargezet.'); }}><Sparkles size={16} /> Demo laden</button>}
        {vraag === 'terug' && <button type="button" className="btn" onClick={() => { const t = backupTekst!; setVraag(null); actie(() => zetBackupTerug(t), 'Back-up teruggezet.'); }}><Upload size={16} /> Terugzetten</button>}
      </>}>
        {vraag === 'wissen' && <p>Meldingen, runs, teams, roosters, verlof, wensen en ruilen in deze browser worden definitief verwijderd. Download eerst een back-up als je die nog nodig hebt.</p>}
        {vraag === 'demo' && <p>Alle gegevens in deze browser worden vervangen door de demo.</p>}
        {vraag === 'terug' && <p>De huidige gegevens in deze browser worden vervangen door de inhoud van de back-up.</p>}
      </Modal>
    </>
  );
}

/** Regio's die meer (of minder) Dg-diensten per dag nodig hebben dan het minimum. */
function DgPerRegio({ waarde, standaard, onZet }: { waarde: Record<string, number>; standaard: number; onZet: (v: Record<string, number>) => void }) {
  const lijst = Object.entries(waarde).sort((a, b) => a[0].localeCompare(b[0]));
  const vrij = REGIONS.filter((r) => !(r in waarde));
  const [nieuw, setNieuw] = useState('');
  return (
    <div className="grid gap-2 sm:col-span-2">
      <div className="text-[14px] font-semibold">Dg-diensten per regio</div>
      <p className="note m-0">Afwijkend van het minimum hiernaast, bijvoorbeeld 3 in een regio met veel voorgangen. De toets, Rooster maken en Bijsturen rekenen dan voor die regio met dat aantal.</p>
      {lijst.map(([regio, n]) => (
        <div key={regio} className="flex items-center gap-2">
          <span className="min-w-[160px] text-[14.5px]">{regio}</span>
          <GetalInvoer min={0} max={8} waarde={n} onZet={(v) => onZet({ ...waarde, [regio]: v })} />
          <button type="button" className="btn btn-ghost btn-icon" aria-label={`${regio} weghalen`} onClick={() => { const { [regio]: _weg, ...rest } = waarde; onZet(rest); }}><Trash2 size={15} /></button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <select className="input w-auto min-w-[160px]" value={nieuw} onChange={(e) => setNieuw(e.target.value)} aria-label="Regio met een eigen aantal Dg-diensten">
          <option value="">Regio kiezen</option>
          {vrij.map((r) => <option key={r}>{r}</option>)}
        </select>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!nieuw} onClick={() => { onZet({ ...waarde, [nieuw]: standaard + 1 }); setNieuw(''); }}><Plus size={15} /> Toevoegen</button>
      </div>
    </div>
  );
}

function Groep({ titel, par, children }: { titel: string; par?: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-5 border-t border-line pt-4 first-of-type:mt-0 first-of-type:border-0 first-of-type:pt-0">
      <legend className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">{titel}{par && <Link href={`/beleid#p-${par.split(' ')[0].includes('.') ? par.split(' ')[0] : `${par}.1`}`} className="ml-2 normal-case tracking-normal text-accent">§ {par}</Link>}</legend>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </fieldset>
  );
}

/** Een vinkje met dezelfde opbouw als een veld (lege labelregel, dan het vinkje), zodat het op één lijn staat met de invoervakken. */
function Vink({ label, aan, zet }: { label: string; aan: boolean; zet: (v: boolean) => void }) {
  return (
    <label className="label">
      <span aria-hidden />
      <span className="flex min-h-[38px] items-center gap-2 text-[15px] font-normal text-ink"><input type="checkbox" className="h-4 w-4 shrink-0 accent-[color:var(--primary)]" checked={aan} onChange={(e) => zet(e.target.checked)} /> {label}</span>
    </label>
  );
}

/** De vastgestelde regelplekken: parameters en per regio volume, amplitude, voorgangen en formatie. */
function NormenEditor() {
  const actie = useActie();
  const n = useApp((x) => x.normen);
  const veld = (regio: string, k: keyof NormRegio, i?: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    if (k === 'fte' && i != null) { const fte = [...n.regios[regio].fte] as NormRegio['fte']; fte[i] = v; zetNormRegio(regio, { fte }); }
    else if (k === 'vrijeMarkt') zetNormRegio(regio, { vrijeMarkt: v / 100 });
    else zetNormRegio(regio, { [k]: v } as Partial<NormRegio>);
  };
  const num = 'input h-8 min-h-0 w-[78px] px-2 py-1 text-right text-[13px]';
  return (
    <Sectie id="normen" titel={<span className="flex items-center gap-2"><Table2 size={22} className="text-accent" /> Vastgestelde regelplekken</span>} lead={<>Bron: {n.bron}. Hieruit rekent GRIP de regelplekken voor dagen zonder voorspelling, de te borgen uren, de capaciteit en de verlofruimte. Wijzigingen gaan direct mee. Opnieuw berekenen uit de eigen meldingen kan bij <Link href="/model#vastgesteld" className="text-accent">Bronnen en model</Link>.</>} rechts={<button type="button" className="btn btn-ghost" onClick={() => actie(normenTerug, 'Teruggezet naar de vastgestelde regelplekken 2027.')}><RotateCcw size={16} /> Terug naar de standaard</button>}>
      <div className="box mb-4 grid gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-7">
        <Veld label="Duur reguliere dienst (uur)"><input className="input" type="number" value={n.dienstUren} onChange={(e) => zetNormen({ dienstUren: Number(e.target.value) || 0 })} /></Veld>
        <Veld label="Kans dat de 1B valt" hint={`Voor de borging; gewogen duur: ${nl(n.beschikbaarKans * n.dienstUren)} uur`}><input className="input" type="number" step={0.005} value={n.beschikbaarKans} onChange={(e) => zetNormen({ beschikbaarKans: Number(e.target.value) || 0 })} /></Veld>
        <Veld label="Uitval op de dag" hint="Kort verzuim per dienst; 0 = ziekte telt niet mee."><input className="input" type="number" step={0.005} min={0} max={0.5} value={n.uitval} onChange={(e) => zetNormen({ uitval: Math.min(0.5, Math.max(0, Number(e.target.value) || 0)) })} /></Veld>
        <Veld label="Duur voorgangsdienst (uur)"><input className="input" type="number" value={n.voorgangUren} onChange={(e) => zetNormen({ voorgangUren: Number(e.target.value) || 0 })} /></Veld>
        <Veld label="Dagen met voorgangen"><input className="input" type="number" value={n.voorgangDagen} onChange={(e) => zetNormen({ voorgangDagen: Number(e.target.value) || 0 })} /></Veld>
        <Veld label="Trend op het volume"><input className="input" type="number" step={0.01} value={n.trend} onChange={(e) => zetNormen({ trend: Number(e.target.value) || 1 })} /></Veld>
        <Veld label="Uren per fte"><input className="input" type="number" value={n.urenPerFte} onChange={(e) => zetNormen({ urenPerFte: Number(e.target.value) || 40 })} /></Veld>
      </div>
      <div className="scroll max-h-[520px]">
        <table className="tb">
          <thead>
            <tr><th>Regio</th><th>Cluster</th><th className="r">Natura</th><th className="r">Overlijdens CBS</th><th className="r">Vrije markt %</th><th className="r" title="Op het volume; opnieuw berekenen uit de eigen meldingen kan bij Bronnen en model">Correctie</th><th className="r">Volume/jaar</th><th className="r">Amplitude</th><th className="r">Voorgangen</th><th className="r">Fte Q1</th><th className="r">Q2</th><th className="r">Q3</th><th className="r">Q4</th></tr>
          </thead>
          <tbody>
            {REGIONS.slice().sort().map((r) => {
              const x = n.regios[r];
              if (!x) return null;
              return (
                <tr key={r}>
                  <td className="whitespace-nowrap font-semibold">{r}</td>
                  <td className="text-muted">{CLUSTER_NAAM[x.cluster]}</td>
                  {/* elk veld met zijn waarde als sleutel: verandert de waarde elders (terugzetten, opnieuw berekenen), dan staat hier de nieuwe */}
                  <td className="r"><input key={x.natura} className={num} aria-label={`Natura ${r}`} defaultValue={x.natura} onBlur={veld(r, 'natura')} /></td>
                  <td className="r"><input key={x.cbs} className={num} aria-label={`CBS ${r}`} defaultValue={x.cbs} onBlur={veld(r, 'cbs')} /></td>
                  <td className="r"><input key={x.vrijeMarkt} className={num} aria-label={`Vrije markt ${r}`} defaultValue={Math.round(x.vrijeMarkt * 10000) / 100} onBlur={veld(r, 'vrijeMarkt')} /></td>
                  <td className="r"><input key={x.correctie} className={num} aria-label={`Correctie ${r}`} defaultValue={x.correctie} onBlur={veld(r, 'correctie')} /></td>
                  <td className="r num">{nl(volumePerJaar(n, r), 0)}</td>
                  <td className="r"><input key={x.amplitude} className={num} aria-label={`Amplitude ${r}`} defaultValue={x.amplitude} onBlur={veld(r, 'amplitude')} /></td>
                  <td className="r"><input key={x.voorgangen} className={num} aria-label={`Voorgangen ${r}`} defaultValue={x.voorgangen} onBlur={veld(r, 'voorgangen')} /></td>
                  {x.fte.map((v, i) => <td key={i} className="r"><input key={v} className={num} aria-label={`Fte Q${i + 1} ${r}`} defaultValue={v} onBlur={veld(r, 'fte', i)} /></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sectie>
  );
}

const SCHOOLREGIO_LABEL: Record<SchoolRegio | 'alle', string> = { noord: 'Noord', midden: 'Midden', zuid: 'Zuid', alle: 'Heel Nederland' };

/** Schoolvakanties: in die weken kijkt de verlofplanning ook naar het cluster. */
function SchoolvakantiesEditor() {
  const actie = useActie();
  const lijst = useApp((x) => x.schoolvakanties);
  const [nieuw, setNieuw] = useState<Schoolvakantie>({ id: '', naam: 'Zomervakantie', regio: 'alle', van: todayIso(), tot: todayIso(), bron: 'handmatig' });
  const jaar = Number(todayIso().slice(0, 4)), maand = Number(todayIso().slice(5, 7));
  const schooljaar = maand >= 8 ? `${jaar}-${jaar + 1}` : `${jaar - 1}-${jaar}`;
  const volgend = maand >= 8 ? `${jaar + 1}-${jaar + 2}` : `${jaar}-${jaar + 1}`;
  return (
    <Sectie titel={<span className="flex items-center gap-2"><CalendarRange size={22} className="text-accent" /> Schoolvakanties</span>} lead="In schoolvakanties kijkt de verlofplanning ook naar het cluster, en horen er geen planbare overige diensten (O, OR, VMS, TD) in het rooster. Indicatieve data zijn startwaarden: controleer ze of haal de officiële data op." rechts={<button type="button" className="btn btn-ghost" onClick={() => actie(() => haalSchoolvakanties([schooljaar, volgend]), (n) => `${n} schoolvakanties opgehaald.`)}><DownloadCloud size={16} /> Ophalen bij rijksoverheid.nl</button>}>
      <div className="scroll">
        <table className="tb">
          <thead><tr><th>Vakantie</th><th>Regio</th><th>Van</th><th>Tot en met</th><th>Bron</th><th /></tr></thead>
          <tbody>
            {lijst.map((v) => (
              <tr key={v.id}>
                <td className="font-semibold">{v.naam}</td>
                <td>{SCHOOLREGIO_LABEL[v.regio]}</td>
                <td>{fmtDJ(v.van)}</td>
                <td>{fmtDJ(v.tot)}</td>
                <td>{v.bron === 'indicatief' ? <Pill soort="warn">indicatief</Pill> : v.bron === 'rijksoverheid' ? <Pill soort="ok">rijksoverheid</Pill> : <Pill>handmatig</Pill>}</td>
                <td className="r"><button type="button" className="btn btn-ghost btn-icon" aria-label={`${v.naam} verwijderen`} onClick={() => zetSchoolvakanties(lijst.filter((x) => x.id !== v.id))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
            <tr>
              <td><input className="input" value={nieuw.naam} onChange={(e) => setNieuw({ ...nieuw, naam: e.target.value })} aria-label="Naam vakantie" /></td>
              <td><select className="input" value={nieuw.regio} onChange={(e) => setNieuw({ ...nieuw, regio: e.target.value as Schoolvakantie['regio'] })} aria-label="Regio vakantie">{Object.entries(SCHOOLREGIO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td><input className="input" type="date" value={nieuw.van} onChange={(e) => setNieuw({ ...nieuw, van: e.target.value })} aria-label="Van" /></td>
              <td><input className="input" type="date" value={nieuw.tot} min={nieuw.van} onChange={(e) => setNieuw({ ...nieuw, tot: e.target.value })} aria-label="Tot en met" /></td>
              <td colSpan={2} className="r"><button type="button" className="btn btn-ghost" disabled={!nieuw.naam.trim() || nieuw.tot < nieuw.van} onClick={() => zetSchoolvakanties([...lijst, { ...nieuw, id: `${Date.now()}`, naam: nieuw.naam.trim() }])}><Plus size={15} /> Toevoegen</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Sectie>
  );
}

/** Wie mag wat (§ 5.1), uit lib/rechten.ts; dezelfde verdeling staat in de RLS van de database. */
function RollenEnRechten() {
  const rollen: Rol[] = ['planner', 'regiomanager', 'beheerder', 'medewerker'];
  const beleid = useApp((x) => x.beleid);
  return (
    <Sectie titel={<span className="flex items-center gap-2"><ShieldCheck size={22} className="text-accent" /> Rollen en rechten</span>} lead={<>De planner maakt en toetst het rooster en biedt het aan; de regiomanager keurt het goed en besluit over verlof (<Link href="/beleid#p-5.1" className="text-accent">§ 5.1</Link>){beleid.plannerBesluitVerlof ? '; zo ingesteld besluit de planner ook over verlof' : ''}. De beheerder richt de app in maar keurt niet goed, zodat maken en goedkeuren gescheiden blijven. De rol komt uit het GRIP-profiel: een regio- of clustermanager is regiomanager.</>}>
      <div className="scroll">
        <table className="tb">
          <thead><tr><th>Mag</th>{rollen.map((r) => <th key={r} className="text-center">{ROL_LABEL[r]}</th>)}</tr></thead>
          <tbody>
            {(Object.keys(RECHT_LABEL) as Recht[]).map((recht) => (
              <tr key={recht}>
                <td>{RECHT_LABEL[recht]}{RECHT_BRON[recht] && <span className="note"> · § {RECHT_BRON[recht]}</span>}</td>
                {rollen.map((r) => <td key={r} className="text-center">{mag(r, recht, beleid) ? <Check size={16} className="inline text-teal" aria-label="ja" /> : <span className="text-muted" aria-label="nee">–</span>}</td>)}
              </tr>
            ))}
            <tr>
              <td>Eigen rooster, voorkeuren, verlof aanvragen en ruilen</td>
              {rollen.map((r) => <td key={r} className="text-center">{r === 'medewerker' ? <Check size={16} className="inline text-teal" aria-label="ja" /> : <span className="text-muted" aria-label="nee">–</span>}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </Sectie>
  );
}
