'use client';
import { useConcept, vasteJson } from '@/lib/concept';
import { Save, Send, CalendarHeart, CheckCircle2 } from 'lucide-react';
import { Groep, Meter, Segment, Veld } from '@/components/ui';
import { useActie } from '@/components/toast';
import { useSessie } from '@/components/sessie';
import { bewaarProfiel, dienVoorkeurenIn, useApp } from '@/lib/store/store';
import { isNbd } from '@/lib/nbd/parameters';
import { DAG_KORT, DAG_LANG, fmtLang, fmtMoment, diffDays, todayIso } from '@/lib/dates';
import { periodeNaam } from '@/lib/rooster/maand';
import { cx, plural } from '@/lib/format';
import { LEEG_PROFIEL, type DagVoorkeur, type TweeVoorkeur, type Medewerker, type Voorkeurprofiel, type Voorkeurronde } from '@/lib/rooster/types';

/** Maandag eerst. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const DAG_VK: Record<DagVoorkeur, { label: string; kort: string; kleur: string; tekst: string }> = {
  neutraal: { label: 'Maakt niet uit', kort: '·', kleur: 'var(--card)', tekst: 'var(--muted)' },
  graag: { label: 'Graag', kort: 'graag', kleur: 'color-mix(in srgb, var(--teal) 28%, var(--card))', tekst: 'var(--text)' },
  liever_niet: { label: 'Liever niet', kort: 'liever niet', kleur: 'color-mix(in srgb, var(--gold) 28%, var(--card))', tekst: 'var(--text)' },
  niet: { label: 'Kan niet', kort: 'kan niet', kleur: 'color-mix(in srgb, var(--red) 22%, var(--card))', tekst: 'var(--text)' },
};
const VOLGORDE: DagVoorkeur[] = ['neutraal', 'graag', 'liever_niet', 'niet'];
const TWEE_OPTIES: [TweeVoorkeur, string][] = [['graag', 'Graag'], ['neutraal', 'Maakt niet uit'], ['liever_niet', 'Liever niet'], ['niet', 'Kan niet']];

/** De inhoud van een profiel zoals die wordt bewaard: zonder tijdstip, met de toelichting zoals bij opslaan. */
const profielSleutel = (p: Voorkeurprofiel) => vasteJson({ ...p, bijgewerkt: '', beschikbaarheid: 'neutraal', twee: p.twee ?? 'neutraal', opmerking: p.opmerking?.trim() || undefined });

/** De beschikbaarheidsdienst is geen keuze: die draait iedereen. */
export function ProfielEditor(props: { medewerker: Medewerker; onOpgeslagen?: () => void; compact?: boolean }) {
  // een andere medewerker is een nieuw formulier
  return <ProfielFormulier key={props.medewerker.id} {...props} />;
}

