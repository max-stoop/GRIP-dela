/** Gebruikers in de tabel users. Iedereen logt in met het werkaccount; GRIP koppelt bij de eerste keer op e-mailadres. */
import { naarGebruiker, regioIds, ROL_NAAR_PROFIEL, type Gebruiker, type GebruikerInvoer } from '../gebruikers';
import type { Rol } from '../store/types';
import { alsServer, database } from './postgres';
import type { Uitvoerder } from './sql';

export class GebruikerFout extends Error {
  constructor(readonly status: number, tekst: string) { super(tekst); }
}

type Regio = { id: number; naam: string };
type UserRij = Parameters<typeof naarGebruiker>[0];

export interface Gebruikersopslag {
  lijst(): Promise<Gebruiker[]>;
  bestaat(email: string): Promise<boolean>;
  maak(g: GebruikerInvoer): Promise<Gebruiker>;
  wijzig(id: string, rol: Rol, regios: string[]): Promise<Gebruiker | null>;
  emailVan(id: string): Promise<string | null>;
  weg(id: string): Promise<void>;
}

export function gebruikersopslag(): Gebruikersopslag {
  const VELDEN = 'id, naam, email, rol, regios::int[] as regios, auth_id';
  const sql = async <T>(fn: (voer: Uitvoerder) => Promise<T>) => alsServer(await database(), fn);
  const regios = async (voer: Uitvoerder) => (await voer('select id::int as id, naam from regios', [])) as Regio[];
  return {
    lijst: () => sql(async (voer) => {
      const tabel = await regios(voer);
      return (await voer(`select ${VELDEN} from users order by naam`, [])).map((r) => naarGebruiker(r as UserRij, tabel));
    }),
    bestaat: (email) => sql(async (voer) => (await voer('select 1 from users where lower(email) = lower($1)', [email])).length > 0),
    maak: (g) => sql(async (voer) => {
      const tabel = await regios(voer);
      const [rij] = await voer(`insert into users (email, naam, rol, regios) values ($1, $2, $3, $4) returning ${VELDEN}`, [g.email, g.naam, ROL_NAAR_PROFIEL[g.rol], regioIds(g.regios, tabel)]);
      return naarGebruiker(rij as UserRij, tabel);
    }),
    wijzig: (id, rol, namen) => sql(async (voer) => {
      const tabel = await regios(voer);
      const [rij] = await voer(`update users set rol = $2, regios = $3 where id = $1 returning ${VELDEN}`, [id, ROL_NAAR_PROFIEL[rol], regioIds(namen, tabel)]);
      return rij ? naarGebruiker(rij as UserRij, tabel) : null;
    }),
    emailVan: (id) => sql(async (voer) => ((await voer('select email from users where id = $1', [id]))[0]?.email as string | undefined) ?? null),
    weg: (id) => sql(async (voer) => { await voer('delete from users where id = $1', [id]); }),
  };
}
