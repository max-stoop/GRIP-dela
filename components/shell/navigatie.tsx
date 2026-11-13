'use client';
import type { ReactNode } from 'react';
import { LayoutDashboard, LineChart, CalendarDays, Compass, Palmtree, ArrowLeftRight, Users, Gauge, BookOpen, Database, Settings, CalendarRange, Route, Clock3 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useSessie } from '@/components/sessie';
import { useApp } from '@/lib/store/store';
import { isNbd } from '@/lib/nbd/parameters';
import type { Rol } from '@/lib/store/types';

export type Teller = 'verlof' | 'ruil' | 'bijsturen' | 'goedkeuring';
export interface Item { href: string; label: string; icoon: ReactNode; rollen: Rol[]; teller?: Teller }
export interface Groep { titel: string; items: Item[] }

const P: Rol[] = ['beheerder', 'regiomanager', 'planner'];
const ALLE: Rol[] = ['beheerder', 'regiomanager', 'planner', 'medewerker'];

/** In de volgorde van de keten: voorspellen, rooster, bijsturen en verdelen; daarna het team en het beleid. */
export const GROEPEN: Groep[] = [
  {
    titel: 'Plannen',
    items: [
      { href: '/dashboard', label: 'Dashboard', icoon: <LayoutDashboard size={18} />, rollen: P },
      { href: '/mijn-rooster', label: 'Mijn rooster', icoon: <CalendarDays size={18} />, rollen: ['medewerker'] },
      { href: '/voorspelling', label: 'Voorspelling', icoon: <LineChart size={18} />, rollen: P },
      { href: '/rooster', label: 'Rooster', icoon: <CalendarDays size={18} />, rollen: P, teller: 'goedkeuring' },
      { href: '/bijsturen', label: 'Bijsturen', icoon: <Compass size={18} />, rollen: P, teller: 'bijsturen' },
      { href: '/verdeling', label: 'Verdelen', icoon: <Route size={18} />, rollen: P },
    ],
  },
  {
    titel: 'Team',
    items: [
      { href: '/team', label: 'Team', icoon: <Users size={18} />, rollen: P },
      { href: '/verlof', label: 'Verlof en voorkeuren', icoon: <Palmtree size={18} />, rollen: ALLE, teller: 'verlof' },
      { href: '/jaarplanning', label: 'Jaarplanning verlof', icoon: <CalendarRange size={18} />, rollen: ALLE },
      { href: '/ruilen', label: 'Ruilen', icoon: <ArrowLeftRight size={18} />, rollen: ALLE, teller: 'ruil' },
    ],
  },
  {
    titel: 'Inzicht',
    items: [
      { href: '/capaciteit', label: 'Capaciteit', icoon: <Gauge size={18} />, rollen: P },
      { href: '/beleid', label: 'Roosterbeleid', icoon: <BookOpen size={18} />, rollen: ALLE },
    ],
  },
  {
    titel: 'Beheer',
    items: [
      { href: '/model', label: 'Bronnen en model', icoon: <Database size={18} />, rollen: ['beheerder'] },
      { href: '/instellingen', label: 'Instellingen', icoon: <Settings size={18} />, rollen: ['beheerder'] },
    ],
  },
];

export type Module = 'regios' | 'nbd';

function moduleVan(pad: string): Module {
  return pad === '/nbd' || pad.startsWith('/nbd/') ? 'nbd' : 'regios';
}

/** Een losse module, met dezelfde rollen als in de regio's. */
export const NBD_GROEPEN: Groep[] = [
  {
    titel: 'Plannen',
    items: [
      { href: '/nbd', label: 'Overzicht', icoon: <LayoutDashboard size={18} />, rollen: P },
      { href: '/nbd/rooster', label: 'Rooster', icoon: <CalendarDays size={18} />, rollen: P, teller: 'goedkeuring' },
      { href: '/nbd/bijsturen', label: 'Bijsturen', icoon: <Compass size={18} />, rollen: P, teller: 'bijsturen' },
    ],
  },
  {
    titel: 'Team',
    items: [
      { href: '/nbd/team', label: 'Team', icoon: <Users size={18} />, rollen: P },
      { href: '/nbd/voorkeuren', label: 'Voorkeuren per uur', icoon: <Clock3 size={18} />, rollen: P },
      { href: '/nbd/verlof', label: 'Verlof', icoon: <Palmtree size={18} />, rollen: P, teller: 'verlof' },
      { href: '/nbd/jaarplanning', label: 'Jaarplanning verlof', icoon: <CalendarRange size={18} />, rollen: P },
      { href: '/nbd/ruilen', label: 'Ruilen', icoon: <ArrowLeftRight size={18} />, rollen: P, teller: 'ruil' },
    ],
  },
  {
    titel: 'Inzicht',
    items: [
      { href: '/nbd/capaciteit', label: 'Capaciteit en Erlang', icoon: <Gauge size={18} />, rollen: P },
    ],
  },
  {
    titel: 'Beheer',
    items: [
      { href: '/instellingen', label: 'Instellingen', icoon: <Settings size={18} />, rollen: ['beheerder'] },
    ],
  },
];

/** Zonder het roosterbeleid van de regio's. */
export const NBD_MEDEWERKER: Groep[] = [
  {
    titel: 'Plannen',
    items: [{ href: '/mijn-rooster', label: 'Mijn rooster', icoon: <CalendarDays size={18} />, rollen: ['medewerker'] }],
  },
  {
    titel: 'Team',
    items: [
      { href: '/verlof', label: 'Verlof en voorkeuren', icoon: <Palmtree size={18} />, rollen: ['medewerker'], teller: 'verlof' },
      { href: '/jaarplanning', label: 'Jaarplanning verlof', icoon: <CalendarRange size={18} />, rollen: ['medewerker'] },
      { href: '/ruilen', label: 'Ruilen', icoon: <ArrowLeftRight size={18} />, rollen: ['medewerker'], teller: 'ruil' },
    ],
  },
];

/** Een medewerker hoort bij de module van het eigen team, wie alleen de NBD doet altijd bij de NBD; verder bepaalt het adres het. */
export function useModule(): Module {
  const s = useSessie();
  const pad = usePathname();
  const eigen = useApp((x) => x.medewerkers.find((m) => m.id === s.medewerkerId)?.regio);
  if (s.rol === 'medewerker') return isNbd(eigen) ? 'nbd' : 'regios';
  if (s.nbd && !s.regios.length) return 'nbd';
  // pagina's van beide modules (de instellingen): je blijft in de module waar je vandaan kwam
  if (GEDEELD.some((p) => pad === p || pad.startsWith(`${p}/`))) return laatsteModule;
  laatsteModule = moduleVan(pad);
  return laatsteModule;
}

const GEDEELD = ['/instellingen'];
let laatsteModule: Module = 'regios';
