/**
 * Welke melding naar welke regelplek (zie docs/ontwerp-verdeling.md). Kosten zijn minuten reistijd: de dagroute per
 * medewerker, werkdruk, reeksen dagen met gesprekken, buiten regio of cluster, het tweede gesprek van een 2, een 1B
 * inzetten, de wens van de familie en het verwachte tekort later op de dag.
 *
 * Eerst invoegen met spijt, dan verbeteren, dan verstoren en opnieuw opbouwen. Deterministisch: een vaste seed.
 */
import { Tekorten } from './optie';
import { rng } from '../model/demo';
import type { Afspraak, ClusterStand, Invoer, Kostenopbouw, Melding, NietIngepland, Parameters, Persoon, Punt, ReistijdFn, Slot, Toewijzing, Uitkomst } from './types';

type Vanaf = Toewijzing['vanaf'];

interface Stap {
  start: number;
  reistijd: number;
  vanaf: Vanaf;
  /** Waar de reis begint. */
  van: Punt;
  /** Een toegezegd gesprek dat volgens het model niet meer past, blijft staan met deze waarschuwing. */
  waarschuwing?: string;
}

interface Dag {
  ok: boolean;
  reden?: string;
  /** Gewogen: heen, door, en terugreis × factor. */
  reis: number;
  stappen: Map<string, Stap>;
}

interface Vrij { o: number; m: number; b: number }

const EPS = 1e-6;

export class Plan {
  readonly par: Parameters;
  readonly personen = new Map<string, Persoon>();
  readonly slots = new Map<string, Slot>();
  readonly meldingen = new Map<string, Melding>();
  readonly slotVan = new Map<string, string>();
  readonly inSlot = new Map<string, string>();
  /** Op volgorde van geschatte reistijd. */
  readonly kandidaten = new Map<string, string[]>();
  private readonly basisReis = new Map<string, number>();
  private readonly dag = new Map<string, Dag>();
  private readonly persoonKosten = new Map<string, number>();
  private readonly clusterKosten = new Map<string, number>();
  private readonly vrij = new Map<string, Vrij>();
  private readonly tekorten = new Map<string, Tekorten>();
  private readonly geheugen = new Map<string, { dag: Dag; kosten: number }>();

  constructor(readonly invoer: Invoer, readonly reistijd: ReistijdFn, schatting: ReistijdFn = reistijd) {
    this.par = invoer.parameters;
    for (const p of invoer.personen) {
      if (!p.slots.length) continue;
      this.personen.set(p.id, p);
      for (const s of p.slots) this.slots.set(s.id, s);
    }
    for (const m of invoer.meldingen) this.meldingen.set(m.id, m);
    const clusters = new Set([...this.personen.values()].map((p) => p.cluster));
    for (const c of clusters) {
      const v = invoer.verwacht[c] ?? 0;
      this.tekorten.set(c, new Tekorten({ ochtend: v * this.par.aandeelOchtend, middag: v * this.par.aandeelMiddag }));
      this.vrij.set(c, { o: 0, m: 0, b: 0 });
    }
    for (const s of this.slots.values()) this.telVrij(s, +1);
    for (const p of this.personen.values()) {
      const d = this.evalueer(p, new Map());
      this.basisReis.set(p.id, d.ok ? d.reis : 0);
      this.dag.set(p.id, d);
      this.persoonKosten.set(p.id, 0);
    }
    for (const c of clusters) this.clusterKosten.set(c, this.clusterDeel(c));
    this.kiesKandidaten(schatting);
    // wat al is toegezegd, staat vast
    for (const m of invoer.meldingen) {
      if (!m.vast || !this.slots.has(m.vast.slotId) || this.inSlot.has(m.vast.slotId)) continue;
      this.voerUit([[m.vast.slotId, m.id]]);
    }
  }

  private telVrij(s: Slot, d: number) {
    const v = this.vrij.get(this.personen.get(s.persoonId)!.cluster)!;
    if (s.dagdeel === 'ochtend') v.o += d; else v.m += d;
    if (s.soort === '1B') v.b += d;
  }

  /** Iedereen uit het eigen cluster en daarbuiten de dichtstbijzijnde, zodat een vrije plek in het cluster nooit buiten beeld valt. */
  private kiesKandidaten(schatting: ReistijdFn) {
    const pers = [...this.personen.values()];
    for (const m of this.meldingen.values()) {
      const binnen = pers
        .filter((p) => !m.nietBij?.includes(p.id))
        .map((p) => {
          const r = Math.min(schatting(p.thuis, m.plek, p.dienstStart), ...p.afspraken.map((a) => schatting(a.plek, m.plek, a.eind)));
          return { p, r };
        })
        .filter((x) => x.r <= this.par.maxReistijd)
        .sort((a, b) => a.r - b.r || a.p.id.localeCompare(b.p.id));
      const dichtst = binnen.slice(0, this.par.kandidaten);
      const gekozen = new Set(dichtst.map((x) => x.p.id));
      const lijst = [...dichtst, ...binnen.filter((x) => x.p.cluster === m.cluster && !gekozen.has(x.p.id))];
      this.kandidaten.set(m.id, lijst.flatMap((x) => x.p.slots.map((s) => s.id)));
    }
  }

