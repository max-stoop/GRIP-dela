'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserPlus, HardHat, CalendarDays, Pencil, AlertTriangle } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { GeenToegang, Modal, PaginaKop, Pill, Sectie } from '@/components/ui';
import { MedewerkerModal } from '@/components/rooster/Panelen';
import { Dienst } from '@/components/ruil/RuilOnderdelen';
import { bewaarMedewerker, useApp, verwijderMedewerker, wisDienstenExternen } from '@/lib/store/store';
import { teamOverzicht, type MwOverzicht } from '@/lib/rooster/team';
import { REGIONS, REGION_CLUSTER, CLUSTER_NAAM } from '@/lib/model/config';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { kwartaal, normWeek } from '@/lib/capaciteit/norm';
import { FUNCTIE_LABEL, LEGE_CELLEN, ZZP_IN_ROOSTER, opVolgorde, type DienstCode, type Medewerker, type Tijden, type UurVoorkeuren, type Voorkeurprofiel } from '@/lib/rooster/types';
import { addDays, fmtD, fmtDag, isoRange, todayIso } from '@/lib/dates';
import { useRegioUitAdres, zetWerkregio } from '@/lib/werkregio';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { nbdDienst } from '@/lib/nbd/blokken';
import { dienstTekst, netto } from '@/lib/nbd/dienst';
import { maxUren, nbdCapaciteitWeek } from '@/lib/nbd/capaciteit';
import { voorkeurKort } from '@/lib/nbd/voorkeuren';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { weekendNaam } from '@/lib/rooster/weekend';
import { WeekendGroepen, WeekendJaar } from '@/components/team/Weekenden';
import { FeestdagenOverzicht } from '@/components/team/Feestdagen';
import { cx, nl, nlInt, nlUren, plural } from '@/lib/format';

