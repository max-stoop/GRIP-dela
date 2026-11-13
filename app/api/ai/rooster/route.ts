import { NextResponse } from 'next/server';
import { limiet, toegang } from '@/lib/api/toegang';
import { heeftIdentiteit, tokenVoor } from '@/lib/server/identiteit';
import { ADVIES_SCHEMA, gebruikersBericht, isAdviesAntwoord, systeemPrompt, type AdviesVraag } from '@/lib/ai/advies';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * De AI-dienst in Azure (Azure OpenAI): het adres van de resource en de naam van de modeldeployment. Inloggen met een
 * sleutel (AI_SLEUTEL) of, zonder sleutel, met de managed identity van de App Service. Zonder adres en model toont de app
 * alleen de eigen controle.
 */
const URL_AI = process.env.AI_URL;
const SLEUTEL = process.env.AI_SLEUTEL;
const MODEL = process.env.AI_MODEL;

function ingesteld(): boolean {
  return !!(URL_AI && MODEL && (SLEUTEL || heeftIdentiteit()));
}

/** Of de AI-assistent beschikbaar is (zonder sleutel toont de app alleen de eigen controle). */
export async function GET(req: Request) {
  const t = await toegang(req);
  if (!t.ok) return NextResponse.json({ fout: t.fout }, { status: t.status });
  return NextResponse.json({ beschikbaar: ingesteld() });
}

/** De AI kost geld: hoogstens 20 adviezen per uur per gebruiker en 200 in totaal. */
const PER_GEBRUIKER = 20, TOTAAL = 200, UUR = 3_600_000;

export async function POST(req: Request) {
  const t = await toegang(req);
  if (!t.ok) return NextResponse.json({ fout: t.fout }, { status: t.status });
  // eerst controleren wat niets kost, dan pas meetellen voor de limiet
  if (!ingesteld()) {
    return NextResponse.json({ fout: 'De AI-assistent is niet ingesteld.' }, { status: 503 });
  }
  const tekst = await req.text();
  if (tekst.length > 400_000) return NextResponse.json({ fout: 'Te veel gegevens; kies een kortere periode.' }, { status: 413 });
  const wacht = limiet(t.sleutel, PER_GEBRUIKER, UUR) || limiet('ai:totaal', TOTAAL, UUR);
  if (wacht) return NextResponse.json({ fout: `Je hebt de AI-assistent het afgelopen uur vaak gebruikt. Probeer het over ${Math.ceil(wacht / 60)} minuten opnieuw.` }, { status: 429, headers: { 'Retry-After': String(wacht) } });
  let vraag: AdviesVraag;
  try {
    vraag = JSON.parse(tekst);
  } catch {
    return NextResponse.json({ fout: 'Ongeldige aanvraag' }, { status: 400 });
  }
  if (!vraag?.dagen?.length || !vraag.rooster) return NextResponse.json({ fout: 'Geen rooster meegestuurd' }, { status: 400 });

  return metAdem(advies(vraag));
}

/** Spaties tot het antwoord er is, zodat de verbinding open blijft; Azure breekt een stil verzoek na 230 seconden af. */
function metAdem(werk: Promise<object>): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    async start(c) {
      const adem = setInterval(() => c.enqueue(enc.encode(' ')), 15_000);
      try {
        c.enqueue(enc.encode(JSON.stringify(await werk)));
      } finally {
        clearInterval(adem);
        c.close();
      }
    },
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** Een antwoord van de AI-dienst in Azure (Azure OpenAI, chat completions). */
type Antwoord = {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

async function advies(vraag: AdviesVraag): Promise<object> {
  try {
    const inloggen: Record<string, string> = SLEUTEL ? { 'api-key': SLEUTEL } : { authorization: `Bearer ${await tokenVoor('https://cognitiveservices.azure.com')}` };
    const res = await fetch(`${URL_AI!.replace(/\/+$/, '')}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...inloggen },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: 16000,
        response_format: { type: 'json_schema', json_schema: { name: 'roosteradvies', strict: true, schema: ADVIES_SCHEMA } },
        messages: [
          { role: 'system', content: systeemPrompt() },
          { role: 'user', content: gebruikersBericht(vraag) },
        ],
      }),
      signal: AbortSignal.timeout(280_000),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      console.error('AI-assistent', res.status, await res.text().catch(() => ''));
      return { fout: 'De AI-assistent is nu niet beschikbaar.' };
    }
    if (res.status === 429) return { fout: 'De AI is even druk. Probeer het over een minuut opnieuw.' };
    if (!res.ok) {
      const tekst = await res.text().catch(() => '');
      // het inhoudsfilter van Azure houdt een vraag tegen
      if (res.status === 400 && tekst.includes('content_filter')) return { fout: 'De AI kon dit verzoek niet behandelen. Gebruik de eigen controle hieronder.' };
      console.error('AI-assistent', res.status, tekst);
      return { fout: 'De AI-assistent gaf een fout. Probeer het later opnieuw.' };
    }
    const js = (await res.json()) as Antwoord;
    const keuze = js.choices?.[0];
    if (keuze?.message?.refusal || keuze?.finish_reason === 'content_filter') return { fout: 'De AI kon dit verzoek niet behandelen. Gebruik de eigen controle hieronder.' };
    if (keuze?.finish_reason === 'length') return { fout: 'Het advies werd te lang; kies een kortere periode.' };
    let antwoord: unknown = null;
    try {
      antwoord = keuze?.message?.content ? JSON.parse(keuze.message.content) : null;
    } catch {
      antwoord = null;
    }
    if (!isAdviesAntwoord(antwoord)) return { fout: 'De AI-assistent gaf een onbruikbaar antwoord. Probeer het opnieuw.' };
    return { antwoord, gebruik: { invoer: js.usage?.prompt_tokens ?? 0, uitvoer: js.usage?.completion_tokens ?? 0 } };
  } catch (e) {
    console.error('AI-assistent', e);
    return { fout: 'De AI-assistent gaf een fout. Probeer het later opnieuw.' };
  }
}
