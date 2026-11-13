'use client';
import { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Modal, Veld } from '@/components/ui';
import { ADVIES, MIN_TOELICHTING, adviesFout, type Advies, type AdviesKleur, type AdviesVoorstel } from '@/lib/rooster/advies';
import { fmtMoment } from '@/lib/dates';
import { cx } from '@/lib/format';

const KLEUREN: AdviesKleur[] = ['groen', 'oranje', 'rood'];

function AdviesLabel({ kleur, metUitleg = true }: { kleur: AdviesKleur; metUitleg?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cx('advies-dot', kleur)} aria-hidden />
      <b className={cx('advies-tekst', kleur)}>{ADVIES[kleur].naam}</b>
      {metUitleg && <span className="text-muted">· {ADVIES[kleur].kort}</span>}
    </span>
  );
}

/** Het advies zoals de regiomanager het ziet: kleur, toelichting, van wie, en of de planner afweek van GRIP. */
export function AdviesBlok({ advies }: { advies: Advies }) {
  return (
    <div className={cx('advies-kaart mt-1.5 px-3 py-2', advies.kleur)}>
      <AdviesLabel kleur={advies.kleur} />
      {advies.toelichting && <p className="mt-1 text-[14px]">“{advies.toelichting}”</p>}
      <p className="note mt-1">
        Advies van {advies.door}, {fmtMoment(advies.op)}.
        {advies.voorstel && advies.voorstel !== advies.kleur && <> GRIP stelde {ADVIES[advies.voorstel].naam.toLowerCase()} voor.</>}
      </p>
    </div>
  );
}

export function AdviesModal({ titel, voorstel, samenvatting, vorige, onClose, onGeef }: {
  regio?: string;
  titel: string;
  voorstel: AdviesVoorstel;
  /** Bijvoorbeeld het cijfer en de wensen. */
  samenvatting: string;
  vorige?: Advies;
  onClose: () => void;
  onGeef: (a: { kleur: AdviesKleur; toelichting?: string; voorstel: AdviesKleur }) => void;
}) {
  const [kleur, setKleur] = useState<AdviesKleur | null>(vorige?.kleur ?? null);
  const [toelichting, setToelichting] = useState(vorige?.toelichting ?? '');
  const fout = adviesFout(kleur, toelichting);
  return (
    <Modal open onClose={onClose} breed titel={titel} voet={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleren</button>
      <button type="button" className="btn" disabled={!!fout} onClick={() => onGeef({ kleur: kleur!, toelichting: toelichting.trim() || undefined, voorstel: voorstel.kleur })}><Send size={16} /> Advies geven en aanbieden</button>
    </>}>
      <p className="lead">Bij elk rooster geef je als planner een advies aan de regiomanager (§ 5.1). Die besluit daarna over goedkeuren.</p>
      <div className="mt-3 rounded-lg bg-soft p-3 text-[14.5px]">
        <div className="flex flex-wrap items-center gap-2 font-semibold"><Sparkles size={15} className="text-accent" /> Voorstel van GRIP: <AdviesLabel kleur={voorstel.kleur} metUitleg={false} /></div>
        <ul className="mt-1.5 list-disc pl-5">
          {voorstel.redenen.map((r) => <li key={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</li>)}
        </ul>
        <p className="note mt-1.5">{samenvatting} Jij kent het team en de regio: kies zelf.</p>
      </div>
      <div role="radiogroup" aria-label="Advies" className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {KLEUREN.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kleur === k} onClick={() => setKleur(k)} className={cx('advies-kaart p-3 text-left', k)}>
            <span className="flex items-center justify-between gap-2">
              <AdviesLabel kleur={k} metUitleg={false} />
              {voorstel.kleur === k && <span className="pill pill-info">voorstel</span>}
            </span>
            <span className="mt-1 block text-[14px] font-semibold">{ADVIES[k].kort}</span>
            <span className="note mt-1 block">{ADVIES[k].uitleg}</span>
          </button>
        ))}
      </div>
      <Veld className="mt-4" label={kleur && kleur !== 'groen' ? 'Toelichting voor de regiomanager (verplicht)' : 'Toelichting voor de regiomanager (optioneel)'} hint={kleur && kleur !== 'groen' ? `Wat moet de regiomanager weten of doen? Minstens ${MIN_TOELICHTING} tekens.` : undefined}>
        <textarea className="input min-h-[84px]" value={toelichting} maxLength={600} onChange={(e) => setToelichting(e.target.value)} placeholder={kleur === 'rood' ? 'Bijvoorbeeld: drie dagen in week 46 kunnen we niet dekken; inzet van een externe is nodig.' : kleur === 'oranje' ? 'Bijvoorbeeld: dinsdag 17 november is krap; Anouk heeft vaker een 1B dan de rest.' : ''} />
      </Veld>
      {kleur && kleur !== voorstel.kleur && <p className="note mt-2">Je wijkt af van het voorstel van GRIP ({ADVIES[voorstel.kleur].naam.toLowerCase()}). De regiomanager ziet dat bij je advies.</p>}
      {fout && kleur && <p className="note mt-2 text-gold">{fout}.</p>}
    </Modal>
  );
}
