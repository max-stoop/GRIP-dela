'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { addDays, fmtD, MAAND_KORT } from '@/lib/dates';
import type { Jaarplan, JaarRij, JaarWeek } from '@/lib/capaciteit/jaarplan';
import { cx, nlInt } from '@/lib/format';
import { SCHOOLREGIO, vakantieNaam } from '@/lib/capaciteit/verlof';

const STATUS_TEKST = { ruim: 'ruimte', krap: 'krap', vol: 'meer verlof dan ruimte' } as const;

function weekTitel(w: JaarWeek) {
  const r = w.ruimte;
  return `Week ${w.week} (${fmtD(w.maandag)} t/m ${fmtD(addDays(w.maandag, 6))})${r.schoolvakantie ? `, ${vakantieNaam(r.schoolvakantie)}` : ''}: ruimte ${nlInt(r.ruimte)} uur, goedgekeurd ${nlInt(r.goedgekeurd)}, aangevraagd ${nlInt(r.aangevraagd)}, over ${nlInt(w.rest)} uur (${STATUS_TEKST[w.status]}). ${w.weg === 1 ? '1 medewerker' : `${w.weg} medewerkers`} met verlof.`;
}

/** Een kolom per ISO-week, een rij per medewerker; bovenin de maanden, vakanties, feestdagen, mijlpalen en de verlofruimte. */
export function JaarKalender({ plan, rijen, onKies, naamExtra, label }: {
  plan: Jaarplan;
  rijen: JaarRij[];
  onKies: (medewerkerId: string, maandag: string) => void;
  naamExtra?: (r: JaarRij) => ReactNode;
  label: string;
}) {
  const { weken } = plan;
  const maanden: { maand: number; n: number }[] = [];
  for (const w of weken) {
    const laatste = maanden[maanden.length - 1];
    if (laatste && laatste.maand === w.maand) laatste.n++; else maanden.push({ maand: w.maand, n: 1 });
  }
  const mijlpaal = (w: JaarWeek) => plan.mijlpalen.filter((m) => m.datum >= w.maandag && m.datum <= addDays(w.maandag, 6));
  // begin bij de huidige week (met een paar weken terug), zodat je ziet wat er komt
  const doos = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = doos.current, nu = d?.querySelector<HTMLElement>('th.wkn.nu'), naam = d?.querySelector<HTMLElement>('thead .nm');
    if (d && nu && naam) d.scrollLeft = Math.max(0, nu.offsetLeft - naam.offsetWidth - 4 * nu.offsetWidth);
    else if (d) d.scrollLeft = 0;
  }, [plan.jaar, plan.regio]);

  return (
    <div className="scroll" ref={doos}>
      <table className="jk" aria-label={label}>
        <thead>
          <tr>
            <th className="nm" scope="col">{plan.jaar}</th>
            {maanden.map((m, i) => <th key={`${m.maand}-${i}`} colSpan={m.n} className="maand" scope="colgroup">{MAAND_KORT[m.maand]}</th>)}
          </tr>
          <tr>
            <th className="nm" scope="col"><small>week</small></th>
            {weken.map((w) => <th key={w.maandag} scope="col" className={cx('wkn', w.huidig && 'nu')} title={`Week ${w.week}, ${fmtD(w.maandag)}`}>{w.week}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="band">
            <th className="nm" scope="row"><small>Vakanties en data</small></th>
            {weken.map((w) => {
              const mp = mijlpaal(w);
              const titel = [w.ruimte.schoolvakantie && vakantieNaam(w.ruimte.schoolvakantie), ...w.feestdagen.map((f) => `${f.naam} (${fmtD(f.datum)})`), ...mp.map((m) => `${m.tekst} (${fmtD(m.datum)}, § ${m.paragraaf})`)].filter(Boolean).join(' · ');
              return (
                <td key={w.maandag} className={cx('wk', w.ruimte.schoolvakantie && 'sv', w.huidig && 'nu')} title={titel || undefined}>
                  {w.feestdagen.length > 0 && <i className="fd" aria-hidden />}
                  {mp.length > 0 && <i className="mp" aria-hidden />}
                  {titel && <span className="sr-only">{titel}</span>}
                </td>
              );
            })}
          </tr>
          <tr className="ruimterij">
            <th className="nm" scope="row">Ruimte <small>aantal met verlof</small></th>
            {weken.map((w) => (
              <td key={w.maandag} className={cx('wk', w.status, w.huidig && 'nu', w.verleden && 'oud')} title={weekTitel(w)}>
                {w.weg || ''}
                <span className="sr-only">{weekTitel(w)}</span>
              </td>
            ))}
          </tr>
          {rijen.map((r) => (
            <tr key={r.m.id}>
              <th className="nm" scope="row">
                <span className="block overflow-hidden text-ellipsis">{r.m.naam}</span>
                {naamExtra?.(r)}
              </th>
              {weken.map((w) => {
                const c = r.weken[w.maandag];
                const tekst = c ? `${c.dagen === 5 ? 'hele week' : `${c.dagen} ${c.dagen === 1 ? 'dag' : 'dagen'}`} verlof, ${c.status}` : 'geen verlof';
                return (
                  <td key={w.maandag} className={cx('wk', w.ruimte.schoolvakantie && 'sv', w.huidig && 'nu', w.verleden && 'oud')}>
                    <button
                      type="button"
                      className={cx('jc', c?.status === 'goedgekeurd' && 'goed', c?.status === 'aangevraagd' && 'aan')}
                      aria-label={`${r.m.naam}, week ${w.week}: ${tekst}`}
                      title={`${r.m.naam}, week ${w.week} (${fmtD(w.maandag)}): ${tekst}`}
                      onClick={() => onKies(r.m.id, w.maandag)}
                    >
                      {c && c.dagen < 5 ? c.dagen : ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JaarLegenda({ regio }: { regio?: string }) {
  const sr = regio ? SCHOOLREGIO[regio] : undefined;
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">
      <span className="flex items-center gap-1.5"><i className="jk-l goed" /> Goedgekeurd (cijfer = dagen, leeg = hele week)</span>
      <span className="flex items-center gap-1.5"><i className="jk-l aan" /> Aangevraagd</span>
      <span className="flex items-center gap-1.5"><i className="jk-l sv" /> Schoolvakantie{sr ? ` (regio ${sr})` : ''}</span>
      <span className="flex items-center gap-1.5"><i className="jk-l ruim" /><i className="jk-l krap" /><i className="jk-l vol" /> Ruimte: genoeg, krap, te weinig</span>
      <span className="flex items-center gap-1.5"><i className="fd static" /> Feestdag</span>
      <span className="flex items-center gap-1.5"><i className="mp static" /> Mijlpaal vakantieproces</span>
    </div>
  );
}
