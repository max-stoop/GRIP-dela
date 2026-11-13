'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Sessie } from '@/lib/sessie';
import type { Rol } from '@/lib/store/types';
import { mag as magRol, plant, verlofBesluiter, type Recht } from '@/lib/rechten';
import { useApp } from '@/lib/store/store';
import { NBD, WERKREGIOS } from '@/lib/nbd/parameters';

interface SessieInfo {
  echt: Sessie;
  /** Kan een voorvertoning zijn. */
  rol: Rol;
  naam: string;
  /** Zonder de NBD. */
  regios: string[];
  nbd: boolean;
  /** De regio's en eventueel de NBD. */
  werkregios: string[];
  /** Als medewerker: wie ben ik in het rooster. */
  medewerkerId: string | null;
  /** Rollen waarmee de gebruiker de app mag bekijken. */
  wisselRollen: Rol[];
  voorvertoning: boolean;
  bekijkAls: (rol: Rol, medewerkerId?: string | null) => void;
  kiesIdentiteit: (medewerkerId: string) => void;
  /** Planner, regiomanager of beheerder. */
  isPlanner: boolean;
  isRegiomanager: boolean;
  isBeheerder: boolean;
  mag: (recht: Recht) => boolean;
}

const Ctx = createContext<SessieInfo | null>(null);

const SLEUTEL = 'grip-bekijk-als';
const IK = 'grip-ik';

/** Bij uitloggen: de voorvertoning en de gekozen identiteit vergeten, zodat de volgende gebruiker schoon begint. */
export function vergeetSessieKeuzes() {
  schrijf(SLEUTEL, null);
  schrijf(IK, null);
}

function lees<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function schrijf(k: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // opslag geblokkeerd: dan geldt de keuze alleen voor deze sessie
  }
}

export function SessieProvider({ sessie, children }: { sessie: Sessie; children: ReactNode }) {
  const [als, setAls] = useState<{ rol: Rol; medewerkerId?: string | null } | null>(null);
  const [ik, setIk] = useState<string | null>(null);
  useEffect(() => {
    setAls(lees(SLEUTEL));
    setIk(lees<string>(IK));
  }, []);
  const medewerkers = useApp((s) => s.medewerkers);
  const plannerBesluitVerlof = useApp((s) => s.beleid.plannerBesluitVerlof);

  // meekijken als een rol met minder rechten (de beheerder kan elke rol bekijken)
  // met de gedeelde database alleen rollen waarvan de acties ook echt worden bewaard: een regiomanager biedt geen
  // rooster aan (dat doet de planner), dus geen "bekijk als planner"
  const wisselRollen: Rol[] = sessie.rol === 'beheerder' ? ['beheerder', 'regiomanager', 'planner', 'medewerker'] : sessie.rol === 'regiomanager' ? (sessie.modus !== 'lokaal' ? ['regiomanager', 'medewerker'] : ['regiomanager', 'planner', 'medewerker']) : sessie.rol === 'planner' ? ['planner', 'medewerker'] : [];
  const rol: Rol = als && wisselRollen.includes(als.rol) ? als.rol : sessie.rol;
  const toegang = sessie.regios ?? WERKREGIOS;
  const regios = useMemo(() => toegang.filter((r) => r !== NBD), [toegang]);
  const nbd = toegang.includes(NBD);
  const werkregios = useMemo(() => (nbd ? [...regios, NBD] : regios), [regios, nbd]);

  // als medewerker: eerst de voorvertoningskeuze, dan een gekoppeld e-mailadres, dan de eigen keuze
  const medewerkerId = useMemo(() => {
    if (rol !== 'medewerker') return null;
    const actief = medewerkers.filter((m) => m.actief && werkregios.includes(m.regio));
    // een echte medewerker met de gedeelde database: de eigen regel is de enige die geen collega is (de database kiest)
    if (sessie.rol === 'medewerker' && sessie.modus !== 'lokaal') return actief.find((m) => !m.collega)?.id ?? null;
    // een voorvertoning geldt alleen voor wie mag wisselen (niet voor de volgende gebruiker op deze computer)
    if (wisselRollen.length && als?.rol === 'medewerker' && als.medewerkerId && actief.some((m) => m.id === als.medewerkerId)) return als.medewerkerId;
    const opMail = sessie.email && actief.find((m) => m.email && m.email.toLowerCase() === sessie.email.toLowerCase());
    if (opMail) return opMail.id;
    if (ik && actief.some((m) => m.id === ik)) return ik;
    return null;
  }, [rol, medewerkers, werkregios, als, sessie.email, sessie.rol, sessie.modus, wisselRollen.length, ik]);

  const bekijkAls = useCallback((r: Rol, mid?: string | null) => {
    const v = r === sessie.rol && !mid ? null : { rol: r, medewerkerId: mid ?? null };
    setAls(v);
    schrijf(SLEUTEL, v);
  }, [sessie.rol]);

  const kiesIdentiteit = useCallback((mid: string) => {
    if (wisselRollen.length) bekijkAls('medewerker', mid);
    else { setIk(mid); schrijf(IK, mid); }
  }, [wisselRollen.length, bekijkAls]);

  const naam = rol === 'medewerker' && medewerkerId && als?.rol === 'medewerker' ? medewerkers.find((m) => m.id === medewerkerId)?.naam ?? sessie.naam : sessie.naam;

  const info: SessieInfo = {
    echt: sessie, rol, naam, regios, nbd, werkregios, medewerkerId, wisselRollen,
    voorvertoning: rol !== sessie.rol || (als?.rol === 'medewerker' && !!als.medewerkerId && sessie.rol !== 'medewerker'),
    bekijkAls, kiesIdentiteit,
    isPlanner: plant(rol),
    isRegiomanager: rol === 'regiomanager',
    isBeheerder: rol === 'beheerder',
    mag: (recht) => magRol(rol, recht, { plannerBesluitVerlof }),
  };
  return <Ctx.Provider value={info}>{children}</Ctx.Provider>;
}

export function useVerlofBesluiter(): string {
  return verlofBesluiter({ plannerBesluitVerlof: useApp((s) => s.beleid.plannerBesluitVerlof) });
}

export function useSessie(): SessieInfo {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSessie buiten SessieProvider');
  return s;
}

/** Voor in logregels. */
export function useDoor(): string {
  const s = useSessie();
  return s.voorvertoning ? `${s.echt.naam} (als ${s.rol})` : s.naam;
}