/** Wat je in één maandrooster niet ziet. Bij de NBD zonder uitvaartleiders, 1B en Dg-rotatie, maar met maximale inzet en voorkeuren per uur. */
export function TeamOverzicht({ nbd = false }: { nbd?: boolean }) {
  const s = useSessie();
  const actie = useActie();
  const router = useRouter();
  const params = useSearchParams();
  const vandaag = todayIso();
  const mijnRegios = useMemo(() => (nbd ? [NBD] : REGIONS.filter((r) => s.regios.includes(r))), [s.regios, nbd]);
  const gekozen = useRegioUitAdres(nbd ? null : params.get('regio'), mijnRegios);
  const regio = nbd ? NBD : gekozen;
  const tijden = useApp((x) => x.tijden[regio]);
  const p = useApp((x) => x.nbd);
  const medewerkers = useApp((x) => x.medewerkers);
  const cellen = useApp((x) => x.rooster[regio]) ?? LEGE_CELLEN;
  const verlof = useApp((x) => x.verlof);
  const profielen = useApp((x) => x.profielen);
  const beleid = useApp((x) => x.beleid);
  const normen = useApp((x) => x.normen);
  const [bewerk, setBewerk] = useState<Medewerker | 'nieuw' | 'extern' | null>(null);
  const detailId = params.get('mw');

  const team = useMemo(() => medewerkers.filter((m) => m.regio === regio && m.actief).sort(opVolgorde), [medewerkers, regio]);
  // bij de NBD komen de uren uit de tijden van de dienst (zonder pauze)
  const uren = useMemo(() => (nbd ? (mid: string, d: string, code: DienstCode) => (code === 'N' ? (() => { const x = nbdDienst(cellen, tijden, mid, d); return x ? netto(x) : 0; })() : DIENSTEN[code].uren) : undefined), [nbd, cellen, tijden]);
  const o = useMemo(() => teamOverzicht({ team, cellen, verlof, profielen, beleid, vandaag, uren, ...(nbd ? { maxPerWeek: maxUren, perUur: true } : {}) }), [team, cellen, verlof, profielen, beleid, vandaag, uren, nbd]);

  if (!s.isPlanner) return <GeenToegang />;
  const formatie = (normen.regios[regio] ?? NORM_STANDAARD.regios[regio])?.fte[kwartaal(normWeek(vandaag))] ?? 0;
  const vast = o.rijen.filter((r) => !r.m.extern), extern = o.rijen.filter((r) => r.m.extern);
  // externen staan voorlopig niet in het rooster: wat er nog van hen staat, is in het rooster niet te zien
  const externDiensten = ZZP_IN_ROOSTER ? 0 : extern.reduce((a, r) => a + Object.entries(cellen[r.m.id] ?? {}).filter(([d, c]) => d > vandaag && c !== '-').length, 0);
  // de jaarcijfers tellen wat er in GRIP staat; staat het rooster er pas sinds kort in, dan zeggen we dat
  const eerste = team.flatMap((m) => Object.keys(cellen[m.id] ?? {})).reduce((a, d) => (d < a ? d : a), vandaag);
  const vanaf = eerste > `${vandaag.slice(0, 4)}-01-07` ? eerste : null;
  const signalen = vast.flatMap((r) => r.signalen.filter((x) => x.ernst !== 'info').map((x) => ({ ...x, r })));
  const detail = o.rijen.find((r) => r.m.id === detailId) ?? null;
  const open = (id: string | null) => router.replace(nbd ? `/nbd/team${id ? `?mw=${id}` : ''}` : `/team?regio=${encodeURIComponent(regio)}${id ? `&mw=${id}` : ''}`, { scroll: false });
  // bij de NBD: de capaciteit van deze week, zoals de capaciteitsplanning (zonder verlof)
  const cap = nbd ? nbdCapaciteitWeek({ p, normen, team }, vandaag) : null;

  return (
    <>
      <PaginaKop boven={nbd ? `${NBD_NAAM} · landelijk` : `Team · cluster ${CLUSTER_NAAM[REGION_CLUSTER[regio]] ?? ''}`} titel={<>Team <em>{nbd ? 'NBD' : regio}</em></>} lead={nbd ? 'Wat je in één maandrooster niet ziet: uren tegenover contract en maximale inzet, weekenden over het hele jaar, feestdagen, verlof en ziekte, en de voorkeuren per uur. En of het eerlijk verdeeld is.' : 'Wat je in één maandrooster niet ziet: weekenden over het hele jaar, beschikbaarheidsdiensten per 28 dagen, uren tegenover contract, feestdagen, Dg-rotatie, verlof en ziekte. En of het eerlijk verdeeld is.'}>
        {!nbd && (
          <label className="label"><span>Regio</span>
            <select className="input w-auto min-w-[210px]" value={regio} onChange={(e) => { zetWerkregio(e.target.value); router.replace(`/team?regio=${encodeURIComponent(e.target.value)}`); }}>
              {mijnRegios.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        )}
      </PaginaKop>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="box">
          <div className="text-[13.5px] font-semibold">Vaste medewerkers</div>
          <div className="display mt-1 text-[34px] font-semibold leading-none">{vast.length}</div>
          <div className="note mt-1">{nbd ? '' : `${vast.filter((r) => r.m.functie === 'UL').length} uitvaartleider${vast.filter((r) => r.m.functie === 'UL').length === 1 ? '' : 's'} · `}{extern.length} extern</div>
        </div>
        <div className="box">
          <div className="text-[13.5px] font-semibold">Contracturen per week</div>
          <div className="display mt-1 text-[34px] font-semibold leading-none">{nlInt(o.contract)}</div>
          {cap
            ? <div className="note mt-1">met maximale inzet {nlInt(cap.brutoMax)} · netto {nlInt(cap.netto)} beschikbaar, {nlInt(cap.benodigd)} nodig aan de telefoon deze week</div>
            : <div className="note mt-1">begroting {nlInt(formatie * normen.urenPerFte)} uur ({nl(formatie)} fte){Math.abs(o.contract - formatie * normen.urenPerFte) >= 8 ? ` · ${o.contract > formatie * normen.urenPerFte ? '+' : '−'}${nlInt(Math.abs(o.contract - formatie * normen.urenPerFte))}` : ''}</div>}
        </div>
        <div className="box">
          <div className="text-[13.5px] font-semibold">Weekenden dit jaar</div>
          <div className="display mt-1 text-[34px] font-semibold leading-none">{o.spreiding.weekenden[0]}–{o.spreiding.weekenden[1]}</div>
          <div className="note mt-1">laagste en hoogste, maximaal {52 - beleid.minVrijeWeekenden} (CAO § 1.4){vanaf ? `; telt vanaf ${fmtD(vanaf)}, het begin van het rooster in GRIP` : ''}</div>
        </div>
        {!nbd && <div className="box">
          <div className="text-[13.5px] font-semibold">Dg-aandeel komende 8 weken</div>
          <div className="display mt-1 text-[34px] font-semibold leading-none">{o.spreiding.dg ? `${Math.round(o.spreiding.dg[0] * 100)}–${Math.round(o.spreiding.dg[1] * 100)}%` : '–'}</div>
          <div className="note mt-1">uitvaartverzorgers; een groot verschil betekent weinig rotatie</div>
        </div>}
      </div>

      {signalen.length > 0 && (
        <div className="box mt-5" style={{ borderColor: 'var(--gold)' }}>
          <h3 className="kop-s flex items-center gap-2"><AlertTriangle size={18} className="text-gold" /> Let op</h3>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {signalen.map((x, i) => (
              <li key={i} className="flex items-center gap-2 text-[14.5px]">
                <Pill soort={x.ernst === 'bad' ? 'bad' : 'warn'}>{x.r.m.naam}</Pill> <span>{x.tekst}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Sectie titel="Medewerkers" lead="Klik op een naam voor de details. Balkjes laten zien hoe iemand zich verhoudt tot het team." rechts={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setBewerk('nieuw')}><UserPlus size={15} /> Medewerker toevoegen</button>}>
        <div className="scroll">
          <table className="tb">
            <thead>
              <tr>
                <th>Medewerker</th>
                <th className="r" title="Geplande uren komende 4 weken tegenover contract (min verlof en ziekte)">Uren 4 wk</th>
                <th title={`Gewerkte weekenden dit kalenderjaar; maximaal ${52 - beleid.minVrijeWeekenden}`}>Weekenden</th>
                {!nbd && <th className="r" title={`Meeste 1B in een periode van 28 dagen (max ${beleid.maxBeschikbaarPer28})`}>1B / 28 d</th>}
                <th className="r" title="Gewerkte feestdagen dit jaar">Feestdagen</th>
                {!nbd && <th className="r" title="Aandeel Dg-dagen van de werkdagen, komende 8 weken">Dg</th>}
                {!nbd && <th className="r" title="Keer een 2, komende 8 weken">2</th>}
                <th className="r" title="Werkdagen verlof dit jaar (goedgekeurd + aangevraagd)">Verlof</th>
                <th className="r" title="Dagen ziek in het rooster dit jaar">Ziek</th>
                <th>Voorkeuren</th>
              </tr>
            </thead>
            <tbody>
              {vast.map((r) => <Rij key={r.m.id} r={r} o={o.spreiding} nbd={nbd} uren={profielen[r.m.id]?.uren} onKies={() => open(r.m.id)} />)}
            </tbody>
          </table>
        </div>
      </Sectie>

      {!nbd && vast.length > 0 && <>
        <Sectie
          titel="Weekendgroepen"
          lead="Iedereen heeft een weekendcadans (elk weekend, om het weekend, 1 op 3 of 1 op 4) en een groep; je zet ze bij de medewerker. Het voorstel plant iemand alleen in de weekenden van de eigen groep. Verdeel de groepen zo dat elk weekend ongeveer evenveel contracturen werkt. Wat de medewerker zelf wil (even of oneven, 2 of 3 regelplekken per weekend) staat erbij: wie 3 regelplekken per weekend doet, zet je op 1 op 3, en die krijgt in zijn weekend een 2."
        >
          <WeekendGroepen team={vast.map((r) => r.m)} profielen={profielen} vandaag={vandaag} />
        </Sectie>
        <Sectie titel="Feestdagen" lead="Wie welke feestdag werkte of ingeroosterd staat. Zo rouleren de feestdagen eerlijk, en zie je bij een verlofaanvraag op een feestdag wie er al vaak heeft gewerkt.">
          <FeestdagenOverzicht team={vast.map((r) => r.m)} cellen={cellen} verlof={verlof} />
        </Sectie>
        <Sectie titel="Weekenden van het hele jaar" lead="Per weekend wat in het rooster staat, en voor weekenden zonder rooster wat de weekendgroep laat verwachten. Onderaan hoeveel mensen er dat weekend werken; rechts het totaal tegenover het maximum van de CAO.">
          <WeekendJaar team={vast.map((r) => r.m)} cellen={cellen} verlof={verlof} beleid={beleid} vandaag={vandaag} />
        </Sectie>
      </>}

      {(ZZP_IN_ROOSTER || extern.length > 0) && (
        <Sectie titel="Externen en ZZP'ers" lead={!ZZP_IN_ROOSTER ? 'Staan voorlopig niet in het rooster en worden niet voorgesteld bij Bijsturen.' : nbd ? 'Tellen mee aan de telefoon, niet in de bezetting. Zet ze in het rooster als er geen andere opties zijn, of via Bijsturen bij een tekort.' : 'Tellen mee in de dekking, niet in de formatie. Zet ze twee maanden vooraf in het rooster als er geen andere opties zijn (§ 3.7), of via Bijsturen bij een tekort (§ 3.9).'} rechts={ZZP_IN_ROOSTER ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBewerk('extern')}><HardHat size={15} /> Externe kracht toevoegen</button> : externDiensten > 0 ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(() => wisDienstenExternen(regio), (n) => `${plural(n, 'dienst', 'diensten')} van externen weggehaald.`)}>Toekomstige diensten weghalen ({externDiensten})</button> : undefined}>
          {extern.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {extern.map((r) => (
                <button key={r.m.id} type="button" onClick={() => open(r.m.id)} className="box text-left hover:bg-soft">
                  <div className="flex items-center gap-2 font-semibold"><HardHat size={16} className="text-muted" /> {r.m.naam}</div>
                  <div className="note mt-1">Maximaal {r.m.contract} uur per week · komende 4 weken {nlInt(r.uren4.gepland)} uur ingezet</div>
                </button>
              ))}
            </div>
          ) : <p className="note">Nog geen externen {nbd ? 'bij de NBD' : `in ${regio}`}.</p>}
        </Sectie>
      )}

      <Detail r={detail} regio={regio} cellen={cellen} tijden={tijden} vandaag={vandaag} uren={detail ? profielen[detail.m.id]?.uren : undefined} onClose={() => open(null)} onBewerk={(m) => setBewerk(m)} />

      <MedewerkerModal
        open={!!bewerk}
        mw={bewerk && typeof bewerk === 'object' ? bewerk : null}
        nieuwExtern={bewerk === 'extern'}
        regio={regio}
        onClose={() => setBewerk(null)}
        onBewaar={(m) => actie(() => { bewaarMedewerker({ ...m, regio }); setBewerk(null); }, m.id ? 'Opgeslagen.' : `${m.naam} toegevoegd aan ${nbd ? 'de NBD' : regio}.`)}
        onVerwijder={(id) => actie(() => { verwijderMedewerker(id); setBewerk(null); open(null); }, 'Medewerker verwijderd. Toekomstige diensten zijn vervallen.')}
      />
    </>
  );
}

/** Een balkje dat laat zien waar iemand zit tussen de laagste en hoogste van het team. */
function Plek({ waarde, bereik, max, label }: { waarde: number; bereik: [number, number]; max?: number | null; label: string }) {
  const top = Math.max(max ?? 0, bereik[1], 1);
  const kleur = max != null && waarde > max ? 'var(--red)' : max != null && waarde >= max - 2 ? 'var(--gold)' : 'var(--primary)';
  return (
    <div className="flex min-w-[120px] items-center gap-2" title={label}>
      <span className="num w-7 text-right">{waarde}</span>
      <span className="relative h-2 flex-1 rounded-full bg-soft">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(waarde / top) * 100}%`, background: kleur }} />
        {max != null && <span className="absolute -top-1 bottom-[-4px] w-px bg-[color:var(--muted)]" style={{ left: `${(max / top) * 100}%` }} />}
      </span>
    </div>
  );
}

function Rij({ r, o, nbd, uren, onKies }: { r: MwOverzicht; o: { weekenden: [number, number]; b28: [number, number]; feestdagen: [number, number] }; nbd?: boolean; uren?: UurVoorkeuren; onKies: () => void }) {
  const beleid = useApp((x) => x.beleid);
  const verschil = r.uren4.gepland - r.uren4.norm;
  return (
    <tr className="klik" onClick={onKies}>
      <td>
        <div className="font-semibold">{r.m.naam}</div>
        <div className="note">{!nbd && r.m.functie === 'UL' ? 'uitvaartleider · ' : ''}{r.m.contract} uur{nbd ? (maxUren(r.m) > r.m.contract ? ` · max ${nlUren(maxUren(r.m))}` : '') : ` · ${weekendNaam(r.m, todayIso())}`}{r.m.afstandsverklaring ? ' · afstandsverklaring' : ''}</div>
      </td>
      <td className={cx('r num', verschil > 0.5 && 'text-gold', verschil < -16 && 'text-muted')}>{nlInt(r.uren4.gepland)}<span className="text-muted">/{nlInt(r.uren4.norm)}</span></td>
      <td><Plek waarde={r.weekenden.aantal} bereik={o.weekenden} max={r.weekenden.max} label={`${r.weekenden.aantal} weekenden gewerkt${r.weekenden.max != null ? `, maximaal ${r.weekenden.max}` : ''}`} /></td>
      {!nbd && <td className={cx('r num', r.b28 > beleid.maxBeschikbaarPer28 && 'text-rood', r.b28 >= beleid.maxBeschikbaarPer28 - 2 && r.b28 <= beleid.maxBeschikbaarPer28 && 'text-gold')}>{r.b28}</td>}
      <td className="r num">{r.feestdagen}</td>
      {!nbd && <td className="r num">{r.m.functie === 'UL' ? '–' : r.dgAandeel != null ? `${Math.round(r.dgAandeel * 100)}%` : '–'}</td>}
      {!nbd && <td className="r num">{r.twee || ''}</td>}
      <td className="r num">{r.verlof.goed}{r.verlof.aangevraagd ? <span className="text-muted"> +{r.verlof.aangevraagd}</span> : ''}</td>
      <td className="r num">{r.ziekDagen || ''}</td>
      <td>{nbd ? (uren ? <Pill soort="ok">{voorkeurKort(uren)}</Pill> : <Pill soort="neutral">nee</Pill>) : r.profiel ? <Pill soort="ok">ingevuld</Pill> : <Pill soort="neutral">nee</Pill>}</td>
    </tr>
  );
}

/** De vaste voorkeuren die de planner bij het zetten van de weekendgroep en het rooster wil weten. */
function VoorkeurRegel({ p }: { p: Voorkeurprofiel | undefined }) {
  if (!p) return null;
  const twee = { graag: 'graag', neutraal: '', liever_niet: 'liever niet', niet: 'kan niet' }[p.twee ?? 'neutraal'];
  const delen = [
    twee && `een 2: ${twee}`,
    p.korteDagen && `korte Dg-dagen (DG1): ${p.korteDagen === 'graag' ? 'graag, uren over meer dagen' : 'liever niet'}`,
    p.weekend && `${p.weekend} weekenden`,
    p.weekendPlekken && `${p.weekendPlekken} regelplekken per weekend`,
    p.maxDagenPerWeek && `liefst niet meer dan ${p.maxDagenPerWeek} dagen per week`,
  ].filter(Boolean);
  return delen.length ? <p className="m-0 text-[14.5px]"><span className="note">Voorkeuren: </span>{delen.join(' · ')}</p> : null;
}

function Detail({ r, regio, cellen, tijden, vandaag, uren, onClose, onBewerk }: { r: MwOverzicht | null; regio: string; cellen: Record<string, Record<string, DienstCode>>; tijden?: Tijden; vandaag: string; uren?: UurVoorkeuren; onClose: () => void; onBewerk: (m: Medewerker) => void }) {
  const beleid = useApp((x) => x.beleid);
  const profiel = useApp((x) => (r ? x.profielen[r.m.id] : undefined));
  if (!r) return null;
  const nbd = regio === NBD;
  const dagen = isoRange(vandaag, addDays(vandaag, 27));
  return (
    <Modal open onClose={onClose} breed titel={<span className="flex items-center gap-2">{r.m.extern && <HardHat size={18} />} {r.m.naam} <span className="note font-normal">· {r.m.extern ? 'extern' : regio === NBD ? 'NBD' : FUNCTIE_LABEL[r.m.functie ?? 'UV']} · {r.m.contract} uur</span></span>} voet={<>
      <Link href={nbd ? '/nbd/rooster' : `/rooster?regio=${encodeURIComponent(regio)}`} className="btn btn-ghost mr-auto"><CalendarDays size={16} /> Naar het rooster</Link>
      <button type="button" className="btn btn-ghost" onClick={() => onBewerk(r.m)}><Pencil size={16} /> Bewerken</button>
      <button type="button" className="btn" onClick={onClose}>Sluiten</button>
    </>}>
      <div className="grid gap-5">
        {r.signalen.length > 0 && (
          <ul className="flex flex-wrap gap-2">{r.signalen.map((x, i) => <li key={i}><Pill soort={x.ernst === 'bad' ? 'bad' : x.ernst === 'warn' ? 'warn' : 'info'}>{x.tekst}</Pill></li>)}</ul>
        )}
        <div>
          <div className="mb-2 text-sm font-semibold text-muted">Komende 4 weken</div>
          <div className="grid grid-cols-7 gap-1">
            {dagen.map((d) => {
              const c = cellen[r.m.id]?.[d] ?? '-';
              return (
                <div key={d} className="rounded-md border border-line p-1 text-center text-[12px]" title={fmtDag(d)}>
                  <div className="text-muted">{fmtDag(d).split(' ').slice(0, 2).join(' ')}</div>
                  {c === 'N' ? (() => { const x = nbdDienst(cellen, tijden, r.m.id, d); return <span className="font-semibold">{x ? dienstTekst(x) : 'dienst'}</span>; })() : c !== '-' ? <Dienst code={c} klein /> : <span className="text-muted">vrij</span>}
                </div>
              );
            })}
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-[14.5px] sm:grid-cols-3">
          <div><dt className="note">Uren komende 4 weken</dt><dd className="font-semibold">{nlInt(r.uren4.gepland)} van {nlInt(r.uren4.norm)}</dd></div>
          <div><dt className="note">Weekenden dit jaar</dt><dd className="font-semibold">{r.weekenden.aantal}{r.weekenden.max != null ? ` van max ${r.weekenden.max}` : ' (afstandsverklaring)'}</dd></div>
          {nbd ? <div><dt className="note">Maximale inzet per week</dt><dd className="font-semibold">{nlUren(maxUren(r.m))} uur{maxUren(r.m) > r.m.contract ? ' (variabel rooster)' : ''}</dd></div>
            : <div><dt className="note">Meeste 1B in 28 dagen</dt><dd className="font-semibold">{r.b28} van max {beleid.maxBeschikbaarPer28}</dd></div>}
          <div><dt className="note">Feestdagen dit jaar</dt><dd className="font-semibold">{r.feestdagen}</dd></div>
          {nbd ? <div><dt className="note">Voorkeuren per uur</dt><dd className="font-semibold">{uren ? voorkeurKort(uren) : 'nog niet ingevuld'}</dd></div>
            : <div><dt className="note">Dg-aandeel 8 weken</dt><dd className="font-semibold">{r.dgAandeel != null ? `${Math.round(r.dgAandeel * 100)}%` : '–'}</dd></div>}
          <div><dt className="note">Verlof dit jaar</dt><dd className="font-semibold">{plural(r.verlof.goed, 'dag', 'dagen')}{r.verlof.aangevraagd ? `, ${r.verlof.aangevraagd} aangevraagd` : ''}</dd></div>
          <div><dt className="note">Ziek dit jaar</dt><dd className="font-semibold">{plural(r.ziekDagen, 'dag', 'dagen')}</dd></div>
        </dl>
        {nbd && !uren && !r.m.extern && <p className="note">Nog geen voorkeuren per uur. Vraag {r.m.naam.split(' ')[0]} die in te vullen onder Verlof en voorkeuren, of vul ze in bij <Link href="/nbd/voorkeuren" className="text-accent">Voorkeuren per uur</Link>; dan houdt Rooster maken er rekening mee.</p>}
        {!nbd && r.profiel && <VoorkeurRegel p={profiel} />}
        {!nbd && !r.profiel && !r.m.extern && <p className="note">Nog geen vaste voorkeuren. Vraag {r.m.naam.split(' ')[0]} die in te vullen onder Verlof en voorkeuren, dan houdt Rooster maken er rekening mee.</p>}
        <p className="note">Gegevens tot en met {fmtD(addDays(vandaag, 55))} komen uit het rooster; weekenden en feestdagen tellen ook wat al gepland is.</p>
      </div>
    </Modal>
  );
}
