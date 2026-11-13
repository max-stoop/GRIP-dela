/**
 * De TypeScript-port tegen het Python-prototype op dezelfde invoer (fixture gemaakt met het prototype). Het eigen niveau
 * per regio staat uit.
 *
 * Bewust anders dan het prototype: de kalibratie en de terugtest kijken niet vooruit. Het prototype gebruikte daar
 * gemeten weer van de doeldag als "verwachting" en rioolwater zonder publicatievertraging; GRIP rekent alleen met wat op
 * de uitgiftedatum bekend was (Features met terugblik). Die delen staan daarom niet in de vergelijking, maar in
 * 'zonder vooruitkijken' hieronder.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { History, BaseModel, Ext, Features, runForecast, calibrate, RIOOL_VERTRAGING } from '@/lib/model/forecast';
import { PRIORS, type FactorKey } from '@/lib/model/config';
import { toDay, fromDay } from '@/lib/dates';
import type { ExternData, ModelInput } from '@/lib/model/types';

interface Case {
  issue: string;
  input: ModelInput;
  expected: {
    base_params: Record<string, number[]>;
    run_rows: { datum: string; regio: string; lam: number; lam_basis: number; factoren: Record<string, number> }[];
    run_info: { mom7: number; level28: number };
    features: { t: string; d: string; mom7: number; level28: number; cbs: number; covid: number; flu: number; x: Record<string, Record<string, number>> }[];
    calibrate?: { coef: Record<string, [number, number, number]>; backtest: Record<'h4' | 'h45', { dagen: number; mae_basis: number; mae_bijgestuurd: number }> };
  };
}

type Compact = Record<string, { start: string; v: (number | null)[] }>;

/** De vergelijkingsdata van het Python-prototype. */
interface Fixture { issue: string; meldingen: Compact; extern: Compact; handmatig: ModelInput['handmatig']; normaal: ModelInput['normaal']; expected: Case['expected'] }

function fromFixture(fx: Fixture): Case {
  const m = fx.meldingen as Compact;
  const start = Object.values(m).reduce((a, s) => (s.start < a ? s.start : a), '9999-12-31');
  const n = Math.max(...Object.values(m).map((s) => toDay(s.start) - toDay(start) + s.v.length));
  const regios: Record<string, (number | null)[]> = {};
  for (const [r, s] of Object.entries(m)) {
    const off = toDay(s.start) - toDay(start);
    regios[r] = Array.from({ length: n }, (_, i) => s.v[i - off] ?? null);
  }
  const extern: ExternData = {};
  for (const [k, s] of Object.entries(fx.extern as Compact)) {
    const [bron, variabele, sleutel] = k.split('|');
    const obj: Record<string, number> = {};
    s.v.forEach((v, i) => { if (v != null) obj[fromDay(toDay(s.start) + i)] = v; });
    ((extern[bron] ??= {})[variabele] ??= {})[sleutel] = obj;
  }
  return {
    issue: fx.issue,
    input: { meldingen: { start, n, regios }, extern, handmatig: fx.handmatig, coef: { niveau_regio: 0 }, normaal: fx.normaal },
    expected: fx.expected,
  };
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-9, Math.abs(b));

