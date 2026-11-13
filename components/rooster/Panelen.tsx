'use client';
import { useEffect, useState } from 'react';
import { Trash2, UserPlus, Save } from 'lucide-react';
import { Groep, Meter, Modal, Pill, Veld } from '@/components/ui';
import { fmtD, todayIso } from '@/lib/dates';
import Link from 'next/link';
import { nl, opsomming, pct } from '@/lib/format';
import type { Check, Toets } from '@/lib/rooster/toets';
import { WEEKEND_CADANS_NAAM, ZZP_IN_ROOSTER, weekendCadans, type Functie, type Medewerker } from '@/lib/rooster/types';
import { isNbd } from '@/lib/nbd/parameters';
import { useApp } from '@/lib/store/store';
import { groepOpties } from '@/lib/rooster/weekend';

export function ScorePaneel({ t, versieTekst, onAnalyse }: { t: Toets; versieTekst: string; onAnalyse?: () => void }) {
  const rij = (l: string, v: number, uitleg: string) => (
    <div className="grid grid-cols-[132px_1fr_30px] items-center gap-2 text-[13.5px]" title={uitleg}>
      <span>{l}</span><Meter waarde={v} kleur={v >= 0.75 ? 'var(--teal)' : v >= 0.6 ? 'var(--gold)' : 'var(--red)'} /><b className="num text-right">{Math.round(v * 100)}</b>
    </div>
  );
  const fmt = (items: string[]) => opsomming([...new Set(items)].slice(0, 6).map((x) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? fmtD(x) : x))) + (new Set(items).size > 6 ? ' en meer' : '');
  const groepen: Check['niveau'][] = ['ATW en CAO', 'Roosterbeleid', 'Teamafspraak'];
  const kl = t.pijlers.klant;
  return (
    <div className="grid gap-3">
      <div className="box-focus">
        <div className="flex items-end gap-4">
          <div className="display text-[64px] font-semibold leading-[0.9]">{nl(t.cijfer)}</div>
          <div className="pb-1">
            <span className="pill" style={{ background: 'rgb(255 255 255 / 0.14)', color: 'inherit' }}>{t.status[1]}</span>
            <div className="note mt-1.5">Getoetst tegen {versieTekst}</div>
          </div>
        </div>
      </div>
      <div className="box">
        <div className="grid gap-1.5">
          {rij('Continuïteit', t.sub.cont, 'Past het werk (kans dat alle meldingen passen) en houden we ons aan wet en beleid')}
          {rij('Efficiency', t.sub.eff, 'Binnen de normen: niet meer plekken of 1B dan afgesproken, geen uren boven contract')}
          {rij('Medewerkers', t.sub.mw, 'Wensen, vaste voorkeuren, ochtend/middag, uren, ritme en eerlijke verdeling')}
          {rij('Klanten', t.sub.klant, 'Verwacht aandeel meldingen dat binnen 24 uur geholpen is')}
        </div>
        {onAnalyse && <button type="button" className="mt-3 text-sm font-semibold text-accent hover:underline" onClick={onAnalyse}>Bekijk de volledige analyse</button>}
        <p className="note mt-2">
          {t.gepland} regelplekken gepland, {t.nodig} afgesproken.
          {kl.binnen24 != null ? ` Naar verwachting ${pct(kl.binnen24, 1)} van de klanten binnen 24 uur geholpen.` : ''}
          {t.wensen.totaal ? ` ${t.wensen.gehonoreerd} van ${t.wensen.totaal} wensen gehonoreerd.` : ''}
        </p>
        {groepen.map((g) => {
          const lijst = t.checks.filter((c) => c.niveau === g);
          if (!lijst.length) return null;
          return (
            <div key={g} className="mt-3">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">{g}</div>
              <table className="mt-1 w-full text-[13.5px]">
                <tbody>
                  {lijst.map((c) => {
                    const u = new Set(c.items).size;
                    return (
                      <tr key={c.id} className="border-t border-line">
                        <td className="py-1.5 pr-2 align-top">
                          {c.naam}
                          {c.paragraaf !== '—' && <Link href={`/beleid#p-${c.paragraaf}`} className="ml-1.5 text-[12px] text-accent no-underline hover:underline">§ {c.paragraaf}</Link>}
                          {u > 0 && <div className="text-[12px] text-muted">{fmt(c.items)}</div>}
                        </td>
                        <td className="py-1.5 text-right align-top">{u ? <Pill soort={c.niveau === 'ATW en CAO' ? 'bad' : 'warn'}>{u}</Pill> : <Pill soort="ok">ok</Pill>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type MedewerkerInvoer = Omit<Medewerker, 'id' | 'actief' | 'regio'> & { id?: string };

const LEEG: MedewerkerInvoer = { naam: '', contract: 32, voorkeur: 'O', weekendgroep: 0, weekendCadans: 2, functie: 'UV', afstandsverklaring: false, email: '' };

export function MedewerkerModal({ open, mw, regio, onClose, onBewaar, onVerwijder, nieuwExtern }: { open: boolean; mw: Medewerker | null; regio: string; onClose: () => void; onBewaar: (m: MedewerkerInvoer) => void; onVerwijder: (id: string) => void; nieuwExtern?: boolean }) {
  // wijzigingen altijd op de nieuwste staat (setF(x => ...)): wie meteen na het openen typt, wist anders de geladen gegevens
  const [f, setF] = useState<MedewerkerInvoer>(LEEG);
  const [weg, setWeg] = useState(false);
  // het contract als tekst, zodat je vrij kunt typen (28, 36, 24,5); geldig van 4 tot en met 40
  const [contractTekst, setContractTekst] = useState(String(LEEG.contract));
  const nbd = isNbd(regio);
  const cadans = weekendCadans(f);
  const extraInzet = useApp((x) => x.nbd.extraInzet);
  const profiel = useApp((x) => (mw ? x.profielen[mw.id] : undefined));
  const vandaag = todayIso();
  useEffect(() => {
    if (open) { setContractTekst(String(mw ? mw.contract : nieuwExtern ? 24 : LEEG.contract)); setF(mw ? { id: mw.id, naam: mw.naam, contract: mw.contract, ...(mw.maxUren != null ? { maxUren: mw.maxUren } : {}), voorkeur: mw.voorkeur, weekendgroep: mw.weekendgroep, weekendCadans: weekendCadans(mw), functie: mw.functie ?? 'UV', afstandsverklaring: !!mw.afstandsverklaring, extern: !!mw.extern, email: mw.email ?? '', postcode: mw.postcode ?? '' } : { ...LEEG, extern: !!nieuwExtern, contract: nieuwExtern ? 24 : LEEG.contract }); setWeg(false); }
  }, [open, mw?.id, nieuwExtern]); // eslint-disable-line react-hooks/exhaustive-deps
  // maximale inzet (NBD, variabel rooster): alleen als die boven het contract ligt
  const variabel = nbd && !f.extern && f.maxUren != null && f.maxUren > f.contract;
  return (
    <Modal
      open={open}
      onClose={onClose}
      titel={mw ? `${mw.naam} bewerken` : nieuwExtern ? `Externe kracht toevoegen aan ${regio}` : `Medewerker toevoegen aan ${regio}`}
      voet={
        <>
          {mw && (weg
            ? <button type="button" className="btn btn-danger mr-auto" onClick={() => onVerwijder(mw.id)}><Trash2 size={16} /> Ja, verwijderen</button>
            : <button type="button" className="btn btn-danger mr-auto" onClick={() => setWeg(true)}><Trash2 size={16} /> Verwijderen</button>)}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleren</button>
          <button type="submit" form="mw-form" className="btn" disabled={!f.naam.trim()}>{mw ? <Save size={16} /> : <UserPlus size={16} />} {mw ? 'Opslaan' : 'Toevoegen'}</button>
        </>
      }
    >
      <form id="mw-form" className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onBewaar({ ...f, naam: f.naam.trim(), email: f.email?.trim() || undefined, maxUren: variabel ? f.maxUren : undefined, postcode: nbd ? f.postcode || undefined : /^\s*([1-9]\d{3})/.exec(f.postcode ?? '')?.[1] }); }}>
        <Veld label="Naam" className="sm:col-span-2"><input className="input" required autoFocus value={f.naam} onChange={(e) => { const naam = e.target.value; setF((x) => ({ ...x, naam })); }} /></Veld>
        {!nbd && <Veld label="Functie" hint="Een uitvaartleider doet geen regelgesprekken, alleen Dg-diensten (DG1 of DG2).">
          <select className="input" value={f.functie ?? 'UV'} onChange={(e) => { const functie = e.target.value as Functie; setF((x) => ({ ...x, functie })); }}><option value="UV">Uitvaartverzorger</option><option value="UL">Uitvaartleider</option></select>
        </Veld>}
        <Veld label={f.extern ? 'Maximaal inzetbaar per week (uur)' : 'Contracturen per week'} hint="Van 4 tot en met 40 uur, ook halve uren.">
          <input className="input" type="number" inputMode="decimal" min={4} max={40} step={0.5} value={contractTekst} onChange={(e) => { setContractTekst(e.target.value); const v = Number(e.target.value.replace(',', '.')); if (Number.isFinite(v) && v >= 4 && v <= 40) setF((x) => ({ ...x, contract: v })); }} onBlur={() => setContractTekst(String(f.contract))} />
        </Veld>
        {nbd && !f.extern && (
          <Groep label="Maximale inzet per week (uur)" hint={`Bij een variabel rooster: meer uren dan het contract, bijvoorbeeld ${extraInzet} uur extra. Gelijk aan het contract: geen extra uren.`}>
            <span className="flex gap-2">
              <input className="input" type="number" aria-label="Maximale inzet per week (uur)" min={f.contract} max={60} step={0.5} value={variabel ? f.maxUren : f.contract} onChange={(e) => { const v = Number(e.target.value); setF((x) => ({ ...x, maxUren: Number.isFinite(v) && v > x.contract ? Math.min(60, v) : undefined })); }} />
              <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setF((x) => ({ ...x, maxUren: variabel ? undefined : Math.min(60, x.contract + extraInzet) }))}>{variabel ? 'Geen extra' : `+${extraInzet} uur`}</button>
            </span>
          </Groep>
        )}
        {!nbd && <Veld label="Voorkeur regeldienst">
          <select className="input" value={f.voorkeur} onChange={(e) => { const voorkeur = e.target.value as 'O' | 'M'; setF((x) => ({ ...x, voorkeur })); }}><option value="O">Ochtend (9–17)</option><option value="M">Middag (11–19)</option></select>
        </Veld>}
        {!nbd && <Veld label="Weekendcadans" hint="Hoe vaak iemand in het weekend werkt.">
          <select className="input" value={cadans} onChange={(e) => { const c = Number(e.target.value); setF((x) => ({ ...x, weekendCadans: c, weekendgroep: x.weekendgroep % c })); }}>
            {[1, 2, 3, 4].map((c) => <option key={c} value={c}>{WEEKEND_CADANS_NAAM[c]}</option>)}
          </select>
        </Veld>}
        {!nbd && cadans > 1 && <Veld label="Weekendgroep" hint={cadans === 2 ? 'Om het weekend: in de even of de oneven weken. Verdeel het team zo dat elk weekend ongeveer evenveel contracturen werkt (zie Team).' : `De groepen ${'ABCD'.slice(0, cadans).split('').join(', ')} werken om de beurt een weekend. Het voorstel plant alleen in de weekenden van de eigen groep.`}>
          <select className="input" value={f.weekendgroep % cadans} onChange={(e) => { const weekendgroep = Number(e.target.value); setF((x) => ({ ...x, weekendgroep })); }}>
            {groepOpties(cadans, vandaag).map((o) => <option key={o.groep} value={o.groep}>{o.naam}</option>)}
          </select>
        </Veld>}
        {!nbd && (profiel?.weekend || profiel?.weekendPlekken) && (
          <p className="note sm:col-span-2 m-0">
            Voorkeur van {mw?.naam.split(' ')[0]}: {[profiel.weekend && `${profiel.weekend} weekenden`, profiel.weekendPlekken && `${profiel.weekendPlekken} regelplekken per weekend${profiel.weekendPlekken === 3 ? ' (minder weekenden, bijvoorbeeld 1 op 3)' : ''}`].filter(Boolean).join(', ')}.
          </p>
        )}
        {!nbd && <Veld label="Woonplaats (postcode)" hint="4 cijfers is genoeg. Daar begint de reis naar het eerste gesprek bij het verdelen van de meldingen.">
          <input className="input" maxLength={7} autoComplete="off" placeholder="1234" pattern="\s*[1-9][0-9]{3}(\s?[A-Za-z]{2})?\s*" title="Een postcode: 1234 of 1234 AB" value={f.postcode ?? ''} onChange={(e) => { const postcode = e.target.value; setF((x) => ({ ...x, postcode })); }} />
        </Veld>}
        <Veld label="E-mailadres" hint="Koppelt het account van de medewerker aan deze regel.">
          <input className="input" type="email" value={f.email ?? ''} onChange={(e) => { const email = e.target.value; setF((x) => ({ ...x, email })); }} placeholder="naam@voorbeeld.nl" />
        </Veld>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={!!f.afstandsverklaring} onChange={(e) => { const afstandsverklaring = e.target.checked; setF((x) => ({ ...x, afstandsverklaring })); }} />
          <span>Afstandsverklaring getekend <span className="note block">De CAO-regel van minimaal 26 vrije weekenden per jaar geldt dan niet.</span></span>
        </label>
        {(ZZP_IN_ROOSTER || mw?.extern || nieuwExtern) && <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={!!f.extern} onChange={(e) => { const extern = e.target.checked; setF((x) => ({ ...x, extern })); }} />
          <span>Externe kracht of ZZP&apos;er <span className="note block">{nbd ? 'Telt mee in de bezetting, maar niet in de formatie. Rooster maken plant externen niet zelf in; dat doe je met de hand.' : 'Telt mee in de dekking, maar niet in de formatie en de medewerkertevredenheid. Rooster maken plant externen niet zelf in; dat doe je met de hand of via Bijsturen (§ 3.7, § 3.9).'}{ZZP_IN_ROOSTER ? '' : ' Externen staan voorlopig niet in het rooster.'}</span></span>
        </label>}
        {weg && mw && <p className="banner sm:col-span-2">Toekomstige diensten van {mw.naam} vervallen. De geschiedenis blijft bewaard.</p>}
      </form>
    </Modal>
  );
}
