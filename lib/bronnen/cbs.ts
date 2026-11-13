/** CBS StatLine 70895ned: overledenen per week, totaal geslacht en leeftijd. */
import { haal, naarReeksen, type BronResultaat } from './common';

const BASE = 'https://opendata.cbs.nl/ODataApi/odata/70895ned/TypedDataSet';

/** "2024W05" -> maandag van ISO-week 5 van 2024; jaartotalen en week 0 vallen af. */
export function weekStart(code: string): string | null {
  const m = code.trim().match(/^(\d{4})W(\d+)/);
  if (!m) return null;
  const y = +m[1], w = +m[2].slice(-2);
  if (w < 1 || w > 53) return null;
  const jan4 = Date.UTC(y, 0, 4), wd = (new Date(jan4).getUTCDay() + 6) % 7;
  const mon = jan4 - wd * 86_400_000 + (w - 1) * 7 * 86_400_000;
  const iso = new Date(mon).toISOString().slice(0, 10);
  // week 53 bestaat niet in elk jaar
  if (w === 53) {
    const thu = new Date(mon + 3 * 86_400_000);
    if (thu.getUTCFullYear() !== y) return null;
  }
  return iso;
}

export function parseCbs(rows: Record<string, unknown>[]): [string, string, string, number | null][] {
  const out: [string, string, string, number | null][] = [];
  for (const r of rows) {
    const d = weekStart(String(r.Perioden ?? ''));
    const v = r.Overledenen_1;
    if (d && typeof v === 'number') out.push(['NL', d, 'overledenen', v]);
  }
  return out;
}

export async function sterftePerWeek(): Promise<BronResultaat> {
  const flt = "Geslacht eq '1100' and LeeftijdOp31December eq '10000'";
  let rows: Record<string, unknown>[];
  try {
    const q = new URLSearchParams({ $filter: flt, $format: 'json' });
    rows = (await (await haal(`${BASE}?${q}`, 120_000)).json()).value;
  } catch {
    const all: Record<string, unknown>[] = (await (await haal(`${BASE}?$format=json`, 180_000)).json()).value;
    rows = all.filter((r) => String(r.Geslacht ?? '').trim() === '1100' && String(r.LeeftijdOp31December ?? '').trim() === '10000');
  }
  return { bron: 'cbs', ...naarReeksen(parseCbs(rows)) };
}
