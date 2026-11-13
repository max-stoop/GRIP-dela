/** Gegevens in een cookie die niemand kan lezen of veranderen zonder het geheim (AES-GCM). */
const enc = new TextEncoder();

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const uitB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function sleutel(geheim: string): Promise<CryptoKey> {
  if (geheim.length < 32) throw new Error('Het sessiegeheim is te kort (minstens 32 tekens)');
  const ruw = await crypto.subtle.digest('SHA-256', enc.encode(geheim));
  return crypto.subtle.importKey('raw', ruw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** exp in milliseconden: daarna geldt de inhoud niet meer. */
export async function verzegel(inhoud: object, exp: number, geheim: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify({ ...inhoud, exp }));
  const versleuteld = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sleutel(geheim), data));
  return `${b64(iv)}.${b64(versleuteld)}`;
}

export async function ontzegel<T>(waarde: string | undefined, geheim: string, nu = Date.now()): Promise<T | null> {
  if (!waarde) return null;
  try {
    const [iv, data] = waarde.split('.');
    const open = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: uitB64(iv) }, await sleutel(geheim), uitB64(data));
    const x = JSON.parse(new TextDecoder().decode(open)) as T & { exp?: number };
    return typeof x.exp === 'number' && x.exp > nu ? x : null;
  } catch {
    return null;
  }
}
