/** Getal met Nederlandse komma. */
export function nl(x: number, dp = 1): string {
  if (!Number.isFinite(x)) return '–';
  return x.toFixed(dp).replace('.', ',');
}

/** Getal met duizendtallen en komma. */
export function nlInt(x: number): string {
  return Math.round(x).toLocaleString('nl-NL');
}

export function pct(x: number, dp = 0): string {
  return nl(x * 100, dp) + '%';
}

/** Procent met teken: "+3,2%" of "−1,0%". */
export function pctS(x: number, dp = 1): string {
  const v = x * 100;
  if (Math.abs(v) < 0.5 * Math.pow(10, -dp)) return '0%';
  return (v > 0 ? '+' : '−') + nl(Math.abs(v), dp) + '%';
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function plural(n: number, een: string, meer: string): string {
  return `${n} ${n === 1 ? een : meer}`;
}

/** "a, b en 3 meer" */
export function opsomming(items: string[], max = 3): string {
  const u = [...new Set(items)];
  if (u.length <= max) return u.length > 1 ? u.slice(0, -1).join(', ') + ' en ' + u[u.length - 1] : u.join('');
  return u.slice(0, max).join(', ') + ' en ' + (u.length - max) + ' meer';
}

/** Uren met hoogstens twee decimalen, zonder overbodige nullen: 8, 7,5 of 6,25. */
export function nlUren(x: number): string {
  return nl(x, 2).replace(/,?0+$/, '');
}
