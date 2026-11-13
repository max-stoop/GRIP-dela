'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { RefreshCw, LogOut, Monitor, Moon, Sun, Eye, User as UserRound, Menu, X, PanelLeftClose, PanelLeftOpen, Search, MapPin, CalendarCheck, Headset } from 'lucide-react';
import { SessieProvider, useSessie, vergeetSessieKeuzes } from '@/components/sessie';
import { ToastProvider, useActie, useToast } from '@/components/toast';
import { Laden, Segment, Spinner } from '@/components/ui';
import { Welkom, KiesIdentiteit } from '@/components/shell/Welkom';
import { Zoeken } from '@/components/shell/Zoeken';
import { GROEPEN, NBD_GROEPEN, NBD_MEDEWERKER, useModule, type Groep, type Module, type Teller } from '@/components/shell/navigatie';
import { laad, leesOpnieuw, useApp, useTaak, useLeesFout, useOpslagFout, useOpslagwijze, useGroteOpslag, dagelijkseRun, vergeetTest, verversBronnen, zetGebruiker } from '@/lib/store/store';
import { TestBalk } from '@/components/shell/Testomgeving';
import { GeenBedrijfsdata } from '@/components/shell/GeenBedrijfsdata';
import { DEEL_NAAM } from '@/lib/store/db/laden';
import { inLopendeRonde, ROL_LABEL, type Rol } from '@/lib/store/types';
import type { Sessie } from '@/lib/sessie';
import { fmtD, fmtMoment } from '@/lib/dates';
import { meldingenEind } from '@/lib/store/afgeleid';
import { REGIONS, REGION_CLUSTER, CLUSTER_NAAM } from '@/lib/model/config';
import { useLandelijk, useWerkregio, zetLandelijk } from '@/lib/werkregio';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { useNbdVandaag } from '@/components/nbd/useNbdVandaag';
import { cx, nlInt } from '@/lib/format';
import { afmelden } from '@/lib/auth/afmelden';

export function AppShell({ sessie, children }: { sessie: Sessie; children: ReactNode }) {
  return (
    <ToastProvider>
      <SessieProvider sessie={sessie}>
        <Schil>{children}</Schil>
      </SessieProvider>
    </ToastProvider>
  );
}

/** Roosters en weekendoverzichten: de volle breedte van het scherm, zodat een hele maand of een heel jaar past. */
const BREED = ['/rooster', '/bijsturen', '/team', '/nbd/rooster', '/nbd/bijsturen'];

