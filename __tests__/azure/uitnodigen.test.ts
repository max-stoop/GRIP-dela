// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLIENT_ID, CLIENT_SECRET, startNepEntra, TENANT } from '../../e2e/azure/nep-entra.mjs';

type Nep = { issuer: string; uitnodigingen: { invitedUserEmailAddress: string; inviteRedirectUrl: string; sendInvitationMessage: boolean }[]; stop: () => Promise<void> };
let met: Nep, zonder: Nep;

beforeAll(async () => {
  met = await startNepEntra();
  zonder = await startNepEntra(0, { uitnodigen: false });
  Object.assign(process.env, { ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT_ID, ENTRA_CLIENT_SECRET: CLIENT_SECRET, GRIP_URL: 'https://gripapp.nl' });
});
afterAll(async () => { await met.stop(); await zonder.stop(); });

async function nodigUitBij(nep: Nep, email: string) {
  process.env.ENTRA_ISSUER = nep.issuer;
  process.env.ENTRA_GRAPH = new URL(nep.issuer).origin;
  vi.resetModules();
  return (await import('@/lib/auth/uitnodigen')).nodigUit(email);
}

describe('gasten uitnodigen', () => {
  it('vraagt Microsoft een uitnodiging te sturen die terugkomt bij GRIP', async () => {
    const u = await nodigUitBij(met, 'planner@elders.nl');
    expect(u.gelukt).toBe(true);
    expect(u.tekst).toContain('Microsoft stuurt planner@elders.nl een uitnodiging');
    expect(met.uitnodigingen).toEqual([expect.objectContaining({ invitedUserEmailAddress: 'planner@elders.nl', inviteRedirectUrl: 'https://gripapp.nl/', sendInvitationMessage: true })]);
  });

  it('zonder de machtiging: de gebruiker staat erin en de melding zegt wat er nog moet', async () => {
    const u = await nodigUitBij(zonder, 'planner@elders.nl');
    expect(u.gelukt).toBe(false);
    expect(u.tekst).toContain('User.Invite.All');
    expect(zonder.uitnodigingen).toHaveLength(0);
  });

  it('een verkeerd geheim: geen uitnodiging, wel een melding', async () => {
    process.env.ENTRA_CLIENT_SECRET = 'fout';
    const u = await nodigUitBij(met, 'ander@elders.nl');
    process.env.ENTRA_CLIENT_SECRET = CLIENT_SECRET;
    expect(u.gelukt).toBe(false);
    expect(met.uitnodigingen).toHaveLength(1);
  });
});
