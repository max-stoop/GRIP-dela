'use client';
import Link from 'next/link';
import { ShieldCheck, Gauge, HeartHandshake, Smile, AlertTriangle, Scale } from 'lucide-react';
import { Meter, Pill } from '@/components/ui';
import { DAG_KORT, fmtD, toDay, weekday } from '@/lib/dates';
import { cx, nl, pct } from '@/lib/format';
import type { Toets } from '@/lib/rooster/toets';
import type { Beleid, Medewerker } from '@/lib/rooster/types';
import type { MwScore } from '@/lib/rooster/analyse';
import { BEHOEFTE_BRON } from '@/lib/rooster/types';

function oordeel(v: number): [string, 'ok' | 'warn' | 'bad'] {
  if (v >= 0.9) return ['Uitstekend', 'ok'];
  if (v >= 0.75) return ['Goed', 'ok'];
  if (v >= 0.6) return ['Matig', 'warn'];
  return ['Aandacht nodig', 'bad'];
}

const kleur = (v: number) => (v >= 0.75 ? 'var(--teal)' : v >= 0.6 ? 'var(--gold)' : 'var(--red)');

function Pijler({ icoon, titel, score, uitleg, accent, children }: { icoon: React.ReactNode; titel: string; score: number; uitleg: string; accent: string; children: React.ReactNode }) {
  const [o, soort] = oordeel(score);
  return (
    <div className="box flex flex-col gap-3" style={{ borderTop: `4px solid ${accent}` }}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>{icoon}</span>
        <h3 className="kop-s flex-1">{titel}</h3>
        <Pill soort={soort}>{o}</Pill>
      </div>
      <div className="flex items-end gap-2">
        <span className="display text-[44px] font-semibold leading-[0.9]">{Math.round(score * 100)}</span>
        <span className="pb-1 text-sm text-muted">van 100</span>
      </div>
      <Meter waarde={score} kleur={kleur(score)} />
      <p className="note">{uitleg}</p>
      <dl className="grid gap-1.5 text-[14px]">{children}</dl>
    </div>
  );
}

function Rij({ label, waarde, slecht }: { label: string; waarde: React.ReactNode; slecht?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-t border-line pt-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className={cx('num font-semibold', slecht && 'text-rood')}>{waarde}</dd>
    </div>
  );
}