function Schil({ children }: { children: ReactNode }) {
  const geladen = useApp((s) => s.geladen);
  const taak = useTaak();
  // tijdens het klaarzetten van de demo blijft het welkomstscherm staan, zodat niets halverwege wordt afgebroken
  const demoBezig = taak?.naam === 'Demo klaarzetten';
  const leesFout = useLeesFout();
  // wat niet kon worden gelezen, is niet leeg: dan geen welkom, maar een melding
  const leeg = useApp((s) => !s.meldingen && s.medewerkers.length === 0) && !leesFout.some((x) => x.deel === 'meldingen' || x.deel === 'medewerkers') || demoBezig;
  const s = useSessie();
  const mod = useModule();
  const toon = useToast();
  const fout = useOpslagFout();
  const groot = useGroteOpslag();
  const opslag = useOpslagwijze();
  const [opnieuw, setOpnieuw] = useState(false);
  const pad = usePathname();
  // Zonder gegevens staat het welkom op de startpagina. Wie plant, kan via het menu verder:
  // teams invoeren, meldingen inlezen, gebruikers en instellingen. Wie niet plant, wacht op de beheerder.
  const welkom = leeg && (demoBezig || !s.isPlanner || pad === '/' || pad === '/dashboard');
  const menu = !leeg || (s.isPlanner && !demoBezig);
  const [lade, setLade] = useState(false);
  const [smal, setSmal] = useState(false);
  const [zoek, setZoek] = useState(false);

  // de rol eerst, want het onderhoud bij het laden hangt ervan af (met de gedeelde database)
  useEffect(() => { zetGebruiker(s.echt.rol, s.echt.email || s.echt.naam, s.echt.regios); laad(); }, [s.echt.rol, s.echt.email, s.echt.naam, s.echt.regios]);
  useEffect(() => { try { setSmal(localStorage.getItem('grip-zijbalk') === 'smal'); } catch { /* geen opslag */ } }, []);
  useEffect(() => { setLade(false); }, [pad]);
  // Ctrl+K of / opent zoeken
  useEffect(() => {
    const toets = (e: KeyboardEvent) => {
      const doel = e.target as HTMLElement | null;
      const typen = doel && (doel.tagName === 'INPUT' || doel.tagName === 'TEXTAREA' || doel.tagName === 'SELECT' || doel.isContentEditable);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typen)) { e.preventDefault(); setZoek(true); }
      if (e.key === 'Escape') setLade(false);
    };
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, []);

  const wisselSmal = () => {
    setSmal((x) => {
      try { localStorage.setItem('grip-zijbalk', x ? 'breed' : 'smal'); } catch { /* geen opslag */ }
      return !x;
    });
  };

  // dagelijkse run, zoals de server om 06:00: bij openen, als er vandaag nog niets is gedaan
  const gestart = useRef(false);
  useEffect(() => {
    // niet rekenen op een half opgehaalde staat (bijvoorbeeld zonder de eigen instellingen)
    if (!geladen || leeg || !s.isPlanner || gestart.current || leesFout.length) return;
    gestart.current = true;
    dagelijkseRun().catch((e) => { console.error('Dagelijkse voorspelling mislukt', e); toon('De voorspelling van vandaag is niet gelukt. Probeer het later opnieuw bij Bronnen en model.', 'fout'); });
  }, [geladen, leeg, s.isPlanner, toon, leesFout.length]);

  return (
    <div className="min-h-screen lg:flex">
      <a href="#inhoud" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">Naar de inhoud</a>
      {lade && <div className="fixed inset-0 z-40 bg-[rgb(6_24_36/0.55)] lg:hidden" onClick={() => setLade(false)} aria-hidden />}
      <Zijbalk smal={smal} open={lade} onSluit={() => setLade(false)} onSmal={wisselSmal} onZoek={() => setZoek(true)} toonNav={menu} />
      <div className="flex min-w-0 flex-1 flex-col">
        <GeenBedrijfsdata omgeving={s.echt.omgeving} />
        <MobieleBalk onOpen={() => setLade(true)} onZoek={() => setZoek(true)} />
        {geladen && <TestBalk />}
        {s.voorvertoning && <Voorvertoning />}
        <main id="inhoud" className={cx('mx-auto w-full flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8', BREED.some((b) => pad.startsWith(b)) ? 'max-w-none' : 'max-w-app')}>
          {leesFout.length > 0 && (
            <div className="banner banner-err mb-4 grid gap-2">
              <span>Niet alles kon worden opgehaald: {leesFout.map((x) => DEEL_NAAM[x.deel]).join(', ')}. De rest staat er wel. Wijzigingen daarin worden pas bewaard als het weer lukt.</span>
              <span className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-sm" disabled={opnieuw} onClick={() => { setOpnieuw(true); void leesOpnieuw().finally(() => setOpnieuw(false)); }}>Opnieuw proberen</button>
                <details className="text-[13px]"><summary className="cursor-pointer">Details</summary><ul className="mt-1 grid gap-0.5">{leesFout.map((x) => <li key={x.deel}>{x.fout}</li>)}</ul></details>
              </span>
            </div>
          )}
          {fout && <div className="banner banner-err mb-4">{opslag !== 'database' ? `Opslaan in deze browser lukt niet: ${fout}. Wijzigingen gaan verloren bij vernieuwen.` : fout}</div>}
          {groot && (groot.klaar
            ? <div className="banner banner-ok mb-4" role="status">Alles is bewaard: {nlInt(groot.rijen)} regels in één keer.</div>
            : (
              <div className="banner banner-info mb-4 flex items-center gap-2" role="status">
                <Spinner />
                <span>Een grote wijziging ({nlInt(groot.rijen)} regels) wordt bewaard: {groot.fase === 'klaarzetten' ? `deel ${groot.deel} van ${groot.van} klaargezet` : 'alles wordt nu in één keer verwerkt'}. Sluit deze pagina nog niet.</span>
              </div>
            ))}
          {!geladen ? <Laden /> : welkom ? <Welkom /> : s.rol === 'medewerker' && !s.medewerkerId ? <KiesIdentiteit /> : children}
        </main>
        <footer className="geen-print border-t border-line">
          <div className="mx-auto flex max-w-app flex-wrap items-center justify-between gap-2 px-4 py-4 text-[13px] text-muted sm:px-6 lg:px-8">
            <span>GRIP {mod === 'nbd' ? 'Nabestaandendesk' : 'Regelplekken'}</span>
            <span>{opslag === 'test' ? 'Testomgeving: niets wordt opgeslagen in de gedeelde database' : opslag === 'browser' ? 'Lokale modus: gegevens staan in deze browser' : 'Gegevens staan in de gedeelde database'}</span>
          </div>
        </footer>
      </div>
      {menu && <Zoeken open={zoek} onSluit={() => setZoek(false)} />}
    </div>
  );
}

