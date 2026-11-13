'use client';
import { Meter, Pill } from '@/components/ui';
import { nl, opsomming, pct } from '@/lib/format';
import type { NbdNiveau, NbdToets } from '@/lib/nbd/toets';
import type { NbdParameters } from '@/lib/nbd/parameters';

const GROEPEN: NbdNiveau[] = ['ATW en CAO', 'Beleid', 'Voorkeur'];

export function NbdScorePaneel({ t, p, versieTekst }: { t: NbdToets; p: NbdParameters; versieTekst: string }) {
  const rij = (l: string, v: number, uitleg: string) => (
    <div className="grid grid-cols-[132px_1fr_30px] items-center gap-2 text-[13.5px]" title={uitleg}>
      <span>{l}</span><Meter waarde={v} kleur={v >= 0.75 ? 'var(--teal)' : v >= 0.6 ? 'var(--gold)' : 'var(--red)'} /><b className="num text-right">{Math.round(v * 100)}</b>
    </div>
  );
  const nodig = t.perDag.reduce((a, d) => a + d.nodigUren, 0), gepland = t.perDag.reduce((a, d) => a + d.geplandUren, 0);
  const onder = t.perDag.filter((d) => d.sl < p.serviceLevel - 1e-9).length;
  const status = t.hard > 0 ? 'Overtredingen' : onder ? 'Krap' : t.cijfer >= 7.5 ? 'Goed' : 'Voldoende';
  return (
    <div className="grid gap-3">
      <div className="box-focus">
        <div className="flex items-end gap-4">
          <div className="display text-[64px] font-semibold leading-[0.9]">{nl(t.cijfer)}</div>
          <div className="pb-1">
            <span className="pill" style={{ background: 'rgb(255 255 255 / 0.14)', color: 'inherit' }}>{status}</span>
            <div className="note mt-1.5">Getoetst tegen {versieTekst}</div>
          </div>
        </div>
      </div>
      <div className="box">
        <div className="grid gap-1.5">
          {rij('Continuïteit', t.sub.cont, 'Deel van de benodigde bezetting (Erlang C, per kwartier) dat gedekt is')}
          {rij('Efficiency', t.sub.eff, 'Niet meer mensen dan nodig, en de uren dicht bij het contract')}
          {rij('Medewerkers', t.sub.mw, 'Wensen, vaste voorkeuren per weekdag en het dagdeel')}
          {rij('Bellers', t.sub.klant, `Verwacht service level tegenover het doel van ${pct(p.serviceLevel)} binnen ${p.wachttijd} seconden`)}
        </div>
        <p className="note mt-2">
          Verwacht service level <b>{pct(t.sl, 1)}</b> (doel {pct(p.serviceLevel)} binnen {p.wachttijd} seconden){onder ? `, op ${onder === 1 ? '1 dag' : `${onder} dagen`} eronder` : ''}.
          {' '}{nl(gepland, 0)} uur aan de telefoon gepland, {nl(nodig, 0)} uur nodig.
          {t.wensen.totaal ? ` ${t.wensen.gehonoreerd} van ${t.wensen.totaal} wensen gehonoreerd.` : ''}
        </p>
        {GROEPEN.map((g) => {
          const lijst = t.checks.filter((c) => c.niveau === g);
          if (!lijst.length) return null;
          return (
            <div key={g} className="mt-3">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">{g}</div>
              <table className="mt-1 w-full text-[13.5px]">
                <tbody>
                  {lijst.map((c) => (
                    <tr key={c.id} className="border-t border-line" title={c.uitleg}>
                      <td className="py-1.5 pr-2 align-top">
                        {c.naam}
                        <div className="text-[12px] text-muted">{opsomming(c.items.slice(0, 5))}{c.items.length > 5 ? ` en ${c.items.length - 5} meer` : ''}</div>
                      </td>
                      <td className="py-1.5 text-right align-top"><Pill soort={c.hard ? 'bad' : 'warn'}>{c.items.length}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {!t.checks.length && <p className="mt-3 text-[13.5px]"><Pill soort="ok">ok</Pill> Geen overtredingen van ATW, CAO of beleid.</p>}
      </div>
    </div>
  );
}
