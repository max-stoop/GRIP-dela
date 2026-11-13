'use client';
import { useState } from 'react';
import Link from 'next/link';
import { LineChart, CalendarRange, ShieldCheck, Sparkles, Upload, Users } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Spinner } from '@/components/ui';
import { laadDemo, useApp, useTaak, useOpslagwijze } from '@/lib/store/store';

const STAPPEN = [
  { icoon: LineChart, titel: 'Voorspellen', tekst: 'Per regio de verwachte meldingen voor de komende 61 dagen, bijgestuurd met weer, luchtkwaliteit, rioolwater, griep en CBS-sterfte.' },
  { icoon: CalendarRange, titel: 'Roosteren', tekst: 'Zet zelf diensten neer of laat een voorstel maken voor de lege vakjes, rekening houdend met verlof en wensen.' },
  { icoon: ShieldCheck, titel: 'Toetsen', tekst: 'Elk rooster wordt direct getoetst aan ATW, CAO en het roosterbeleid en krijgt een cijfer van 1 tot 10.' },
];

export function Welkom() {
  const s = useSessie();
  const taak = useTaak();
  const actie = useActie();
  const opslag = useOpslagwijze();
  if (opslag === 'database') return <NogLeeg />;
  return (
    <div className="mx-auto max-w-5xl py-6">
      <p className="mb-2 text-sm font-bold uppercase tracking-wider text-teal">Welkom</p>
      <h1 className="wordmark">Regelplekken, van voorspelling tot rooster</h1>
      <p className="lead text-[17px]">
        GRIP voorspelt hoeveel regelplekken elke regio nodig heeft, helpt een rooster maken dat dat dekt en toetst het meteen.
        {s.isPlanner ? ' Begin met de demo om alles te verkennen, of lees direct je eigen meldingenhistorie in.' : ' Er staat in deze browser nog geen rooster klaar. Laad de demo om de app te verkennen.'}
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {STAPPEN.map(({ icoon: I, titel, tekst }, i) => (
          <div key={titel} className="box">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: i === 0 ? 'var(--accent)' : i === 1 ? 'var(--teal)' : 'var(--gold)' }}><I size={20} /></span>
              <span className="display text-[15px] font-semibold text-muted">Stap {i + 1}</span>
            </div>
            <h3 className="kop-s">{titel}</h3>
            <p className="note mt-1.5">{tekst}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-teal" disabled={!!taak} onClick={() => actie(laadDemo, 'De demo staat klaar: 25 regio\'s en de nabestaandendesk met teams, roosters, verlof en ruilverzoeken.')}>
          {taak ? <Spinner /> : <Sparkles size={17} />} {taak ? `${taak.naam}${taak.stap ? `: ${taak.stap}` : ''}` : 'Demo laden'}
        </button>
        {s.isBeheerder && (
          <Link href="/model" className="btn btn-ghost"><Upload size={17} /> Eigen meldingen uploaden</Link>
        )}
        <span className="note">De demo maakt synthetische historie en 16 voorspellingen. Dat duurt een paar seconden.</span>
      </div>
    </div>
  );
}

/** Met de gedeelde database: er staat nog niets in (geen meldingen, geen teams). Het menu staat er wel voor wie plant. */
function NogLeeg() {
  const s = useSessie();
  return (
    <div className="mx-auto max-w-2xl py-8">
      <p className="mb-2 text-sm font-bold uppercase tracking-wider text-teal">Welkom</p>
      <h1 className="wordmark">Nog geen gegevens</h1>
      {s.isBeheerder ? (
        <>
          <p className="lead text-[17px]">Er staan nog geen teams of meldingen in GRIP. Zet per regio het team klaar en lees de meldingenhistorie in. Collega&apos;s geef je toegang onder Instellingen.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/team" className="btn btn-teal"><Users size={17} /> Teams invoeren</Link>
            <Link href="/model" className="btn btn-ghost"><Upload size={17} /> Meldingen inlezen</Link>
            <Link href="/instellingen" className="btn btn-ghost">Gebruikers en instellingen</Link>
          </div>
        </>
      ) : s.isPlanner ? (
        <>
          <p className="lead text-[17px]">Er staan nog geen teams of meldingen in. Je kunt het team van je regio&apos;s alvast klaarzetten; de beheerder leest de meldingenhistorie in.</p>
          <div className="mt-6"><Link href="/team" className="btn btn-teal"><Users size={17} /> Team invoeren</Link></div>
        </>
      ) : (
        <p className="lead text-[17px]">De beheerder zet de gegevens nog klaar. Kom later terug, of vraag de beheerder wanneer GRIP klaarstaat.</p>
      )}
    </div>
  );
}

export function KiesIdentiteit() {
  const s = useSessie();
  const medewerkers = useApp((x) => x.medewerkers.filter((m) => m.actief && s.werkregios.includes(m.regio)));
  const regios = [...new Set(medewerkers.map((m) => m.regio))].sort();
  const [regio, setRegio] = useState(regios[0] ?? '');
  const [mid, setMid] = useState('');
  const lijst = medewerkers.filter((m) => m.regio === regio).sort((a, b) => a.naam.localeCompare(b.naam));
  if (s.echt.modus !== 'lokaal' && s.echt.rol === 'medewerker') {
    return (
      <div className="mx-auto max-w-xl py-8">
        <h1 className="wordmark">Nog niet gekoppeld</h1>
        <p className="lead">Je account ({s.echt.email}) hoort nog niet bij een medewerker in het rooster. Vraag je planner om dit e-mailadres bij je gegevens in het team te zetten. Daarna zie je hier je eigen rooster.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl py-8">
      <h1 className="wordmark">Wie ben jij?</h1>
      <p className="lead">Kies jezelf in het rooster. Dan zie je je eigen diensten en kun je verlof, wensen en ruilen doorgeven.</p>
      <div className="box mt-6 grid gap-4">
        <label className="label"><span>Regio</span>
          <select className="input" value={regio} onChange={(e) => { setRegio(e.target.value); setMid(''); }}>
            {regios.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="label"><span>Naam</span>
          <select className="input" value={mid} onChange={(e) => setMid(e.target.value)}>
            <option value="">Kies je naam</option>
            {lijst.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
          </select>
        </label>
        <div><button type="button" className="btn btn-teal" disabled={!mid} onClick={() => s.kiesIdentiteit(mid)}>Verder</button></div>
      </div>
    </div>
  );
}
