/** De urennorm bij verlof en ziekte: een week verlof is één week contract, ook als het verlof het weekend omvat. */
import { describe, it, expect } from 'vitest';
import { isoRange } from '@/lib/dates';
import { toets } from '@/lib/rooster/toets';
import { voorstel } from '@/lib/rooster/voorstel';
import { teamOverzicht } from '@/lib/rooster/team';
import { afwezigVoorNorm } from '@/lib/rooster/diensten';
import { poissonQuantile } from '@/lib/model/poisson';
import { STANDAARD_BELEID, type Behoefte, type Cellen, type DienstCode, type Medewerker } from '@/lib/rooster/types';

const dates = isoRange('2027-03-01', '2027-03-31');
const mk = (i: number, contract = 36, functie: 'UV' | 'UL' = 'UV'): Medewerker => ({ id: `m${i}`, regio: 'Utrecht', naam: `M${i}`, contract, voorkeur: 'O', weekendgroep: i % 2, functie, actief: true });
const team: Medewerker[] = [...Array.from({ length: 14 }, (_, i) => mk(i)), mk(14, 32, 'UL'), mk(15, 32, 'UL')];
const behoefte: Behoefte = Object.fromEntries(dates.map((d) => [d, { k: poissonQuantile(0.8, 4.5), lam: 4.5, bron: 'basis' as const }]));
const verlof = (van: string, tot: string): Cellen => ({ m0: Object.fromEntries(isoRange(van, tot).map((d) => [d, 'V' as DienstCode])) });
const pas = (c: Cellen, w: [string, string, DienstCode][]) => {
  const uit: Cellen = JSON.parse(JSON.stringify(c));
  for (const [m, d, s] of w) (uit[m] ??= {})[d] = s;
  return uit;
};
const alleUren = (c: Cellen) => {
  const w = voorstel({ team, dates, cellen: c, behoefte, wensen: [], beleid: STANDAARD_BELEID, opnieuw: true });
  return toets({ team, dates, cellen: pas(c, w), behoefte, wensen: [], beleid: STANDAARD_BELEID }).uren;
};
const metVerlof = (c: Cellen) => alleUren(c).m0;

describe('urennorm bij verlof en ziekte', () => {
  it('verlof telt alleen op werkdagen; ziekte staat alleen op diensten en telt altijd', () => {
    expect(afwezigVoorNorm('V', false)).toBe(true);
    expect(afwezigVoorNorm('V', true)).toBe(false);
    expect(afwezigVoorNorm('Z', true)).toBe(true);
    expect(afwezigVoorNorm('1', false)).toBe(false);
  });

  it('een week verlof van maandag t/m zondag kost één week contract, net als maandag t/m vrijdag', () => {
    const week = 36 * 31 / 7 - 36;
    const heel = metVerlof(verlof('2027-03-08', '2027-03-14'));
    const werkweek = metVerlof(verlof('2027-03-08', '2027-03-12'));
    expect(heel.norm).toBeCloseTo(week, 6);
    expect(werkweek.norm).toBeCloseTo(week, 6);
    // en Rooster maken plant wie verlof had even ver als de rest. Dit team is groter dan het werk (de Dg-diensten per
    // dag hebben een maximum), dus iedereen blijft naar verhouding even ver onder zijn uren: niet een dag minder
    const uren = alleUren(verlof('2027-03-08', '2027-03-14'));
    const aandeel = (id: string) => uren[id].gepland / uren[id].norm;
    const rest = team.filter((m) => m.id !== 'm0' && m.functie === 'UV').map((m) => aandeel(m.id)).sort((a, b) => a - b);
    expect(aandeel('m0')).toBeGreaterThan(rest[Math.floor(rest.length / 2)] - 0.06);
    expect(rest.at(-1)! - rest[0]).toBeLessThan(0.06);
  });

  it('ook het teamoverzicht: een week verlof is één week, een zieke zaterdagdienst telt mee', () => {
    const vandaag = '2027-03-01';
    const norm = (cellen: Cellen) => teamOverzicht({ team: [team[0]], cellen, verlof: [], profielen: {}, beleid: STANDAARD_BELEID, vandaag }).rijen[0].uren4.norm;
    expect(norm(verlof('2027-03-08', '2027-03-14'))).toBeCloseTo(36 * 4 - 36, 6);
    // ziek op een zaterdag met een dienst: die dag telt, net als in de toets
    expect(norm({ m0: { '2027-03-13': 'Z' } })).toBeCloseTo(36 * 4 - 36 / 5, 6);
  });
});
