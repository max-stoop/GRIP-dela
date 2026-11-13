'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Sparkles, ShieldCheck, Check, X, AlertTriangle, Lock, ListChecks } from 'lucide-react';
import { Modal, Pill, Spinner } from '@/components/ui';
import { fmtDag, toDay, weekday } from '@/lib/dates';
import { cx, nl, plural } from '@/lib/format';
import { bijsturen, geenExtraWerk, ACTIE_LABEL, type Actie } from '@/lib/rooster/bijsturen';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { ruilToets, pasToe } from '@/lib/rooster/ruil';
import { cel, toets, REGELS, type Toets } from '@/lib/rooster/toets';
import type { Wijziging } from '@/lib/rooster/voorstel';
import type { Behoefte, Beleid, Cellen, Medewerker, Voorkeurprofiel, Wens } from '@/lib/rooster/types';
import { maakVraag, type AdviesAntwoord } from '@/lib/ai/advies';
import { useApp } from '@/lib/store/store';
import { inSchoolvakantie } from '@/lib/capaciteit/verlof';

interface Beoordeeld {
  i: number;
  mid: string;
  naam: string;
  datum: string;
  van: string;
  naar: string;
  reden: string;
  status: 'ok' | 'let' | 'nee';
  uitleg: string;
  delta: number;
  w: Wijziging;
}