  /** Vaste afspraken staan; een gesprek kan ervoor of erna en de goedkoopste haalbare volgorde telt. */
  evalueer(p: Persoon, gesprekken: Map<string, Melding>): Dag {
    const afspraken = [...p.afspraken].sort((a, b) => a.start - b.start);
    const gs = [...gesprekken].map(([sid, m]) => ({ slot: this.slots.get(sid)!, melding: m })).sort((a, b) => a.slot.van - b.slot.van);
    if (!gs.length) return this.route(p, afspraken.map((a) => ({ afspraak: a })));
    let beste: Dag | null = null;
    let fout: Dag | null = null;
    for (const volgorde of vervlechtingen(afspraken.map((a) => ({ afspraak: a })), gs)) {
      const d = this.route(p, volgorde);
      if (d.ok) { if (!beste || d.reis < beste.reis - EPS) beste = d; } else fout ??= d;
    }
    return beste ?? fout!;
  }

  private route(p: Persoon, lijst: Gebeurtenis[]): Dag {
    const stappen = new Map<string, Stap>();
    let pos: Punt = p.thuis, t = p.dienstStart, reis = 0;
    let vanaf: Vanaf = 'thuis';
    let naGesprek = false;
    for (const g of lijst) {
      const plek = g.afspraak ? g.afspraak.plek : g.melding!.plek;
      if (g.afspraak) {
        const r = this.reistijd(pos, plek, Math.max(t, g.afspraak.start - this.par.marge - 30));
        // een afspraak staat vast; alleen als er een gesprek voor zit, moet hij nog gehaald worden
        if (naGesprek && t + r + this.par.marge > g.afspraak.start + EPS) {
          return { ok: false, reden: `haalt ${g.afspraak.soort === 'voorgang' ? 'de voorgang' : 'de afspraak'} van ${uur(g.afspraak.start)} niet`, reis: Infinity, stappen };
        }
        t = Math.max(t, g.afspraak.eind);
        vanaf = g.afspraak.soort === 'voorgang' ? 'voorgang' : g.afspraak.soort === 'gesprek' ? 'gesprek' : 'afspraak';
        naGesprek = false;
        reis += r;
      } else {
        const s = g.slot!, m = g.melding!;
        // een toegezegd gesprek staat: de familie weet het al
        const vast = m.vast?.slotId === s.id;
        // vertrekken zodat je net op tijd bent, niet eerder (dat telt voor de spits en de live reistijd)
        const doel = m.tijd ?? s.van;
        const r0 = this.reistijd(pos, plek, t);
        const vertrek = Math.max(t, doel - this.par.marge - r0);
        const r = vertrek === t ? r0 : this.reistijd(pos, plek, vertrek);
        const aankomst = vertrek + r + this.par.marge;
        // een afgesproken tijd staat; anders de eerste vaste tijd van de plek die haalbaar is, of zo vroeg mogelijk
        const vasteTijd = m.tijd == null && s.tijden?.length ? s.tijden.find((x) => x >= aankomst - EPS) : undefined;
        const start = m.tijd != null ? Math.max(aankomst, m.tijd) : s.tijden?.length ? vasteTijd ?? aankomst : Math.max(aankomst, s.van);
        const eind = start + this.par.gesprekDuur;
        const reden = r > this.par.maxReistijd + EPS ? `reistijd ${Math.round(r)} min, meer dan ${this.par.maxReistijd}`
          : m.tijd != null && (m.tijd < s.van - EPS || m.tijd > s.tot + EPS) ? `${uur(m.tijd)} past niet in deze plek (${uur(s.van)}–${uur(s.tot)})`
          : m.tijd != null && aankomst > m.tijd + EPS ? `is pas om ${uur(aankomst)} ter plaatse, afgesproken is ${uur(m.tijd)}`
          : s.tijden?.length && vasteTijd == null && m.tijd == null ? `kan pas om ${uur(aankomst)} beginnen, uiterlijk ${uur(s.tijden[s.tijden.length - 1])}`
          : start > s.tot + EPS ? `kan pas om ${uur(start)} beginnen, uiterlijk ${uur(s.tot)}`
          : m.uiterlijk != null && start > m.uiterlijk + EPS ? 'na de 24-uursgrens'
          : eind > p.dienstEind + EPS ? 'loopt uit over het einde van de dienst'
          : null;
        if (reden && !vast) return { ok: false, reden, reis: Infinity, stappen };
        stappen.set(s.id, reden ? { start, reistijd: r, vanaf, van: pos, waarschuwing: `Toegezegd, maar ${reden}.` } : { start, reistijd: r, vanaf, van: pos });
        t = eind;
        vanaf = 'gesprek';
        naGesprek = true;
        reis += r;
      }
      pos = plek;
    }
    if (lijst.length) reis += this.par.terugreis * this.reistijd(pos, p.thuis, t);
    return { ok: true, reis, stappen };
  }

