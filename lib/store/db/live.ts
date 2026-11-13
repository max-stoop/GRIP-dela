/** Wijzigingen van collega's via /api/live (Azure). Na een onderbreking zijn er seintjes gemist: dan alles bijlezen. */
export function luisterLive(opWijziging: (tabel: string) => void, opHerstel: () => void): () => void {
  const bron = new EventSource('/api/live');
  let weg = false;
  bron.onmessage = (e) => opWijziging(String(e.data));
  bron.onerror = () => { weg = true; };
  bron.onopen = () => { if (weg) opHerstel(); weg = false; };
  return () => bron.close();
}
