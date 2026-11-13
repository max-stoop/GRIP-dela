/** Eén bron ophalen bij de externe aanbieder. Voor de server: de route /api/bronnen en de dagelijkse taak. */
import type { BronNaam, BronResultaat } from './common';
import { weersverwachting, weerArchief, luchtVerwachting, luchtArchief, klimaatNormalen, seizoensverwachting } from './openmeteo';
import { rioolwater } from './rivm';
import { sterftePerWeek } from './cbs';

export async function haalBron(bron: BronNaam, o: { van?: string; tot?: string } = {}): Promise<BronResultaat> {
  switch (bron) {
    case 'weer': return weersverwachting();
    case 'lucht': return luchtVerwachting();
    case 'seizoen': return seizoensverwachting();
    case 'riool': return rioolwater();
    case 'cbs': return sterftePerWeek();
    case 'normalen': return klimaatNormalen();
    case 'weer_archief': return weerArchief(o.van!, o.tot!);
    case 'lucht_archief': return luchtArchief(o.van!, o.tot!);
  }
}

export { DAGELIJKSE_BRONNEN } from './actualiteit';
