/// <reference lib="webworker" />
import { rekenDag, rekenVerdeling, type DagOpdracht, type Opdracht } from './werk';

self.onmessage = async (e: MessageEvent<{ id: number; opdracht: Opdracht | DagOpdracht }>) => {
  const { id, opdracht } = e.data;
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  try {
    const resultaat = 'soort' in opdracht && opdracht.soort === 'dag' ? await rekenDag(opdracht) : await rekenVerdeling(opdracht as Opdracht);
    scope.postMessage({ id, ok: true, resultaat });
  } catch (err) {
    scope.postMessage({ id, ok: false, fout: err instanceof Error ? err.message : String(err) });
  }
};
