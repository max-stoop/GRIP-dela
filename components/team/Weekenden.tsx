'use client';
import { useMemo, useState } from 'react';
import { JaarKiezer } from '@/components/verlof/Jaarplanning';
import { Pill } from '@/components/ui';
import { addDays, fmtD, fromDay, isoWeek, MAAND_KORT, mondayOf, month, toDay, weekIndex } from '@/lib/dates';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { weekendCadans, werktWeekend, type Beleid, type Cellen, type Medewerker, type Voorkeurprofiel } from '@/lib/rooster/types';
import { isoJaar, pariteitIn, weekendNaam } from '@/lib/rooster/weekend';
import type { Verlof } from '@/lib/store/types';
import { cx, nlInt } from '@/lib/format';

/** De zaterdagen van een ISO-jaar (week 1 tot en met 52 of 53). */
export function zaterdagenVan(jaar: number): string[] {
  const uit: string[] = [];
  for (let n = mondayOf(toDay(`${jaar}-01-04`)) + 5; isoJaar(fromDay(n)) === jaar; n += 7) uit.push(fromDay(n));
  return uit;
}

type Stand = { soort: 'gewerkt'; plekken: number; codes: string } | { soort: 'verlof' } | { soort: 'groep' } | { soort: 'vrij' };

/** Een weekend van een medewerker: wat er in het rooster staat, en voor een weekend dat nog komt wat de weekendgroep zegt. */
export function weekendStand(m: Medewerker, cellen: Cellen, verlof: Verlof[], za: string, vandaag: string): Stand {
  const zo = addDays(za, 1);
  const c = [cellen[m.id]?.[za] ?? '-', cellen[m.id]?.[zo] ?? '-'];
  if (c.some((x) => DIENSTEN[x].werk)) {
    return { soort: 'gewerkt', plekken: c.reduce((n, x) => n + DIENSTEN[x].plekken, 0), codes: c.filter((x) => DIENSTEN[x].werk).join(' ') };
  }
  if (c.includes('V') || verlof.some((v) => v.medewerkerId === m.id && v.status === 'goedgekeurd' && v.van <= zo && v.tot >= za)) return { soort: 'verlof' };
  // nog geen rooster voor een weekend dat nog komt: volgens de weekendgroep
  if (zo >= vandaag && c.every((x) => x === '-') && werktWeekend(m, weekIndex(toDay(za)))) return { soort: 'groep' };
  return { soort: 'vrij' };
}

