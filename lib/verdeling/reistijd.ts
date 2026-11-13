/**
 * Reistijden voor de verdeling: eerst per melding de K dichtstbijzijnde mensen op de tabel (gratis), dan alleen voor
 * die paren de live reistijd per tijdvak. Wat ontbreekt, valt terug op de schatting, gekalibreerd op de live tijden.
 */
import { schatReistijd } from './geo';
import type { Invoer, Punt, ReistijdFn } from './types';

const BANDEN = [
  { naam: 'ochtend', tot: 11 * 60, vertrek: 9 * 60 },
  { naam: 'middag', tot: 15 * 60, vertrek: 12.5 * 60 },
  { naam: 'eind', tot: Infinity, vertrek: 16.5 * 60 },
] as const;

export function bandVan(vertrek: number): number {
  return BANDEN.findIndex((b) => vertrek < b.tot);
}

const ll = (p: Punt) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

export function sleutel(a: Punt, b: Punt, band: number): string {
  return `${ll(a)}>${ll(b)}@${band}`;
}

interface Paar {
  van: Punt;
  naar: Punt;
  band: number;
}

export class Reistijden {
  private readonly live = new Map<string, number>();
  private factor = 1;
  gebruikt = { live: 0, schatting: 0 };

  constructor(private readonly schatting: ReistijdFn = schatReistijd) {}

  zet(p: Paar, minuten: number) {
    this.live.set(sleutel(p.van, p.naar, p.band), minuten);
  }

  heeft(p: Paar): boolean {
    return this.live.has(sleutel(p.van, p.naar, p.band));
  }

  get aantalLive(): number {
    return this.live.size;
  }

  get kalibratie(): number {
    return this.factor;
  }

  /** De mediaan van live / schatting (begrensd), zodat een terugval niet stelselmatig te kort of te lang is. */
  kalibreer(paren: Paar[]): number {
    const r: number[] = [];
    for (const p of paren) {
      const l = this.live.get(sleutel(p.van, p.naar, p.band));
      const s = this.schatting(p.van, p.naar, BANDEN[p.band].vertrek);
      if (l != null && s > 5 && Number.isFinite(s)) r.push(l / s);
    }
    if (r.length >= 10) {
      r.sort((a, b) => a - b);
      this.factor = Math.min(1.5, Math.max(0.7, r[Math.floor(r.length / 2)]));
    }
    return this.factor;
  }

  readonly reistijd: ReistijdFn = (a, b, vertrek) => {
    const l = this.live.get(sleutel(a, b, bandVan(vertrek)));
    if (l != null) { this.gebruikt.live++; return l; }
    this.gebruikt.schatting++;
    return this.schatting(a, b, vertrek) * this.factor;
  };
}

/** Per melding de K dichtstbijzijnde mensen, met de reizen die hun dag dan kan hebben. */
export function benodigdeParen(invoer: Invoer, k: number, schatting: ReistijdFn = schatReistijd): Paar[] {
  const uit = new Map<string, Paar>();
  const voeg = (van: Punt, naar: Punt, band: number) => {
    if (van.lat === naar.lat && van.lng === naar.lng) return;
    uit.set(sleutel(van, naar, band), { van, naar, band });
  };
  const perPersoon = new Map<string, Punt[]>();
  for (const m of invoer.meldingen) {
    const kandidaten = invoer.personen
      .filter((p) => p.slots.length && !m.nietBij?.includes(p.id))
      .map((p) => ({ p, r: Math.min(schatting(p.thuis, m.plek, p.dienstStart), ...p.afspraken.map((a) => schatting(a.plek, m.plek, a.eind))) }))
      .filter((x) => x.r <= invoer.parameters.maxReistijd * 1.15)
      .sort((a, b) => a.r - b.r)
      .slice(0, k);
    for (const { p } of kandidaten) {
      (perPersoon.get(p.id) ?? perPersoon.set(p.id, []).get(p.id)!).push(m.plek);
      for (const s of p.slots) voeg(p.thuis, m.plek, bandVan(s.van - 60));
      for (const a of p.afspraken) {
        voeg(a.plek, m.plek, bandVan(a.eind));
        for (const s of p.slots) voeg(a.plek, m.plek, bandVan(Math.max(a.eind, s.van - 60)));
        voeg(m.plek, a.plek, bandVan(a.start - 60));
      }
      // terug naar huis: na een ochtendgesprek rond het middaguur, na een middaggesprek aan het eind van de dag
      for (const s of p.slots) voeg(m.plek, p.thuis, bandVan(s.van + invoer.parameters.gesprekDuur));
    }
  }
  for (const p of invoer.personen) {
    if (p.slots.length < 2) continue;
    const plekken = perPersoon.get(p.id) ?? [];
    const band = bandVan(p.slots[0].van + invoer.parameters.gesprekDuur);
    for (const a of plekken) for (const b of plekken) voeg(a, b, band);
  }
  return [...uit.values()];
}

/** Met de juiste verschuiving: zomertijd van de laatste zondag van maart tot die van oktober. */
export function amsterdamIso(datum: string, minuten: number): string {
  const [j, m, d] = datum.split('-').map(Number);
  const laatsteZondag = (maand: number) => {
    const t = new Date(Date.UTC(j, maand, 0));
    return t.getUTCDate() - t.getUTCDay();
  };
  const utcMin = (dag: number, maand: number) => Date.UTC(j, maand - 1, dag, 1, 0);
  const lokaalAlsUtc = Date.UTC(j, m - 1, d, 0, minuten);
  // de overgang is om 1:00 UTC; met +1 is dat 2:00 lokaal
  const zomer = lokaalAlsUtc - 3_600_000 >= utcMin(laatsteZondag(3), 3) && lokaalAlsUtc - 7_200_000 < utcMin(laatsteZondag(10), 10);
  const off = zomer ? 2 : 1;
  const hh = String(Math.floor(minuten / 60)).padStart(2, '0');
  const mm = String(minuten % 60).padStart(2, '0');
  return `${datum}T${hh}:${mm}:00+0${off}:00`;
}

interface LiveAntwoord {
  aanbieder: string | null;
  /** In dezelfde volgorde; null als er geen route was. */
  minuten: (number | null)[];
  fout?: string;
}

/** Via de eigen server (die de sleutel heeft), in porties. */
export async function haalLive(datum: string, paren: Paar[], r: Reistijden, opties: { portie?: number; fetch?: typeof fetch } = {}): Promise<{ opgehaald: number; aanbieder: string | null; fout?: string }> {
  const f = opties.fetch ?? fetch;
  const portie = opties.portie ?? 600;
  let opgehaald = 0, aanbieder: string | null = null;
  for (let i = 0; i < paren.length; i += portie) {
    const deel = paren.slice(i, i + portie);
    const res = await f('/api/reistijd', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        paren: deel.map((p) => ({ van: [p.van.lat, p.van.lng], naar: [p.naar.lat, p.naar.lng], vertrek: amsterdamIso(datum, BANDEN[p.band].vertrek) })),
      }),
    });
    const j = (await res.json().catch(() => ({}))) as Partial<LiveAntwoord>;
    if (!res.ok || !Array.isArray(j.minuten)) return { opgehaald, aanbieder, fout: j.fout ?? `Reistijden ophalen mislukt (${res.status})` };
    aanbieder = j.aanbieder ?? null;
    j.minuten.forEach((min, k) => {
      if (typeof min === 'number' && Number.isFinite(min)) { r.zet(deel[k], min); opgehaald++; }
    });
  }
  r.kalibreer(paren);
  return { opgehaald, aanbieder };
}
