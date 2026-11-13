'use client';
import { useMemo, useState } from 'react';
import { FileUp, Upload } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Modal, Spinner, Veld } from '@/components/ui';
import { importeerJaarrooster, useApp, type ImportRij } from '@/lib/store/store';
import { REGIONS } from '@/lib/model/config';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { WEEKEND_CADANS_NAAM, type DienstCode } from '@/lib/rooster/types';
import { CODE_STANDAARD, WENS_VRIJ, codesTellen, leesJaarrooster, weekendCadansUit, type Cel, type JaarBlad } from '@/lib/jaarrooster';
import { addDays, fmtD, todayIso } from '@/lib/dates';
import { plural } from '@/lib/format';

const KEUZES: DienstCode[] = ['1', '1M', '2', '1B', 'DG1', 'DG2', 'O', 'O4', 'OR', 'VMS', 'TD', 'V', 'Z', '-'];
const label = (c: DienstCode) => (c === '-' ? 'Vrij' : `${c} · ${DIENSTEN[c].naam}`);
const afkorting = (blad: string) => blad.replace(/\s*\(.*$/, '').trim().toUpperCase().slice(0, 6);

/** Namen worden niet gelezen: elke rij wordt "AMS 01", of je koppelt hem aan iemand die al in het team staat. */
export function JaarroosterImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSessie();
  const door = useDoor();
  const actie = useActie();
  const mijnRegios = REGIONS.filter((r) => s.regios.includes(r));
  const medewerkers = useApp((x) => x.medewerkers);
  const [bladen, setBladen] = useState<JaarBlad[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [keuze, setKeuze] = useState<Record<string, { aan: boolean; regio: string }>>({});
  const [codes, setCodes] = useState<Record<string, DienstCode>>({});
  const [koppel, setKoppel] = useState<Record<string, string>>({});
  const [vanaf, setVanaf] = useState(addDays(todayIso(), 1));
  const [alleenLeeg, setAlleenLeeg] = useState(false);
  const [wens, setWens] = useState(true);

  const telling = useMemo(() => (bladen ? codesTellen(bladen.filter((b) => keuze[b.blad]?.aan)) : new Map<string, number>()), [bladen, keuze]);
  const dienst = (c: string): DienstCode | null => (c ? codes[c] ?? CODE_STANDAARD[c] ?? '-' : null);

  const reset = () => { setBladen(null); setFout(null); setKeuze({}); setCodes({}); setKoppel({}); };
  const sluit = () => { reset(); onClose(); };

  const lees = async (file: File) => {
    setBezig(true); setFout(null);
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Kies een Excel-bestand (.xlsx).');
      const { default: lezen } = await import('read-excel-file/browser');
      const gelezen = await lezen(file) as unknown as { sheet: string; data: Cel[][] }[];
      const uit = leesJaarrooster(gelezen, file.name);
      if (!uit.length) throw new Error('Geen roosterbladen gevonden. Een blad heeft een kolom "mw" met daarnaast "contract-uren", en daarboven een rij "datum" met de dagen.');
      setBladen(uit);
      // alleen regio's waar deze gebruiker bij mag
      setKeuze(Object.fromEntries(uit.map((b) => { const regio = b.regio && mijnRegios.includes(b.regio) ? b.regio : ''; return [b.blad, { aan: !!regio && !b.variant, regio }]; })));
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Het bestand kon niet worden gelezen.');
    } finally {
      setBezig(false);
    }
  };

  const gekozen = (bladen ?? []).filter((b) => keuze[b.blad]?.aan && keuze[b.blad].regio);
  const rijenVan = (b: JaarBlad): ImportRij[] => b.rijen.map((r) => {
    const diensten: Record<string, DienstCode> = {};
    const wensVrij: string[] = [];
    b.dagen.forEach((d, i) => {
      if (d < vanaf) return;
      const c = r.codes[i], x = dienst(c);
      if (x == null) return;
      diensten[d] = x;
      if (wens && WENS_VRIJ.has(c)) wensVrij.push(d);
    });
    const alles = b.dagen.map((_, i) => dienst(r.codes[i]) ?? '-');
    const { cadans, groep } = weekendCadansUit(b.dagen, alles);
    return { nr: r.nr, contract: r.contract, cadans, groep, medewerkerId: koppel[`${b.blad}|${r.nr}`] || null, diensten, wensVrij };
  });
  const voorbeeld = gekozen.map((b) => ({ b, rijen: rijenVan(b) }));
  const totaal = voorbeeld.reduce((s, x) => s + x.rijen.reduce((t, r) => t + Object.keys(r.diensten).length, 0), 0);

  const importeer = () => actie(() => {
    let nieuw = 0, diensten = 0, wensen = 0;
    for (const { b, rijen } of voorbeeld) {
      const r = importeerJaarrooster(keuze[b.blad].regio, afkorting(b.blad), rijen, { alleenLeeg }, door);
      nieuw += r.nieuw; diensten += r.diensten; wensen += r.wensen;
    }
    sluit();
    return { nieuw, diensten, wensen };
  }, (r) => `Jaarrooster geïmporteerd: ${plural(r.diensten, 'dienst', 'diensten')}${r.nieuw ? `, ${plural(r.nieuw, 'nieuwe medewerker', 'nieuwe medewerkers')}` : ''}${r.wensen ? `, ${plural(r.wensen, 'wens', 'wensen')} vrij` : ''}. Ongedaan maken kan niet; controleer het rooster.`);

  return (
    <Modal open={open} onClose={sluit} breed titel={<span className="flex items-center gap-2"><FileUp size={20} className="text-accent" /> Jaarrooster importeren</span>} voet={<>
      <button type="button" className="btn btn-ghost" onClick={sluit}>Annuleren</button>
      <button type="button" className="btn btn-teal" disabled={!gekozen.length || !totaal} onClick={importeer}><Upload size={16} /> {totaal ? `${plural(totaal, 'dienst', 'diensten')} importeren` : 'Importeren'}</button>
    </>}>
      <div className="grid gap-5">
        <p className="text-[15px]">Kies het jaarrooster (Excel). Per regio een blad; elke rij met contracturen wordt een medewerker. <b>Namen worden niet overgenomen</b>: een nieuwe medewerker heet bijvoorbeeld &quot;AMS 01&quot;, of je koppelt de rij aan iemand die al in het team staat. Contracturen en de weekendcadans komen uit het rooster. Verlof en ziekte die al in GRIP staan, blijven staan.</p>
        <label className="label"><span>Bestand</span>
          <input className="input" type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) void lees(f); }} />
        </label>
        {bezig && <p className="flex items-center gap-2 text-[15px]"><Spinner /> Bestand lezen…</p>}
        {fout && <p className="banner banner-bad">{fout}</p>}

        {bladen && (
          <>
            <div className="grid gap-2">
              <div className="text-sm font-semibold text-muted">Bladen</div>
              {bladen.map((b) => {
                const k = keuze[b.blad] ?? { aan: false, regio: '' };
                return (
                  <div key={b.blad} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
                    <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={k.aan} onChange={(e) => setKeuze({ ...keuze, [b.blad]: { ...k, aan: e.target.checked } })} /> {b.blad}</label>
                    <select className="input w-auto" aria-label={`Regio voor ${b.blad}`} value={k.regio} onChange={(e) => setKeuze({ ...keuze, [b.blad]: { ...k, regio: e.target.value } })}>
                      <option value="">Kies een regio</option>
                      {mijnRegios.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <span className="note">{plural(b.rijen.length, 'medewerker', 'medewerkers')} · {fmtD(b.dagen[0])} t/m {fmtD(b.dagen[b.dagen.length - 1])}{b.overgeslagen ? ` · ${plural(b.overgeslagen, 'rij', 'rijen')} zonder contracturen (flex) overgeslagen` : ''}{b.variant ? ' · lijkt een variant' : ''}</span>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Veld label="Vanaf" hint="Dagen daarvoor blijven zoals ze zijn."><input className="input" type="date" value={vanaf} onChange={(e) => setVanaf(e.target.value)} /></Veld>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={alleenLeeg} onChange={(e) => setAlleenLeeg(e.target.checked)} /><span>Alleen lege vakjes vullen <span className="note block">Wat al in GRIP staat, blijft staan.</span></span></label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={wens} onChange={(e) => setWens(e.target.checked)} /><span>RV en NB ook als wens &quot;vrij&quot; <span className="note block">Zodat rooster maken er later rekening mee houdt.</span></span></label>
            </div>

            {telling.size > 0 && (
              <div>
                <div className="mb-1.5 text-sm font-semibold text-muted">Codes in het rooster</div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[...telling].map(([c, n]) => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <span className="w-[70px] font-mono font-semibold">{c}</span>
                      <span className="w-[56px] text-right text-muted">{n}×</span>
                      <select className="input min-w-0 flex-1" aria-label={`Code ${c}`} value={dienst(c) ?? '-'} onChange={(e) => setCodes({ ...codes, [c]: e.target.value as DienstCode })}>
                        {KEUZES.map((x) => <option key={x} value={x}>{label(x)}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {voorbeeld.map(({ b, rijen }) => {
              const regio = keuze[b.blad].regio, afk = afkorting(b.blad);
              const team = medewerkers.filter((m) => m.regio === regio && m.actief).sort((x, y) => x.naam.localeCompare(y.naam));
              return (
                <details key={b.blad} className="rounded-lg border border-line p-3">
                  <summary className="cursor-pointer font-semibold">{b.blad} → {regio}: medewerkers koppelen ({rijen.length})</summary>
                  <div className="mt-3 grid gap-2">
                    {rijen.map((r) => {
                      const sleutel = `${b.blad}|${r.nr}`, naam = `${afk} ${String(r.nr).padStart(2, '0')}`;
                      const bestaand = team.find((m) => m.naam === naam);
                      return (
                        <div key={r.nr} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="w-[200px]">Rij {r.nr} · {r.contract} uur · {WEEKEND_CADANS_NAAM[r.cadans].toLowerCase()}{r.cadans > 1 ? ` (${'ABCD'[r.groep]})` : ''}</span>
                          <select className="input w-auto" aria-label={`Koppelen rij ${r.nr}`} value={koppel[sleutel] ?? ''} onChange={(e) => setKoppel({ ...koppel, [sleutel]: e.target.value })}>
                            <option value="">{bestaand ? `${naam} (al geïmporteerd)` : `Nieuw: ${naam}`}</option>
                            {team.filter((m) => m.naam !== naam).map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
                          </select>
                          <span className="note">{plural(Object.keys(r.diensten).length, 'dag', 'dagen')}</span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
            {gekozen.length > 0 && <p className="note">Wordt geïmporteerd: {gekozen.map((b) => `${b.blad} in ${keuze[b.blad].regio}`).join(', ')}, vanaf {fmtD(vanaf)}. Lege vakjes in het bestand laten GRIP zoals het is.</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