  /** Onthouden: dezelfde combinatie komt vaak terug. */
  private persoonNu(p: Persoon): { dag: Dag; kosten: number } {
    const g = this.gesprekkenVan(p);
    let k = p.id;
    for (const [sid, m] of g) k += `|${sid}=${m.id}`;
    let x = this.geheugen.get(k);
    if (!x) {
      const dag = this.evalueer(p, g);
      x = { dag, kosten: dag.ok ? this.persoonDeel(p, g, dag) : Infinity };
      this.geheugen.set(k, x);
    }
    return x;
  }

  private gesprekkenVan(p: Persoon): Map<string, Melding> {
    const g = new Map<string, Melding>();
    for (const s of p.slots) {
      const mid = this.inSlot.get(s.id);
      if (mid) g.set(s.id, this.meldingen.get(mid)!);
    }
    return g;
  }

  /** Zonder reis, werkdruk en flexibiliteit. */
  vasteKosten(m: Melding, s: Slot): { regio: number; inzet1B: number; klant: number } {
    const p = this.personen.get(s.persoonId)!;
    const regio = m.regio === p.regio ? 0 : this.par.buitenRegio + (m.cluster === p.cluster ? 0 : this.par.buitenCluster);
    let klant = s.dagdeel === 'middag' ? this.par.klantMiddag : 0;
    if (m.voorkeurDagdeel && m.voorkeurDagdeel !== s.dagdeel) klant += this.par.voorkeur;
    if (m.liefstBij === p.id) klant -= this.par.liefstBij;
    return { regio, inzet1B: s.soort === '1B' ? this.par.inzet1B : 0, klant };
  }

  private fte(p: Persoon): number {
    return Math.max(0.3, p.contract / 36);
  }

  werkdrukKosten(p: Persoon, k: number): number {
    const f = this.fte(p);
    return (this.par.werkdruk * ((p.belasting + k) ** 2 - p.belasting ** 2)) / (f * f);
  }

  reeksKosten(p: Persoon, k: number): number {
    return k > 0 && p.reeks >= 2 ? this.par.reeks * (p.reeks - 1) : 0;
  }

  /** Het tweede gesprek van iemand kost extra: eerst de eerste plekken vullen. */
  tweedeKosten(k: number): number {
    return this.par.tweedeGesprek * Math.max(0, k - 1);
  }

  private persoonDeel(p: Persoon, gesprekken: Map<string, Melding>, d: Dag): number {
    if (!gesprekken.size) return 0;
    let k = (d.reis - this.basisReis.get(p.id)!) + this.werkdrukKosten(p, gesprekken.size) + this.reeksKosten(p, gesprekken.size) + this.tweedeKosten(gesprekken.size);
    for (const [sid, m] of gesprekken) {
      const v = this.vasteKosten(m, this.slots.get(sid)!);
      k += v.regio + v.inzet1B + v.klant;
    }
    return k;
  }

  private clusterDeel(c: string): number {
    const v = this.vrij.get(c)!;
    return this.par.tekort * this.tekorten.get(c)!.verwacht(v.o, v.m);
  }

  /** Verandering in de totale kosten, of null als het niet kan. Met doorvoeren blijft de wijziging staan. */
  private wijzig(wijzigingen: [string, string | null][], doorvoeren: boolean): number | null {
    const oud = wijzigingen.map(([sid]) => [sid, this.inSlot.get(sid) ?? null] as [string, string | null]);
    const zet = (lijst: [string, string | null][]) => {
      for (const [sid] of lijst) {
        const mid = this.inSlot.get(sid);
        if (mid) { this.inSlot.delete(sid); this.slotVan.delete(mid); this.telVrij(this.slots.get(sid)!, +1); }
      }
      for (const [sid, mid] of lijst) {
        if (!mid) continue;
        this.inSlot.set(sid, mid); this.slotVan.set(mid, sid); this.telVrij(this.slots.get(sid)!, -1);
      }
    };
    const personen = new Set(wijzigingen.map(([sid]) => this.slots.get(sid)!.persoonId));
    const clusters = new Set([...personen].map((pid) => this.personen.get(pid)!.cluster));
    const ongeplandVoor = this.meldingen.size - this.slotVan.size;
    zet(wijzigingen);
    let delta = (this.meldingen.size - this.slotVan.size - ongeplandVoor) * this.par.geenPlek;
    const nieuw = new Map<string, { dag: Dag; kosten: number }>();
    let ok = true;
    for (const pid of personen) {
      const x = this.persoonNu(this.personen.get(pid)!);
      if (!x.dag.ok) { ok = false; break; }
      nieuw.set(pid, x);
      delta += x.kosten - this.persoonKosten.get(pid)!;
    }
    const nieuwC = new Map<string, number>();
    if (ok) {
      for (const c of clusters) {
        const k = this.clusterDeel(c);
        nieuwC.set(c, k);
        delta += k - this.clusterKosten.get(c)!;
      }
    }
    if (!ok || !doorvoeren) {
      zet(oud);
      return ok ? delta : null;
    }
    for (const [pid, x] of nieuw) { this.dag.set(pid, x.dag); this.persoonKosten.set(pid, x.kosten); }
    for (const [c, k] of nieuwC) this.clusterKosten.set(c, k);
    return delta;
  }