/** Het hele jaar aan weekenden: wat er gewerkt is of gepland staat, en wat de weekendgroep nog laat verwachten. */
export function WeekendJaar({ team, cellen, verlof, beleid, vandaag }: { team: Medewerker[]; cellen: Cellen; verlof: Verlof[]; beleid: Beleid; vandaag: string }) {
  const [jaar, setJaar] = useState(() => isoJaar(vandaag));
  const zaterdagen = useMemo(() => zaterdagenVan(jaar), [jaar]);
  const rijen = useMemo(() => team.map((m) => {
    const standen = zaterdagen.map((za) => weekendStand(m, cellen, verlof, za, vandaag));
    const gewerkt = standen.filter((x) => x.soort === 'gewerkt').length;
    const verwacht = standen.filter((x) => x.soort === 'groep').length;
    return { m, standen, gewerkt, verwacht };
  }), [team, zaterdagen, cellen, verlof, vandaag]);
  const max = 52 - beleid.minVrijeWeekenden;

  return (
    <div className="box p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <JaarKiezer jaar={jaar} onJaar={setJaar} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--teal)' }} /> in het rooster (het getal: regelplekken)</span>
          <span className="inline-flex items-center gap-1.5"><i className="wk-groep inline-block h-3 w-3 rounded-sm" /> volgens de weekendgroep, nog geen rooster</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--gold) 35%, var(--card))' }} /> verlof</span>
        </div>
      </div>
      <div className="scroll">
        <table className="wkj">
          <thead>
            <tr>
              <th className="nm">Medewerker</th>
              {zaterdagen.map((za, i) => {
                const n = toDay(za);
                const nieuweMaand = i === 0 || month(toDay(zaterdagen[i - 1])) !== month(n);
                return <th key={za} className={cx(za <= vandaag && addDays(za, 1) >= vandaag && 'nu')} title={`Week ${isoWeek(n)}: za ${fmtD(za)} en zo ${fmtD(addDays(za, 1))}`}>{nieuweMaand ? <span className="block text-[10.5px] font-semibold text-muted">{MAAND_KORT[month(n) - 1]}</span> : <span className="block text-[10.5px]">&nbsp;</span>}{isoWeek(n)}</th>;
              })}
              <th className="r" title={`Gewerkt of gepland, plus wat de weekendgroep nog laat verwachten. Maximaal ${max} (CAO).`}>Totaal</th>
            </tr>
          </thead>
          <tbody>
            {rijen.map(({ m, standen, gewerkt, verwacht }) => {
              const totaal = gewerkt + verwacht;
              return (
                <tr key={m.id}>
                  <th className="nm">{m.naam}<small>{weekendNaam(m, `${jaar}-07-01`)}</small></th>
                  {standen.map((x, i) => (
                    <td key={zaterdagen[i]} className={cx(x.soort === 'gewerkt' && 'gewerkt', x.soort === 'groep' && 'wk-groep', x.soort === 'verlof' && 'verlof')} title={`${m.naam}, week ${isoWeek(toDay(zaterdagen[i]))}: ${x.soort === 'gewerkt' ? `${x.codes} (${x.plekken} regelplekken)` : x.soort === 'groep' ? 'volgens de weekendgroep' : x.soort === 'verlof' ? 'verlof' : 'vrij'}`}>
                      {x.soort === 'gewerkt' ? x.plekken || '·' : x.soort === 'verlof' ? 'V' : ''}
                    </td>
                  ))}
                  <td className={cx('r num font-semibold', !m.afstandsverklaring && totaal > max && 'text-rood')}>{gewerkt}{verwacht ? <span className="text-muted">+{verwacht}</span> : ''}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="nm">Aan het werk</th>
              {zaterdagen.map((za, i) => {
                const n = rijen.filter((r) => r.standen[i].soort === 'gewerkt' || r.standen[i].soort === 'groep').length;
                return <td key={za} className="num">{n || ''}</td>;
              })}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Wie in welke weekendgroep zit, met de contracturen per groep en de voorkeur van de medewerker ernaast. */
export function WeekendGroepen({ team, profielen, vandaag }: { team: Medewerker[]; profielen: Record<string, Voorkeurprofiel>; vandaag: string }) {
  const jaar = isoJaar(vandaag);
  const groepen = useMemo(() => {
    const g = new Map<string, Medewerker[]>();
    for (const m of team) {
      const k = weekendNaam(m, vandaag);
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g.entries()].sort((a, b) => weekendCadans(a[1][0]) - weekendCadans(b[1][0]) || a[0].localeCompare(b[0]));
  }, [team, vandaag]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {groepen.map(([naam, leden]) => (
        <div key={naam} className="box">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-semibold">{naam.replace(/^./, (x) => x.toUpperCase())}</div>
            <div className="note">{leden.length} · {nlInt(leden.reduce((a, m) => a + m.contract, 0))} uur</div>
          </div>
          <ul className="mt-2 grid gap-1 text-[14px]">
            {leden.map((m) => {
              const p = profielen[m.id];
              const nu = pariteitIn(m, jaar);
              const anders = p?.weekend && nu && p.weekend !== nu;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-1.5">
                  <span>{m.naam}</span>
                  {anders && <Pill soort="warn">wil {p!.weekend}</Pill>}
                  {p?.weekendPlekken === 3 && <Pill soort="info">3 plekken per weekend</Pill>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
