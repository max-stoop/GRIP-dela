/** Met GRIP_DAGTAAK=intern plant de app zelf de dagelijkse taak (zie planner.ts). Geladen vanuit instrumentation.ts. */
import { startPlanner } from './planner';
import { dagtaakOpServer } from './server';

if (process.env.GRIP_DAGTAAK === 'intern') {
  startPlanner(async () => {
    const uitkomst = await dagtaakOpServer();
    if (uitkomst && !uitkomst.overgeslagen) console.log('Dagelijkse taak', uitkomst.status, uitkomst.melding ?? '');
  });
}
