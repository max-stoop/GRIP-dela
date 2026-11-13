/** Stuurt modelberekeningen naar een web worker, zodat de pagina blijft reageren. */
import type { Antwoord, Opdracht } from './werk';

let worker: Worker | null = null;
let volgnr = 0;
const wachtend = new Map<number, { resolve: (a: Antwoord) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; antwoord?: Antwoord; fout?: string }>) => {
      const w = wachtend.get(e.data.id);
      if (!w) return;
      wachtend.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.antwoord!);
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

export async function reken(opdracht: Opdracht): Promise<Antwoord> {
  const w = getWorker();
  if (!w) {
    const { voerUit } = await import('./werk');
    return voerUit(opdracht);
  }
  const id = ++volgnr;
  return new Promise<Antwoord>((resolve, reject) => {
    wachtend.set(id, { resolve, reject });
    w.postMessage({ id, opdracht });
  });
}
