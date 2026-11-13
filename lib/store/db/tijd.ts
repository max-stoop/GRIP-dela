/** De app werkt met Nederlandse tijdstempels zonder tijdzone (nowStamp), de database met timestamptz. */
import { nowStamp, uitNederlandseTijd } from '../../dates';

export function naarTijdstip(s: string | null | undefined): string | null {
  if (!s) return null;
  // zonder tijdzone: Nederlandse tijd; met tijdzone (Z of +02:00) zoals het er staat
  const d = /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? new Date(s) : uitNederlandseTijd(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function uitTijdstip(s: unknown): string | undefined {
  if (typeof s !== 'string' || !s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : nowStamp(d);
}

export function uitDatum(s: unknown): string | undefined {
  return typeof s === 'string' && s ? s.slice(0, 10) : undefined;
}
