'use client';
import { useCallback, useEffect, useState } from 'react';
import { Mail, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { useToast } from '@/components/toast';
import { Leeg, Modal, Pill, Sectie, Spinner, Veld } from '@/components/ui';
import { REGIONS } from '@/lib/model/config';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { heeftAlleRegios, ROL_LABEL, type Rol } from '@/lib/store/types';
import type { Gebruiker, GebruikerInvoer } from '@/lib/gebruikers';
import type { Uitnodiging } from '@/lib/auth/uitnodigen';
import { useOpslagwijze } from '@/lib/store/store';
import { gastenUitnodigen } from '@/lib/platform';

const ROLLEN: Rol[] = ['planner', 'regiomanager', 'medewerker', 'beheerder'];

/** Een planner en de beheerder: altijd alles. Bij de andere rollen is leeg geen enkele regio (dan geen toegang). */
function regioTekst(regios: string[], rol: Rol) {
  if (heeftAlleRegios(rol)) return <span className="note">alle, ook NBD</span>;
  if (!regios.length) return <span className="text-rood">geen regio&apos;s: geen toegang</span>;
  if (REGIONS.every((r) => regios.includes(r))) return <>alle regio&apos;s{regios.includes(NBD) ? ' en NBD' : <span className="note"> (zonder NBD)</span>}</>;
  return regios.join(', ');
}

async function api<T>(pad: string, init?: RequestInit): Promise<T> {
  const r = await fetch(pad, { ...init, headers: { 'content-type': 'application/json' } });
  const js = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(js.fout ?? `Fout ${r.status}`);
  return js as T;
}

/** Een planner en de beheerder hebben altijd alle regio's. */
export function GebruikersBeheer() {
  const s = useSessie();
  const toon = useToast();
  const [lijst, setLijst] = useState<Gebruiker[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bewerk, setBewerk] = useState<Gebruiker | 'nieuw' | null>(null);
  const [weg, setWeg] = useState<Gebruiker | null>(null);
  const opslag = useOpslagwijze();
  const database = opslag === 'database';

  const laad = useCallback(async () => {
    try { setLijst((await api<{ gebruikers: Gebruiker[] }>('/api/gebruikers')).gebruikers); setFout(null); } catch (e) { setFout((e as Error).message); }
  }, []);
  useEffect(() => { if (database) void laad(); }, [database, laad]);

  const titel = <span className="flex items-center gap-2"><Users size={22} className="text-accent" /> Gebruikers</span>;
  if (!database) {
    return (
      <Sectie titel={titel} lead="Wie mag inloggen, met welke rol en voor welke regio's.">
        <p className="note">{opslag === 'test' ? 'In de testomgeving beheer je geen gebruikers. Ga terug naar echt om gebruikers toe te voegen of te wijzigen.' : 'In deze omgeving logt niemand in, dus er zijn geen gebruikers om te beheren.'}</p>
      </Sectie>
    );
  }

  return (
    <Sectie titel={titel} lead={`Wie mag inloggen, met welke rol en voor welke regio's. Iedereen logt in met het werkaccount; het e-mailadres hier moet daarmee overeenkomen.${gastenUitnodigen() ? ' Wie je toevoegt, krijgt van Microsoft een uitnodiging per e-mail.' : ''}`}
      rechts={<button type="button" className="btn" onClick={() => setBewerk('nieuw')}><Plus size={16} /> Gebruiker toevoegen</button>}>
      {fout ? <div className="banner banner-err" role="alert">{fout}</div>
        : !lijst ? <div className="flex items-center gap-2 text-muted"><Spinner /> Gebruikers ophalen…</div>
        : !lijst.length ? <Leeg titel="Nog geen gebruikers" />
        : (
          <div className="scroll">
            <table className="tb">
              <thead><tr><th>Naam</th><th>Rol</th><th>Regio&apos;s</th><th>Status</th><th /></tr></thead>
              <tbody>
                {lijst.map((g) => {
                  const ik = g.email.toLowerCase() === s.echt.email.toLowerCase();
                  return (
                    <tr key={g.id}>
                      <td><div className="font-semibold">{g.naam}{ik && <span className="note font-normal"> (jij)</span>}</div><div className="note">{g.email}</div></td>
                      <td>{ROL_LABEL[g.rol]}{g.profielRol !== '' && <div className="note">{g.profielRol}</div>}</td>
                      <td className="max-w-[260px]">{regioTekst(g.regios, g.rol)}</td>
                      <td>{g.gekoppeld ? <Pill soort="ok">heeft ingelogd</Pill> : <Pill soort="neutral">nog niet ingelogd</Pill>}</td>
                      <td className="r whitespace-nowrap">
                        {!ik && <>
                          {!g.gekoppeld && gastenUitnodigen() && <button type="button" className="btn btn-ghost btn-icon" title="Uitnodiging opnieuw sturen" aria-label={`Uitnodiging opnieuw sturen naar ${g.naam}`} onClick={async () => { try { const { uitnodiging } = await api<{ uitnodiging: Uitnodiging }>(`/api/gebruikers/${g.id}`, { method: 'POST' }); toon(uitnodiging.tekst.replace(/^Toegevoegd, maar /, ''), uitnodiging.gelukt ? undefined : 'fout'); } catch (e) { toon((e as Error).message, 'fout'); } }}><Mail size={15} /></button>}
                          <button type="button" className="btn btn-ghost btn-icon" title="Rol en regio's" aria-label={`Rol en regio's van ${g.naam}`} onClick={() => setBewerk(g)}><Pencil size={15} /></button>
                          <button type="button" className="btn btn-ghost btn-icon" title="Weghalen" aria-label={`${g.naam} weghalen`} onClick={() => setWeg(g)}><Trash2 size={15} /></button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {bewerk && <GebruikerModal g={bewerk === 'nieuw' ? null : bewerk} onClose={() => setBewerk(null)} onKlaar={(u) => { setBewerk(null); void laad(); toon(u ? u.tekst : 'Bewaard.', u && !u.gelukt ? 'fout' : undefined); }} />}
      <Modal open={!!weg} onClose={() => setWeg(null)} titel={`${weg?.naam ?? ''} weghalen`} voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => setWeg(null)}>Annuleren</button>
        <button type="button" className="btn btn-danger" onClick={async () => { try { await api(`/api/gebruikers/${weg!.id}`, { method: 'DELETE' }); toon(`${weg!.naam} kan niet meer inloggen.`); setWeg(null); void laad(); } catch (e) { toon((e as Error).message, 'fout'); } }}><Trash2 size={16} /> Weghalen</button>
      </>}>
        <p>{weg?.naam} ({weg?.email}) kan daarna niet meer inloggen. Het rooster en verlof van een medewerker blijven staan.</p>
      </Modal>
    </Sectie>
  );
}

function GebruikerModal({ g, onClose, onKlaar }: { g: Gebruiker | null; onClose: () => void; onKlaar: (uitnodiging?: Uitnodiging | null) => void }) {
  const [f, setF] = useState<GebruikerInvoer>(g ? { email: g.email, naam: g.naam, rol: g.rol, regios: g.regios } : { email: '', naam: '', rol: 'planner', regios: [] });
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  // alle regio's is een bewuste keuze: dan staan ze ook allemaal in de lijst. De NBD is een eigen module (eigen tab in
  // de app) en staat daarom apart, niet tussen de regio's
  const alle = REGIONS.every((r) => f.regios.includes(r));
  const metNbd = f.regios.includes(NBD);
  const landelijk = heeftAlleRegios(f.rol);
  const wissel = (r: string) => setF({ ...f, regios: f.regios.includes(r) ? f.regios.filter((x) => x !== r) : [...f.regios, r] });
  const kiesRol = (rol: Rol) => setF({ ...f, rol, regios: heeftAlleRegios(rol) ? [] : f.regios });
  const bewaar = async () => {
    setBezig(true);
    setFout(null);
    try {
      if (g) {
        await api(`/api/gebruikers/${g.id}`, { method: 'PATCH', body: JSON.stringify(f) });
        onKlaar();
      } else {
        const { uitnodiging } = await api<{ uitnodiging: Uitnodiging | null }>('/api/gebruikers', { method: 'POST', body: JSON.stringify(f) });
        onKlaar(uitnodiging);
      }
    } catch (e) { setFout((e as Error).message); setBezig(false); }
  };
  return (
    <Modal open onClose={onClose} breed titel={g ? `${g.naam}: rol en regio's` : 'Gebruiker toevoegen'} voet={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleren</button>
      <button type="button" className="btn" disabled={bezig} onClick={bewaar}>{bezig ? <Spinner /> : g ? 'Bewaren' : 'Toevoegen'}</button>
    </>}>
      <div className="grid gap-3.5">
        {!g && <div className="grid gap-3 sm:grid-cols-2">
          <Veld label="Naam"><input className="input" value={f.naam} onChange={(e) => setF({ ...f, naam: e.target.value })} autoFocus /></Veld>
          <Veld label="E-mailadres (werk)"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Veld>
        </div>}
        <Veld label="Rol">
          <select className="input" value={f.rol} onChange={(e) => kiesRol(e.target.value as Rol)}>
            {ROLLEN.map((r) => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}
          </select>
        </Veld>
        {landelijk ? (
          <div>
            <div className="mb-1 text-[14px] font-semibold">Regio&apos;s</div>
            <p className="text-[15px]">Alle regio&apos;s en de nabestaandendesk. {f.rol === 'planner' ? 'Een planner' : 'De beheerder'} werkt altijd landelijk.</p>
          </div>
        ) : (
          <fieldset>
            <legend className="mb-1.5 text-[14px] font-semibold">{f.rol === 'medewerker' ? 'Regio van de medewerker' : 'Regio\'s'}</legend>
            {f.rol !== 'medewerker' && <label className="mb-2 flex items-center gap-2 text-[15px]"><input type="checkbox" className="h-4 w-4" checked={alle} onChange={() => setF({ ...f, regios: alle ? (metNbd ? [NBD] : []) : [...REGIONS, ...(metNbd ? [NBD] : [])] })} /> Alle regio&apos;s</label>}
            {f.rol === 'regiomanager' && !f.regios.length && <p className="note mb-2">Kies minstens één regio, of de nabestaandendesk hieronder. Zonder heeft een regiomanager geen toegang.</p>}
            {(!alle || f.rol === 'medewerker') && <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {REGIONS.map((r) => <label key={r} className="flex items-center gap-2 text-[14px]"><input type="checkbox" className="h-4 w-4" checked={f.regios.includes(r)} onChange={() => wissel(r)} /> {r}</label>)}
            </div>}
          </fieldset>
        )}
        {!landelijk && (
          <fieldset>
            <legend className="mb-1.5 text-[14px] font-semibold">{NBD_NAAM}</legend>
            <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" className="h-4 w-4" checked={metNbd} onChange={() => wissel(NBD)} /> {f.rol === 'medewerker' ? 'Werkt bij de nabestaandendesk (NBD)' : 'Ook de nabestaandendesk (NBD)'}</label>
            <p className="note mt-1">De NBD is een eigen module, met een eigen tab in de app.</p>
          </fieldset>
        )}
        {fout && <div className="banner banner-err" role="alert">{fout}</div>}
      </div>
    </Modal>
  );
}
