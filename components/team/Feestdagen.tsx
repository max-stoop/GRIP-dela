'use client';
import { useMemo, useState } from 'react';
import { JaarKiezer } from '@/components/verlof/Jaarplanning';
import { feestdagenVan, fmtD, todayIso } from '@/lib/dates';
import { feestdagStand } from '@/lib/rooster/feestdagen';
import type { Cellen, Medewerker } from '@/lib/rooster/types';
import type { Verlof } from '@/lib/store/types';
import { cx } from '@/lib/format';

/** Wie welke feestdag werkte of ingeroosterd staat, zodat de feestdagen eerlijk rouleren; ook bij het beoordelen van verlof. */
export function FeestdagenOverzicht({ team, cellen, verlof }: { team: Medewerker[]; cellen: Cellen; verlof: Verlof[] }) {
  const vandaag = todayIso();
  const [jaar, setJaar] = useState(() => Number(vandaag.slice(0, 4)));
  const dagen = useMemo(() => feestdagenVan(jaar), [jaar]);
  const rijen = useMemo(() => team.map((m) => {
    const standen = dagen.map((f) => feestdagStand(m, cellen, verlof, f.datum));
    return { m, standen, gewerkt: standen.filter((x) => x.soort === 'gewerkt').length };
  }).sort((a, b) => a.gewerkt - b.gewerkt || a.m.naam.localeCompare(b.m.naam)), [team, dagen, cellen, verlof]);

  return (
    <div className="box p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <JaarKiezer jaar={jaar} onJaar={setJaar} />
        <span className="note">Wie de minste feestdagen werkte, staat bovenaan: die is de volgende keer aan de beurt, of krijgt verlof op een feestdag juist minder snel.</span>
      </div>
      <div className="scroll">
        <table className="tb">
          <thead>
            <tr>
              <th>Medewerker</th>
              {dagen.map((f) => <th key={f.datum} className={cx('whitespace-nowrap text-center', f.datum < vandaag && 'text-muted')} title={`${f.naam}, ${fmtD(f.datum)}`}>{f.naam.replace('Eerste ', '1e ').replace('Tweede ', '2e ').replace('dag', '')}<div className="note font-normal">{fmtD(f.datum)}</div></th>)}
              <th className="r" title={`Gewerkt of ingeroosterd in ${jaar}`}>Totaal</th>
            </tr>
          </thead>
          <tbody>
            {rijen.map(({ m, standen, gewerkt }) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap font-semibold">{m.naam}<div className="note font-normal">{m.contract} uur</div></td>
                {standen.map((x, i) => (
                  <td key={dagen[i].datum} className="text-center">
                    {x.soort === 'gewerkt' ? <span className={cx('inline-block min-w-[34px] rounded px-1 text-[12.5px] font-semibold', `c-${x.code}`)}>{x.code}</span>
                      : x.soort === 'verlof' ? <span className="text-[12.5px] font-semibold text-gold">V</span>
                      : x.soort === 'vrij' ? <span className="text-muted">vrij</span> : <span className="text-muted">·</span>}
                  </td>
                ))}
                <td className="r num font-semibold">{gewerkt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note mt-2">Een code is een dienst op die feestdag (gewerkt of ingeroosterd), V is verlof, een punt betekent dat er nog geen rooster is.</p>
    </div>
  );
}
