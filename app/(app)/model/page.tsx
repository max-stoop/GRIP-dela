'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Upload, Sparkles, DownloadCloud as CloudDownload, FlaskConical, RotateCcw, Trash2, Anchor, Eye, Plus, RefreshCw } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Box, GeenToegang, Modal, PaginaKop, Pill, Sectie, Spinner, Veld } from '@/components/ui';
import {
  griepToevoegen, griepVerwijderen, haalHistorie, kalibreren, laadDemo, startwaardenTerug, useApp, useTaak,
  vastleggenRoosterbasis, verversBronnen, verwijderRun, zetMeldingen, useOpslagwijze,
} from '@/lib/store/store';
import { useRunData } from '@/lib/store/hooks';
import { factoren, lamBasis, meldingenEind } from '@/lib/store/afgeleid';
import { leesBestand, verdwijntBijVervangen, voegSamen, type ImportResultaat } from '@/lib/import';
import { FACTORS, PRIORS, RATIO_FACTORS, type FactorKey } from '@/lib/model/config';
import { addDays, fmtD, fmtDJ, fmtMoment, todayIso } from '@/lib/dates';
import { nl, pctS, plural } from '@/lib/format';
import { gebrekTekst, isActueel, laatsteDatum } from '@/lib/bronnen/actualiteit';
import { VastgesteldePlekken } from '@/components/voorspelling/VastgesteldePlekken';

const BRONNEN: [string, string, string][] = [
  ['weer', 'Weersverwachting', 'Open-Meteo, per regio, 16 dagen vooruit'],
  ['lucht', 'Luchtkwaliteit', 'Open-Meteo, fijnstof en ozon, 5 dagen vooruit'],
  ['seizoen', 'Seizoensverwachting', 'Open-Meteo, de komende maanden'],
  ['riool', 'Rioolwater COVID', 'RIVM, landelijk, per week'],
  ['cbs', 'Sterfte per week', 'CBS, landelijk'],
  ['normalen', 'Klimaatnormaal', 'De Bilt, gemiddelde over 30 jaar'],
  ['weer_archief', 'Weerhistorie', 'voor de kalibratie'],
  ['lucht_archief', 'Luchthistorie', 'voor de kalibratie'],
];

