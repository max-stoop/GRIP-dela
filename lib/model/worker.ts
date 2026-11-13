/// <reference lib="webworker" />
import { voerUit, type Opdracht } from './werk';

self.onmessage = (e: MessageEvent<{ id: number; opdracht: Opdracht }>) => {
  const { id, opdracht } = e.data;
  try {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, antwoord: voerUit(opdracht) });
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, fout: err instanceof Error ? err.message : String(err) });
  }
};
