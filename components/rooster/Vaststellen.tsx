'use client';
import { useState } from 'react';
import { Check, Send, X } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { AlleenRegiomanager, AlleenVoor } from '@/components/Rechten';
import { AdviesBlok, AdviesModal } from '@/components/rooster/Advies';
import { useActie } from '@/components/toast';
import { Modal, Pill, Veld } from '@/components/ui';
import { aangepastNaAdvies, beoordeelRooster, useOpslagwijze, vraagGoedkeuring } from '@/lib/store/store';
import type { Goedkeuring, Publicatie } from '@/lib/store/types';
import type { AdviesVoorstel } from '@/lib/rooster/advies';
import { addDays, fmtD, fmtMoment, todayIso } from '@/lib/dates';
import { cx, nl, plural } from '@/lib/format';
import { maandenTussen, maandNaam, maandStart, maandVan, publicatieVereistTot, volgendeMaand, type Maand } from '@/lib/rooster/maand';
import { VASTSTELLING, vaststellingVan } from '@/lib/rooster/vaststelling';
import type { MaandRegel } from '@/lib/store/overzicht';

const maandStatus = vaststellingVan;
const ADVIES_TEKST = { groen: 'text-teal', oranje: 'text-gold', rood: 'text-rood' } as const;

/** Elke maand gaat één keer langs planner en regiomanager; wat vastgesteld is, publiceer je daarna zonder nieuw advies. */
export function Vaststellen({ regio, maand, maanden, overzicht, onMaand, tot, t, advies: adviesInfo, pub, wijzigingen, goedkeuring, verplicht, publicatieMaanden, bewerkbaar, onPubliceer }: {
  regio: string; maand: Maand; maanden: Record<string, Goedkeuring> | undefined; onMaand: (m: Maand) => void;
  overzicht?: MaandRegel[];
  tot: string; t: { hard: number; cijfer: number };
  advies: { voorstel: AdviesVoorstel; samenvatting: string };
  pub: Publicatie | undefined; wijzigingen: number; goedkeuring: Goedkeuring | undefined;
  verplicht: boolean; publicatieMaanden: number; bewerkbaar: boolean; onPubliceer: (van: string, tot: string) => void;
}) {
  const s = useSessie();
  const door = useDoor();
  const actie = useActie();
  const vandaag = todayIso();
  const [afkeur, setAfkeur] = useState(false);
  const [tegenRood, setTegenRood] = useState(false);
  const [adviesOpen, setAdviesOpen] = useState(false);
  const [reden, setReden] = useState('');
  const g = goedkeuring;
  const status = maandStatus(g);
  const geldig = status === 'goed';
  const wacht = status === 'wacht';
  const advies = g && g.status !== 'afgekeurd' ? g.advies : undefined;
  // vier ogen (§ 5.1): wie het advies gaf, keurt niet zelf goed of af; de database bewaakt het op het werkaccount
  const zelfGeadviseerd = useOpslagwijze() === 'database' && wacht && !!advies && advies.door === door;
  // het cijfer bij het advies is wat de planner zag; de regiomanager ziet ook wat de toets nu zegt
  const anderCijfer = wacht && !!g && Math.abs(g.cijfer - t.cijfer) >= 0.05;
  const voorbij = tot < vandaag;
  // aangepast na het advies: geen nieuw advies nodig, de regiomanager ziet het wel
  const aangepast = wacht && aangepastNaAdvies(regio, maand);
  // publiceren sluit aan op wat al gepubliceerd is: geen gat, dus eventueel ook de maanden ervoor
  const aansluiting = pub && pub.tot >= vandaag ? addDays(pub.tot, 1) : vandaag;
  const pubVan = [maandStart(maand) < vandaag ? vandaag : maandStart(maand), aansluiting].sort()[0];
  const pubMaanden = maandenTussen(pubVan, tot);
  const nogOpen = verplicht ? pubMaanden.find((m) => maandStatus(maanden?.[m]) !== 'goed') : undefined;
  const kanPubliceren = bewerkbaar && s.mag('rooster.publiceren') && !voorbij && !nogOpen;
  const vereistTot = publicatieVereistTot(vandaag, publicatieMaanden);
  const Stap = ({ nr, klaar, titel, children }: { nr: number; klaar: boolean; titel: string; children: React.ReactNode }) => (
    <li className="flex gap-3">
      <span className={cx('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold', klaar ? 'bg-primary text-white' : 'bg-soft text-muted')}>{klaar ? <Check size={13} /> : nr}</span>
      <div className="min-w-0 flex-1"><div className="font-semibold">{titel}</div><div className="text-[14px]">{children}</div></div>
    </li>
  );
  const goedkeuren = () => (advies?.kleur === 'rood' ? (setTegenRood(true), setReden('')) : actie(() => beoordeelRooster(regio, maand, 'goedgekeurd', door), `Rooster ${maandNaam(maand)} goedgekeurd. Het kan nu worden gepubliceerd.`));
  const komend = [0, 1, 2, 3].map((i) => volgendeMaand(maandVan(vandaag), i));
  return (
    <div className="box">
      <h3 className="kop-s">Vaststellen en publiceren</h3>
      {verplicht && (
        <div className="mb-3 mt-2 grid grid-cols-2 gap-1.5" role="list" aria-label="Vaststelling per maand">
          {komend.map((m) => {
            const st = maandStatus(maanden?.[m]);
            const kleur = maanden?.[m]?.advies?.kleur;
            const regel = overzicht?.find((x) => x.maand === m);
            return (
              <button key={m} type="button" role="listitem" onClick={() => onMaand(m)} aria-current={m === maand ? 'true' : undefined}
                className={cx('rounded-lg border px-2.5 py-1.5 text-left text-[13px]', m === maand ? 'border-[color:var(--primary)] bg-soft' : 'border-line hover:border-[color:var(--accent)]')}>
                <span className="block font-semibold capitalize">{maandNaam(m, false)}</span>
                <span className="mt-0.5 inline-flex items-center gap-1.5">
                  {st === 'wacht' && kleur ? <i className={cx('advies-dot', kleur)} aria-hidden /> : <i className={cx('inline-block h-2 w-2 rounded-full', st === 'goed' ? 'bg-teal' : st === 'afgekeurd' ? 'bg-rood' : 'bg-line')} aria-hidden />}
                  <span className="note">{VASTSTELLING[st].kort}</span>
                </span>
                {regel && (
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    {regel.toets ? <>cijfer <b className="text-ink">{nl(regel.toets.cijfer)}</b></> : 'nog geen rooster'}
                    {regel.advies && st !== 'afgekeurd' ? <> · advies <span className={cx('font-semibold', ADVIES_TEKST[regel.advies])}>{regel.advies}</span></> : null}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <ol className="grid gap-3">
        <Stap nr={1} klaar={t.hard === 0} titel="Toetsen (planner)">
          {t.hard === 0 ? <>Cijfer {nl(t.cijfer)}, geen overtredingen van ATW of CAO.</> : <span className="text-rood">{plural(t.hard, 'overtreding', 'overtredingen')} van ATW of CAO. Los die eerst op.</span>}
        </Stap>
        {verplicht && (
          <Stap nr={2} klaar={!!advies} titel={`Advies (planner) · ${maandNaam(maand, false)}`}>
            {advies ? <AdviesBlok advies={advies} />
              : g?.status === 'afgekeurd' ? <span className="text-rood">Afgekeurd{g.reden ? `: ${g.reden}` : ''}. Pas het rooster aan en geef opnieuw een advies.</span>
              : <span className="note">Nog geen advies. Bij elk maandrooster is een advies van de planner verplicht: groen, oranje of rood.</span>}
            {aangepast && <span className="note mt-1 block">Na het advies is het rooster nog aangepast. Daarvoor is geen nieuw advies nodig; de regiomanager keurt goed wat er nu staat.</span>}
            {!geldig && !voorbij && (
              <div className="mt-2">
                {s.mag('rooster.advies')
                  ? <button type="button" className="btn btn-sm" disabled={t.hard > 0} onClick={() => setAdviesOpen(true)}><Send size={14} /> {wacht ? 'Advies wijzigen' : 'Advies geven en aanbieden'}</button>
                  : !wacht && <AlleenVoor rol="planner" wat="Het advies" />}
              </div>
            )}
          </Stap>
        )}
        <Stap nr={verplicht ? 3 : 2} klaar={geldig || !verplicht} titel="Goedkeuren (regiomanager)">
          {!verplicht ? <span className="note">Niet verplicht (Instellingen).</span>
            : geldig ? <>Vastgesteld{g!.beoordeelaar ? ` door ${g!.beoordeelaar}` : ''}{g!.reden ? `: ${g!.reden}` : ''}.</>
            : wacht ? <>Aangeboden {fmtMoment(g!.aangevraagd)} door {g!.door}, cijfer {nl(g!.cijfer)}.</>
            : <span className="note">Wacht op het advies van de planner.</span>}
          {anderCijfer && <span className="mt-1 block text-gold">De toets geeft nu cijfer {nl(t.cijfer)}, niet {nl(g!.cijfer)} zoals bij het advies.</span>}
          {wacht && t.hard > 0 && <span className="mt-1 block text-rood">Het rooster heeft nu {plural(t.hard, 'overtreding', 'overtredingen')} van ATW of CAO. Eerst oplossen, dan goedkeuren.</span>}
          {zelfGeadviseerd && s.mag('rooster.goedkeuren') && <span className="note mt-1 block">Je gaf zelf het advies voor deze maand. Een ander keurt goed of af (vier ogen, § 5.1).</span>}
          {wacht && (
            <div className="mt-2 flex flex-wrap gap-2">
              {s.mag('rooster.goedkeuren') ? (
                <>
                  <button type="button" className="btn btn-sm" disabled={zelfGeadviseerd || t.hard > 0} onClick={goedkeuren}><Check size={14} /> Goedkeuren</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={zelfGeadviseerd} onClick={() => { setAfkeur(true); setReden(''); }}><X size={14} /> Afkeuren</button>
                </>
              ) : <AlleenRegiomanager wat="Goedkeuren" />}
            </div>
          )}
        </Stap>
        <Stap nr={verplicht ? 4 : 3} klaar={!!pub && pub.tot >= tot && wijzigingen === 0} titel="Publiceren">
          {pub ? <>Gepubliceerd t/m <b>{fmtD(pub.tot)}</b>, {fmtMoment(pub.op)}{pub.door !== 'demo' ? ` door ${pub.door}` : ''}.</> : 'Nog niet gepubliceerd.'}
          {(!pub || pub.tot < vereistTot) && <span className="note block">Het beleid vraagt elke maand {publicatieMaanden} maanden vooraf te publiceren: nu t/m {maandNaam(maandVan(vereistTot))}.</span>}
          {wijzigingen > 0 && <span className="mt-1 block"><Pill soort="info">{plural(wijzigingen, 'wijziging', 'wijzigingen')} sinds publicatie</Pill></span>}
        </Stap>
      </ol>
      <button type="button" className="btn mt-4 w-full" disabled={!kanPubliceren} onClick={() => onPubliceer(pubVan, tot)}><Send size={16} /> {pubMaanden.length > 1 ? `${maandNaam(pubMaanden[0], false)} t/m ${maandNaam(maand)}` : maandNaam(maand)} publiceren</button>
      {nogOpen && nogOpen !== maand && geldig && <p className="note mt-2">Eerst {maandNaam(nogOpen)} vaststellen: het gepubliceerde rooster sluit zonder gat aan op wat er al staat.</p>}
      <p className="note mt-2">Medewerkers zien alleen het gepubliceerde rooster en krijgen een bericht met wat er voor hen veranderd is. Na de vaststelling kunnen ze gewoon ruilen; ziekte, verlof, ruilen en eigen aanpassingen in een vastgestelde maand vragen geen nieuw advies.</p>
      {g && g.geschiedenis.length > 0 && (
        <details className="mt-3 text-[13.5px]">
          <summary className="cursor-pointer font-semibold text-accent">Geschiedenis van {maandNaam(maand, false)} ({g.geschiedenis.length})</summary>
          <ol className="mt-2 grid gap-1.5">
            {g.geschiedenis.map((st, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-[86px] shrink-0 text-muted">{fmtMoment(st.op)}</span>
                <span className="min-w-0">
                  {st.soort === 'advies' ? <>Advies <b>{st.kleur}</b> van {st.door}{st.toelichting ? `: “${st.toelichting}”` : ''}</> : <>{st.soort === 'goedgekeurd' ? 'Goedgekeurd' : 'Afgekeurd'} door {st.door}{st.reden ? `: ${st.reden}` : ''}</>}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {adviesOpen && (
        <AdviesModal regio={regio} titel={`Advies bij het rooster ${regio} ${maandNaam(maand)}`} voorstel={adviesInfo.voorstel} samenvatting={adviesInfo.samenvatting} vorige={wacht ? advies : undefined} onClose={() => setAdviesOpen(false)}
          onGeef={(a) => { actie(() => vraagGoedkeuring(regio, maand, t, door, a), `Advies ${a.kleur} gegeven; het rooster van ${maandNaam(maand)} ligt bij de regiomanager.`); setAdviesOpen(false); }} />
      )}
      <Modal open={afkeur} onClose={() => setAfkeur(false)} titel={`Rooster ${regio} ${maandNaam(maand)} afkeuren`} voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => setAfkeur(false)}>Annuleren</button>
        <button type="button" className="btn btn-danger" disabled={!reden.trim()} onClick={() => { actie(() => beoordeelRooster(regio, maand, 'afgekeurd', door, reden.trim()), 'Rooster afgekeurd. De planner past het aan.'); setAfkeur(false); }}><X size={16} /> Afkeuren</button>
      </>}>
        <Veld label="Wat moet er anders? (de planner ziet dit)"><textarea className="input min-h-[80px]" autoFocus value={reden} onChange={(e) => setReden(e.target.value)} /></Veld>
      </Modal>
      <Modal open={tegenRood} onClose={() => setTegenRood(false)} titel="Goedkeuren tegen het advies in" voet={<>
        <button type="button" className="btn btn-ghost" onClick={() => setTegenRood(false)}>Annuleren</button>
        <button type="button" className="btn" disabled={!reden.trim()} onClick={() => { actie(() => beoordeelRooster(regio, maand, 'goedgekeurd', door, reden.trim()), 'Rooster goedgekeurd tegen het advies in. De toelichting staat bij de goedkeuring.'); setTegenRood(false); }}><Check size={16} /> Toch goedkeuren</button>
      </>}>
        {advies && <AdviesBlok advies={advies} />}
        <Veld className="mt-3" label="Waarom keur je het toch goed? (verplicht; de planner ziet dit)"><textarea className="input min-h-[80px]" autoFocus value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Bijvoorbeeld: een externe is geregeld voor week 46." /></Veld>
      </Modal>
    </div>
  );
}
