/** Schoolvakanties van rijksoverheid.nl (open data), per schooljaar en regio (noord, midden, zuid). */
import { haal } from './common';
import type { Schoolvakantie } from '../capaciteit/verlof';

interface RijksVakantie {
  type?: string;
  regions?: { region?: string; startdate?: string; enddate?: string }[];
}

/** De API geeft middernacht in Nederlandse tijd als UTC-moment; terug naar een kalenderdatum. */
function datum(moment: string): string {
  const d = new Date(moment);
  if (Number.isNaN(d.getTime())) return moment.slice(0, 10);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
}

export async function schoolvakanties(schooljaren: string[]): Promise<Schoolvakantie[]> {
  const out: Schoolvakantie[] = [];
  for (const jaar of schooljaren) {
    if (!/^\d{4}-\d{4}$/.test(jaar)) continue;
    const r = await haal(`https://opendata.rijksoverheid.nl/v1/sources/rijksoverheid/infotypes/schoolholidays/schoolyear/${jaar}?output=json`, 20_000);
    const js = await r.json();
    const inhoud = Array.isArray(js?.content) ? js.content : [];
    for (const c of inhoud) {
      for (const v of (c?.vacations ?? []) as RijksVakantie[]) {
        const naam = String(v.type ?? 'Vakantie').trim();
        for (const reg of v.regions ?? []) {
          if (!reg.startdate || !reg.enddate) continue;
          const regio = String(reg.region ?? '').toLowerCase();
          const sr = regio.startsWith('noord') ? 'noord' : regio.startsWith('midden') ? 'midden' : regio.startsWith('zuid') ? 'zuid' : 'alle';
          const van = datum(reg.startdate), tot = datum(reg.enddate);
          out.push({ id: `${jaar}-${naam}-${sr}`.toLowerCase().replace(/\s+/g, '-'), naam, regio: sr, van, tot, bron: 'rijksoverheid' });
        }
      }
    }
  }
  return out;
}
