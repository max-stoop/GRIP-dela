/** Stuurt een verdeling naar een web worker, zodat de pagina blijft reageren. Zonder workers: in de pagina zelf. */
import type { DagOpdracht, DagResultaat, Opdracht, Resultaat } from './werk';

let worker: Worker | null = null;
let volgnr = 0;
const wachtend = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; resultaat?: unknown; fout?: string }>) => {
      const w = wachtend.get(e.data.id);
      if (!w) return;
      wachtend.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.resultaat);
      else w.reject(new Error(e.data.fout));
    };
    worker.onerror = (e) => {
      for (const w of wachtend.values()) w.reject(new Error(e.message || 'Rekenfout in de achtergrond'));
      wachtend.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

function inAchtergrond<T>(opdracht: Opdracht | DagOpdracht): Promise<T> {
  const w = getWorker()!;
  const id = ++volgnr;
  return new Promise<T>((resolve, reject) => {
    wachtend.set(id, { resolve: (r) => resolve(r as T), reject });
    w.postMessage({ id, opdracht });
  });
}

export async function verdeelInAchtergrond(opdracht: Opdracht): Promise<Resultaat> {
  if (!getWorker()) {
    const { rekenVerdeling } = await import('./werk');
    return rekenVerdeling(opdracht);
  }
  return inAchtergrond<Resultaat>(opdracht);
}

export async function verdeelDagInAchtergrond(opdracht: DagOpdracht): Promise<DagResultaat> {
  if (!getWorker()) {
    const { rekenDag } = await import('./werk');
    return rekenDag(opdracht);
  }
  return inAchtergrond<DagResultaat>(opdracht);
}
