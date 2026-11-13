/**
 * Inloggen bij andere Azure-diensten met de managed identity van de App Service, zonder sleutel. App Service zet
 * IDENTITY_ENDPOINT en IDENTITY_HEADER; bij een user-assigned identity kiest AZURE_CLIENT_ID welke.
 */
const tokens = new Map<string, { token: string; tot: number }>();

export const heeftIdentiteit = () => !!(process.env.IDENTITY_ENDPOINT && process.env.IDENTITY_HEADER);

export async function tokenVoor(resource: string, nu = Date.now()): Promise<string> {
  const bewaard = tokens.get(resource);
  // vijf minuten voor het verlopen een nieuwe
  if (bewaard && bewaard.tot - 5 * 60_000 > nu) return bewaard.token;
  if (!heeftIdentiteit()) throw new Error('Geen managed identity');
  const url = new URL(process.env.IDENTITY_ENDPOINT!);
  url.searchParams.set('resource', resource);
  url.searchParams.set('api-version', '2019-08-01');
  if (process.env.AZURE_CLIENT_ID) url.searchParams.set('client_id', process.env.AZURE_CLIENT_ID);
  const r = await fetch(url, { headers: { 'X-IDENTITY-HEADER': process.env.IDENTITY_HEADER! }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Geen token van de managed identity (${r.status})`);
  const js = await r.json() as { access_token: string; expires_on: string | number };
  tokens.set(resource, { token: js.access_token, tot: Number(js.expires_on) * 1000 });
  return js.access_token;
}

export function wisTokens() { tokens.clear(); }
