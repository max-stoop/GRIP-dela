/** De beheerder voegt mensen toe en kiest hun rol en regio's. */
import { WERKREGIOS } from './nbd/parameters';
import { rolUitProfiel } from './sessie';
import { heeftAlleRegios, type Rol } from './store/types';

/** user_role uit de oude GRIP. */
export const ROL_NAAR_PROFIEL: Record<Rol, string> = {
  beheerder: 'Planner',
  regiomanager: 'Regio Manager',
  planner: 'Regio Planner',
  medewerker: 'Uitvaartverzorger/Leider',
};

export interface GebruikerInvoer {
  email: string;
  naam: string;
  rol: Rol;
  /**
   * Een planner en de beheerder: leeg, ze werken altijd landelijk. De andere rollen: hun regio's, minstens één; een
   * regiomanager met alle regio's heeft ze allemaal in de lijst. Leeg is daar nooit "alle".
   */
  regios: string[];
}

export interface Gebruiker extends GebruikerInvoer {
  id: string;
  /** Kan een oude GRIP-rol zijn, zoals NBD Planner. */
  profielRol: string;
  /** Heeft al eens ingelogd. */
  gekoppeld: boolean;
}

const ROLLEN: Rol[] = ['beheerder', 'regiomanager', 'planner', 'medewerker'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function controleerInvoer(x: unknown, nieuw = true): { ok: true; invoer: GebruikerInvoer } | { ok: false; fout: string } {
  const v = (x ?? {}) as Record<string, unknown>;
  const email = String(v.email ?? '').trim().toLowerCase();
  const naam = String(v.naam ?? '').trim();
  const rol = v.rol as Rol;
  const regios = Array.isArray(v.regios) ? v.regios.map(String) : [];
  if (nieuw && !EMAIL.test(email)) return { ok: false, fout: 'Geef een geldig e-mailadres' };
  if (nieuw && (naam.length < 2 || naam.length > 80)) return { ok: false, fout: 'Geef een naam' };
  if (!ROLLEN.includes(rol)) return { ok: false, fout: 'Kies een rol' };
  const onbekend = regios.find((r) => !WERKREGIOS.includes(r));
  if (onbekend) return { ok: false, fout: `Onbekende regio: ${onbekend}` };
  if (rol === 'medewerker' && !regios.length) return { ok: false, fout: 'Kies de regio van de medewerker' };
  if (rol === 'regiomanager' && !regios.length) return { ok: false, fout: 'Kies de regio\'s van de regiomanager (of Alle regio\'s), of de nabestaandendesk' };
  return { ok: true, invoer: { email, naam, rol, regios: heeftAlleRegios(rol) ? [] : [...new Set(regios)] } };
}

/** Onbekende namen vallen weg. */
export function regioIds(namen: string[], tabel: { id: number; naam: string }[]): number[] {
  return namen.map((n) => tabel.find((r) => r.naam === n)?.id).filter((id): id is number => id != null);
}

export function naarGebruiker(rij: { id: string; naam: string; email: string; rol: string; regios: number[] | null; auth_id: string | null }, tabel: { id: number; naam: string }[]): Gebruiker {
  const rol = rolUitProfiel(rij.rol);
  const namen = (rij.regios ?? []).map((id) => tabel.find((r) => r.id === id)?.naam).filter((n): n is string => !!n && WERKREGIOS.includes(n));
  return { id: rij.id, naam: rij.naam, email: rij.email, rol, profielRol: rij.rol, regios: heeftAlleRegios(rol) ? [] : [...new Set(namen)], gekoppeld: !!rij.auth_id };
}
