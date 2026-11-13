/** Wie is er ingelogd, op basis van de tabel users. */
import { cookies } from 'next/headers';
import { WERKREGIOS } from './nbd/parameters';
import { platform, type Platform } from './platform';
import { heeftAlleRegios, type Rol } from './store/types';
import { leesWerkaccount, SESSIE_COOKIE } from './auth/entra';
import { alsServer, database } from './server/postgres';

export interface Sessie {
  modus: Platform;
  naam: string;
  email: string;
  rol: Rol;
  /** null = alle. */
  regios: string[] | null;
  /** 'test' op de testomgeving (GRIP_OMGEVING); daar staat het bovenaan elke pagina. */
  omgeving?: string;
}

const LOKALE_SESSIE: Sessie = { modus: 'lokaal', naam: 'Lokale gebruiker', email: '', rol: 'beheerder', regios: null };
const omgeving = () => process.env.GRIP_OMGEVING || undefined;

/** Rollen uit het oude GRIP-schema; hetzelfde staat in rp_rol() in de database. */
export function rolUitProfiel(rol: string | null | undefined): Rol {
  if (!rol) return 'medewerker';
  if (rol === 'Planner' || rol === 'Beheerder') return 'beheerder';
  if (/(regio|cluster).*manager/i.test(rol)) return 'regiomanager';
  if (/planner|manager/i.test(rol)) return 'planner';
  return 'medewerker';
}

export interface Profiel { id: string; naam: string; email: string; rol: string; regios: number[] | null }

/** Los van de database, zodat het koppelen te testen is. */
export interface ProfielBron {
  opAuthId(authId: string): Promise<Profiel | null>;
  /** Hoofdletters maken niet uit; alleen profielen die nog niet aan een account hangen. */
  vrijOpEmail(email: string): Promise<Profiel[]>;
  koppel(profielId: string, authId: string): Promise<boolean>;
}

/** Een account dat nog niet gekoppeld is, koppelt op e-mail: alleen bevestigd en met precies één vrij profiel. */
export async function vindProfiel(bron: ProfielBron, user: { id: string; email?: string | null; email_confirmed_at?: string | null }): Promise<Profiel | null> {
  const eigen = await bron.opAuthId(user.id);
  if (eigen) return eigen;
  if (!user.email || !user.email_confirmed_at) return null;
  const vrij = await bron.vrijOpEmail(user.email);
  if (vrij.length !== 1) return null;
  return (await bron.koppel(vrij[0].id, user.id)) ? vrij[0] : null;
}

type SessieUitslag = { soort: 'ok'; sessie: Sessie } | { soort: 'niet_ingelogd' } | { soort: 'geen_profiel'; email: string; reden?: 'geen_regios' };

/**
 * Een planner en de beheerder hebben altijd alle regio's (null). Een regiomanager heeft precies de eigen regio's, zoals
 * rp_regios() in de database: geen regio's (of alleen onbekende) is geen enkele, nooit alle. Een medewerker zonder
 * regio's houdt null: die leest in de database alleen de eigen gegevens, de regio's sturen alleen het scherm.
 */
export function regiosVan(rol: Rol, p: Pick<Profiel, 'regios'>, namen: string[]): string[] | null {
  if (heeftAlleRegios(rol)) return null;
  if (rol === 'medewerker' && !p.regios?.length) return null;
  const werk = namen.filter((n) => WERKREGIOS.includes(n));
  return WERKREGIOS.every((r) => werk.includes(r)) ? null : werk;
}

export async function bepaalSessie(): Promise<SessieUitslag> {
  const p = platform();
  if (p === 'lokaal') return { soort: 'ok', sessie: { ...LOKALE_SESSIE, omgeving: omgeving() } };
  return sessieAzure();
}

/** Een nieuwe database heeft nog geen gebruikers: dit werkaccount wordt bij de eerste keer inloggen beheerder. */
const eersteBeheerder = (email: string) => (process.env.GRIP_BEHEERDER ?? '').toLowerCase().split(',').map((x) => x.trim()).includes(email);

async function sessieAzure(): Promise<SessieUitslag> {
  const w = await leesWerkaccount((await cookies()).get(SESSIE_COOKIE)?.value);
  if (!w) return { soort: 'niet_ingelogd' };
  const VELDEN_PG = 'id, naam, email, rol, regios::int[] as regios';
  return alsServer(await database(), async (voer) => {
    const bron: ProfielBron = {
      opAuthId: async (id) => ((await voer(`select ${VELDEN_PG} from users where auth_id = $1`, [id]))[0] as unknown as Profiel | undefined) ?? null,
      vrijOpEmail: async (email) => (await voer(`select ${VELDEN_PG} from users where lower(email) = lower($1) and auth_id is null`, [email])) as unknown as Profiel[],
      koppel: async (id, authId) => (await voer('update users set auth_id = $2 where id = $1 and auth_id is null returning id', [id, authId])).length > 0,
    };
    // de tenant staat in voor het e-mailadres van een werkaccount
    const p = await vindProfiel(bron, { id: w.oid, email: w.email, email_confirmed_at: 'entra' })
      ?? (eersteBeheerder(w.email) ? ((await voer(`insert into users (email, naam, rol, auth_id) values ($1, $2, 'Planner', $3)
        on conflict do nothing returning ${VELDEN_PG}`, [w.email, w.naam, w.oid]))[0] as unknown as Profiel | undefined) ?? null : null);
    if (!p) return { soort: 'geen_profiel', email: w.email } as const;
    const rol = rolUitProfiel(p.rol);
    const namen = p.regios?.length ? (await voer('select naam from regios where id = any($1)', [p.regios])).map((r) => String(r.naam)) : [];
    const regios = regiosVan(rol, p, namen);
    // een regiomanager zonder regio's mag niets: de database geeft dan ook niets
    if (regios && !regios.length) return { soort: 'geen_profiel', email: w.email, reden: 'geen_regios' } as const;
    return { soort: 'ok', sessie: { modus: 'azure', naam: p.naam || w.naam, email: p.email || w.email, rol, regios, omgeving: omgeving() } } as const;
  });
}
