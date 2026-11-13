/**
 * Erlang C, met de stabiele recursie van Erlang B in plaats van faculteiten (die lopen boven de 170 over).
 *
 *   A  = gesprekken × gespreksduur / intervalduur   (aanbod in erlang)
 *   C  = kans dat een beller moet wachten, met n mensen
 *   SL = 1 − C × e^(−(n − A) × wachttijd / gespreksduur)
 */

export function aanbod(gesprekken: number, aht: number, interval: number): number {
  return gesprekken > 0 && aht > 0 && interval > 0 ? (gesprekken * aht) / interval : 0;
}

/** 1 als n niet groter is dan a. */
export function wachtkans(a: number, n: number): number {
  if (a <= 0) return 0;
  if (n <= a) return 1;
  let b = 1;
  for (let k = 1; k <= n; k++) b = (a * b) / (k + a * b);
  return (n * b) / (n - a * (1 - b));
}

export function serviceLevel(gesprekken: number, aht: number, interval: number, n: number, wachttijd: number): number {
  const a = aanbod(gesprekken, aht, interval);
  if (a <= 0) return 1;
  if (n <= a) return 0;
  return Math.max(0, Math.min(1, 1 - wachtkans(a, n) * Math.exp(-((n - a) * wachttijd) / aht)));
}

/** 0 zonder gesprekken. */
export function nodigErlang(gesprekken: number, aht: number, interval: number, doel: number, wachttijd: number): number {
  const a = aanbod(gesprekken, aht, interval);
  if (a <= 0) return 0;
  let n = Math.max(1, Math.floor(a) + 1);
  // ruim genoeg voor elk realistisch aanbod; daarboven geeft het de grens terug
  for (let i = 0; i < 500; i++, n++) {
    if (serviceLevel(gesprekken, aht, interval, n, wachttijd) >= doel) return n;
  }
  return n;
}