function groepenVan(mod: Module, rol: string): Groep[] {
  if (mod === 'nbd') return rol === 'medewerker' ? NBD_MEDEWERKER : NBD_GROEPEN;
  return GROEPEN;
}

function useTellers(mod: Module) {
  const s = useSessie();
  // de tellers gaan over de module waar je in werkt: de regio's of de nabestaandendesk
  const regios = mod === 'nbd' ? [NBD] : s.regios;
  const verlof = useApp((x) => {
    // de regiomanager besluit over verlof (§ 4.1, § 5.1); voor planner en beheerder is er niets te doen
    if (s.isPlanner) return s.mag('verlof.besluiten') ? x.verlof.filter((v) => v.status === 'aangevraagd' && !inLopendeRonde(v, x.vakantierondes) && regios.includes(v.regio)).length : 0;
    // medewerker: een open voorkeurenronde die nog niet is ingediend
    const ik = x.medewerkers.find((m) => m.id === s.medewerkerId);
    return ik ? x.rondes.filter((r) => r.regio === ik.regio && r.status === 'open' && !r.ingediend[ik.id]).length : 0;
  });
  const ruil = useApp((x) =>
    s.isPlanner
      ? x.ruil.filter((r) => r.status === 'wacht_planner' && regios.includes(r.regio) && (r.soort !== 'verlof' || s.mag('verlof.besluiten'))).length
      : x.ruil.filter((r) => r.status === 'open' && r.aanbiederId !== s.medewerkerId && (r.soort === 'aanbieden' ? x.medewerkers.find((m) => m.id === s.medewerkerId)?.regio === r.regio : r.ontvangerId === s.medewerkerId)).length,
  );
  // bijsturen: ziekmeldingen die nog niet zijn opgevangen
  const bijsturen = useApp((x) => (s.isPlanner ? x.ziekmeldingen.filter((z) => z.status === 'ziek' && regios.includes(z.regio)).length : 0));
  // roosters die op goedkeuring wachten, voor de regiomanager
  const goedkeuring = useApp((x) => (s.mag('rooster.goedkeuren') ? Object.values(x.goedkeuringen).flatMap((per) => Object.values(per)).filter((g) => g.status === 'ter_goedkeuring' && !!g.advies && regios.includes(g.regio)).length : 0));
  return { verlof, ruil, bijsturen, goedkeuring } as Record<Teller, number>;
}

const LANDELIJK = 'landelijk';

