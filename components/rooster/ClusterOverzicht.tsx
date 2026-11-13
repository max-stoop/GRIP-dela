'use client';
import { DAG_KORT, fmtD, fmtDag, toDay, weekday, dayOfMonth, isoWeek } from '@/lib/dates';
import { cx } from '@/lib/format';
import type { ClusterStand } from '@/lib/rooster/cluster';

const getal = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

/** Rood als er minder gepland is dan afgesproken; klik op een regio voor het rooster van die regio. */
export function ClusterOverzicht({ naam, dates, vandaag, stand, minDG, kans1B, zonderInzage, onRegio }: {
  naam: string;
  /** Per regio per dag, behalve zondag. */
  minDG: number;
  dates: string[];
  vandaag: string;
  stand: ClusterStand;
  /** 0..1 */
  kans1B?: (number | null)[];
  /** Regio's van het cluster die deze gebruiker niet ziet. */
  zonderInzage: string[];
  onRegio: (regio: string) => void;
}) {
  const wk = (d: string, i: number) => (weekday(toDay(d)) === 1 && i > 0 ? 'wk' : '');
  const kleur = (p: number, k: number | null) => (k == null ? undefined : p < k ? 'low' : p > k ? 'high' : undefined);
  return (
    <div>
      <div className="scroll">
        <table className="rs cl" aria-label={`Cluster ${naam}: regelplekken per regio`}>
          <thead>
            <tr>
              <th className="nm">
                <span className="text-[13px] text-muted">Regio</span>
                <small>gepland / afgesproken in de maand</small>
              </th>
              {dates.map((d, i) => {
                const n = toDay(d);
                return (
                  <th key={d} className={cx(weekday(n) % 6 === 0 && 'we', d === vandaag && 'vandaag', wk(d, i))} title={`${fmtDag(d)}, week ${isoWeek(n)}`}>
                    {DAG_KORT[weekday(n)]}<br />{dayOfMonth(n)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {stand.regels.map((r) => (
              <tr key={r.regio}>
                <th className="nm">
                  <button type="button" className="block w-full text-left" onClick={() => onRegio(r.regio)} title={`Naar het rooster van ${r.regio}`}>
                    <span className="truncate">{r.regio}</span>
                    <small>{r.leeg ? 'nog geen team' : <>{r.totaalGepland} / {r.totaalAfgesproken}{r.tekort ? ` · ${r.tekort} ${r.tekort === 1 ? 'dag' : 'dagen'} te weinig` : ''}</>}</small>
                  </button>
                </th>
                {dates.map((d, i) => {
                  const p = r.gepland[i], k = r.afgesproken[i];
                  return (
                    <td key={d} className={cx(wk(d, i), weekday(toDay(d)) % 6 === 0 && 'we', kleur(p, k))}
                      title={`${r.regio}, ${fmtD(d)}: ${p} gepland${r.beschikbaar[i] ? ` (waarvan ${r.beschikbaar[i]} beschikbaarheid)` : ''}${k != null ? `, ${k} afgesproken` : ''}`}>
                      {p}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="nm" title="Inclusief beschikbaarheidsdiensten (1B): die tellen als regelplek">Cluster gepland</th>
              {dates.map((d, i) => <td key={d} className={cx(wk(d, i), kleur(stand.gepland[i], stand.afgesproken[i]))}>{stand.gepland[i]}</td>)}
            </tr>
            <tr>
              <th className="nm" title="Wat het cluster moet: de afgesproken regelplekken van de regio's samen, plus de speling die het cluster samen nodig heeft">Afgesproken</th>
              {dates.map((d, i) => <td key={d} className={wk(d, i)} title={stand.speling[i] ? `Waarvan ${stand.speling[i]} speling voor het cluster samen` : undefined}>{stand.afgesproken[i] ?? '–'}</td>)}
            </tr>
            <tr>
              <th className="nm" title="Gepland min afgesproken: − is te weinig, + is meer dan afgesproken">Verschil</th>
              {dates.map((d, i) => {
                const v = stand.verschil[i];
                return <td key={d} className={cx(wk(d, i), v != null && (v < 0 ? 'low' : v > 0 ? 'high' : ''))}>{v == null ? '' : getal(v)}</td>;
              })}
            </tr>
            <tr>
              <th className="nm" title={`Dg-diensten (DG1 en DG2) in het cluster. Elke regio moet er minstens ${minDG} per dag hebben (tenzij anders ingesteld voor de regio), behalve op zondag.`}>
                Dg gepland <span className="font-normal text-muted">· moet {Math.max(0, ...stand.dgMoet)}</span>
              </th>
              {dates.map((d, i) => {
                const kort = stand.regels.filter((r) => r.dg[i] < r.dgMoet[i]).map((r) => r.regio);
                return (
                  <td key={d} className={cx(wk(d, i), (stand.dg[i] < stand.dgMoet[i] || kort.length > 0) && 'low')}
                    title={stand.dgMoet[i] ? `${fmtD(d)}: ${stand.regels.map((r) => `${r.regio} ${r.dg[i]}`).join(', ')}${kort.length ? `. Te weinig in ${kort.join(', ')}` : ''}` : 'Zondag: geen Dg-diensten'}>
                    {stand.dgMoet[i] ? stand.dg[i] : ''}
                  </td>
                );
              })}
            </tr>
            {kans1B && (
              <tr>
                <th className="nm" title="Gemiddelde kans per 1B in het cluster dat hij valt. Een melding gaat eerst naar een vrije plek in het cluster; pas als alle reguliere plekken bezet zijn, valt er een 1B.">Kans 1B valt</th>
                {dates.map((d, i) => <td key={d} className={cx('text-[11px]', wk(d, i))}>{kans1B[i] != null ? Math.round(kans1B[i]! * 100) : ''}</td>)}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <p className="note mt-2">
        {stand.tekort ? `Op ${stand.tekort} ${stand.tekort === 1 ? 'dag' : 'dagen'} heeft het cluster minder regelplekken gepland dan afgesproken.` : 'Het cluster heeft elke dag minstens zoveel regelplekken gepland als afgesproken.'}{' '}
        Rood is minder dan afgesproken, oranje meer. Klik op een regio voor het rooster.
        {zonderInzage.length > 0 && ` Niet zichtbaar voor jou: ${zonderInzage.join(', ')}.`}
      </p>
    </div>
  );
}
