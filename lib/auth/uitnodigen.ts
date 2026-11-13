/**
 * Iemand van buiten de eigen Entra ID kan pas inloggen als gast. GRIP vraagt Microsoft die uitnodiging te sturen zodra
 * een beheerder iemand toevoegt; daarvoor heeft de app-registratie de toepassingsmachtiging User.Invite.All nodig. Een gast
 * krijgt daarmee alleen toegang tot het inloggen, geen rechten in Azure.
 */
import * as oidc from 'openid-client';
import { appUrl, entra } from './entra';

export interface Uitnodiging { gelukt: boolean; tekst: string }

const BERICHT = 'Je bent toegevoegd aan GRIP. Accepteer deze uitnodiging en log daarna in met je eigen werkaccount.';

export async function nodigUit(email: string): Promise<Uitnodiging> {
  try {
    return await stuur(email);
  } catch (e) {
    console.error('Uitnodigen', e);
    return { gelukt: false, tekst: `Toegevoegd, maar de uitnodiging voor ${email} lukte niet. Stuur die later opnieuw.` };
  }
}

async function stuur(email: string): Promise<Uitnodiging> {
  let token: string;
  try {
    token = (await oidc.clientCredentialsGrant(await entra(), { scope: 'https://graph.microsoft.com/.default' })).access_token;
  } catch (e) {
    console.error('Uitnodigen: geen token', e);
    return { gelukt: false, tekst: `Toegevoegd, maar Microsoft gaf GRIP geen toegang om ${email} uit te nodigen. Nodig deze persoon zelf uit in Entra ID.` };
  }
  const graph = process.env.ENTRA_GRAPH || 'https://graph.microsoft.com';
  const r = await fetch(`${graph}/v1.0/invitations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      invitedUserEmailAddress: email,
      inviteRedirectUrl: appUrl('/').toString(),
      sendInvitationMessage: true,
      invitedUserMessageInfo: { messageLanguage: 'nl-NL', customizedMessageBody: BERICHT },
    }),
  }).catch((e) => { console.error('Uitnodigen', e); return null; });
  if (!r) return { gelukt: false, tekst: `Toegevoegd, maar Microsoft was niet bereikbaar. Stuur de uitnodiging later opnieuw.` };
  if (r.ok) {
    const js = await r.json().catch(() => ({}));
    return js.status === 'Completed'
      ? { gelukt: true, tekst: `${email} kan al inloggen bij Microsoft; een nieuwe uitnodiging is niet nodig.` }
      : { gelukt: true, tekst: `Microsoft stuurt ${email} een uitnodiging per e-mail. Na het accepteren kan deze persoon inloggen.` };
  }
  if (r.status === 401 || r.status === 403) {
    return { gelukt: false, tekst: `Toegevoegd, maar GRIP mag nog geen uitnodigingen versturen. Geef GRIP eenmalig de machtiging User.Invite.All in Entra ID, of nodig ${email} zelf uit.` };
  }
  const js = await r.json().catch(() => null);
  console.error('Uitnodigen', r.status, js);
  return { gelukt: false, tekst: `Toegevoegd, maar Microsoft verstuurde geen uitnodiging${js?.error?.message ? ` (${js.error.message})` : ''}.` };
}
