import { rng } from '../model/demo';
import { NORM_STANDAARD } from '../capaciteit/parameters';
import type { Medewerker } from './types';
import { isNbd } from '../nbd/parameters';

const VOORNAMEN = [
  'Anouk', 'Bas', 'Carlijn', 'Daan', 'Els', 'Femke', 'Gerard', 'Hanneke', 'Ilse', 'Joost', 'Karin', 'Lotte', 'Mark', 'Nicole',
  'Olaf', 'Petra', 'Ruud', 'Sanne', 'Thijs', 'Vera', 'Wim', 'Yvonne', 'Bram', 'Inge', 'Maaike', 'Rik', 'Esther', 'Jeroen',
  'Lieke', 'Marloes', 'Niels', 'Paul', 'Renske', 'Sven', 'Tessa', 'Ward',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Reproduceerbaar per regio; de omvang volgt de formatie (fte × 40). De NBD krijgt ongeveer 935 contracturen per week. */
export function voorbeeldTeam(regio: string, maakId: () => string): Medewerker[] {
  const R = rng(hash(regio));
  const nbd = isNbd(regio);
  const fte = nbd ? 23.4 : NORM_STANDAARD.regios[regio]?.fte[0] ?? 12;
  const doel = fte * 40;
  const namen = [...VOORNAMEN];
  for (let i = namen.length - 1; i > 0; i--) {
    const j = Math.floor(R.uniform() * (i + 1));
    [namen[i], namen[j]] = [namen[j], namen[i]];
  }
  const leiders = nbd ? [] : fte >= 13 ? [20, 16] : [20];
  const uren: number[] = [];
  let som = leiders.reduce((a, b) => a + b, 0);
  while (som < doel - 12) {
    const c = R.pick(nbd ? [20, 24, 24, 28, 28, 32, 32, 36] : [24, 28, 32, 32, 36, 36]);
    uren.push(c);
    som += c;
  }
  const team: Medewerker[] = uren.map((contract, i) => ({
    id: maakId(),
    regio,
    naam: '',
    contract,
    voorkeur: R.uniform() < 0.6 ? 'O' : 'M',
    weekendgroep: (i % 2) as 0 | 1,
    functie: 'UV',
    // NBD: de meesten hebben een variabel rooster met 4 uur extra inzet; een paar vaste uren
    ...(nbd && R.uniform() < 0.85 ? { maxUren: contract + 4 } : {}),
    actief: true,
  }));
  leiders.forEach((contract, i) => team.push({
    id: maakId(), regio, naam: '', contract, voorkeur: 'O', weekendgroep: (i % 2) as 0 | 1, functie: 'UL', actief: true,
  }));
  team.forEach((m, i) => { m.naam = `${namen[i % namen.length]} ${String.fromCharCode(65 + Math.floor(R.uniform() * 26))}.`; });
  return team;
}
