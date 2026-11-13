'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Sectie, Veld } from '@/components/ui';
import { useApp, zetWoonpostcodes } from '@/lib/store/store';
import { inRooster, opVolgorde } from '@/lib/rooster/types';

const POSTCODE = /^\s*[1-9]\d{3}(\s?[A-Za-z]{2})?\s*$/;
/** Waar de simulatie de postcodes eerder alleen in deze browser bewaarde. */
const OUD = 'grip-verdeling-postcodes';

/** PC4, bij de medewerker; zonder postcode rekenen we vanaf het midden van de regio. */
export function Woonplaatsen() {
  const s = useSessie();
  const actie = useActie();
  const medewerkers = useApp((x) => x.medewerkers);
  const team = useMemo(() => medewerkers.filter((m) => inRooster(m) && m.functie !== 'UL' && s.regios.includes(m.regio))
    .sort((a, b) => a.regio.localeCompare(b.regio) || opVolgorde(a, b)), [medewerkers, s.regios]);
  const bewaard = useMemo(() => Object.fromEntries(team.map((m) => [m.id, m.postcode ?? ''])), [team]);
  const [concept, setConcept] = useState<Record<string, string>>(bewaard);
  useEffect(() => {
    // wat eerder alleen in deze browser stond, alvast invullen (bewaren gaat met de knop)
    let oud: Record<string, string> = {};
    try { oud = JSON.parse(localStorage.getItem(OUD) ?? '{}') as Record<string, string>; } catch { /* geen opslag */ }
    setConcept(Object.fromEntries(Object.entries(bewaard).map(([id, pc]) => [id, pc || (oud[id] ?? '')])));
  }, [bewaard]);
  if (!team.length) return null;
  const ongeldig = (v: string) => !!v.trim() && !POSTCODE.test(v);
  const met = team.filter((m) => m.postcode).length;
  const gewijzigd = team.some((m) => (concept[m.id] ?? '').trim().slice(0, 4) !== (m.postcode ?? ''));
  const fout = team.some((m) => ongeldig(concept[m.id] ?? ''));
  return (
    <Sectie titel="Woonplaatsen" lead="De postcode van waar iemand woont: daar begint de reis naar het eerste gesprek. We bewaren alleen de 4 cijfers. Zonder postcode rekenen we vanaf het midden van de regio.">
      <details className="box">
        <summary className="cursor-pointer font-semibold">{team.length} uitvaartverzorgers · {met} met postcode</summary>
        <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {team.map((m) => (
            <Veld key={m.id} label={`${m.naam} · ${m.regio}`} hint={ongeldig(concept[m.id] ?? '') ? 'Geen postcode (1234 of 1234 AB)' : undefined}>
              <input className="input" placeholder="1234" maxLength={7} autoComplete="off" value={concept[m.id] ?? ''} aria-invalid={ongeldig(concept[m.id] ?? '') || undefined} onChange={(e) => setConcept({ ...concept, [m.id]: e.target.value })} />
            </Veld>
          ))}
        </div>
        <button type="button" className="btn mt-4" disabled={!gewijzigd || fout} onClick={() => actie(() => {
          zetWoonpostcodes(Object.fromEntries(team.map((m) => [m.id, (concept[m.id] ?? '').trim()])));
          try { localStorage.removeItem(OUD); } catch { /* geen opslag */ }
        }, 'Woonplaatsen bewaard')}>Woonplaatsen bewaren</button>
      </details>
    </Sectie>
  );
}