/** De eigen controle en het advies van de AI; elk AI-voorstel gaat eerst door de eigen toets. */
export function Verbeteren({ open, onClose, regio, team, dates, cellen, behoefte, wensen, profielen, beleid, t, vandaag, onToepassen }: {
  open: boolean;
  onClose: () => void;
  regio: string;
  team: Medewerker[];
  /** Vanaf vandaag. */
  dates: string[];
  cellen: Cellen;
  behoefte: Behoefte;
  wensen: Wens[];
  profielen: Record<string, Voorkeurprofiel>;
  beleid: Beleid;
  t: Toets;
  vandaag: string;
  onToepassen: (w: Wijziging[], tekst: string) => void;
}) {
  const tijden = useApp((x) => x.tijden[regio]);
  const verlof = useApp((x) => x.verlof);
  const aanvragen = useMemo(() => verlof.filter((v) => v.regio === regio && v.status === 'aangevraagd'), [verlof, regio]);
  const schoolvakanties = useApp((x) => x.schoolvakanties);
  const inVakantie = useCallback((d: string) => inSchoolvakantie(schoolvakanties, regio, d), [schoolvakanties, regio]);
  const [ai, setAi] = useState<{ beschikbaar: boolean; fout?: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [antwoord, setAntwoord] = useState<{ a: AdviesAntwoord; codes: Map<string, string> } | null>(null);
  const [gekozen, setGekozen] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open || ai) return;
    fetch('/api/ai/rooster').then((r) => r.json()).then((js) => setAi({ beschikbaar: !!js.beschikbaar, fout: js.fout })).catch(() => setAi({ beschikbaar: false }));
  }, [open, ai]);
  useEffect(() => { if (!open) { setAntwoord(null); setFout(null); setGekozen(new Set()); } }, [open]);

  const naam = useMemo(() => Object.fromEntries(team.map((e) => [e.id, e.naam])), [team]);

  // eigen controle: dezelfde acties als bij bijsturen, tegen de behoefte waartegen het rooster getoetst wordt
  const eigen = useMemo(() => {
    if (!open) return [];
    const b = bijsturen({ team, cellen, dates, basis: behoefte, nu: behoefte, beleid, vandaag, maxActies: 3, tijden, wensen, profielen, aanvragen });
    return b.dagen.filter((d) => d.acties.some((a) => a.wijzigingen.length));
  }, [open, team, cellen, dates, behoefte, beleid, vandaag, tijden, wensen, profielen, aanvragen]);

  const beoordeeld = useMemo<Beoordeeld[]>(() => {
    if (!antwoord) return [];
    return antwoord.a.voorstellen.map((v, i) => {
      const mid = antwoord.codes.get(v.medewerker) ?? '';
      const van = mid ? cel(cellen, mid, v.datum) : '-';
      const w: Wijziging = [mid, v.datum, v.dienst];
      const basis = { i, mid, naam: naam[mid] ?? v.medewerker, datum: v.datum, van, naar: v.dienst, reden: v.reden, w, delta: 0 };
      if (!mid) return { ...basis, status: 'nee', uitleg: `Onbekende medewerker ${v.medewerker}` };
      if (v.datum < vandaag || !dates.includes(v.datum)) return { ...basis, status: 'nee', uitleg: 'Datum valt buiten de periode' };
      if (van === 'V' || van === 'Z') return { ...basis, status: 'nee', uitleg: 'Verlof en ziekte blijven staan' };
      if (van === v.dienst) return { ...basis, status: 'nee', uitleg: 'Staat al zo in het rooster' };
      const r = ruilToets({ team, cellen, wijzigingen: [w], beleid, tijden });
      if (!r.ok) return { ...basis, status: 'nee', uitleg: r.bevindingen.filter((b) => b.ernst === 'hard').map((b) => b.tekst).join('; ') };
      const na = toets({ team, dates, cellen: pasToe(cellen, [w]), behoefte, wensen, beleid, profielen, tijden, schoolvakantie: inVakantie });
      const delta = Math.round((na.cijfer - t.cijfer) * 10) / 10;
      const vrijBinnen28 = !DIENSTEN[van].werk && DIENSTEN[v.dienst].werk && toDay(v.datum) - toDay(vandaag) < beleid.vastDagen;
      const extra = !DIENSTEN[van].werk && DIENSTEN[v.dienst].werk ? geenExtraWerk({ wensen, profielen, aanvragen }, mid, v.datum) : null;
      const letOp = [...r.bevindingen.map((b) => b.tekst), ...(vrijBinnen28 ? ['vrije dag binnen 28 dagen: alleen in overleg'] : []), ...(extra ? [extra] : [])];
      return { ...basis, delta, status: letOp.length ? 'let' : 'ok', uitleg: letOp.join('; ') };
    });
  }, [antwoord, cellen, naam, vandaag, dates, team, beleid, behoefte, wensen, profielen, aanvragen, t.cijfer, tijden, inVakantie]);

  const vraagAdvies = async () => {
    setBezig(true);
    setFout(null);
    setAntwoord(null);
    try {
      const { vraag, codes } = maakVraag({ regio, vandaag, team, dates, cellen, behoefte, wensen, profielen, beleid, toets: t });
      const r = await fetch('/api/ai/rooster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vraag) });
      const js = await r.json().catch(() => ({ fout: null }));
      if (!r.ok || js.fout !== undefined) throw new Error(js.fout || 'De AI-assistent gaf geen antwoord. Probeer het later opnieuw.');
      setAntwoord({ a: js.antwoord, codes });
      setGekozen(new Set());
    } catch (e) {
      setFout(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  };

  const geldig = beoordeeld.filter((b) => b.status !== 'nee');
  const keuze = geldig.filter((b) => gekozen.has(b.i));
  const samen = useMemo(() => {
    if (!keuze.length) return null;
    const w = keuze.map((b) => b.w);
    const r = ruilToets({ team, cellen, wijzigingen: w, beleid, tijden });
    const na = toets({ team, dates, cellen: pasToe(cellen, w), behoefte, wensen, beleid, profielen, tijden, schoolvakantie: inVakantie });
    return { ok: r.ok, cijfer: na.cijfer };
  }, [keuze, team, cellen, beleid, dates, behoefte, wensen, profielen, tijden, inVakantie]);

  const pasActieToe = (a: Actie, d: string) => onToepassen(a.wijzigingen, `${fmtDag(d)}: ${a.tekst}`);
  // harde overtredingen (ATW en CAO): eerst oplossen. De dienst op die dag vrij maken lost ze meestal op;
  // een eventueel tekort daarna vangt de eigen controle hieronder op.
  const hard = t.overtredingen.filter((o) => REGELS[o.regel].niveau === 'ATW en CAO' && o.datum >= vandaag)
    .filter((o, i, l) => l.findIndex((x) => x.mid === o.mid && x.datum === o.datum && x.regel === o.regel) === i)
    .slice(0, 8);

  return (
    <Modal open={open} onClose={onClose} breed titel={<span className="flex items-center gap-2"><Sparkles size={19} className="text-plum" /> Rooster {regio} verbeteren</span>} voet={<button type="button" className="btn btn-ghost" onClick={onClose}>Sluiten</button>}>
      <div className="grid gap-6">
        <section>
          <h3 className="kop-s flex items-center gap-2"><ListChecks size={18} className="text-accent" /> Eigen controle</h3>
          <p className="note mt-1">Dagen die niet kloppen met de afgesproken regelplekken of voorgangen, met acties volgens het stroomschema dagsturing (<Link href="/beleid#p-3.9" className="text-accent">§ 3.9</Link>). Elke actie is al getoetst op ATW, CAO en beleid.</p>
          {hard.length > 0 && (
            <ul className="mt-3 grid gap-1.5 rounded-lg border p-3" style={{ borderColor: 'var(--red)' }}>
              <li className="text-[14px] font-semibold text-rood">Eerst oplossen: overtredingen van ATW en CAO</li>
              {hard.map((o) => (
                <li key={`${o.mid}${o.datum}${o.regel}`} className="flex flex-wrap items-center gap-2 text-[14px]">
                  <Pill soort="bad">ATW/CAO</Pill>
                  <span className="min-w-[200px] flex-1">{naam[o.mid]}, {fmtDag(o.datum)}: {REGELS[o.regel].kort} <Link href={`/beleid#p-${REGELS[o.regel].paragraaf}`} className="text-accent">§ {REGELS[o.regel].paragraaf}</Link></span>
                  {DIENSTEN[cel(cellen, o.mid, o.datum)].werk && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onToepassen([[o.mid, o.datum, '-']], `${fmtDag(o.datum)}: ${naam[o.mid]} vrij gemaakt (${REGELS[o.regel].kort})`)}><Check size={14} /> Dag vrij maken</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {eigen.length ? (
            <ul className="mt-3 grid gap-2">
              {eigen.slice(0, 10).map((d) => (
                <li key={d.datum} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <b>{fmtDag(d.datum)}</b>
                    <span className="note">{d.p} gepland, {d.kNu ?? '–'} afgesproken · {d.voorgangen} voorgangen{d.ziek.length ? ` · ziek: ${d.ziek.join(', ')}` : ''}</span>
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    {d.acties.filter((a) => a.wijzigingen.length).map((a, j) => (
                      <div key={j} className="flex flex-wrap items-center gap-2 text-[14px]">
                        <Pill soort="neutral">{ACTIE_LABEL[a.soort]}</Pill>
                        <span className="flex-1">{a.tekst}{a.overleg && <span className="note"> · in overleg</span>}{a.bevindingen.length ? <span className="note"> · let op: {a.bevindingen.map((b) => b.tekst).join('; ')}</span> : null}</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => pasActieToe(a, d.datum)}><Check size={14} /> Toepassen</button>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-[15px]"><ShieldCheck size={18} className="text-teal" /> Elke dag heeft de afgesproken regelplekken en voorgangen.{hard.length ? '' : ' Niets te doen.'}</p>
          )}
        </section>

        <section className="border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="kop-s flex items-center gap-2"><Sparkles size={18} className="text-plum" /> AI-roosterassistent</h3>
              <p className="note mt-1">De AI-assistent beoordeelt het rooster tegen het roosterbeleid en stelt wijzigingen voor. Namen gaan niet mee: medewerkers heten M1, M2, enzovoort.</p>
            </div>
            <button type="button" className="btn" disabled={bezig || ai?.beschikbaar === false || !team.length} onClick={vraagAdvies}>{bezig ? <Spinner /> : <Sparkles size={16} />} {antwoord ? 'Opnieuw vragen' : 'Vraag advies'}</button>
          </div>
          {ai?.beschikbaar === false && (
            <div className="banner banner-info mt-3 flex gap-2 text-[14.5px]"><Lock size={16} className="mt-0.5 shrink-0" /><span>{ai.fout ? <>De AI-assistent is nu niet beschikbaar ({ai.fout}).</> : <>De AI-assistent is nog niet beschikbaar.</>} De eigen controle hierboven werkt altijd.</span></div>
          )}
          {bezig && <p className="mt-3 flex items-center gap-2 text-[15px]"><Spinner /> Het rooster wordt beoordeeld. Dit duurt meestal een halve tot twee minuten.</p>}
          {fout && <p className="banner banner-err mt-3">{fout}</p>}
          {antwoord && (
            <div className="mt-4 grid gap-4">
              <div className="rounded-lg bg-soft p-4 text-[15px]">
                {antwoord.a.samenvatting}
                {antwoord.a.sterk.length > 0 && <ul className="mt-2 grid gap-1">{antwoord.a.sterk.map((x) => <li key={x} className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-teal" />{x}</li>)}</ul>}
              </div>
              {antwoord.a.risicos.length > 0 && (
                <ul className="grid gap-2">
                  {antwoord.a.risicos.map((r, i) => (
                    <li key={i} className="flex gap-3 rounded-lg border border-line p-3 text-[14.5px]">
                      <AlertTriangle size={17} className={cx('mt-0.5 shrink-0', r.ernst === 'hoog' ? 'text-rood' : r.ernst === 'middel' ? 'text-gold' : 'text-muted')} />
                      <div><b>{r.titel}</b>{/^\d/.test(r.paragraaf) && <Link href={`/beleid#p-${r.paragraaf}`} className="ml-1.5 text-[12px] text-accent">§ {r.paragraaf}</Link>}<div className="note">{r.uitleg}</div></div>
                    </li>
                  ))}
                </ul>
              )}
              {beoordeeld.length > 0 && (
                <div>
                  <div className="scroll">
                    <table className="tb">
                      <thead><tr><th /><th>Wie</th><th>Dag</th><th>Wijziging</th><th>Waarom</th><th className="r">Cijfer</th><th>Toets</th></tr></thead>
                      <tbody>
                        {beoordeeld.map((b) => (
                          <tr key={b.i} className={cx(b.status === 'nee' && 'opacity-60')}>
                            <td>{b.status !== 'nee' && <input type="checkbox" aria-label={`Voorstel ${b.i + 1} kiezen`} checked={gekozen.has(b.i)} onChange={(e) => setGekozen((g) => { const n = new Set(g); if (e.target.checked) n.add(b.i); else n.delete(b.i); return n; })} />}</td>
                            <td className="whitespace-nowrap font-semibold">{b.naam}</td>
                            <td className="whitespace-nowrap">{fmtDag(b.datum)}{weekday(toDay(b.datum)) % 6 === 0 ? '' : ''}</td>
                            <td className="whitespace-nowrap"><span className={cx('rounded px-1.5 py-0.5 text-[12px] font-semibold', `c-${b.van}`)}>{b.van === '-' ? 'vrij' : b.van}</span> → <span className={cx('rounded px-1.5 py-0.5 text-[12px] font-semibold', `c-${b.naar}`)}>{b.naar === '-' ? 'vrij' : b.naar}</span></td>
                            <td className="min-w-[220px]">{b.reden}{b.uitleg && <div className="note">{b.uitleg}</div>}</td>
                            <td className={cx('r', b.delta > 0 && 'text-teal', b.delta < 0 && 'text-rood')}>{b.status === 'nee' ? '–' : `${b.delta > 0 ? '+' : ''}${nl(b.delta)}`}</td>
                            <td>{b.status === 'ok' ? <Pill soort="ok">in orde</Pill> : b.status === 'let' ? <Pill soort="warn">let op</Pill> : <Pill soort="bad"><X size={12} /> afgewezen</Pill>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGekozen(new Set(geldig.filter((b) => b.status === 'ok' && b.delta >= 0).map((b) => b.i)))}>Alle goede kiezen</button>
                    <span className="note flex-1">{samen ? `${plural(keuze.length, 'wijziging', 'wijzigingen')}: cijfer ${nl(t.cijfer)} wordt ${nl(samen.cijfer)}${samen.ok ? '' : ', maar samen geven ze een harde overtreding'}` : `${geldig.length} van ${beoordeeld.length} voorstellen doorstaan de toets.`}</span>
                    <button type="button" className="btn" disabled={!keuze.length || (samen != null && !samen.ok)} onClick={() => { onToepassen(keuze.map((b) => b.w), `AI-voorstel: ${plural(keuze.length, 'wijziging', 'wijzigingen')}`); setGekozen(new Set()); }}><Check size={16} /> Gekozen toepassen</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
