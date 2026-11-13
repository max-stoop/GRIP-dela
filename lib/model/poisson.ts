
function logFactorial(k: number): number {
  let s = 0;
  for (let i = 2; i <= k; i++) s += Math.log(i);
  return s;
}

/** Stabiel ook voor grote lam. */
export function poissonCdf(k: number, lam: number): number {
  if (k < 0) return 0;
  if (lam <= 0) return 1;
  if (lam < 600) {
    let p = Math.exp(-lam), s = p;
    for (let n = 1; n <= k; n++) {
      p *= lam / n;
      s += p;
    }
    return Math.min(1, s);
  }
  // grote λ: tel in log-ruimte vanaf de modus naar beneden
  let s = 0;
  const top = Math.floor(k);
  for (let n = top; n >= 0; n--) {
    const lp = -lam + n * Math.log(lam) - logFactorial(n);
    const p = Math.exp(lp);
    s += p;
    if (n < lam && p < 1e-16 * s) break;
  }
  return Math.min(1, s);
}

const Z: Record<string, number> = { '0.1': -1.2815515655446004, '0.5': 0, '0.8': 0.8416212335729143, '0.9': 1.2815515655446004, '0.95': 1.6448536269514722 };

/** Kleinste k met P(X <= k) >= alpha. */
export function poissonQuantile(alpha: number, lam: number): number {
  if (lam <= 0) return 0;
  if (lam > 700) {
    const z = Z[String(alpha)] ?? normInv(alpha);
    return Math.max(0, Math.ceil(lam + z * Math.sqrt(lam) - 0.5));
  }
  let p = Math.exp(-lam), s = p, k = 0;
  while (s < alpha && k < 5000) {
    k++;
    p *= lam / k;
    s += p;
  }
  return k;
}

/** Benadering van de inverse standaardnormale verdeling (Acklam). */
function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Voor grote λ de normale benadering, zoals het prototype. */
export function poissonBand(alpha: number, lam: number): number {
  if (lam < 300) return poissonQuantile(alpha, lam);
  return Math.round(lam + normInv(alpha) * Math.sqrt(lam));
}

/** Door hele aantallen minstens 80%, bij weinig meldingen meer (bij 3,9 verwacht: 2 tot 7, op 86% van de dagen). */
export function bandDekking(lam: number): number {
  return poissonCdf(poissonBand(0.9, lam), lam) - poissonCdf(poissonBand(0.1, lam) - 1, lam);
}

/** Negatief binomiaal met gemiddelde λ en variantie φ·λ; bij φ <= 1 gewoon Poisson. */
export function kwantielMetSchommeling(alpha: number, lam: number, phi: number): number {
  if (phi <= 1.0001 || lam <= 0) return poissonBand(alpha, lam);
  const r = lam / (phi - 1), q = 1 - 1 / phi; // q: kans op 'nog een' per stap
  let p = Math.exp(r * Math.log(1 / phi)), s = p, k = 0;
  while (s < alpha && k < 100_000) {
    p *= ((k + r) / (k + 1)) * q;
    k++;
    s += p;
  }
  return k;
}