function ProfielFormulier({ medewerker, onOpgeslagen, compact }: { medewerker: Medewerker; onOpgeslagen?: () => void; compact?: boolean }) {
  const actie = useActie();
  const opgeslagen = useApp((x) => x.profielen[medewerker.id]) ?? null;
  // "kan niet" bij de 2 is een harde grens: die zet de planner of regiomanager (de database bewaakt het ook)
  const planner = useSessie().rol !== 'medewerker';
  const nbd = isNbd(medewerker.regio);
  const standaard: Voorkeurprofiel = { ...LEEG_PROFIEL(medewerker.id), dienst: nbd ? 'geen' : medewerker.voorkeur === 'M' ? 'middag' : 'ochtend' };
  // de keuzes blijven staan tot je opslaat, ook als de app intussen gegevens van collega's bijleest
  const { waarde: p, zet: setP, gewijzigd: anders } = useConcept<Voorkeurprofiel>(opgeslagen ?? standaard, profielSleutel);
  const gewijzigd = anders || !opgeslagen;
  const nietDagen = p.dagen.filter((d) => d === 'niet').length;

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        actie(() => {
          bewaarProfiel(medewerker.id, {
            dagen: p.dagen, dienst: p.dienst, beschikbaarheid: 'neutraal', twee: p.twee ?? 'neutraal', maxDagenPerWeek: p.maxDagenPerWeek, opmerking: p.opmerking?.trim() || undefined,
            korteDagen: p.korteDagen, weekend: p.weekend, weekendPlekken: p.weekendPlekken,
          });
          onOpgeslagen?.();
        }, 'Voorkeuren opgeslagen.');
      }}
    >
      <div>
        <div className="mb-2 text-sm font-semibold text-muted">Weekpatroon <span className="font-normal">· tik op een dag om te wisselen</span></div>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEK.map((wd) => {
            const v = p.dagen[wd];
            return (
              <button
                key={wd}
                type="button"
                onClick={() => { const d = [...p.dagen]; d[wd] = VOLGORDE[(VOLGORDE.indexOf(v) + 1) % VOLGORDE.length]; setP({ ...p, dagen: d }); }}
                className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border border-line px-1 py-2 text-center transition-colors hover:border-[color:var(--accent)]"
                style={{ background: DAG_VK[v].kleur }}
                aria-label={`${DAG_LANG[wd]}: ${DAG_VK[v].label}`}
                title={`${DAG_LANG[wd]}: ${DAG_VK[v].label}`}
              >
                <span className="display text-[18px] font-semibold">{DAG_KORT[wd]}</span>
                <span className="text-[11px] font-semibold leading-tight" style={{ color: DAG_VK[v].tekst }}>{DAG_VK[v].kort}</span>
              </button>
            );
          })}
        </div>
        {nietDagen > 2 && <p className="note mt-2">Met {nietDagen} dagen &quot;kan niet&quot; is het lastig om je contracturen te plannen. Overleg dit met je planner.</p>}
      </div>
      <div className={cx('grid gap-4', !compact && 'sm:grid-cols-2')}>
        {nbd ? (
          <Groep label="Dagdeel" hint="De desk is open van 's ochtends vroeg tot 's avonds laat.">
            <Segment label="Dagdeel" waarde={p.dienst} onChange={(v) => setP({ ...p, dienst: v })} opties={[['ochtend', 'Ochtend'], ['middag', 'Middag'], ['avond', 'Avond'], ['geen', 'Geen voorkeur']]} />
          </Groep>
        ) : (
          <>
            <Groep label="Regeldienst" hint="Een voorkeur, geen vaste dienst: wie middag kiest, krijgt ongeveer twee keer zoveel middagdiensten (1M) als een collega en daarnaast gewone diensten.">
              <Segment label="Regeldienst" waarde={p.dienst === 'avond' ? 'geen' : p.dienst} onChange={(v) => setP({ ...p, dienst: v })} opties={[['ochtend', 'Ochtend'], ['middag', 'Middag'], ['geen', 'Geen voorkeur']]} />
            </Groep>
            <Groep label="Dubbele dienst (2)" hint={planner ? 'Een 2 komt alleen als er te weinig mensen zijn. Kan niet is een harde grens; die zet de planner of regiomanager.' : 'Een 2 komt alleen als er te weinig mensen zijn. Kan je echt geen 2 doen? Overleg dat met je planner: die legt het vast.'}>
              {!planner && p.twee === 'niet'
                ? <p className="m-0 rounded-lg border border-line px-3 py-2 text-[14px]"><b>Kan niet</b> <span className="text-muted">· vastgelegd door je planner</span></p>
                : <Segment label="Dubbele dienst" waarde={p.twee ?? 'neutraal'} onChange={(v) => setP({ ...p, twee: v })} opties={TWEE_OPTIES.filter(([v]) => planner || v !== 'niet')} />}
            </Groep>
            {medewerker.functie !== 'UL' && (
              <Groep label="Korte Dg-dagen (DG1, 4 uur)" hint="Graag: je uren over meer dagen, bijvoorbeeld 32 uur in 5 dagen in plaats van 4. Het rooster vult dan aan met DG1-diensten van 4 uur.">
                <Segment label="Korte Dg-dagen" waarde={p.korteDagen ?? 'neutraal'} onChange={(v) => setP({ ...p, korteDagen: v === 'neutraal' ? undefined : v })} opties={[['graag', 'Graag'], ['neutraal', 'Maakt niet uit'], ['liever_niet', 'Liever niet']]} />
              </Groep>
            )}
            <Groep label="Weekenden" hint="Om het weekend: in de even of de oneven weken. De planner zet je weekendgroep; dit ziet hij erbij.">
              <Segment label="Even of oneven weekenden" waarde={p.weekend ?? 'geen'} onChange={(v) => setP({ ...p, weekend: v === 'geen' ? undefined : v })} opties={[['even', 'Even weken'], ['oneven', 'Oneven weken'], ['geen', 'Geen voorkeur']]} />
            </Groep>
            {medewerker.functie !== 'UL' && (
              <Groep label="Regelplekken per weekend" hint="3 (een 2 en een 1) betekent minder weekenden werken, 2 vaker. Het rooster geeft je in een gewerkt weekend dan liefst een 2; de planner past je weekendcadans erop aan.">
                <Segment label="Regelplekken per weekend" waarde={p.weekendPlekken ? String(p.weekendPlekken) : 'geen'} onChange={(v) => setP({ ...p, weekendPlekken: v === '2' ? 2 : v === '3' ? 3 : undefined })} opties={[['2', '2, vaker een weekend'], ['3', '3, minder weekenden'], ['geen', 'Geen voorkeur']]} />
              </Groep>
            )}
          </>
        )}
        <Veld label="Toelichting (optioneel)">
          <input className="input" value={p.opmerking ?? ''} maxLength={200} onChange={(e) => setP({ ...p, opmerking: e.target.value })} placeholder="Bijvoorbeeld: woensdag zorgdag" />
        </Veld>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={!gewijzigd}><Save size={16} /> Voorkeuren opslaan</button>
        {opgeslagen?.bijgewerkt && <span className="note">Laatst opgeslagen {fmtMoment(opgeslagen.bijgewerkt)}</span>}
      </div>
    </form>
  );
}

