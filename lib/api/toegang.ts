/**
 * Toegang tot de server-routes (AI, bronnen): ingelogd met een planningsrol, want de AI kost geld. Zonder login alleen
 * tijdens het ontwikkelen, of op een server met ZONDER_LOGIN=1. Daarbovenop een limiet per gebruiker of IP-adres, per
 * serverproces.
 */
import { gedeeld } from '@/lib/platform';
import { bepaalSessie } from '@/lib/sessie';
import { plant } from '@/lib/rechten';
import { vanDezeSite } from './herkomst';

type Toegang = { ok: true; sleutel: string } | { ok: false; status: number; fout: string };

export function zonderLoginToegestaan(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ZONDER_LOGIN === '1';
}

function ipVan(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'onbekend';
}

export async function toegang(req: Request): Promise<Toegang> {
  if (!vanDezeSite(req)) return { ok: false, status: 403, fout: 'Niet toegestaan' };
  if (!gedeeld()) {
    if (!zonderLoginToegestaan()) return { ok: false, status: 401, fout: 'Niet ingelogd' };
    return { ok: true, sleutel: `ip:${ipVan(req)}` };
  }
  const u = await bepaalSessie();
  if (u.soort === 'niet_ingelogd') return { ok: false, status: 401, fout: 'Niet ingelogd' };
  if (u.soort === 'geen_profiel') return { ok: false, status: 403, fout: 'Dit account heeft geen toegang tot GRIP' };
  const s = u.sessie;
  if (!plant(s.rol)) return { ok: false, status: 403, fout: 'Alleen voor planners, regiomanagers en beheerders' };
  return { ok: true, sleutel: `gebruiker:${s.email || s.naam}` };
}

const tellers = new Map<string, number[]>();
/** Bovengrens voor het aantal sleutels in het geheugen: wie steeds een ander adres opgeeft, laat de lijst niet groeien. */
const MAX_SLEUTELS = 5000;

/** Sliding window: hoogstens max keer per perMs. Geeft de seconden tot het weer mag, of 0. */
export function limiet(sleutel: string, max: number, perMs: number, nu = Date.now()): number {
  const lijst = (tellers.get(sleutel) ?? []).filter((t) => t > nu - perMs);
  if (!tellers.has(sleutel) && tellers.size >= MAX_SLEUTELS) {
    for (const [k, v] of tellers) if (!v.length || v[v.length - 1] <= nu - perMs) tellers.delete(k);
    // nog steeds vol: alles wat geen gebruiker is, telt als één (anoniem verkeer)
    if (tellers.size >= MAX_SLEUTELS && !sleutel.startsWith('gebruiker:')) return limiet('ip:vol', max, perMs, nu);
  }
  if (lijst.length >= max) {
    tellers.set(sleutel, lijst);
    return Math.ceil((lijst[0] + perMs - nu) / 1000);
  }
  lijst.push(nu);
  tellers.set(sleutel, lijst);
  return 0;
}

export function wisLimieten() {
  tellers.clear();
}
