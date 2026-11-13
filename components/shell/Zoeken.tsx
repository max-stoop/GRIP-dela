'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, MapPin, User as UserRound, BookOpen, Zap, Headset } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { GROEPEN, NBD_GROEPEN, NBD_MEDEWERKER, useModule } from '@/components/shell/navigatie';
import { useApp } from '@/lib/store/store';
import { REGIONS } from '@/lib/model/config';
import { BELEID } from '@/lib/beleid/tekst';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { zetWerkregio } from '@/lib/werkregio';
import { cx } from '@/lib/format';

interface Resultaat {
  sleutel: string;
  groep: string;
  titel: string;
  sub?: string;
  icoon: ReactNode;
  href: string;
  regio?: string;
  zoek: string;
}

/** Zonder accenten en hoofdletters, zodat "continuiteit" ook "Continuïteit" vindt. */
const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Zoeken in pagina's, regio's, medewerkers, acties en het roosterbeleid. Ctrl+K of /. */
export function Zoeken({ open, onSluit }: { open: boolean; onSluit: () => void }) {
  const s = useSessie();
  const router = useRouter();
  const medewerkers = useApp((x) => x.medewerkers);
  const mod = useModule();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const invoer = useRef<HTMLInputElement>(null);
  const lijst = useRef<HTMLUListElement>(null);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => invoer.current?.focus(), 0); } }, [open]);

  const alles = useMemo<Resultaat[]>(() => {
    const out: Resultaat[] = [];
    // de pagina's van de regio's, en (wie bij de NBD mag) die van de nabestaandendesk als eigen groep
    const eigen = s.rol === 'medewerker' ? (mod === 'nbd' ? NBD_MEDEWERKER : GROEPEN) : s.regios.length ? GROEPEN : [];
    for (const g of eigen) for (const i of g.items) if (i.rollen.includes(s.rol)) out.push({ sleutel: `p${i.href}`, groep: "Pagina's", titel: i.label, icoon: i.icoon, href: i.href, zoek: norm(`${i.label} ${g.titel}`) });
    if (s.nbd && s.isPlanner) for (const g of NBD_GROEPEN) for (const i of g.items) if (i.rollen.includes(s.rol) && i.href.startsWith('/nbd')) out.push({ sleutel: `n${i.href}`, groep: NBD_NAAM, titel: `${i.label} NBD`, icoon: i.icoon, href: i.href, zoek: norm(`${i.label} nbd ${NBD_NAAM}`) });
    const acties: [string, string, string, boolean][] = [
      ['Ziekmelding doen', 'Bijsturen', '/bijsturen?ziek=1', s.isPlanner],
      ['Rooster maken', 'Rooster', '/rooster?plan=1', s.isPlanner],
      ['Verlofruimte per week', 'Jaarplanning verlof', '/jaarplanning#ruimte', s.isPlanner],
      ['Verlof plannen in het jaar', 'Jaarplanning verlof', '/jaarplanning', true],
      ['Vakantieronde', 'Verlof en voorkeuren', '/verlof?tab=vakantie', s.isPlanner],
      ['Voorkeurenronde openen', 'Verlof en voorkeuren', '/verlof?tab=voorkeuren', s.isPlanner],
      ['Verlof aanvragen', 'Verlof en voorkeuren', '/verlof', !s.isPlanner],
      ['Verlof ruilen', 'Ruilen', '/ruilen?tab=verlof', !s.isPlanner],
      ['Vastgestelde regelplekken aanpassen', 'Instellingen', '/instellingen#normen', s.isBeheerder],
    ];
    for (const [titel, sub, href, mag] of acties) if (mag) out.push({ sleutel: `a${href}${titel}`, groep: 'Acties', titel, sub, icoon: <Zap size={16} />, href, zoek: norm(`${titel} ${sub}`) });
    if (s.isPlanner) {
      for (const r of REGIONS.filter((x) => s.regios.includes(x))) {
        out.push({ sleutel: `r${r}`, groep: "Regio's", titel: `Rooster ${r}`, icoon: <MapPin size={16} />, href: `/rooster?regio=${encodeURIComponent(r)}`, regio: r, zoek: norm(`rooster ${r}`) });
        out.push({ sleutel: `b${r}`, groep: "Regio's", titel: `Bijsturen ${r}`, icoon: <MapPin size={16} />, href: `/bijsturen?regio=${encodeURIComponent(r)}`, regio: r, zoek: norm(`bijsturen ${r}`) });
      }
      if (s.nbd) out.push({ sleutel: 'aNBDplan', groep: 'Acties', titel: 'Rooster NBD maken', sub: NBD_NAAM, icoon: <Headset size={16} />, href: '/nbd/rooster?plan=1', zoek: norm(`rooster maken nbd ${NBD_NAAM}`) });
      for (const m of medewerkers) {
        if (!m.actief || !s.werkregios.includes(m.regio)) continue;
        const nbd = m.regio === NBD;
        out.push({ sleutel: `m${m.id}`, groep: 'Medewerkers', titel: m.naam, sub: `${nbd ? NBD_NAAM : m.regio}${m.extern ? ' · extern' : !nbd && m.functie === 'UL' ? ' · uitvaartleider' : ''} · ${m.contract} uur`, icoon: nbd ? <Headset size={16} /> : <UserRound size={16} />, href: nbd ? `/nbd/team?mw=${m.id}` : `/team?regio=${encodeURIComponent(m.regio)}&mw=${m.id}`, regio: nbd ? undefined : m.regio, zoek: norm(`${m.naam} ${nbd ? `nbd ${NBD_NAAM}` : m.regio}`) });
      }
    }
    // het roosterbeleid hoort bij de regio's
    if (s.rol !== 'medewerker' ? s.regios.length > 0 : mod === 'regios') for (const h of BELEID) for (const p of h.paragrafen) {
      out.push({ sleutel: `§${p.id}`, groep: 'Roosterbeleid', titel: `§ ${p.id} ${p.titel}`, sub: h.titel, icoon: <BookOpen size={16} />, href: `/beleid#p-${p.id}`, zoek: norm(`${p.id} ${p.titel} ${h.titel} ${JSON.stringify(p.blokken).slice(0, 2000)}`) });
    }
    return out;
  }, [s.rol, s.isPlanner, s.isBeheerder, s.regios, s.nbd, s.werkregios, medewerkers, mod]);

  const resultaten = useMemo(() => {
    const woorden = norm(q).split(/\s+/).filter(Boolean);
    if (!woorden.length) return alles.filter((r) => r.groep === "Pagina's" || r.groep === 'Acties');
    const score = (r: Resultaat) => {
      const t = norm(r.titel);
      return woorden.every((w) => r.zoek.includes(w)) ? (t.startsWith(woorden[0]) ? 0 : t.includes(woorden[0]) ? 1 : 2) : -1;
    };
    return alles.map((r) => [r, score(r)] as const).filter(([, sc]) => sc >= 0).sort((a, b) => a[1] - b[1]).slice(0, 40).map(([r]) => r);
  }, [q, alles]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { lijst.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  if (!open) return null;
  const kies = (r: Resultaat | undefined) => {
    if (!r) return;
    if (r.regio) zetWerkregio(r.regio);
    onSluit();
    router.push(r.href);
  };
  const toets = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(resultaten.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); kies(resultaten[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onSluit(); }
  };

  let vorige = '';
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgb(6_24_36/0.5)] px-3 pt-[10vh]" onMouseDown={onSluit} role="presentation">
      <div className="w-full max-w-[620px] overflow-hidden rounded-xl border border-line bg-card text-ink shadow-card" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Zoeken">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="shrink-0 text-muted" />
          <input
            ref={invoer}
            className="h-14 w-full bg-transparent text-[16px] outline-none"
            placeholder="Zoek een pagina, regio, medewerker of regel uit het beleid"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={toets}
            role="combobox"
            aria-expanded="true"
            aria-controls="zoek-resultaten"
            aria-activedescendant={resultaten[sel] ? `zoek-${sel}` : undefined}
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
        </div>
        <ul ref={lijst} id="zoek-resultaten" role="listbox" className="max-h-[56vh] overflow-y-auto py-2">
          {resultaten.length === 0 && <li className="px-4 py-6 text-center text-muted">Niets gevonden voor “{q}”.</li>}
          {resultaten.map((r, i) => {
            const kop = r.groep !== vorige ? r.groep : null;
            vorige = r.groep;
            return (
              <li key={r.sleutel} role="presentation">
                {kop && <div className="px-4 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">{kop}</div>}
                <div
                  id={`zoek-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === sel}
                  className={cx('mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2', i === sel ? 'bg-primary text-white' : 'hover:bg-soft')}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => kies(r)}
                >
                  <span className={cx('shrink-0', i === sel ? 'text-white' : 'text-accent')}>{r.icoon}</span>
                  <span className="min-w-0 flex-1 truncate">{r.titel}{r.sub && <span className={cx('ml-2 text-[13px]', i === sel ? 'text-white/80' : 'text-muted')}>{r.sub}</span>}</span>
                  {i === sel && <CornerDownLeft size={15} className="shrink-0 text-white/80" />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[12px] text-muted"><span>↑↓ kiezen</span><span>Enter openen</span><span>Esc sluiten</span></div>
      </div>
    </div>
  );
}