function Zijbalk({ smal, open, onSluit, onSmal, onZoek, toonNav }: { smal: boolean; open: boolean; onSluit: () => void; onSmal: () => void; onZoek: () => void; toonNav: boolean }) {
  const s = useSessie();
  const pad = usePathname();
  const router = useRouter();
  const mod = useModule();
  const tellers = useTellers(mod);
  const mijnRegios = REGIONS.filter((r) => s.regios.includes(r));
  const [werk, zetWerk] = useWerkregio(mijnRegios);
  // de regiomanager kiest tussen het cluster van de werkregio en het hele land (het dashboard volgt die keuze)
  const landelijkKeuze = s.rol === 'regiomanager' && new Set(mijnRegios.map((r) => REGION_CLUSTER[r])).size > 1;
  const landelijk = useLandelijk() && landelijkKeuze;
  const groepen = groepenVan(mod, s.rol).map((g) => ({ ...g, items: g.items.filter((i) => i.rollen.includes(s.rol)) })).filter((g) => g.items.length);
  // wie bij de regio's en de NBD werkt, wisselt hier van module
  const wissel = s.isPlanner && s.nbd && mijnRegios.length > 0;

  const kiesRegio = (r: string) => {
    if (r === LANDELIJK) { zetLandelijk(true); return; }
    zetLandelijk(false);
    zetWerk(r);
    // op een pagina met de regio in het adres meteen meegaan (de rest van het adres blijft staan)
    if (['/rooster', '/bijsturen', '/team', '/jaarplanning', '/capaciteit'].includes(pad)) {
      const q = new URLSearchParams(window.location.search);
      q.set('regio', r);
      q.delete('mw');
      router.replace(`${pad}?${q}`);
    }
  };

  return (
    <aside
      className={cx(
        'zijbalk geen-print fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col transition-transform lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:translate-x-0',
        // de nabestaandendesk is een eigen omgeving, met een eigen kleur
        mod === 'nbd' && 'nbd',
        open ? 'translate-x-0' : '-translate-x-full',
        smal ? 'lg:w-[76px]' : 'lg:w-[264px]',
      )}
      aria-label="Navigatie"
    >
      <div className={cx('flex items-center gap-2 px-5 pb-3 pt-5', smal && 'lg:justify-center lg:px-2')}>
        <Link href={mod === 'nbd' && s.isPlanner ? '/nbd' : '/'} className={cx('merk flex items-center gap-2.5', mod === 'nbd' && 'text-[18px]')} aria-label={mod === 'nbd' ? 'GRIP Nabestaandendesk' : 'GRIP Regelplekken'}>
          <Beeldmerk />
          <span className={cx(smal && 'lg:hidden')}>GRIP <em>{mod === 'nbd' ? 'Nabestaandendesk' : 'Regelplekken'}</em></span>
        </Link>
        <button type="button" className="ml-auto rounded-md p-1.5 text-white/70 hover:bg-white/10 lg:hidden" onClick={onSluit} aria-label="Menu sluiten"><X size={20} /></button>
      </div>
      <Status smal={smal} nbd={mod === 'nbd'} />

      {toonNav && (
        <>
          <div className={cx('px-4 pb-2 pt-1', smal && 'lg:px-3')}>
            <button type="button" onClick={onZoek} className={cx('zoekknop', smal && 'lg:justify-center lg:px-0')} aria-label="Zoeken (Ctrl+K)">
              <Search size={16} />
              <span className={cx('flex-1 text-left', smal && 'lg:hidden')}>Zoeken</span>
              <kbd className={cx(smal && 'lg:hidden')}>Ctrl K</kbd>
            </button>
          </div>
          {wissel && (
            <div className={cx('mx-4 mb-1 mt-1', smal && 'lg:mx-2')} role="group" aria-label="Module">
              <div className="module-wissel">
                <Link href="/dashboard" aria-current={mod === 'regios' ? 'true' : undefined} title="Regio's: regelplekken, voorspelling en roosters per regio">
                  <MapPin size={14} /><span className={cx(smal && 'lg:hidden')}>Regio&apos;s</span>
                </Link>
                <Link href="/nbd" aria-current={mod === 'nbd' ? 'true' : undefined} title={`${NBD_NAAM}: landelijk, open van 7:00 tot 22:30`}>
                  <Headset size={14} /><span className={cx(smal && 'lg:hidden')}>NBD</span>
                </Link>
              </div>
            </div>
          )}
          {mod === 'nbd' && !smal && (
            <div className="mx-4 mb-1 mt-2 rounded-lg bg-white/[0.06] px-3 py-2 text-[12.5px] text-white/75">
              <div className="font-semibold text-white/90">{NBD_NAAM}</div>
              <div>Landelijk · elke dag open van 7:00 tot 22:30</div>
            </div>
          )}
          {mod === 'regios' && s.isPlanner && mijnRegios.length > 1 && !smal && (
            <label className="mx-4 mb-1 mt-1 block">
              <span className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-white/55"><MapPin size={12} /> Werkregio</span>
              <select className="zijbalk-select" value={landelijk ? LANDELIJK : werk} onChange={(e) => kiesRegio(e.target.value)}>
                {landelijkKeuze && <option value={LANDELIJK}>Landelijk</option>}
                {Object.entries(CLUSTER_NAAM).map(([c, naam]) => {
                  const rs = mijnRegios.filter((r) => REGION_CLUSTER[r] === c);
                  return rs.length ? <optgroup key={c} label={`Cluster ${naam}`}>{rs.map((r) => <option key={r} value={r}>{r}</option>)}</optgroup> : null;
                })}
              </select>
            </label>
          )}
          <nav className="no-scrollbar mt-2 flex-1 overflow-y-auto px-3 pb-4" aria-label="Onderdelen">
            {groepen.map((g) => (
              <div key={g.titel} className="mb-3">
                <div className={cx('nav-groep', smal && 'lg:sr-only')}>{g.titel}</div>
                <ul className="grid gap-0.5">
                  {g.items.map((i) => {
                    const n = i.teller ? tellers[i.teller] : 0;
                    // het overzicht van de NBD (/nbd) is alleen actief op zichzelf, niet op de pagina's eronder
                    const actief = pad === i.href || (i.href !== '/nbd' && pad.startsWith(`${i.href}/`));
                    return (
                      <li key={i.href}>
                        <Link href={i.href} className={cx('nav-item', smal && 'lg:justify-center lg:px-0')} aria-current={actief ? 'page' : undefined} title={smal ? i.label : undefined}>
                          <span className="relative shrink-0">{i.icoon}{n > 0 && smal && <i className="nav-stip lg:block" aria-hidden />}</span>
                          <span className={cx('flex-1 truncate', smal && 'lg:hidden')}>{i.label}</span>
                          {n > 0 && <span className={cx('tel', smal && 'lg:hidden')} aria-label={`${n} open`}>{n}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </>
      )}
      {!toonNav && <div className="flex-1" />}

      <div className="border-t border-white/10 p-3">
        <Gebruikersmenu smal={smal} />
        <button type="button" onClick={onSmal} className="mt-1 hidden w-full items-center gap-2 rounded-md px-3 py-2 text-[13px] text-white/60 hover:bg-white/10 hover:text-white lg:flex" aria-label={smal ? 'Zijbalk uitklappen' : 'Zijbalk inklappen'}>
          {smal ? <PanelLeftOpen size={17} className="mx-auto" /> : <><PanelLeftClose size={17} /> Inklappen</>}
        </button>
      </div>
    </aside>
  );
}

/** Beeldmerk: drie regelplekken die samen een dag vormen. */
function Beeldmerk() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="#007DA4" />
      <rect x="7" y="8" width="5" height="16" rx="1.5" fill="#ffffff" />
      <rect x="13.5" y="12" width="5" height="12" rx="1.5" fill="#ffffff" opacity="0.8" />
      <rect x="20" y="15" width="5" height="9" rx="1.5" fill="#9fd9ec" />
    </svg>
  );
}

function Status({ smal, nbd }: { smal: boolean; nbd: boolean }) {
  const s = useSessie();
  // bij de nabestaandendesk: de gesprekken van vandaag, niet de meldingen van de regio's
  const vandaag = useNbdVandaag(nbd && s.isPlanner);
  const demo = useApp((x) => x.demo);
  const meldingen = useApp((x) => x.meldingen);
  const laatste = useApp((x) => x.runs[0]);
  const taak = useTaak();
  const actie = useActie();
  const eind = meldingen ? meldingenEind(meldingen) : null;
  const opslag = useOpslagwijze();
  const modus = `${opslag === 'test' ? 'Test · ' : ''}${demo ? 'Demodata' : eind ? `Eigen data t/m ${fmtD(eind)}` : opslag === 'database' ? 'Gedeelde database' : 'Geen data'}`;
  if (smal) {
    return (
      <div className="hidden justify-center pb-2 lg:flex" title={`${modus}${laatste ? ` · laatste voorspelling ${fmtMoment(`${laatste.uitgegeven}T${laatste.gemaakt.slice(11, 16)}`)}` : ''}`}>
        {taak ? <Spinner className="h-4 w-4 text-white" /> : <i className={cx('live-dot', demo && 'demo')} />}
      </div>
    );
  }
  return (
    <div className="mx-4 mb-3 rounded-lg bg-white/[0.06] px-3 py-2.5 text-[12.5px] text-white/75">
      <div className="flex items-center gap-2 font-semibold text-white/90"><i className={cx('live-dot', demo && 'demo')} /> {modus}</div>
      {vandaag && !taak && <div className="mt-1">Vandaag <b className="text-white">{nlInt(vandaag.gesprekken)}</b> gesprekken verwacht</div>}
      {taak ? (
        <div className="mt-1 flex items-center gap-2" role="status"><Spinner className="h-3.5 w-3.5" /> {taak.naam}{taak.stap ? `: ${taak.stap}` : ''}</div>
      ) : s.isPlanner && laatste ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span>{nbd ? 'Overlijdens voorspeld' : 'Voorspelling'} {fmtMoment(`${laatste.uitgegeven}T${laatste.gemaakt.slice(11, 16)}`)}</span>
          {meldingen && (opslag !== 'database' || s.echt.rol === 'beheerder') && (
            <button
              type="button"
              className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
              title="Bronnen verversen en opnieuw voorspellen"
              aria-label="Bronnen verversen"
              disabled={!!taak}
              onClick={() => actie(() => verversBronnen(), (r) => r.fout ? `Bronnen ververst: ${r.ok} gelukt, ${r.fout} niet bereikbaar. Nieuwe voorspelling gemaakt.` : 'Bronnen ververst en nieuwe voorspelling gemaakt.')}
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MobieleBalk({ onOpen, onZoek }: { onOpen: () => void; onZoek: () => void }) {
  const s = useSessie();
  const pad = usePathname();
  const mod = useModule();
  const titel = [...NBD_GROEPEN, ...GROEPEN].flatMap((g) => g.items).find((i) => pad === i.href || (i.href !== '/nbd' && pad.startsWith(`${i.href}/`)))?.label;
  return (
    <header className={cx('zijbalk geen-print sticky top-0 z-30 flex items-center gap-2 px-3 py-2.5 lg:hidden', mod === 'nbd' && 'nbd')}>
      <button type="button" className="rounded-md p-2 text-white hover:bg-white/10" onClick={onOpen} aria-label="Menu openen"><Menu size={22} /></button>
      <Link href={mod === 'nbd' && s.isPlanner ? '/nbd' : '/'} className="merk flex items-center gap-2 text-[19px]"><Beeldmerk /><span className="truncate">{titel ? (mod === 'nbd' ? `${titel} NBD` : titel) : <>GRIP <em>{mod === 'nbd' ? 'NBD' : 'Regelplekken'}</em></>}</span></Link>
      <div className="flex-1" />
      <button type="button" className="rounded-md p-2 text-white/80 hover:bg-white/10" onClick={onZoek} aria-label="Zoeken"><Search size={20} /></button>
      <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-white" title={s.naam}><UserRound size={16} /></span>
    </header>
  );
}

function Voorvertoning() {
  const s = useSessie();
  return (
    <div className="geen-print text-[13.5px] font-semibold" style={{ background: '#f3d68a', color: '#1b2a33' }}>
      <div className="mx-auto flex max-w-app items-center gap-2 px-4 py-1.5 sm:px-6 lg:px-8">
        <Eye size={15} className="shrink-0" /> <span className="min-w-0 truncate">Je bekijkt de app als {ROL_LABEL[s.rol].toLowerCase()}{s.rol === 'medewerker' && s.naam ? ` (${s.naam})` : ''}.</span>
        <button type="button" className="ml-auto shrink-0 underline" onClick={() => s.bekijkAls(s.echt.rol)}>Terug naar {ROL_LABEL[s.echt.rol].toLowerCase()}</button>
      </div>
    </div>
  );
}

type Thema = 'systeem' | 'light' | 'dark';

function Gebruikersmenu({ smal }: { smal: boolean }) {
  const s = useSessie();
  const medewerkers = useApp((x) => x.medewerkers);
  const [open, setOpen] = useState(false);
  const [thema, setThema] = useState<Thema>('systeem');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setThema((localStorage.getItem('grip-thema') as Thema) || 'systeem'); } catch { /* geen opslag */ }
  }, []);
  useEffect(() => {
    const klik = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', klik);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', klik); document.removeEventListener('keydown', esc); };
  }, []);

  const zetThema = (t: Thema) => {
    setThema(t);
    try {
      if (t === 'systeem') { localStorage.removeItem('grip-thema'); delete document.documentElement.dataset.theme; }
      else { localStorage.setItem('grip-thema', t); document.documentElement.dataset.theme = t; }
    } catch { /* geen opslag */ }
  };

  const uitloggen = async () => {
    await vergeetTest();
    vergeetSessieKeuzes();
    await afmelden();
  };

  const keuzeMedewerkers = medewerkers.filter((m) => m.actief && !m.extern && s.werkregios.includes(m.regio)).sort((a, b) => a.regio.localeCompare(b.regio) || a.naam.localeCompare(b.naam));

  return (
    <div className="relative" ref={ref}>
      <button type="button" className={cx('flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-white/90 hover:bg-white/10', smal && 'lg:justify-center lg:px-0')} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" title={smal ? s.naam : undefined}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#007DA4] text-white"><UserRound size={16} /></span>
        <span className={cx('min-w-0 flex-1', smal && 'lg:hidden')}>
          <span className="block truncate text-[13.5px] font-semibold">{s.naam}</span>
          <span className="block truncate text-[12px] text-white/60">{ROL_LABEL[s.rol]}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className={cx('absolute bottom-[calc(100%+8px)] z-50 w-[300px] rounded-xl border border-line bg-card p-4 text-ink shadow-card', smal ? 'left-0 lg:left-[calc(100%+8px)] lg:bottom-0' : 'left-0')}>
          <div className="font-semibold">{s.echt.naam}</div>
          <div className="note">{ROL_LABEL[s.echt.rol]}{s.echt.email ? ` · ${s.echt.email}` : ''}{s.echt.regios ? ` · ${s.echt.regios.length} regio's` : ''}</div>

          {s.wisselRollen.length > 0 && (
            <div className="mt-4 grid gap-2">
              <div className="text-sm font-semibold text-muted">Bekijk als</div>
              <div role="radiogroup" aria-label="Bekijk als" className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-card p-0.5">
                {s.wisselRollen.map((r: Rol) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={s.rol === r}
                    onClick={() => s.bekijkAls(r, r === 'medewerker' ? s.medewerkerId ?? keuzeMedewerkers[0]?.id : null)}
                    className={cx('rounded-md px-2 py-1.5 text-[13.5px] font-semibold transition-colors', s.rol === r ? 'bg-[color:var(--navy)] text-white' : 'text-muted hover:text-ink')}
                  >
                    {ROL_LABEL[r]}
                  </button>
                ))}
              </div>
              {s.rol === 'medewerker' && (
                <select className="input" value={s.medewerkerId ?? ''} onChange={(e) => s.bekijkAls('medewerker', e.target.value)} aria-label="Medewerker">
                  {keuzeMedewerkers.map((m) => <option key={m.id} value={m.id}>{m.naam} · {m.regio}</option>)}
                </select>
              )}
            </div>
          )}

          <div className="mt-4 grid gap-2">
            <div className="text-sm font-semibold text-muted">Weergave</div>
            <Segment label="Thema" waarde={thema} onChange={zetThema} opties={[['systeem', <span key="s" className="inline-flex items-center gap-1"><Monitor size={14} />Auto</span>], ['light', <span key="l" className="inline-flex items-center gap-1"><Sun size={14} />Licht</span>], ['dark', <span key="d" className="inline-flex items-center gap-1"><Moon size={14} />Donker</span>]]} />
          </div>

          <div className="note mt-4 flex items-center gap-1.5"><CalendarCheck size={14} /> Sneltoets: Ctrl+K of / om te zoeken</div>

          {s.echt.modus !== 'lokaal' && (
            <button type="button" className="btn btn-ghost mt-4 w-full" onClick={uitloggen}><LogOut size={16} /> Uitloggen</button>
          )}
        </div>
      )}
    </div>
  );
}
