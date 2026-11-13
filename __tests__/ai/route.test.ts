// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import { wisLimieten } from '@/lib/api/toegang';

const vraag = { regio: 'AMS', vandaag: '2026-11-07', dagen: [{ datum: '2026-12-01' }], rooster: {} };
const post = () => new Request('http://localhost/api/ai/rooster', {
  method: 'POST', headers: { 'x-forwarded-for': '10.0.0.9' }, body: JSON.stringify(vraag),
});

async function route(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('@/app/api/ai/rooster/route');
}

describe('AI-roosterassistent via Azure OpenAI', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); wisLimieten(); });

  it('niet beschikbaar zonder adres, sleutel en deployment', async () => {
    const { GET, POST } = await route({ AI_URL: '', AI_SLEUTEL: 'geheim', AI_MODEL: 'gpt' });
    expect(await (await GET(post())).json()).toEqual({ beschikbaar: false });
    expect((await POST(post())).status).toBe(503);
  });

  it('vraagt Azure OpenAI om een antwoord volgens het schema en geeft dat door', async () => {
    const antwoord = { samenvatting: 'Goed rooster.', sterk: [], risicos: [], voorstellen: [] };
    const fetchNep = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(antwoord) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })));
    vi.stubGlobal('fetch', fetchNep);
    const { POST } = await route({ AI_URL: 'https://grip.openai.azure.com/', AI_SLEUTEL: 'geheim', AI_MODEL: 'roosteradvies' });
    const res = await POST(post());
    expect(JSON.parse((await res.text()).trim())).toEqual({ antwoord, gebruik: { invoer: 10, uitvoer: 5 } });
    const [url, init] = fetchNep.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://grip.openai.azure.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>)['api-key']).toBe('geheim');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('roosteradvies');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });

  it('een fout of filter van Azure wordt een nette melding', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"content_filter"}}', { status: 400 })));
    const { POST } = await route({ AI_URL: 'https://grip.openai.azure.com', AI_SLEUTEL: 'geheim', AI_MODEL: 'm' });
    expect(JSON.parse((await (await POST(post())).text()).trim()).fout).toMatch(/kon dit verzoek niet behandelen/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    expect(JSON.parse((await (await POST(post())).text()).trim()).fout).toMatch(/even druk/);
  });
});

describe('AI via de managed identity van de App Service', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); wisLimieten(); });

  it('zonder sleutel een token van de identiteit, en dat token hergebruiken', async () => {
    const antwoord = { samenvatting: 'Goed.', sterk: [], risicos: [], voorstellen: [] };
    const fetchNep = vi.fn(async (url: string | URL, _init?: RequestInit) => String(url).startsWith('http://identiteit')
      ? new Response(JSON.stringify({ access_token: 'tok', expires_on: String(Math.floor(Date.now() / 1000) + 3600) }))
      : new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(antwoord) } }] })));
    vi.stubGlobal('fetch', fetchNep);
    const { GET, POST } = await route({ AI_URL: 'https://grip.openai.azure.com', AI_SLEUTEL: '', AI_MODEL: 'm', IDENTITY_ENDPOINT: 'http://identiteit/msi/token', IDENTITY_HEADER: 'h' });
    expect(await (await GET(post())).json()).toEqual({ beschikbaar: true });
    await (await POST(post())).text();
    await (await POST(post())).text();
    const aanroepen = fetchNep.mock.calls.map((c) => String(c[0]));
    expect(aanroepen.filter((u) => u.startsWith('http://identiteit'))).toHaveLength(1);
    expect(aanroepen[0]).toContain('resource=https%3A%2F%2Fcognitiveservices.azure.com');
    const init = fetchNep.mock.calls[1][1] as unknown as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});