  probeer(wijzigingen: [string, string | null][]): number | null {
    return this.wijzig(wijzigingen, false);
  }

  voerUit(wijzigingen: [string, string | null][]): number | null {
    return this.wijzig(wijzigingen, true);
  }

  doel(): number {
    let t = (this.meldingen.size - this.slotVan.size) * this.par.geenPlek;
    for (const k of this.persoonKosten.values()) t += k;
    for (const k of this.clusterKosten.values()) t += k;
    return t;
  }

  isVast(mid: string): boolean {
    const m = this.meldingen.get(mid)!;
    return !!m.vast && this.slotVan.get(mid) === m.vast.slotId;
  }

  stapVan(sid: string): Stap | undefined {
    return this.dag.get(this.slots.get(sid)!.persoonId)?.stappen.get(sid);
  }

  vrijIn(c: string): Vrij {
    return { ...this.vrij.get(c)! };
  }

  tekortIn(c: string): Tekorten | undefined {
    return this.tekorten.get(c);
  }

  /** Als marginale bijdrage. */
  opbouw(mid: string): Kostenopbouw {
    const sid = this.slotVan.get(mid)!;
    const s = this.slots.get(sid)!, p = this.personen.get(s.persoonId)!, m = this.meldingen.get(mid)!;
    const g = this.gesprekkenVan(p);
    const met = this.dag.get(p.id)!;
    const zonderG = new Map(g); zonderG.delete(sid);
    const zonder = zonderG.size ? this.evalueer(p, zonderG) : { reis: this.basisReis.get(p.id)!, ok: true };
    const reis = met.reis - (zonder.ok ? zonder.reis : met.reis);
    const werkdruk = (this.werkdrukKosten(p, g.size) - this.werkdrukKosten(p, 0)) / g.size;
    const reeks = this.reeksKosten(p, g.size) / g.size;
    // het tweede gesprek hoort bij het latere van de twee
    const tweede = this.isTweede(p, sid) ? this.tweedeKosten(g.size) : 0;
    const v = this.vasteKosten(m, s);
    const vr = this.vrij.get(p.cluster)!, tk = this.tekorten.get(p.cluster)!;
    const flexibiliteit = this.par.tekort * (tk.verwacht(vr.o, vr.m) - (s.dagdeel === 'ochtend' ? tk.verwacht(vr.o + 1, vr.m) : tk.verwacht(vr.o, vr.m + 1)));
    const totaal = reis + werkdruk + reeks + v.regio + tweede + v.inzet1B + flexibiliteit + v.klant;
    return { reis, werkdruk, reeks, regio: v.regio, tweede, inzet1B: v.inzet1B, flexibiliteit, klant: v.klant, totaal };
  }

  isTweede(p: Persoon, sid: string): boolean {
    const g = this.gesprekkenVan(p);
    if (g.size < 2) return false;
    const start = (x: string) => this.stapVan(x)?.start ?? 0;
    const laatste = [...g.keys()].sort((a, b) => start(a) - start(b) || a.localeCompare(b)).at(-1);
    return laatste === sid;
  }
}

type Gebeurtenis = { afspraak?: Afspraak; slot?: Slot; melding?: Melding };

function* vervlechtingen(a: Gebeurtenis[], b: Gebeurtenis[]): Generator<Gebeurtenis[]> {
  if (!a.length) { yield b; return; }
  if (!b.length) { yield a; return; }
  for (const rest of vervlechtingen(a.slice(1), b)) yield [a[0], ...rest];
  for (const rest of vervlechtingen(a, b.slice(1))) yield [b[0], ...rest];
}

