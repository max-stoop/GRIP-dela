/**
 * Een nagebootste Microsoft Entra ID voor de tests: discovery, een accountkiezer, de code flow met PKCE en ID-tokens
 * met RS256, en voor het uitnodigen van gasten een token voor de app zelf en Graph /v1.0/invitations (met
 * opties.uitnodigen === false zonder die machtiging). Los te starten: node e2e/azure/nep-entra.mjs <poort>.
 */
import http from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';

export const TENANT = '11111111-2222-3333-4444-555555555555';
export const CLIENT_ID = 'grip-test';
export const CLIENT_SECRET = 'geheim-van-de-test';

const b64 = (b) => Buffer.from(b).toString('base64url');
const oidVan = (email) => {
  const h = createHash('sha256').update(email).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export function startNepEntra(poort = 0, opties = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomBytes(6).toString('hex');
  const codes = new Map();
  const appTokens = new Set();
  const uitnodigingen = [];
  let issuer = '';
  const tenant = opties.tenant ?? TENANT;

  const idToken = (claims) => {
    const kop = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const inhoud = b64(JSON.stringify(claims));
    return `${kop}.${inhoud}.${b64(sign('RSA-SHA256', Buffer.from(`${kop}.${inhoud}`), privateKey))}`;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const pad = url.pathname.replace(`/${TENANT}/v2.0`, '');
    const json = (x, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(x)); };
    if (pad === '/.well-known/openid-configuration') {
      return json({
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys`,
        response_types_supported: ['code'], subject_types_supported: ['pairwise'], id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      });
    }
    if (pad === '/keys') return json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] });
    if (pad === '/authorize') {
      // een accountkiezer zoals bij Microsoft: kies een werkaccount of typ er een
      const q = url.searchParams;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><title>Nep-Entra</title><h1>Kies een account</h1>
        <form method="get" action="${issuer}/kies">${[...q].map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, '&quot;')}">`).join('')}
        <label>E-mailadres <input name="login" type="email" required></label> <button>Inloggen</button></form>`);
    }
    if (pad === '/kies') {
      const q = url.searchParams;
      const code = randomUUID();
      codes.set(code, { email: q.get('login').toLowerCase(), nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirect: q.get('redirect_uri') });
      const terug = new URL(q.get('redirect_uri'));
      terug.searchParams.set('code', code);
      terug.searchParams.set('state', q.get('state'));
      res.writeHead(302, { Location: terug.toString() });
      return res.end();
    }
    if (pad === '/token' && req.method === 'POST') {
      let tekst = '';
      for await (const deel of req) tekst += deel;
      const p = new URLSearchParams(tekst);
      if (p.get('grant_type') === 'client_credentials') {
        if (p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== CLIENT_SECRET) return json({ error: 'invalid_client' }, 401);
        const token = randomUUID();
        appTokens.add(token);
        return json({ token_type: 'Bearer', expires_in: 3600, access_token: token });
      }
      const c = codes.get(p.get('code'));
      codes.delete(p.get('code'));
      const basic = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
      const geheim = p.get('client_secret') ?? decodeURIComponent(basic.split(':')[1] ?? '');
      if (!c || geheim !== CLIENT_SECRET || p.get('redirect_uri') !== c.redirect) return json({ error: 'invalid_grant' }, 400);
      if (b64(createHash('sha256').update(p.get('code_verifier') ?? '').digest()) !== c.challenge) return json({ error: 'invalid_grant' }, 400);
      const nu = Math.floor(Date.now() / 1000);
      const naam = c.email.split('@')[0].replace(/[._]/g, ' ');
      return json({
        token_type: 'Bearer', expires_in: 3600, access_token: randomUUID(),
        id_token: idToken({ iss: issuer, aud: CLIENT_ID, iat: nu, nbf: nu, exp: nu + 3600, nonce: c.nonce, sub: randomUUID(), oid: oidVan(c.email), tid: tenant, preferred_username: c.email, name: naam }),
      });
    }
    if (url.pathname === '/v1.0/invitations' && req.method === 'POST') {
      if (!appTokens.has((req.headers.authorization ?? '').replace(/^Bearer /, ''))) return json({ error: { code: 'InvalidAuthenticationToken' } }, 401);
      if (opties.uitnodigen === false) return json({ error: { code: 'Authorization_RequestDenied', message: 'Insufficient privileges to complete the operation.' } }, 403);
      let tekst = '';
      for await (const deel of req) tekst += deel;
      const u = JSON.parse(tekst);
      uitnodigingen.push(u);
      return json({ id: randomUUID(), invitedUserEmailAddress: u.invitedUserEmailAddress, inviteRedirectUrl: u.inviteRedirectUrl, status: 'PendingAcceptance' }, 201);
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((klaar) => server.listen(poort, 'localhost', () => {
    issuer = `http://localhost:${server.address().port}/${TENANT}/v2.0`;
    klaar({ issuer, oidVan, uitnodigingen, stop: () => new Promise((k) => server.close(k)) });
  }));
}

if (process.argv[1]?.endsWith('nep-entra.mjs')) {
  const { issuer } = await startNepEntra(Number(process.argv[2] ?? 3199));
  console.log(`Nep-Entra op ${issuer}`);
}