const cases: [string, () => Case][] = [
  ['fixture', () => fromFixture(JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/python-parity.json'), 'utf8')))],
];

for (const [name, load] of cases) {
  describe(`pariteit met het Python-prototype (${name})`, () => {
    const c = load();
    const hist = new History(c.input.meldingen);
    const issue = toDay(c.issue);

    it('basismodel: parameters', () => {
      const base = new BaseModel(hist, issue);
      for (const [r, p] of Object.entries(c.expected.base_params)) p.forEach((v, j) => expect(Math.abs(base.params[r][j] - v)).toBeLessThan(1e-5));
    });

    it('features op vaste momenten (zoals de dagelijkse run)', () => {
      const base = new BaseModel(hist, issue);
      const ext = new Ext(c.input.extern, c.input.handmatig);
      for (const f of c.expected.features) {
        const F = new Features(ext, base, hist, toDay(f.t), c.input.normaal);
        for (const k of ['mom7', 'level28', 'cbs', 'covid', 'flu'] as const) expect(F[k]).toBeCloseTo(f[k], 8);
        for (const [r, x] of Object.entries(f.x)) {
          const mine = F.x(r, toDay(f.d)) as Record<string, number>;
          // de seizoensfactoren rekende het prototype hier met gemeten weer; de run gebruikt de seizoensverwachting
          for (const [k, v] of Object.entries(x)) if (k !== 'seas_tw' && k !== 'seas_ts') expect(mine[k]).toBeCloseTo(v, 8);
        }
      }
    });

    it('run: λ, basis en factoren per regio en dag', () => {
      const run = runForecast(c.input, { issue: c.issue, soort: 'test', hist });
      for (const row of c.expected.run_rows) {
        const ri = run.data.regios.indexOf(row.regio), di = run.data.dates.indexOf(row.datum);
        expect(rel(run.data.lam[ri][di], row.lam)).toBeLessThan(2e-4);
        expect(rel(run.data.base[ri][di], row.lam_basis)).toBeLessThan(2e-4);
        const fac = run.data.fac[row.regio] as Record<string, number[]>;
        for (const [k, v] of Object.entries(row.factoren)) expect(fac[k]?.[di] ?? 0).toBeCloseTo(v, 4);
      }
      expect(run.meta.info.mom7).toBeCloseTo(c.expected.run_info.mom7, 8);
      expect(run.meta.info.level28).toBeCloseTo(c.expected.run_info.level28, 8);
    });

    describe('zonder vooruitkijken (kalibratie en terugtest)', () => {
      /** Externe waarden vanaf een dag (per bron) vervangen door onzin: wat op t bekend was, mag daar niet van afhangen. */
      const verstoord = (vanaf: (bron: string) => number): ExternData => {
        const uit: ExternData = {};
        for (const [bron, vars] of Object.entries(c.input.extern)) for (const [v, sl] of Object.entries(vars)) for (const [k, reeks] of Object.entries(sl)) {
          ((uit[bron] ??= {})[v] ??= {})[k] = Object.fromEntries(Object.entries(reeks).map(([d, w]) => [d, toDay(d) >= vanaf(bron) ? w * 3 + 40 : w]));
        }
        return uit;
      };

      it('een terugblik op dag t hangt niet af van weer, lucht of rioolwater dat op t nog niet bekend was', () => {
        const base = new BaseModel(hist, issue);
        for (const f of c.expected.features) {
          const t = toDay(f.t), d = toDay(f.d);
          const echt = new Features(new Ext(c.input.extern, c.input.handmatig), base, hist, t, c.input.normaal, true);
          // weer, lucht en seizoen vanaf vandaag; rioolwater vanaf de publicatiegrens (CBS kent al een eigen vertraging)
          const grens = (bron: string) => (bron === 'riool' ? t - RIOOL_VERTRAGING + 1 : bron === 'cbs' ? Infinity : t);
          const nep = new Features(new Ext(verstoord(grens), c.input.handmatig), base, hist, t, c.input.normaal, true);
          expect(nep.covid).toBe(echt.covid);
          for (const r of Object.keys(f.x)) expect(nep.x(r, d)).toEqual(echt.x(r, d));
          // en zonder terugblik (de dagelijkse run) telt de verwachting voor de doeldag wel
          const run = new Features(new Ext(verstoord(grens), c.input.handmatig), base, hist, t, c.input.normaal);
          const runEcht = new Features(new Ext(c.input.extern, c.input.handmatig), base, hist, t, c.input.normaal);
          if (d - t <= 16) expect(Object.keys(f.x).some((r) => run.x(r, d).pm25 !== runEcht.x(r, d).pm25)).toBe(true);
        }
      });

      it('zonder verwachtingen van toen: hitte, fijnstof, ozon en de seizoensverwachting houden hun startwaarde', () => {
        const res = calibrate(c.input);
        for (const k of ['heat', 'pm25', 'ozone', 'seas_tw', 'seas_ts'] as FactorKey[]) expect(res.coef[k]).toBeUndefined();
        // wat wel bekend was, wordt geschat: het recente niveau, kou (gemeten tot gisteren), rioolwater en CBS
        for (const k of ['mom7', 'level28', 'cold', 'covid_ww', 'cbs_exc'] as FactorKey[]) {
          expect(res.coef[k]?.dagen).toBeGreaterThan(0);
          expect(Number.isFinite(res.coef[k]!.waarde)).toBe(true);
        }
        expect(PRIORS.heat.prior).toBeGreaterThan(0);
        for (const h of ['h4', 'h45'] as const) expect(res.backtest.resultaat[h].dagen).toBeGreaterThan(300);
      }, 120_000);
    });
  });
}