export function uur(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min - h * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Steeds de melding die het meest verliest als hij zijn beste plek mist. */
function invoegen(plan: Plan, open: Set<string>, niet: NietIngepland[], ruis?: () => number) {
  while (open.size) {
    let kies: { mid: string; sid: string; spijt: number; beste: number } | null = null;
    for (const mid of open) {
      let b1 = Infinity, b2 = Infinity, s1 = '';
      for (const sid of plan.kandidaten.get(mid) ?? []) {
        if (plan.inSlot.has(sid)) continue;
        const d0 = plan.probeer([[sid, mid]]);
        if (d0 == null) continue;
        const d = ruis ? d0 + ruis() : d0;
        if (d < b1 - EPS || (Math.abs(d - b1) <= EPS && sid < s1)) { b2 = b1; b1 = d; s1 = sid; } else if (d < b2) b2 = d;
      }
      if (!s1) {
        open.delete(mid);
        niet.push({ meldingId: mid, reden: redenGeenPlek(plan, mid) });
        continue;
      }
      const spijt = (b2 === Infinity ? plan.par.geenPlek : b2) - b1;
      if (!kies || spijt > kies.spijt + EPS || (Math.abs(spijt - kies.spijt) <= EPS && (b1 < kies.beste - EPS || (Math.abs(b1 - kies.beste) <= EPS && mid < kies.mid)))) {
        kies = { mid, sid: s1, spijt, beste: b1 };
      }
    }
    if (!kies) break;
    plan.voerUit([[kies.sid, kies.mid]]);
    open.delete(kies.mid);
  }
}

function redenGeenPlek(plan: Plan, mid: string): string {
  const k = plan.kandidaten.get(mid) ?? [];
  if (!k.length) return `niemand met een regelplek binnen ${plan.par.maxReistijd} minuten`;
  if (k.every((sid) => plan.inSlot.has(sid))) return 'alle plekken in de buurt zijn al gevuld';
  return 'geen plek waar het in de tijd past (tijdvak, voorgang, dienst of 24-uursgrens)';
}

/**
 * Verplaatsen, ruilen en herschikken tot niets meer helpt. Herschikken deelt een melding samen met een of twee
 * meldingen in de buurt opnieuw in; dat vindt wat één stap tegelijk niet vindt.
 */
function verbeteren(plan: Plan, maxRondes = 20, focus?: Set<string>, herschikken = true): number {
  let stappen = 0;
  const los = () => [...plan.slotVan.keys()].filter((mid) => !plan.isVast(mid)).sort();
  const telt = (mid: string) => !focus || focus.has(mid);
  for (let ronde = 0; ronde < maxRondes; ronde++) {
    let beter = false;
    for (const mid of los()) {
      if (!telt(mid)) continue;
      const van = plan.slotVan.get(mid)!;
      let beste: { sid: string; d: number } | null = null;
      for (const sid of plan.kandidaten.get(mid) ?? []) {
        if (sid === van || plan.inSlot.has(sid)) continue;
        const d = plan.probeer([[van, null], [sid, mid]]);
        if (d != null && d < -EPS && (!beste || d < beste.d)) beste = { sid, d };
      }
      if (beste) { plan.voerUit([[van, null], [beste.sid, mid]]); beter = true; stappen++; }
    }
    const nu = los();
    for (let i = 0; i < nu.length; i++) {
      for (let j = i + 1; j < nu.length; j++) {
        const a = nu[i], b = nu[j];
        if (!telt(a) && !telt(b)) continue;
        const sa = plan.slotVan.get(a)!, sb = plan.slotVan.get(b)!;
        if (!plan.kandidaten.get(a)!.includes(sb) || !plan.kandidaten.get(b)!.includes(sa)) continue;
        const d = plan.probeer([[sa, b], [sb, a]]);
        if (d != null && d < -EPS) { plan.voerUit([[sa, b], [sb, a]]); beter = true; stappen++; }
      }
    }
    if (beter) continue;
    // pas als één stap tegelijk niets meer oplevert: groepjes samen opnieuw indelen
    if (!herschikken) break;
    for (const mid of los()) {
      if (!telt(mid) || !plan.slotVan.has(mid)) continue;
      for (const groep of groepen(plan, mid)) {
        if (herschik(plan, groep)) { beter = true; stappen++; break; }
      }
    }
    if (!beter) break;
  }
  return stappen;
}

function groepen(plan: Plan, mid: string): string[][] {
  const m = plan.meldingen.get(mid)!;
  const mijn = new Set((plan.kandidaten.get(mid) ?? []).map((s) => plan.slots.get(s)!.persoonId));
  const buren = [...plan.slotVan.entries()]
    .filter(([x, s]) => x !== mid && !plan.isVast(x) && mijn.has(plan.slots.get(s)!.persoonId))
    .map(([x]) => ({ x, d: plan.reistijd(m.plek, plan.meldingen.get(x)!.plek, 12 * 60) }))
    .sort((a, b) => a.d - b.d || a.x.localeCompare(b.x))
    .slice(0, 2)
    .map((b) => b.x);
  const uit: string[][] = buren.map((b) => [mid, b]);
  for (let i = 0; i < buren.length; i++) for (let j = i + 1; j < buren.length; j++) uit.push([mid, buren[i], buren[j]]);
  return uit;
}

function herschik(plan: Plan, groep: string[], perMelding = 3): boolean {
  const huidig = groep.map((mid) => plan.slotVan.get(mid)!);
  const leeg = huidig.map((s) => [s, null] as [string, string | null]);
  if (plan.voerUit(leeg) == null) return false;
  const opties = groep.map((mid) => {
    const vrij = (plan.kandidaten.get(mid) ?? [])
      .filter((sid) => !plan.inSlot.has(sid) && !huidig.includes(sid))
      .map((sid) => ({ sid, d: plan.probeer([[sid, mid]]) }))
      .filter((x): x is { sid: string; d: number } => x.d != null)
      .sort((a, b) => a.d - b.d || a.sid.localeCompare(b.sid))
      .slice(0, perMelding)
      .map((x) => x.sid);
    return [...huidig.filter((s) => plan.kandidaten.get(mid)!.includes(s)), ...vrij];
  });
  const terug = huidig.map((s, i) => [s, groep[i]] as [string, string | null]);
  const nul = plan.probeer(terug);
  let beste: { keuze: [string, string | null][]; d: number } | null = null;
  const kies = (i: number, gebruikt: Set<string>, keuze: [string, string | null][]) => {
    if (i === groep.length) {
      const d = plan.probeer(keuze);
      if (d != null && (!beste || d < beste.d - EPS)) beste = { keuze: [...keuze], d };
      return;
    }
    for (const sid of opties[i]) {
      if (gebruikt.has(sid)) continue;
      gebruikt.add(sid);
      keuze.push([sid, groep[i]]);
      kies(i + 1, gebruikt, keuze);
      keuze.pop();
      gebruikt.delete(sid);
    }
  };
  kies(0, new Set(), []);
  const b = beste as { keuze: [string, string | null][]; d: number } | null;
  if (b && (nul == null || b.d < nul - EPS)) {
    plan.voerUit(b.keuze);
    return true;
  }
  plan.voerUit(terug);
  return false;
}

interface VerdeelOpties {
  /** Standaard de reistijd zelf. */
  schatting?: ReistijdFn;
  /** Om het effect te laten zien. */
  zonderVerbeteren?: boolean;
  /** Standaard 20 + 2 per melding. */
  iteraties?: number;
}

export function verdeel(invoer: Invoer, reistijd: ReistijdFn, opties: VerdeelOpties = {}): { plan: Plan; uitkomst: Uitkomst } {
  const plan = new Plan(invoer, reistijd, opties.schatting);
  const niet: NietIngepland[] = [];
  const open = new Set([...plan.meldingen.keys()].filter((mid) => !plan.slotVan.has(mid)).sort());
  invoegen(plan, open, niet);
  if (opties.zonderVerbeteren) return { plan, uitkomst: uitkomstVan(plan, niet, 0) };
  const verbeterd = afmaken(plan, niet, opties.iteraties ?? 20 + 2 * plan.meldingen.size);
  // ook vanuit 'dichtstbij' verbeteren, en de beste nemen: zo is slim nooit slechter dan dichtstbij
  const d = dichtstbijPlan(invoer, reistijd, opties);
  if (d.plan.doel() < plan.doel() - EPS) {
    const verbeterdD = afmaken(d.plan, d.niet, opties.iteraties ?? 20 + 2 * plan.meldingen.size);
    if (d.plan.doel() < plan.doel() - EPS) return { plan: d.plan, uitkomst: uitkomstVan(d.plan, d.niet, verbeterdD) };
  }
  return { plan, uitkomst: uitkomstVan(plan, niet, verbeterd) };
}

function afmaken(plan: Plan, niet: NietIngepland[], iteraties: number): number {
  let verbeterd = verbeteren(plan);
  verbeterd += verstoren(plan, iteraties);
  if (niet.length) {
    const nog = new Set(niet.map((n) => n.meldingId));
    niet.length = 0;
    invoegen(plan, nog, niet);
    verbeterd += verdringen(plan, niet);
  }
  return verbeterd;
}

/** Haalt meldingen binnen die alleen op een bezette plek passen, bijvoorbeeld door de 24-uursgrens. */
function verdringen(plan: Plan, niet: NietIngepland[]): number {
  let stappen = 0;
  for (const n of [...niet]) {
    const u = n.meldingId;
    let beste: { w: [string, string | null][]; d: number } | null = null;
    for (const s of plan.kandidaten.get(u) ?? []) {
      const m = plan.inSlot.get(s);
      if (!m || plan.isVast(m)) continue;
      for (const s2 of plan.kandidaten.get(m) ?? []) {
        if (s2 === s || plan.inSlot.has(s2)) continue;
        const w: [string, string | null][] = [[s, u], [s2, m]];
        const d = plan.probeer(w);
        if (d != null && d < -EPS && (!beste || d < beste.d - EPS)) beste = { w, d };
      }
    }
    if (beste) {
      plan.voerUit(beste.w);
      niet.splice(niet.indexOf(n), 1);
      stappen++;
    }
  }
  return stappen;
}

/** Iterated local search: een melding met de buren eruit en met ruis opnieuw invoegen; beter dan het beste, dan blijft het. */
function verstoren(plan: Plan, iteraties: number): number {
  const R = rng(20261007);
  const vrij = (mid: string) => !plan.isVast(mid);
  let beste = new Map(plan.slotVan), besteDoel = plan.doel(), stappen = 0;
  const herstel = (naar: Map<string, string>) => {
    const w = new Map<string, string | null>();
    for (const [mid, sid] of plan.slotVan) if (vrij(mid) && naar.get(mid) !== sid) w.set(sid, null);
    for (const [mid, sid] of naar) if (vrij(mid) && plan.slotVan.get(mid) !== sid) w.set(sid, mid);
    if (w.size) plan.voerUit([...w]);
  };
  for (let i = 0; i < iteraties; i++) {
    const ingepland = [...plan.slotVan.keys()].filter(vrij).sort();
    if (ingepland.length < 2) break;
    const kern = plan.meldingen.get(ingepland[Math.floor(R.uniform() * ingepland.length)])!;
    const n = Math.min(ingepland.length, 2 + Math.floor(R.uniform() * 4));
    const weg = ingepland
      .map((mid) => ({ mid, d: plan.reistijd(kern.plek, plan.meldingen.get(mid)!.plek, 12 * 60) }))
      .sort((a, b) => a.d - b.d || a.mid.localeCompare(b.mid))
      .slice(0, n)
      .map((x) => x.mid);
    plan.voerUit(weg.map((mid) => [plan.slotVan.get(mid)!, null]));
    invoegen(plan, new Set(weg), [], () => (R.uniform() - 0.5) * 20);
    verbeteren(plan, 3, new Set(weg), false);
    const d = plan.doel();
    if (d < besteDoel - EPS) { beste = new Map(plan.slotVan); besteDoel = d; stappen++; } else herstel(beste);
  }
  herstel(beste);
  return stappen;
}

/** Ter vergelijking: zoals een planner die op afstand sorteert. */
export function dichtstbij(invoer: Invoer, reistijd: ReistijdFn, opties: VerdeelOpties = {}): { plan: Plan; uitkomst: Uitkomst } {
  const { plan, niet } = dichtstbijPlan(invoer, reistijd, opties);
  return { plan, uitkomst: uitkomstVan(plan, niet, 0) };
}

function dichtstbijPlan(invoer: Invoer, reistijd: ReistijdFn, opties: VerdeelOpties): { plan: Plan; niet: NietIngepland[] } {
  const plan = new Plan(invoer, reistijd, opties.schatting);
  const niet: NietIngepland[] = [];
  const volgorde = [...plan.meldingen.values()].filter((m) => !plan.slotVan.has(m.id)).sort((a, b) => a.ontvangen.localeCompare(b.ontvangen) || a.id.localeCompare(b.id));
  for (const m of volgorde) {
    const opties2 = (plan.kandidaten.get(m.id) ?? [])
      .filter((sid) => !plan.inSlot.has(sid))
      .map((sid) => {
        const s = plan.slots.get(sid)!, p = plan.personen.get(s.persoonId)!;
        return { sid, r: reistijd(p.thuis, m.plek, s.van - 60), van: s.van, soort: s.soort };
      })
      // een 1B alleen als het niet anders kan
      .sort((a, b) => Number(a.soort === '1B') - Number(b.soort === '1B') || a.r - b.r || a.van - b.van || a.sid.localeCompare(b.sid));
    let gezet = false;
    for (const o of opties2) {
      if (plan.voerUit([[o.sid, m.id]]) != null) { gezet = true; break; }
    }
    if (!gezet) niet.push({ meldingId: m.id, reden: redenGeenPlek(plan, m.id) });
  }
  return { plan, niet };
}

function uitkomstVan(plan: Plan, niet: NietIngepland[], verbeterd: number): Uitkomst {
  const toewijzingen: Toewijzing[] = [];
  for (const [mid, sid] of plan.slotVan) {
    const s = plan.slots.get(sid)!, stap = plan.stapVan(sid)!;
    const m = plan.meldingen.get(mid)!;
    toewijzingen.push({
      meldingId: mid, persoonId: s.persoonId, slotId: sid, dagdeel: s.dagdeel, start: stap.start, reistijd: stap.reistijd, vanaf: stap.vanaf,
      kosten: plan.opbouw(mid), vast: plan.isVast(mid) || undefined,
      waarschuwing: stap.waarschuwing,
      herplaatst: (!!m.vast && !plan.isVast(mid)) || undefined,
    });
  }
  for (const n of niet) {
    if (plan.meldingen.get(n.meldingId)!.vast) n.reden = `toegezegde plek vervallen; ${n.reden}`;
  }
  toewijzingen.sort((a, b) => a.meldingId.localeCompare(b.meldingId));
  const clusters: ClusterStand[] = [...new Set([...plan.personen.values()].map((p) => p.cluster))].sort().map((c) => {
    const v = plan.vrijIn(c), t = plan.tekortIn(c)!;
    return { cluster: c, vrijOchtend: v.o, vrijMiddag: v.m, vrij1B: v.b, verwachtOchtend: t.vraag.ochtend, verwachtMiddag: t.vraag.middag, verwachtTekort: t.verwacht(v.o, v.m) };
  });
  return { toewijzingen, nietIngepland: niet, clusters, doel: plan.doel(), verbeterd };
}

/** Recente dossiers per fte na vandaag. */
export const HOGE_WERKDRUK = 4;

export interface Kengetallen {
  ingepland: number;
  nietIngepland: number;
  gemReistijd: number;
  maxReistijd: number;
  totaalReis: number;
  inzet1B: number;
  buitenRegio: number;
  buitenCluster: number;
  middag: number;
  /** (recente dossiers + vandaag) per fte, van wie een gesprek krijgt. */
  gemWerkdruk: number;
  maxWerkdruk: number;
  hogeWerkdruk: number;
  /** Opgeteld over de clusters. */
  verwachtTekort: number;
  doel: number;
}

export function kengetallen(plan: Plan, u: Uitkomst): Kengetallen {
  const t = u.toewijzingen;
  const reis = t.map((x) => x.reistijd);
  const perPersoon = new Map<string, number>();
  for (const x of t) perPersoon.set(x.persoonId, (perPersoon.get(x.persoonId) ?? 0) + 1);
  const werkdruk = [...perPersoon].map(([pid, k]) => {
    const p = plan.personen.get(pid)!;
    return (p.belasting + k) / Math.max(0.3, p.contract / 36);
  });
  return {
    ingepland: t.length,
    nietIngepland: u.nietIngepland.length,
    gemReistijd: reis.length ? reis.reduce((a, b) => a + b, 0) / reis.length : 0,
    maxReistijd: reis.length ? Math.max(...reis) : 0,
    totaalReis: reis.reduce((a, b) => a + b, 0),
    inzet1B: t.filter((x) => plan.slots.get(x.slotId)!.soort === '1B').length,
    buitenRegio: t.filter((x) => plan.meldingen.get(x.meldingId)!.regio !== plan.personen.get(x.persoonId)!.regio).length,
    buitenCluster: t.filter((x) => plan.meldingen.get(x.meldingId)!.cluster !== plan.personen.get(x.persoonId)!.cluster).length,
    middag: t.filter((x) => x.dagdeel === 'middag').length,
    gemWerkdruk: werkdruk.length ? werkdruk.reduce((a, b) => a + b, 0) / werkdruk.length : 0,
    maxWerkdruk: werkdruk.length ? Math.max(...werkdruk) : 0,
    hogeWerkdruk: werkdruk.filter((w) => w > HOGE_WERKDRUK).length,
    verwachtTekort: u.clusters.reduce((a, c) => a + c.verwachtTekort, 0),
    doel: u.doel,
  };
}

/** Voor de uitleg. */
export function alternatief(plan: Plan, mid: string): { sid: string; reistijd: number; delta: number; opbouw: Kostenopbouw } | null {
  const van = plan.slotVan.get(mid);
  if (!van) return null;
  if (plan.isVast(mid)) return null;
  const m = plan.meldingen.get(mid)!;
  const vrij = (plan.kandidaten.get(mid) ?? [])
    .filter((sid) => sid !== van && !plan.inSlot.has(sid))
    .map((sid) => ({ sid, r: plan.reistijd(plan.personen.get(plan.slots.get(sid)!.persoonId)!.thuis, m.plek, plan.slots.get(sid)!.van - 60) }))
    .sort((a, b) => a.r - b.r || a.sid.localeCompare(b.sid));
  for (const { sid } of vrij) {
    const delta = plan.probeer([[van, null], [sid, mid]]);
    if (delta == null) continue;
    plan.voerUit([[van, null], [sid, mid]]);
    const opbouw = plan.opbouw(mid);
    const stap = plan.stapVan(sid)!;
    plan.voerUit([[sid, null], [van, mid]]);
    return { sid, reistijd: stap.reistijd, delta, opbouw };
  }
  return null;
}

