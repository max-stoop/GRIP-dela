/**
 * Inloggen met het werkaccount (Microsoft Entra ID): de authorization code flow met PKCE, alleen voor de eigen tenant.
 * Rollen en regio's blijven in GRIP: het account koppelt op e-mailadres aan een gebruiker in users.
 */
import * as oidc from 'openid-client';
import { ontzegel, verzegel } from './zegel';

export const SESSIE_COOKIE = 'grip_sessie';
export const LOGIN_COOKIE = 'grip_login';
export const SESSIE_DUUR = 12 * 3_600_000;
const LOGIN_DUUR = 10 * 60_000;

export interface Werkaccount { oid: string; tid: string; email: string; naam: string }
interface Loginstaat { state: string; nonce: string; verifier: string; volgende: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function instelling(naam: string): string {
  const w = process.env[naam];
  if (!w) throw new Error(`${naam} ontbreekt`);
  return w;
}

const sessieGeheim = () => instelling('SESSIE_GEHEIM');
/** Het adres van de app zoals de browser het kent; achter de proxy van Azure ziet de server een ander. */
export const appUrl = (pad: string) => new URL(pad, instelling('GRIP_URL'));
const terugAdres = () => appUrl('/auth/entra/callback').toString();

/**
 * Het inloggen moet op het adres uit GRIP_URL beginnen: daar komt Microsoft op terug, en daar moet het logincookie dus
 * staan. Komt iemand binnen via het Azure-adres, dan eerst daarheen.
 */
export function naarEigenAdres(req: Request): URL | null {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim();
  const eigen = appUrl('/');
  if (!host || host === eigen.host) return null;
  const { pathname, search } = new URL(req.url);
  return appUrl(pathname + search);
}

let config: Promise<oidc.Configuration> | null = null;

export function entra(): Promise<oidc.Configuration> {
  config ??= (async () => {
    const tenant = instelling('ENTRA_TENANT_ID');
    const issuer = new URL(process.env.ENTRA_ISSUER || `https://login.microsoftonline.com/${tenant}/v2.0`);
    // alleen de nagebootste Entra in de tests draait zonder https
    const lokaal = issuer.protocol === 'http:' && issuer.hostname === 'localhost';
    return oidc.discovery(issuer, instelling('ENTRA_CLIENT_ID'), instelling('ENTRA_CLIENT_SECRET'), undefined, lokaal ? { execute: [oidc.allowInsecureRequests] } : undefined);
  })().catch((e) => { config = null; throw e; });
  return config;
}

/** Waar de browser heen moet, en het cookie dat de controle na terugkomst mogelijk maakt. */
export async function startInloggen(volgende: string): Promise<{ naar: URL; cookie: string }> {
  const c = await entra();
  const staat: Loginstaat = { state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier(), volgende };
  const naar = oidc.buildAuthorizationUrl(c, {
    redirect_uri: terugAdres(),
    scope: 'openid profile email',
    response_type: 'code',
    code_challenge: await oidc.calculatePKCECodeChallenge(staat.verifier),
    code_challenge_method: 'S256',
    state: staat.state,
    nonce: staat.nonce,
  });
  return { naar, cookie: await verzegel(staat, Date.now() + LOGIN_DUUR, sessieGeheim()) };
}

/** Controleert het antwoord van Entra en geeft het sessiecookie, of null als er iets niet klopt. */
export async function rondInloggenAf(zoek: string, loginCookie: string | undefined): Promise<{ cookie: string; volgende: string; account: Werkaccount } | null> {
  const staat = await ontzegel<Loginstaat>(loginCookie, sessieGeheim());
  if (!staat) return null;
  try {
    const tokens = await oidc.authorizationCodeGrant(await entra(), new URL(`${terugAdres()}${zoek}`), {
      pkceCodeVerifier: staat.verifier, expectedState: staat.state, expectedNonce: staat.nonce, idTokenExpected: true,
    });
    const c = tokens.claims();
    const tenant = instelling('ENTRA_TENANT_ID');
    const email = String(c?.email ?? c?.preferred_username ?? '').toLowerCase();
    if (!c || c.tid !== tenant || typeof c.oid !== 'string' || !UUID.test(c.oid) || !email.includes('@')) return null;
    const account: Werkaccount = { oid: c.oid, tid: tenant, email, naam: typeof c.name === 'string' ? c.name : email };
    return { cookie: await verzegel(account, Date.now() + SESSIE_DUUR, sessieGeheim()), volgende: staat.volgende, account };
  } catch (e) {
    console.error('Inloggen met Entra ID', e);
    return null;
  }
}

export const leesWerkaccount = (cookie: string | undefined) => ontzegel<Werkaccount>(cookie, sessieGeheim());