export default function ModelPagina() {
  const s = useSessie();
  const opslag = useOpslagwijze();
  const door = useDoor();
  const actie = useActie();
  const taak = useTaak();
  const st = useApp((x) => x);
  const laatste = st.runs[0];
  const run = useRunData(laatste?.id);
  const bestand = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<ImportResultaat | null>(null);
  const [demoVraag, setDemoVraag] = useState(false);
  const [griep, setGriep] = useState({ datum: todayIso(), waarde: '' });
  if (!s.isBeheerder) return <GeenToegang />;
  // bij een bestaande historie (geen demo): aanvullen, of bewust alles vervangen
  const samen = upload && st.meldingen && !st.demo ? voegSamen(st.meldingen, upload.data) : null;
  const weg = samen && upload ? verdwijntBijVervangen(st.meldingen, upload.data) : 0;
  const aantal = (n: number, een: string, meer: string) => `${n.toLocaleString('nl-NL')} ${n === 1 ? een : meer}`;

  const m = st.meldingen;
  const eind = m ? meldingenEind(m) : null;
  const effect = (k: FactorKey) => {
    if (!run) return '';
    const d = run.dates[0];
    let w = 0, som = 0;
    for (const r of run.regios) {
      const b = lamBasis(run, r, d) ?? 0;
      som += b * (factoren(run, r, d)[k] ?? 0);
      w += b;
    }
    return w ? pctS(Math.exp(som / w) - 1) : '';
  };
  const fmtCoef = (k: FactorKey, v: number) => (RATIO_FACTORS.includes(k) ? nl(v, 2) : `${nl(v * 100, 1)}%`);
  const bt = st.backtest;

  const kiesBestand = async (f: File) => {
    const r = await actie(() => leesBestand(f));
    if (r) setUpload(r);
  };

  return (
    <>
      <PaginaKop titel="Bronnen en model" lead="Het basismodel kijkt naar seizoen, weekdag en feestdagen. Daarbovenop sturen actuele bronnen bij: op twee maanden vooral het recente niveau en de seizoensverwachting, op vier dagen ook weer, luchtkwaliteit, rioolwater en griep." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Box titel="Meldingenhistorie">
          {m && eind ? (
            <p className="text-[15px]"><b>{fmtDJ(m.start)}</b> tot en met <b>{fmtDJ(eind)}</b>, {Object.keys(m.regios).length} regio&apos;s. {st.demo && <Pill soort="warn">demodata</Pill>}</p>
          ) : <p className="note">Nog geen meldingen.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => bestand.current?.click()} disabled={!!taak}><Upload size={16} /> Bestand uploaden</button>
            {opslag !== 'database' && <button type="button" className="btn btn-ghost" onClick={() => setDemoVraag(true)} disabled={!!taak}><Sparkles size={16} /> Demodata</button>}
            <input ref={bestand} type="file" accept=".xlsx,.xls,.csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) kiesBestand(f); }} />
          </div>
          <p className="note mt-3">Excel of CSV met kolommen datum, regio, aantal, of een breed bestand met een datumkolom en per regio een kolom. Een bestand met alleen de laatste dagen vult de historie aan.</p>
        </Box>

        <Box titel="Kalibratie op eigen data">
          {bt ? (
            <>
              <p className="text-[15px]">Laatst gekalibreerd {fmtMoment(bt.datum)}, testperiode vanaf {fmtD(bt.knippunt)}.</p>
              <table className="tb mt-2">
                <thead><tr><th>Horizon</th><th className="r">Fout basis</th><th className="r">Bijgestuurd</th><th className="r">Verschil</th></tr></thead>
                <tbody>
                  {(['h4', 'h45'] as const).map((h) => {
                    const r = bt.resultaat[h];
                    return <tr key={h}><td>{h === 'h4' ? '4 dagen vooruit' : '45 dagen vooruit'}</td><td className="r">{nl(r.mae_basis)}</td><td className="r">{nl(r.mae_bijgestuurd)}</td><td className="r font-semibold" style={{ color: r.mae_bijgestuurd <= r.mae_basis ? 'var(--teal)' : 'var(--red)' }}>{pctS(r.mae_bijgestuurd / r.mae_basis - 1)}</td></tr>;
                  })}
                </tbody>
              </table>
              <p className="note mt-1">Gemiddelde absolute afwijking in meldingen per dag, landelijk. De terugtest rekent alleen met wat op de dag van de voorspelling bekend was. De weersverwachtingen van toen zijn niet bewaard, dus hitte, fijnstof, ozon en de seizoensverwachting worden niet geschat en houden hun startwaarde.</p>
            </>
          ) : <p className="note">Nog niet gekalibreerd. Haal eerst de weer- en luchthistorie op over dezelfde periode als de meldingen.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" disabled={!m || !!taak} onClick={() => actie(haalHistorie, (ok) => ok ? 'Weer- en luchthistorie opgehaald.' : 'Historie deels niet opgehaald; zie de bronnentabel.')}><CloudDownload size={16} /> Historie ophalen</button>
            <button type="button" className="btn" disabled={!m || !!taak} onClick={() => actie(kalibreren, 'Kalibratie klaar en nieuwe voorspelling gemaakt.')}>{taak?.naam === 'Kalibreren' ? <Spinner /> : <FlaskConical size={16} />} Kalibreren</button>
            {Object.keys(st.coef).length > 0 && <button type="button" className="btn btn-ghost" onClick={() => actie(startwaardenTerug, 'Terug naar de startwaarden. Maak een nieuwe run om dit door te voeren.')}><RotateCcw size={16} /> Startwaarden</button>}
          </div>
        </Box>

        <Box titel="Griepsignaal">
          <p className="note">Griepachtige consulten per 100.000 inwoners uit de wekelijkse huisartsensurveillance (Nivel). Telt alleen mee als het niet ouder is dan 14 dagen.</p>
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(griep.waarde.replace(',', '.')); if (!Number.isFinite(v)) return; actie(() => { griepToevoegen(griep.datum, v); setGriep({ ...griep, waarde: '' }); }, 'Griepwaarde opgeslagen.'); }}>
            <Veld label="Week van"><input className="input" type="date" required value={griep.datum} onChange={(e) => setGriep({ ...griep, datum: e.target.value })} /></Veld>
            <Veld label="Per 100.000"><input className="input w-[110px]" inputMode="decimal" required value={griep.waarde} onChange={(e) => setGriep({ ...griep, waarde: e.target.value })} /></Veld>
            <button className="btn"><Plus size={16} /> Toevoegen</button>
          </form>
          <ul className="mt-3 grid gap-1 text-sm">
            {st.handmatig.filter((h) => h.variabele === 'flu_ili').slice(0, 6).map((h) => (
              <li key={h.datum} className="flex items-center justify-between"><span>{fmtDJ(h.datum)}</span><span className="flex items-center gap-2"><b className="num">{nl(h.waarde)}</b><button type="button" className="text-muted hover:text-rood" onClick={() => griepVerwijderen(h.datum)} aria-label="Verwijderen"><Trash2 size={14} /></button></span></li>
            ))}
            {!st.handmatig.some((h) => h.variabele === 'flu_ili') && <li className="note">Nog geen waarden.</li>}
          </ul>
        </Box>
      </div>

      <Sectie titel="Bronnen" rechts={<button type="button" className="btn btn-ghost btn-sm" disabled={!!taak || !m} onClick={() => actie(() => verversBronnen(), (r) => `${r.ok} bronnen ververst${r.fout ? `, ${r.fout} niet bereikbaar` : ''}.${r.gebreken.length ? ` Niet actueel: ${r.gebreken.map((g) => g.label).join(', ')}.` : ''}`)}><RefreshCw size={15} /> Nu verversen</button>}>
        <DagelijkseVoorspelling />
        <div className="scroll">
          <table className="tb">
            <thead><tr><th>Bron</th><th>Wat</th><th>Laatst opgehaald</th><th>Status</th><th>Gegevens tot</th><th className="r">Rijen</th></tr></thead>
            <tbody>
              {BRONNEN.map(([k, n, w]) => {
                const b = st.bronStatus[k];
                // tot wanneer de gegevens lopen, en of dat ver genoeg is (alleen bij de bronnen van de dagelijkse voorspelling)
                const tot = laatsteDatum(st.extern[k]);
                const actueel = isActueel(k, tot, todayIso());
                return (
                  <tr key={k}>
                    <td className="font-semibold">{n}</td>
                    <td className="note">{w}</td>
                    <td className="whitespace-nowrap">{b ? fmtMoment(b.opgehaald) : 'nog niet'}</td>
                    <td>{!b ? <Pill soort="warn">wacht</Pill> : b.ok ? <Pill soort="ok">ok</Pill> : <span className="flex flex-wrap items-center gap-2"><Pill soort="bad">niet opgehaald</Pill><span className="note">Probeer het later opnieuw.</span></span>}</td>
                    <td className="whitespace-nowrap">{actueel === null ? '' : <span className="flex items-center gap-2">{tot ? fmtD(tot) : '–'}{!actueel && <Pill soort="warn">{tot ? 'verouderd' : 'ontbreekt'}</Pill>}</span>}</td>
                    <td className="r">{b?.rijen ? b.rijen.toLocaleString('nl-NL') : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Sectie>

      <VastgesteldePlekken />

      <Sectie titel="Bijstuurfactoren" lead="Elke factor duwt de verwachting van het basismodel een paar procent omhoog of omlaag. De startwaarde komt uit onderzoek naar sterfte (zie hieronder waarom); na kalibratie staat ernaast wat de eigen historie zegt, en die schatting telt dan. De laatste kolom toont wat de factor in de laatste voorspelling voor morgen doet: bij gewoon weer is dat bij hitte en kou 0.">
        <div className="scroll">
          <table className="tb">
            <thead><tr><th>Factor</th><th>Bron</th><th>Eenheid</th><th>Horizon</th><th className="r">Startwaarde</th><th className="r">Geschat</th><th className="r">Onzekerheid</th><th className="r">Effect morgen</th></tr></thead>
            <tbody>
              {FACTORS.map((k) => {
                const p = PRIORS[k], c = st.coef[k];
                return (
                  <tr key={k}>
                    <td className="font-semibold">{p.label}</td>
                    <td className="note">{p.bron}</td>
                    <td className="note">{p.eenheid}</td>
                    <td className="whitespace-nowrap">{p.horizon === 'kort' ? 'tot 16 dagen' : 'tot 61 dagen'}</td>
                    <td className="r">{fmtCoef(k, p.prior)}</td>
                    <td className="r font-semibold">{c ? fmtCoef(k, c.waarde) : '–'}</td>
                    <td className="r">{c ? `± ${fmtCoef(k, c.se)}` : ''}</td>
                    <td className="r">{effect(k)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details className="box mt-3">
          <summary className="cursor-pointer font-semibold">Waarom deze startwaarden?</summary>
          <dl className="mt-3 grid gap-2.5 text-[14.5px]">
            {FACTORS.map((k) => (
              <div key={k}>
                <dt className="font-semibold">{PRIORS[k].label} <span className="note font-normal">({fmtCoef(k, PRIORS[k].prior)} {PRIORS[k].eenheid})</span></dt>
                <dd className="m-0">{PRIORS[k].waarom}</dd>
              </div>
            ))}
          </dl>
          <p className="note mt-3">Elk percentage is het effect van die factor alleen. Spelen er meer tegelijk, dan stapelen ze: +10% hitte en +4% drukte geeft samen ongeveer +14%.</p>
        </details>
      </Sectie>

      <Sectie titel="Runs" lead={`Elke run wordt bewaard (maximaal 60), zodat per doeldatum zichtbaar is hoe de verwachting verschoof. De roosterbasis blijft altijd bewaard.`}>
        <div className="scroll max-h-[520px]">
          <table className="tb">
            <thead><tr><th>Uitgegeven</th><th>Gemaakt</th><th>Soort</th><th>Meldingen t/m</th><th>Opmerkingen</th><th /></tr></thead>
            <tbody>
              {st.runs.map((r, i) => {
                const isBasis = r.id === st.roosterbasis?.runId;
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap font-semibold">{fmtDJ(r.uitgegeven)} {i === 0 && <Pill soort="info">laatste</Pill>} {isBasis && <Pill soort="warn">roosterbasis</Pill>}</td>
                    <td className="note whitespace-nowrap">{fmtMoment(r.gemaakt)}</td>
                    <td>{r.soort}</td>
                    <td className="whitespace-nowrap">{r.info.data_end ? fmtD(r.info.data_end) : '–'}</td>
                    <td className="note">{r.info.notes.join('. ')}</td>
                    <td className="r whitespace-nowrap">
                      <Link className="btn btn-ghost btn-icon" href={i === 0 ? '/voorspelling' : `/voorspelling?run=${encodeURIComponent(r.id)}`} title="Bekijken" aria-label="Bekijken"><Eye size={15} /></Link>{' '}
                      <button type="button" className="btn btn-ghost btn-icon" disabled={isBasis} onClick={() => actie(() => vastleggenRoosterbasis(r.id, door), 'Vastgelegd als roosterbasis.')} title="Vastleggen als roosterbasis" aria-label="Vastleggen als roosterbasis"><Anchor size={15} /></button>{' '}
                      <button type="button" className="btn btn-danger btn-icon" disabled={isBasis || i === 0} onClick={() => actie(() => verwijderRun(r.id), 'Run verwijderd.')} title="Verwijderen" aria-label="Verwijderen"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Sectie>

      <Modal open={!!upload} onClose={() => setUpload(null)} titel="Meldingen inlezen?" voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => setUpload(null)}>Annuleren</button>
        {samen ? <>
          <button type="button" className={weg > 0 ? 'btn btn-danger' : 'btn btn-ghost'} onClick={() => { const u = upload!; setUpload(null); actie(() => zetMeldingen(u.data, `${u.rijen} rijen`, 'vervangen'), 'Historie vervangen en nieuwe voorspelling gemaakt.'); }}>Alles vervangen</button>
          <button type="button" className="btn btn-teal" onClick={() => { const u = upload!; setUpload(null); actie(() => zetMeldingen(u.data, `${u.rijen} rijen`, 'aanvullen'), 'Meldingen aangevuld en nieuwe voorspelling gemaakt.'); }}><Upload size={16} /> Aanvullen en voorspellen</button>
        </> : (
          <button type="button" className="btn btn-teal" onClick={() => { const u = upload!; setUpload(null); actie(() => zetMeldingen(u.data, `${u.rijen} rijen`, 'vervangen'), 'Historie ingelezen en nieuwe voorspelling gemaakt.'); }}><Upload size={16} /> Inlezen en voorspellen</button>
        )}
      </>}>
        {upload && (
          <div className="grid gap-2 text-[15px]">
            <p><b>{upload.rijen.toLocaleString('nl-NL')}</b> rijen, <b>{upload.regios}</b> regio&apos;s, {fmtDJ(upload.van)} tot en met {fmtDJ(upload.tot)}.</p>
            {upload.onbekend.length > 0 && <p className="banner">Niet herkend en overgeslagen: {upload.onbekend.slice(0, 8).join(', ')}{upload.onbekend.length > 8 ? ` en ${upload.onbekend.length - 8} meer` : ''}.</p>}
            {upload.dubbel > 0 && <p className="note">{plural(upload.dubbel, 'dubbele rij', 'dubbele rijen')}: de laatste waarde telt.</p>}
            {upload.nul > 0 && <p className="note">{plural(upload.nul, 'regio-dag', 'regio-dagen')} zonder rij of met een lege cel, tussen de eerste en laatste dag van die regio in het bestand: die tellen als 0 meldingen.</p>}
            {samen ? <>
              <p><b>Aanvullen</b>: {aantal(samen.nieuw, 'nieuwe regio-dag', 'nieuwe regio-dagen')}, {samen.gewijzigd.toLocaleString('nl-NL')} bijgewerkt{samen.gelijk ? `, ${samen.gelijk.toLocaleString('nl-NL')} stonden er al zo` : ''}. De historie loopt daarna van {fmtDJ(samen.data.start)} tot en met {fmtDJ(addDays(samen.data.start, samen.data.n - 1))}; wat niet in het bestand staat, blijft staan.</p>
              <p className="note"><b className="text-ink">Alles vervangen</b> is alleen voor een bestand met de hele historie. {weg > 0 ? <b className="text-rood">{aantal(weg, 'regio-dag', 'regio-dagen')} met meldingen {weg === 1 ? 'staat' : 'staan'} er niet in en {weg === 1 ? 'verdwijnt' : 'verdwijnen'} dan.</b> : 'Er verdwijnt dan niets.'}</p>
            </> : (
              <p className="note">{st.demo ? 'De demodata worden vervangen.' : 'Dit wordt de meldingenhistorie.'} Roosters, teams en verlof blijven staan.</p>
            )}
          </div>
        )}
      </Modal>

      <Modal open={demoVraag} onClose={() => setDemoVraag(false)} titel="Demodata laden?" voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => setDemoVraag(false)}>Annuleren</button>
        <button type="button" className="btn btn-teal" onClick={() => { setDemoVraag(false); actie(laadDemo, 'Demo opnieuw klaargezet.'); }}><Sparkles size={16} /> Demo laden</button>
      </>}>
        <p>Alle gegevens in deze browser (meldingen, runs, teams, roosters, verlof en ruilen) worden vervangen door de demo. Bronnen en klimaatnormalen blijven bewaard.</p>
      </Modal>
    </>
  );
}

/** Hoe de dagelijkse voorspelling van vandaag ging: elke ochtend automatisch, met de status erbij. */
function DagelijkseVoorspelling() {
  const d = useApp((x) => x.dagtaak);
  const vandaag = todayIso();
  const waar = d?.waar === 'browser' ? 'in de app' : 'automatisch';
  const wanneer = d ? `${waar}${d.klaar ? ` om ${d.klaar.slice(11, 16)}` : ''}${d.bronnen ? `, bronnen ${d.bronnen.ok} van ${d.bronnen.ok + d.bronnen.fout} opgehaald` : ''}` : '';
  return (
    <div className="mb-3 grid gap-1 text-[14.5px]" aria-label="Dagelijkse voorspelling">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Dagelijkse voorspelling:</span>
        {!d ? <span className="note">elke ochtend automatisch; nog niet gedraaid.</span>
          : d.status === 'geslaagd' ? <><Pill soort={d.datum === vandaag ? 'ok' : 'warn'}>{d.datum === vandaag ? 'vandaag volledig gelukt' : `laatst gelukt ${fmtD(d.datum)}`}</Pill><span className="note">{wanneer}; alle bronnen actueel</span></>
          : d.status === 'beperkt' ? <><Pill soort="warn">{d.datum === vandaag ? 'vandaag gelukt, met verouderde of ontbrekende bronnen' : `laatst gelukt ${fmtD(d.datum)}, met verouderde of ontbrekende bronnen`}</Pill><span className="note">{wanneer}</span></>
          : d.status === 'gestart' ? <><Pill soort="info">bezig</Pill><span className="note">gestart om {d.gestart.slice(11, 16)}</span></>
          : <><Pill soort="bad">mislukt</Pill><span className="note">{fmtMoment(d.klaar ?? d.gestart)}: {d.melding}</span></>}
      </p>
      {d?.status === 'beperkt' && d.gebreken?.length ? (
        <p className="note">
          De voorspelling is gemaakt met wat er wel was. {d.gebreken.map((g) => gebrekTekst(g, fmtD)).join('; ')}. Met <em>Nu verversen</em> probeer je het opnieuw.
        </p>
      ) : null}
    </div>
  );
}
