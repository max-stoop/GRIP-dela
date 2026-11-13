/**
 * De dagelijkse taak zonder Logic App: de app kijkt zelf elke tien minuten of het na 06:00 (Nederlandse tijd) is en de
 * taak van vandaag nog moet. Aan met GRIP_DAGTAAK=intern. Draaien er meer servers, dan legt de database vast wie de taak
 * doet (rp_dagtaak_claim); de anderen slaan hem over.
 */
export const ELKE = 10 * 60_000;
export const VANAF_UUR = 6;

/** Het uur in Nederland. */
export function uurInNederland(nu = new Date()): number {
  return Number(new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' }).format(nu));
}

export function startPlanner(voer: () => Promise<unknown>, o: { elke?: number; nu?: () => Date } = {}): () => void {
  let bezig = false;
  const kijk = async () => {
    if (bezig || uurInNederland(o.nu?.()) < VANAF_UUR) return;
    bezig = true;
    try {
      await voer();
    } catch (e) {
      console.error('Dagelijkse taak', e);
    } finally {
      bezig = false;
    }
  };
  // even na het starten, zodat de server eerst klaar is
  const eerst = setTimeout(kijk, 60_000);
  const t = setInterval(kijk, o.elke ?? ELKE);
  t.unref?.();
  eerst.unref?.();
  return () => { clearTimeout(eerst); clearInterval(t); };
}
