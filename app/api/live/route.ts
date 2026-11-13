import { NextResponse } from 'next/server';
import { bepaalSessie } from '@/lib/sessie';
import { platform } from '@/lib/platform';
import { luister } from '@/lib/server/live';

export const dynamic = 'force-dynamic';

/** Server-sent events: per wijziging de naam van de tabel. Wat het tabblad daarna leest, bepaalt de RLS. */
export async function GET(req: Request) {
  if (platform() !== 'azure') return NextResponse.json({ fout: 'Niet beschikbaar' }, { status: 404 });
  // alleen wie in GRIP staat: een werkaccount van de organisatie zonder profiel hoort niet te zien wat er verandert
  const u = await bepaalSessie();
  if (u.soort === 'niet_ingelogd') return NextResponse.json({ fout: 'Niet ingelogd' }, { status: 401 });
  if (u.soort !== 'ok') return NextResponse.json({ fout: 'Dit account heeft geen toegang tot GRIP' }, { status: 403 });
  const enc = new TextEncoder();
  let opruimen = () => {};
  const stroom = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let dicht = false;
      const sluit = () => { if (dicht) return; dicht = true; opruimen(); try { ctrl.close(); } catch { /* al dicht */ } };
      const stuur = (s: string) => { if (!dicht) try { ctrl.enqueue(enc.encode(s)); } catch { sluit(); } };
      // Azure sluit een stille verbinding na vier minuten
      const hartslag = setInterval(() => stuur(': \n\n'), 25_000);
      const stop = await luister({ wijziging: (t) => stuur(`data: ${t}\n\n`), weg: sluit }).catch(() => null);
      opruimen = () => { clearInterval(hartslag); stop?.(); };
      if (!stop) return sluit();
      stuur('retry: 5000\n\n');
      req.signal.addEventListener('abort', sluit);
    },
    cancel() { opruimen(); },
  });
  return new Response(stroom, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}
