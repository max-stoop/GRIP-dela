import { solve, inverse, type Mat } from './linalg';

/** Gewogen Poisson-regressie met log-link via IRLS, zoals statsmodels GLM met var_weights. X is rij voor rij: n × p. */
export function fitPoisson(X: Float64Array, n: number, p: number, y: Float64Array, w: Float64Array) {
  let ybar = 0;
  for (let i = 0; i < n; i++) ybar += y[i];
  ybar /= n;
  const mu = new Float64Array(n), eta = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    mu[i] = (y[i] + ybar) / 2;
    eta[i] = Math.log(mu[i]);
  }
  let beta = new Array<number>(p).fill(0);
  let devPrev = Infinity;
  for (let it = 0; it < 100; it++) {
    const A: Mat = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const b = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i++) {
      const wi = w[i] * mu[i], zi = eta[i] + (y[i] - mu[i]) / mu[i], o = i * p;
      for (let j = 0; j < p; j++) {
        const xj = X[o + j];
        if (xj === 0) continue;
        const wx = wi * xj;
        b[j] += wx * zi;
        for (let k = j; k < p; k++) A[j][k] += wx * X[o + k];
      }
    }
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) A[j][k] = A[k][j];
    beta = solve(A, b);
    let dev = 0;
    for (let i = 0; i < n; i++) {
      let e = 0;
      const o = i * p;
      for (let j = 0; j < p; j++) e += X[o + j] * beta[j];
      eta[i] = e;
      mu[i] = Math.exp(e);
      dev += 2 * w[i] * (y[i] > 0 ? y[i] * Math.log(y[i] / mu[i]) - (y[i] - mu[i]) : mu[i]);
    }
    if (Math.abs(dev - devPrev) <= 1e-11 * (Math.abs(dev) + 1)) break;
    devPrev = dev;
  }
  let num = 0, wsum = 0;
  for (let i = 0; i < n; i++) {
    num += (w[i] * (y[i] - mu[i]) ** 2) / mu[i];
    wsum += w[i];
  }
  return { beta, mu, phi: num / Math.max(1, wsum - p) };
}

/** MAP met normale prior (Newton-Raphson), zoals _map_poisson in het prototype: weinig signaal blijft dicht bij de startwaarde. */
export function mapPoisson(y: number[], off: number[], X: number[][], m: number[], s: number[], iters = 50) {
  const n = y.length, q = m.length;
  let b = [...m];
  let H: Mat = [];
  for (let it = 0; it < iters; it++) {
    const mu = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let e = off[i];
      for (let j = 0; j < q; j++) e += X[i][j] * b[j];
      mu[i] = Math.exp(e);
    }
    const g = new Array<number>(q).fill(0);
    H = Array.from({ length: q }, () => new Array<number>(q).fill(0));
    for (let i = 0; i < n; i++) {
      const r = y[i] - mu[i];
      for (let j = 0; j < q; j++) {
        const xj = X[i][j];
        if (xj === 0) continue;
        g[j] += xj * r;
        for (let k = 0; k < q; k++) H[j][k] -= xj * mu[i] * X[i][k];
      }
    }
    for (let j = 0; j < q; j++) {
      g[j] -= (b[j] - m[j]) / (s[j] * s[j]);
      H[j][j] -= 1 / (s[j] * s[j]);
    }
    const step = solve(H, g);
    b = b.map((v, j) => v - step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  const mu = y.map((_, i) => {
    let e = off[i];
    for (let j = 0; j < q; j++) e += X[i][j] * b[j];
    return Math.exp(e);
  });
  let chi = 0;
  for (let i = 0; i < n; i++) chi += (y[i] - mu[i]) ** 2 / mu[i];
  const phi = Math.max(1, chi / Math.max(1, n - q));
  const negInv = inverse(H.map((row) => row.map((v) => -v)));
  const se = negInv.map((row, j) => Math.sqrt(row[j] * phi));
  return { b, se, mu };
}