export function Analyse({ t, team, beleid, magInstellen }: { t: Toets; team: Medewerker[]; beleid: Beleid; magInstellen?: boolean }) {
  const { continuiteit: c, efficiency: e, medewerker: tv, klant: kl } = t.pijlers;
  const w = beleid.weging;
  const totW = Math.max(1, w.continuiteit + w.efficiency + w.medewerker + w.klant);
  const segmenten: [string, number, number, string][] = [
    ['Continuïteit', w.continuiteit, t.sub.cont, 'var(--navy)'],
    ['Efficiency', w.efficiency, t.sub.eff, 'var(--teal)'],
    ['Medewerkers', w.medewerker, t.sub.mw, 'var(--plum)'],
    ['Klanten', w.klant, t.sub.klant, 'var(--gold)'],
  ];
  const mw = team.map((m) => ({ m, s: tv.perMedewerker[m.id] })).filter((x) => x.s).sort((a, b) => a.s.score - b.s.score);
  const bereik = (f: (s: MwScore) => number) => {
    const v = mw.filter((x) => x.m.functie !== 'UL').map((x) => f(x.s));
    return v.length ? `${Math.min(...v)}–${Math.max(...v)}` : '–';
  };

  return (
    <div className="grid gap-5">
      <div className="box">
        <h3 className="kop-s">Waar het cijfer uit bestaat</h3>
        <p className="note mt-1">
          Het cijfer ({nl(t.cijfer)}) volgt de vierledige doelstelling personeelsplanning{t.hard ? ', met een maximum van 5,4 omdat er een overtreding van ATW of CAO is' : ''}.{' '}
          <Link href="/beleid#p-2.1" className="font-semibold text-accent">Over de doelen</Link>
          {magInstellen ? <> · <Link href="/instellingen" className="font-semibold text-accent">Weging aanpassen</Link></> : null}
        </p>
        <div className="mt-3 flex h-9 w-full overflow-hidden rounded-md border border-line" role="img" aria-label="Opbouw van het cijfer">
          {segmenten.map(([naam, gew, sc, kl]) => (
            <div key={naam} className="relative h-full border-r-2 border-card last:border-r-0" style={{ width: `${(gew / totW) * 100}%`, background: 'var(--soft)' }} title={`${naam}: ${Math.round(sc * 100)} van 100, weegt ${Math.round((gew / totW) * 100)}%`}>
              <div className="absolute inset-y-0 left-0" style={{ width: `${sc * 100}%`, background: kl, opacity: 0.88 }} />
              <span className="absolute inset-0 flex items-center px-2 text-[12px] font-semibold text-white" style={{ textShadow: '0 1px 2px rgb(0 0 0 / .4)' }}>{gew / totW >= 0.15 ? naam : ''}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
          {segmenten.map(([naam, gew, sc]) => <span key={naam}>{naam}: <b className="text-ink">{Math.round(sc * 100)}</b> × {Math.round((gew / totW) * 100)}%</span>)}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Pijler icoon={<ShieldCheck size={18} />} accent="var(--navy)" titel="Continuïteit" score={c.score} uitleg={`Past het werk, en houden we ons aan wet en beleid? Dekking: de kans dat alle meldingen passen, met de afgesproken plekken (${Math.round(beleid.alphaRegio * 100)}%).`}>
          <Rij label="Dagen met de afgesproken plekken" waarde={`${c.gedekt} van ${c.dagen}`} slecht={c.gedekt < c.dagen} />
          <Rij label="Gemiddelde kans dat het past" waarde={c.gemKans != null ? pct(c.gemKans) : '–'} />
          <Rij label="Dekking" waarde={Math.round(c.dekking * 100)} slecht={c.dekking < 0.9} />
          <Rij label="Naleving beleid" waarde={Math.round(c.naleving * 100)} slecht={c.naleving < 0.75} />
          <Rij label="Risicodagen" waarde={c.risico.length} slecht={c.risico.length > 0} />
        </Pijler>
        <Pijler icoon={<Gauge size={18} />} accent="var(--teal)" titel="Efficiency" score={e.score} uitleg="Een uitvaart regelen binnen de gestelde normen: niet meer plekken of beschikbaarheid dan afgesproken, geen uren boven contract, geen onbenutte uren bij een tekort.">
          <Rij label="Plekken boven afspraak" waarde={`${e.surplus} van ${e.nodig}`} slecht={e.surplus > 0} />
          <Rij label="Plekken te weinig" waarde={e.tekort} slecht={e.tekort > 0} />
          <Rij label="Extra beschikbaarheid" waarde={e.extraB} slecht={e.extraB > 0} />
          <Rij label="Contracturen benut" waarde={pct(e.benutting)} slecht={e.benutting > 1.001} />
          <Rij label="Uren t.o.v. de norm" waarde={e.urenNorm ? pct(e.verhouding) : '–'} />
        </Pijler>
        <Pijler icoon={<HeartHandshake size={18} />} accent="var(--plum)" titel="Medewerkers" score={tv.score} uitleg="Per medewerker: wensen, vaste voorkeuren per weekdag, ochtend of middag, uren tegenover contract en een rustig ritme. Plus een eerlijke verdeling van weekenden, 1B en 2.">
          <Rij label="Gemiddeld per medewerker" waarde={Math.round(tv.gemiddeld * 100)} />
          <Rij label="Wensen gehonoreerd" waarde={t.wensen.totaal ? `${t.wensen.gehonoreerd} van ${t.wensen.totaal}` : 'geen wensen'} slecht={t.wensen.totaal > 0 && t.wensen.gehonoreerd < t.wensen.totaal * 0.8} />
          <Rij label="Eerlijke verdeling" waarde={Math.round(tv.eerlijkheid * 100)} slecht={tv.eerlijkheid < 0.7} />
          <Rij label="Laagste score" waarde={mw[0] ? `${Math.round(mw[0].s.score * 100)} (${mw[0].m.naam})` : '–'} slecht={!!mw[0] && mw[0].s.score < 0.6} />
        </Pijler>
        <Pijler icoon={<Smile size={18} />} accent="var(--gold)" titel="Klanten" score={kl.score} uitleg="Kunnen we klanten binnen 24 uur helpen? Meldingen die niet op de dag passen, schuiven naar de volgende dag als daar plekken over zijn.">
          <Rij label="Gesprek op de dag zelf" waarde={kl.zelfdeDag != null ? pct(kl.zelfdeDag, 1) : '–'} slecht={kl.zelfdeDag != null && kl.zelfdeDag < 0.9} />
          <Rij label="Binnen 24 uur geholpen" waarde={kl.binnen24 != null ? pct(kl.binnen24, 1) : '–'} slecht={kl.binnen24 != null && kl.binnen24 < 0.96} />
          <Rij label="Later dan 24 uur (verwacht)" waarde={nl(kl.laat)} slecht={kl.meldingen > 0 && kl.laat / kl.meldingen > 0.04} />
          <Rij label="Meldingen verwacht" waarde={Math.round(kl.meldingen)} />
        </Pijler>
      </div>

      {c.risico.length > 0 && (
        <div className="box">
          <h3 className="kop-s mb-1 flex items-center gap-2"><AlertTriangle size={18} className="text-rood" /> Risicodagen</h3>
          <p className="note mb-3">Dagen met minder dan de afgesproken regelplekken, of waarop de kans dat alles past duidelijk lager is dan {Math.round(beleid.alphaRegio * 100)}%.</p>
          <div className="scroll">
            <table className="tb">
              <thead><tr><th>Dag</th><th className="r">Verwacht</th><th className="r">Afgesproken</th><th className="r">Gepland</th><th className="r">Waarvan 1B</th><th className="r">Kans</th><th>Bron</th></tr></thead>
              <tbody>
                {c.risico.slice(0, 12).map((d) => (
                  <tr key={d.datum}>
                    <td className="whitespace-nowrap font-semibold">{DAG_KORT[weekday(toDay(d.datum))]} {fmtD(d.datum)}</td>
                    <td className="r">{d.lam != null ? nl(d.lam) : '–'}</td>
                    <td className="r">{d.k}</td>
                    <td className={cx('r', d.k != null && d.p < d.k && 'font-bold text-rood')}>{d.p}</td>
                    <td className="r">{d.b}</td>
                    <td className="r">{d.cov != null ? pct(d.cov) : '–'}</td>
                    <td className="note">{d.bron ? BEHOEFTE_BRON[d.bron] : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="box">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="kop-s">Tevredenheid per medewerker</h3>
            <p className="note mt-1">Laagste score eerst. Zo zie je wie het rooster het zwaarst treft.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[13px]">
            <Pill soort="neutral"><Scale size={13} /> Weekenden {bereik((s) => s.details.weekenden)}</Pill>
            <Pill soort="neutral">1B {bereik((s) => s.details.beschikbaar)}</Pill>
            <Pill soort="neutral">2-diensten {bereik((s) => s.details.twee)}</Pill>
          </div>
        </div>
        <div className="scroll max-h-[520px]">
          <table className="tb">
            <thead>
              <tr>
                <th>Medewerker</th><th>Score</th><th className="r">Wensen</th><th className="r">Weekpatroon</th><th className="r">Ochtend/middag</th>
                <th className="r">Uren</th><th className="r">Weekenden</th><th className="r">1B</th><th>Signalen</th>
              </tr>
            </thead>
            <tbody>
              {mw.map(({ m, s }) => {
                const d = s.details;
                const signalen: string[] = [];
                if (d.patroon.niet) signalen.push(`${d.patroon.niet}× op een niet-dag`);
                if (d.patroon.lieverNiet) signalen.push(`${d.patroon.lieverNiet}× liever-niet-dag`);
                if (d.ritme.overMax) signalen.push(`${d.ritme.overMax} dag(en) boven weekmax`);
                if (d.ritme.losse) signalen.push(`${d.ritme.losse} losse werkdag(en)`);
                if (d.ritme.lang) signalen.push(`${d.ritme.lang} lange reeks(en)`);
                if (d.ritme.terug) signalen.push(`${d.ritme.terug}× laat gevolgd door vroeg`);
                if (d.weekendPlekken > beleid.maxWeekendPlekken) signalen.push(`${d.weekendPlekken} plekken in één weekend`);
                if (d.uren.norm > 0 && Math.abs(d.uren.gepland - d.uren.norm) > d.uren.norm * 0.1) signalen.push(d.uren.gepland > d.uren.norm ? 'boven contract' : 'onder contract');
                return (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap font-semibold">{m.naam}{m.functie === 'UL' && <span className="note ml-1.5">UL</span>}</td>
                    <td className="min-w-[120px]"><div className="flex items-center gap-2"><div className="flex-1"><Meter waarde={s.score} kleur={kleur(s.score)} /></div><b className="num w-7 text-right">{Math.round(s.score * 100)}</b></div></td>
                    <td className="r">{d.wensen.tot ? `${d.wensen.ok}/${d.wensen.tot}` : '–'}</td>
                    <td className="r">{d.patroon.actief ? (s.delen.patroon != null ? Math.round(s.delen.patroon * 100) : '–') : '–'}</td>
                    <td className="r">{d.dienst.tot ? `${d.dienst.tot - d.dienst.mis}/${d.dienst.tot}` : '–'}</td>
                    <td className={cx('r', d.uren.norm > 0 && Math.abs(d.uren.gepland - d.uren.norm) > d.uren.norm * 0.1 && 'text-rood')}>{nl(d.uren.gepland, 0)}/{Math.round(d.uren.norm)}</td>
                    <td className="r">{d.weekenden}</td>
                    <td className="r">{d.beschikbaar}</td>
                    <td className="note">{signalen.join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