/** Mini-weergave van het weekpatroon voor tabellen. */
export function PatroonMini({ p }: { p: Voorkeurprofiel | null | undefined }) {
  return (
    <span className="inline-flex gap-0.5" aria-label="Weekpatroon">
      {WEEK.map((wd) => {
        const v = p?.dagen[wd] ?? 'neutraal';
        return <span key={wd} title={`${DAG_LANG[wd]}: ${DAG_VK[v].label}`} className="grid h-6 w-6 place-items-center rounded text-[11px] font-bold" style={{ background: v === 'neutraal' ? 'var(--soft)' : DAG_VK[v].kleur, border: v === 'niet' ? '1px solid var(--red)' : undefined }}>{DAG_KORT[wd][0]}</span>;
      })}
    </span>
  );
}

export function RondeBanner({ ronde, medewerkerId }: { ronde: Voorkeurronde; medewerkerId: string }) {
  const actie = useActie();
  const ingediend = ronde.ingediend[medewerkerId];
  const dagen = diffDays(ronde.deadline, todayIso());
  return (
    <div className="box mb-5 flex flex-wrap items-center gap-4" style={{ borderColor: ingediend ? 'var(--teal)' : 'var(--gold)' }}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: ingediend ? 'var(--teal)' : 'var(--gold)' }}>{ingediend ? <CheckCircle2 size={22} /> : <CalendarHeart size={22} />}</span>
      <div className="min-w-[200px] flex-1">
        <div className="font-semibold">Voorkeurenronde {periodeNaam(ronde)}</div>
        <div className="note">
          {ingediend
            ? `Ingediend op ${fmtMoment(ingediend)}. Je kunt tot de deadline nog aanpassen en opnieuw indienen.`
            : `Geef je vaste voorkeuren en wensen op ${dagen >= 0 ? `vóór ${fmtLang(ronde.deadline, false)}${dagen <= 3 ? ` (nog ${plural(dagen, 'dag', 'dagen')})` : ''}` : 'zo snel mogelijk; de deadline is verstreken'}. Daarna maakt de planner het rooster.`}
        </div>
      </div>
      <button type="button" className={cx('btn', ingediend ? 'btn-ghost' : 'btn-teal')} onClick={() => actie(() => dienVoorkeurenIn(ronde.id, medewerkerId), 'Je voorkeuren zijn ingediend. Dank je wel!')}>
        <Send size={16} /> {ingediend ? 'Opnieuw indienen' : 'Voorkeuren indienen'}
      </button>
    </div>
  );
}

export function RondeVoortgang({ ronde, team }: { ronde: Voorkeurronde; team: Medewerker[] }) {
  const n = team.filter((m) => ronde.ingediend[m.id]).length;
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between text-sm"><span>{n} van {team.length} ingediend</span><b>{team.length ? Math.round((n / team.length) * 100) : 0}%</b></div>
      <Meter waarde={team.length ? n / team.length : 0} />
    </div>
  );
}
