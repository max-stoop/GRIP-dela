/**
 * Datumrekenen op hele dagen. Een dag is een geheel getal: het aantal dagen sinds 1970-01-01 (UTC).
 * Zo zijn optellen, vergelijken en vensters rekenen exact, zonder tijdzone- of zomertijdfouten.
 */

export type Day = number;

const MS_DAY = 86_400_000;

export function toDay(iso: string): Day {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function fromDay(n: Day): string {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return fromDay(toDay(iso) + n);
}

export function diffDays(a: string, b: string): number {
  return toDay(a) - toDay(b);
}

/**
 * Datum en tijd in Nederland. De server draait in UTC; zo zien de server en de browser dezelfde dag en hetzelfde uur,
 * ook rond middernacht, en plant iemand die in het buitenland inlogt gewoon op Nederlandse dagen.
 */
const NL_TIJD = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
let laatsteNl: { t: number; delen: Record<string, string> } | null = null;

function inNederland(now: Date): Record<string, string> {
  const t = Math.floor(now.getTime() / 1000);
  if (laatsteNl?.t === t) return laatsteNl.delen;
  const delen: Record<string, string> = {};
  for (const p of NL_TIJD.formatToParts(now)) delen[p.type] = p.value;
  laatsteNl = { t, delen };
  return delen;
}

export function todayIso(now: Date = new Date()): string {
  const p = inNederland(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 'JJJJ-MM-DD' of 'JJJJ-MM-DDTUU:MM:SS' zonder tijdzone, als Nederlandse tijd. */
export function uitNederlandseTijd(stempel: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(stempel);
  if (!m) return new Date(NaN);
  const alsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  // het verschil met UTC op dat moment (1 of 2 uur, met zomertijd); twee keer, voor de nacht van de omschakeling
  const verschil = (t: number) => {
    const p = inNederland(new Date(t));
    return Date.UTC(+p.year, +p.month - 1, +p.day, Number(p.hour) % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  };
  const t = alsUtc - verschil(alsUtc);
  return new Date(alsUtc - verschil(t));
}

export function uurNu(now: Date = new Date()): number {
  return Number(inNederland(now).hour) % 24;
}

/** 0 = zondag … 6 = zaterdag. */
export function weekday(n: Day): number {
  return (((n + 4) % 7) + 7) % 7;
}

/** 0 = maandag … 6 = zondag. */
export function weekdayMon(n: Day): number {
  return (weekday(n) + 6) % 7;
}

export function isWeekend(n: Day): boolean {
  const w = weekday(n);
  return w === 0 || w === 6;
}

/** De week begint op maandag; geen sprong rond de jaarwisseling. */
export function weekIndex(n: Day): number {
  return Math.floor((n + 3) / 7);
}

export function mondayOf(n: Day): Day {
  return n - weekdayMon(n);
}

export function year(n: Day): number {
  return new Date(n * MS_DAY).getUTCFullYear();
}

export function month(n: Day): number {
  return new Date(n * MS_DAY).getUTCMonth() + 1;
}

export function dayOfMonth(n: Day): number {
  return new Date(n * MS_DAY).getUTCDate();
}

/** 1..366 */
export function dayOfYear(n: Day): number {
  return n - Math.round(Date.UTC(year(n), 0, 1) / MS_DAY) + 1;
}

export function isoWeek(n: Day): number {
  const thursday = n - weekdayMon(n) + 3;
  const jan1 = Math.round(Date.UTC(year(thursday), 0, 1) / MS_DAY);
  return Math.floor((thursday - jan1) / 7) + 1;
}

function range(start: Day, end: Day): Day[] {
  const out: Day[] = [];
  for (let d = start; d <= end; d++) out.push(d);
  return out;
}

export function isoRange(start: string, end: string): string[] {
  return range(toDay(start), toDay(end)).map(fromDay);
}

function easterSunday(y: number): Day {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Math.round(Date.UTC(y, month - 1, day) / MS_DAY);
}

const holidayCache = new Map<number, Set<Day>>();

/** Landelijke feestdagen: nieuwjaar, Pasen, Koningsdag, Bevrijdingsdag (lustrum), Hemelvaart, Pinksteren, Kerst. */
export function holidaysOf(y: number): Set<Day> {
  let s = holidayCache.get(y);
  if (s) return s;
  const D = (m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
  const e = easterSunday(y);
  let koningsdag = D(4, 27);
  if (weekday(koningsdag) === 0) koningsdag -= 1;
  s = new Set([D(1, 1), e, e + 1, koningsdag, e + 39, e + 49, e + 50, D(12, 25), D(12, 26)]);
  if (y % 5 === 0) s.add(D(5, 5));
  holidayCache.set(y, s);
  return s;
}

export function isHoliday(n: Day): boolean {
  return holidaysOf(year(n)).has(n);
}

/** Dezelfde dagen als holidaysOf, met naam. */
export function feestdagenVan(y: number): { datum: string; naam: string }[] {
  const D = (m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
  const e = easterSunday(y);
  let koningsdag = D(4, 27);
  if (weekday(koningsdag) === 0) koningsdag -= 1;
  const lijst: [Day, string][] = [
    [D(1, 1), 'Nieuwjaarsdag'], [e, 'Eerste paasdag'], [e + 1, 'Tweede paasdag'], [koningsdag, 'Koningsdag'],
    ...(y % 5 === 0 ? [[D(5, 5), 'Bevrijdingsdag'] as [Day, string]] : []),
    [e + 39, 'Hemelvaartsdag'], [e + 49, 'Eerste pinksterdag'], [e + 50, 'Tweede pinksterdag'], [D(12, 25), 'Eerste kerstdag'], [D(12, 26), 'Tweede kerstdag'],
  ];
  return lijst.sort((a, b) => a[0] - b[0]).map(([n, naam]) => ({ datum: fromDay(n), naam }));
}

export const DAG_KORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
export const DAG_LANG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
export const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
export const MAAND_LANG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/** "5 okt" */
export function fmtD(iso: string): string {
  const n = toDay(iso);
  return `${dayOfMonth(n)} ${MAAND_KORT[month(n) - 1]}`;
}

/** "ma 5 okt" */
export function fmtDag(iso: string): string {
  const n = toDay(iso);
  return `${DAG_KORT[weekday(n)]} ${dayOfMonth(n)} ${MAAND_KORT[month(n) - 1]}`;
}

/** "maandag 5 oktober 2026" */
export function fmtLang(iso: string, metJaar = true): string {
  const n = toDay(iso);
  return `${DAG_LANG[weekday(n)]} ${dayOfMonth(n)} ${MAAND_LANG[month(n) - 1]}${metJaar ? ' ' + year(n) : ''}`;
}

/** "5 okt 2026" */
export function fmtDJ(iso: string): string {
  return `${fmtD(iso)} ${iso.slice(0, 4)}`;
}

/** "2026-10-05T14:03:11" -> "5 okt 14:03" */
export function fmtMoment(ts: string): string {
  return `${fmtD(ts.slice(0, 10))} ${ts.slice(11, 16)}`;
}

/** Het moment nu in Nederland: "2026-10-05T14:03:11". */
export function nowStamp(now: Date = new Date()): string {
  const p = inNederland(now);
  return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}:${p.second}`;
}
