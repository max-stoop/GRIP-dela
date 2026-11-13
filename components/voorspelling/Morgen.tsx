'use client';
import Link from 'next/link';
import { Lightbulb } from 'lucide-react';
import { CLUSTERS, CLUSTER_NAAM } from '@/lib/model/config';
import { kwantielMetSchommeling } from '@/lib/model/poisson';
import { gemiddeldOver, inzicht, schommelTekst, type Terugtest, type TerugtestRegel } from '@/lib/model/terugtest';
import { lam, plekken } from '@/lib/store/afgeleid';
import type { RunData } from '@/lib/model/types';
import { cx, nl } from '@/lib/format';

/** Hulptekst bij "ernaast": zat de voorspelling er structureel boven of onder? */
function scheefTekst(scheef: number): string {
  if (Math.abs(scheef) < 0.02) return 'Niet structureel te hoog of te laag voorspeld.';
  return `Gemiddeld ${nl(Math.abs(scheef) * 100, 0)}% te ${scheef > 0 ? 'laag' : 'hoog'} voorspeld.`;
}

/** Op 9 van de 10 dagen niet meer; met de gemeten schommeling als het meer schommelt dan toeval (tot 2×). */
function hoogstens(x: { verwacht: number; t?: TerugtestRegel }): number {
  return kwantielMetSchommeling(0.9, x.verwacht, Math.min(2, x.t?.schommeling ?? 1));
}

/** Smallere kolommen op een telefoon, zodat alles zonder schuiven past. */
const PAD = '!px-2 sm:!px-3';

interface Rij { naam: string; regio?: string; verwacht: number; plekken: number; t?: TerugtestRegel; cluster?: boolean }

/** Per cluster en regio: de verwachting, hoeveel het op 9 van de 10 dagen hoogstens wordt, en hoeveel het er het afgelopen halfjaar naast zat. */
export function Morgen({ run, datum, regios, clusters, alpha, terugtest }: { run: RunData; datum: string; regios: string[]; clusters: string[]; alpha: number; terugtest: Terugtest | null | undefined }) {
  const rijen: Rij[] = [];
  const toonClusters: string[] = [];
  for (const c of clusters) {
    const rs = CLUSTERS[c].filter((r) => regios.includes(r) && lam(run, r, datum) != null);
    if (!rs.length) continue;
    const heel = CLUSTERS[c].every((r) => rs.includes(r));
    if (heel) {
      toonClusters.push(c);
      rijen.push({ naam: CLUSTER_NAAM[c], verwacht: rs.reduce((a, r) => a + lam(run, r, datum)!, 0), plekken: rs.reduce((a, r) => a + (plekken(run, r, datum, alpha) ?? 0), 0), t: terugtest?.clusters[c], cluster: true });
    }
    for (const r of rs) rijen.push({ naam: r, regio: r, verwacht: lam(run, r, datum)!, plekken: plekken(run, r, datum, alpha) ?? 0, t: terugtest?.regios[r] });
  }
  if (!rijen.length) return <p className="box note">Voor deze dag is er geen voorspelling per regio.</p>;
  const metTerugtest = terugtest !== null;
  const regioGem = terugtest ? gemiddeldOver(rijen.filter((x) => !x.cluster).map((x) => x.t)) : null;
  const clusterGem = terugtest ? gemiddeldOver(toonClusters.map((c) => terugtest.clusters[c])) : null;
  const tekst = inzicht(regioGem, clusterGem);
  const onrustig = terugtest ? schommelTekst(toonClusters.filter((c) => terugtest.clusters[c]).map((c) => ({ naam: CLUSTER_NAAM[c], schommeling: terugtest.clusters[c].schommeling }))) : null;
  if (onrustig) tekst.push(onrustig);
  return (
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <div className="box !p-0">
        <div className="scroll">
          <table className="tb">
            <thead>
              <tr>
                <th className="!pl-3">Regio</th>
                <th className={cx('r', PAD)} title="Het gemiddelde dat we voor morgen verwachten">Verwacht</th>
                <th className={cx('r', PAD)} title="Op 9 van de 10 dagen komen er niet meer meldingen dan dit">Hoogstens</th>
                <th className={cx('r', PAD)} title={`Regelplekken op ${Math.round(alpha * 100)}%, inclusief de 1B`}>Plekken</th>
                {metTerugtest && <th className={cx('r hidden sm:table-cell', PAD)} title="Hoeveel de voorspelling voor morgen er het afgelopen halfjaar gemiddeld naast zat">Ernaast</th>}
              </tr>
            </thead>
            <tbody>
              {rijen.map((x) => (
                <tr key={(x.cluster ? 'c:' : '') + x.naam} className={cx(x.cluster && 'bg-soft')}>
                  <td className={cx('max-w-[124px] truncate !pr-1.5 sm:max-w-none', x.cluster ? '!pl-3 font-semibold' : '!pl-5 sm:!pl-7')}>
                    {x.regio ? <Link href={`/rooster?regio=${encodeURIComponent(x.regio)}`} className="text-ink no-underline hover:underline">{x.naam}</Link> : <><span className="sr-only sm:not-sr-only">Cluster </span>{x.naam}</>}
                  </td>
                  <td className={cx('r num', PAD, x.cluster && 'font-semibold')}>
                    {nl(x.verwacht)}
                    {/* op een smal scherm staat "ernaast" onder de verwachting */}
                    {metTerugtest && x.t && <span className="block text-[11.5px] font-normal text-muted sm:hidden">±{nl(x.t.ernaast)}</span>}
                  </td>
                  <td className={cx('r num', PAD)}>{hoogstens(x)}</td>
                  <td className={cx('r num', PAD, x.cluster ? 'font-semibold' : 'text-teal')}>{x.plekken}</td>
                  {metTerugtest && <td className={cx('r num hidden text-muted sm:table-cell', PAD)} title={x.t ? scheefTekst(x.t.scheef) : undefined}>{terugtest === undefined ? '…' : x.t ? `±${nl(x.t.ernaast)}` : '–'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid content-start gap-3">
        {tekst.length > 0 && (
          <div className="box flex gap-3" style={{ borderColor: 'var(--teal)' }}>
            <Lightbulb size={20} className="mt-0.5 shrink-0 text-teal" />
            <div className="grid gap-2 text-[14.5px] leading-relaxed">{tekst.map((t) => <p key={t} className="m-0">{t}</p>)}</div>
          </div>
        )}
        {terugtest === undefined && <p className="note m-0">De terugtest op jullie eigen meldingen wordt berekend…</p>}
        <p className="note m-0">
          <b className="text-ink">Verwacht</b> is het gemiddelde: daar komt het op de meeste dagen dichtbij. <b className="text-ink">Hoogstens</b>: op 9 van de 10 dagen komen er niet meer.
          {metTerugtest && <> <b className="text-ink">Ernaast</b> (± onder de verwachting op de telefoon): hoeveel de voorspelling voor morgen er het afgelopen halfjaar gemiddeld naast zat. Dat is opnieuw gerekend op jullie eigen meldingen, alsof het elke ochtend opnieuw was.</>}
        </p>
      </div>
    </div>
  );
}
