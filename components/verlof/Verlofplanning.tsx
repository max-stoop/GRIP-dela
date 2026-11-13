'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, ArrowRight, Palmtree, CircleDot, CheckCircle2 } from 'lucide-react';
import { Leeg, Pill, Segment } from '@/components/ui';
import { useDoor, useSessie } from '@/components/sessie';
import { AlleenRegiomanager } from '@/components/Rechten';
import { useActie } from '@/components/toast';
import { besluitVakantieronde, openVakantieronde, useApp, zetVakantieFase } from '@/lib/store/store';
import { CLUSTERS, CLUSTER_NAAM, REGION_CLUSTER } from '@/lib/model/config';
import { NBD, NBD_NAAM } from '@/lib/nbd/parameters';
import { addDays, fmtD, fmtDJ, isoWeek, mondayOf, toDay, todayIso, fromDay, diffDays } from '@/lib/dates';
import { vakantieNaam, verlofAdvies, verlofRuimte, verlofUrenPerWeek, ADVIES_LABEL, type Advies, type AdviesSoort, type VerlofContext, type WeekRuimte } from '@/lib/capaciteit/verlof';
import { VAKANTIE_FASE, type VakantieFase, type Vakantieronde, type Verlof } from '@/lib/store/types';
import { cx, nlInt, plural } from '@/lib/format';

const ADVIES_PILL: Record<AdviesSoort, 'ok' | 'warn' | 'info' | 'bad'> = { past: 'ok', krap: 'warn', cluster: 'info', past_niet: 'bad' };

export function useVerlofContext(): VerlofContext {
  const normen = useApp((x) => x.normen);
  const beleid = useApp((x) => x.beleid);
  const medewerkers = useApp((x) => x.medewerkers);
  const verlof = useApp((x) => x.verlof);
  const schoolvakanties = useApp((x) => x.schoolvakanties);
  const nbd = useApp((x) => x.nbd);
  return useMemo(() => ({ normen, beleid, medewerkers, verlof, schoolvakanties, nbd }), [normen, beleid, medewerkers, verlof, schoolvakanties, nbd]);
}

/** Goedgekeurd, aangevraagd en de ruimte. */
function RuimteStrook({ weken, compact }: { weken: WeekRuimte[]; compact?: boolean }) {
  const W = Math.max(compact ? 520 : 760, weken.length * (compact ? 16 : 22)), H = compact ? 130 : 190, pl = 40, pb = 30, pt = 10;
  const max = Math.max(8, ...weken.map((w) => Math.max(w.ruimte, w.goedgekeurd + w.aangevraagd, w.normVerlof))) * 1.08;
  const min = Math.min(0, ...weken.map((w) => w.ruimte));
  const bw = (W - pl - 6) / Math.max(1, weken.length);
  const y = (v: number) => pt + (H - pt - pb) * (1 - (v - min) / (max - min || 1));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart block h-auto w-full" style={{ minWidth: compact ? 520 : 640 }} role="img" aria-label="Verlofruimte per week">
        <defs>
          <pattern id="arcering" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--d1b-a)" /><line x1="0" y1="0" x2="0" y2="5" stroke="var(--plum)" strokeWidth="2" />
          </pattern>
        </defs>
        {[min, 0, max / 2, max].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
          <g key={v}><line x1={pl} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={pl - 6} y={y(v) + 4} textAnchor="end">{nlInt(v)}</text></g>
        ))}
        {weken.map((w, i) => {
          const x = pl + i * bw + 2, bwi = Math.max(3, bw - 4);
          const vol = w.goedgekeurd + w.aangevraagd > w.ruimte;
          return (
            <g key={w.maandag}>
              <title>{`Week ${isoWeek(toDay(w.maandag))} (${fmtD(w.maandag)}): ruimte ${nlInt(w.ruimte)} uur, goedgekeurd ${nlInt(w.goedgekeurd)}, aangevraagd ${nlInt(w.aangevraagd)}${w.schoolvakantie ? `, ${vakantieNaam(w.schoolvakantie)}` : ''}`}</title>
              {w.schoolvakantie && <rect x={x - 2} y={pt} width={bwi + 4} height={H - pt - pb} fill="var(--soft)" />}
              <rect x={x} y={y(w.goedgekeurd)} width={bwi} height={Math.max(0, y(0) - y(w.goedgekeurd))} fill={vol ? 'var(--red)' : 'var(--teal)'} rx={2} />
              {w.aangevraagd > 0 && <rect x={x} y={y(w.goedgekeurd + w.aangevraagd)} width={bwi} height={Math.max(0, y(w.goedgekeurd) - y(w.goedgekeurd + w.aangevraagd))} fill="url(#arcering)" rx={2} />}
              <line x1={x - 2} x2={x + bwi + 2} y1={y(w.ruimte)} y2={y(w.ruimte)} stroke="var(--navy)" strokeWidth={2.5} strokeLinecap="round" />
              {(i === 0 || isoWeek(toDay(w.maandag)) % (compact ? 8 : 4) === 1) && <text x={x + bwi / 2} y={H - 10} textAnchor="middle">wk {isoWeek(toDay(w.maandag))}</text>}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[13px] text-muted">
        <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm bg-teal" /> Goedgekeurd verlof</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg, var(--d1b-a) 0 2px, var(--plum) 2px 4px)' }} /> Aangevraagd</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-[3px] w-4 rounded" style={{ background: 'var(--navy)' }} /> Verlofruimte</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm bg-soft" /> Schoolvakantie</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--red)' }} /> Meer verlof dan ruimte</span>
      </div>
    </div>
  );
}

/** Per regio of voor een heel cluster, vanaf nu of voor een vaste periode. */
export function Verlofplanning({ regios, regio, van, aantal }: { regios: string[]; regio: string; van?: string; aantal?: number }) {
  const ctx = useVerlofContext();
  const [periode, setWeken] = useState<'26' | '52'>('26');
  const [niveau, setNiveau] = useState<'regio' | 'cluster'>('regio');
  const vandaag = todayIso();
  const start = van ?? fromDay(mondayOf(toDay(vandaag)));
  const weken = String(aantal ?? periode);
  const gekozen = regio === 'alle' ? regios : [regio];
  const groepen = useMemo(() => {
    if (niveau === 'regio') return gekozen.map((r) => ({ naam: r, sub: r === NBD ? NBD_NAAM : CLUSTER_NAAM[REGION_CLUSTER[r]], regios: [r] }));
    // de NBD is landelijk en hoort bij geen cluster
    const cl = [...new Set(gekozen.map((r) => (r === NBD ? NBD : REGION_CLUSTER[r])))];
    return cl.map((c) => (c === NBD ? { naam: NBD, sub: NBD_NAAM, regios: [NBD] } : { naam: `Cluster ${CLUSTER_NAAM[c]}`, sub: CLUSTERS[c].join(', '), regios: CLUSTERS[c] }));
  }, [niveau, gekozen.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => groepen.map((g) => {
    const per = g.regios.map((r) => verlofRuimte(ctx, r, start, Number(weken)));
    const som: WeekRuimte[] = per[0].map((w, i) => ({
      ...w,
      bezetting: per.reduce((a, p) => a + p[i].bezetting, 0), verzuim: per.reduce((a, p) => a + p[i].verzuim, 0),
      borging: per.reduce((a, p) => a + p[i].borging, 0), ruimte: per.reduce((a, p) => a + p[i].ruimte, 0),
      normVerlof: per.reduce((a, p) => a + p[i].normVerlof, 0), goedgekeurd: per.reduce((a, p) => a + p[i].goedgekeurd, 0),
      aangevraagd: per.reduce((a, p) => a + p[i].aangevraagd, 0), over: per.reduce((a, p) => a + p[i].over, 0),
      schoolvakantie: per.map((p) => p[i].schoolvakantie).find(Boolean) ?? null,
    }));
    return { ...g, weken: som };
  }), [groepen, ctx, start, weken]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {regio !== NBD && <Segment label="Niveau" waarde={niveau} onChange={setNiveau} opties={[['regio', 'Per regio'], ['cluster', 'Per cluster']]} />}
        {!van && <Segment label="Periode" waarde={periode} onChange={setWeken} opties={[['26', '26 weken'], ['52', '52 weken']]} />}
        {regio === NBD
          ? <p className="note flex-1">Verlofruimte = netto uren beschikbaar min 92% van de uren aan de telefoon die Erlang C vraagt, zoals de capaciteitsplanning. <Link href="/nbd/capaciteit" className="text-accent">Capaciteit per week</Link></p>
          : <p className="note flex-1">Verlofruimte = bezetting min verzuim ({Math.round(ctx.beleid.verzuimNorm * 1000) / 10}%) min de te borgen uren uit de vastgestelde regelplekken. <Link href="/beleid#p-4.3" className="text-accent">Hoe dit werkt</Link></p>}
      </div>
      {data.map((g) => {
        const krap = g.weken.filter((w) => w.over < 0);
        const tot = g.weken.reduce((a, w) => a + w.ruimte, 0), goed = g.weken.reduce((a, w) => a + w.goedgekeurd, 0), norm = g.weken.reduce((a, w) => a + w.normVerlof, 0);
        return (
          <div key={g.naam} className="box">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="kop-s">{g.naam}</h3>
                <p className="note">{g.sub}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {krap.length ? <Pill soort="bad">{plural(krap.length, 'week', 'weken')} meer verlof dan ruimte</Pill> : <Pill soort="ok">Overal ruimte</Pill>}
                <Pill soort="neutral">Ruimte {nlInt(tot)} uur · norm {nlInt(norm)} · goedgekeurd {nlInt(goed)}</Pill>
              </div>
            </div>
            <RuimteStrook weken={g.weken} compact={data.length > 2} />
          </div>
        );
      })}
    </div>
  );
}

const FASEN: VakantieFase[] = ['planning', 'analyse', 'advies', 'gesprek', 'besloten'];

function datumVan(r: Vakantieronde, f: VakantieFase): string {
  return f === 'planning' ? r.data.aanvragen : f === 'analyse' ? r.data.analyse : f === 'advies' ? r.data.advies : f === 'gesprek' ? r.data.gesprek : r.data.besluit;
}

/** § 4.1, met advies per aanvraag uit de verlofruimte. */
export function Vakantierondes({ regios }: { regios: string[] }) {
  const s = useSessie();
  const door = useDoor();
  const actie = useActie();
  const rondes = useApp((x) => x.vakantierondes);
  const ctx = useVerlofContext();
  const [nieuw, setNieuw] = useState(false);
  const vandaag = todayIso();
  const jaar = Number(vandaag.slice(0, 4)) + 1;
  const [f, setF] = useState({ naam: `Zomervakantie ${jaar}`, cluster: 'NL', van: `${jaar}-06-01`, tot: `${jaar}-09-30`, aanvragen: addDays(vandaag, 30), analyse: addDays(vandaag, 40), advies: addDays(vandaag, 47), gesprek: addDays(vandaag, 54), besluit: addDays(vandaag, 60) });

  return (
    <div className="grid gap-5">
      {rondes.length === 0 && !nieuw && (
        <Leeg titel="Nog geen vakantieronde" icoon={<Palmtree size={28} />} actie={<button type="button" className="btn" onClick={() => setNieuw(true)}>Vakantieronde openen</button>}>
          Open een ronde voor de zomer of voor oktober tot en met mei. Medewerkers vragen aan, GRIP rekent per week de ruimte en geeft per aanvraag een advies.
        </Leeg>
      )}
      {rondes.map((r) => <Ronde key={r.id} r={r} regios={regios} ctx={ctx} onFase={(fase) => actie(() => zetVakantieFase(r.id, fase, door))} onBesluit={(b) => actie(() => besluitVakantieronde(r.id, b, door), 'Besluit genomen. De goedgekeurde vakanties staan in het rooster; medewerkers krijgen bericht.')} magBeheren={s.isPlanner} magBesluiten={s.mag('verlof.besluiten')} />)}
      {rondes.length > 0 && !nieuw && <div><button type="button" className="btn btn-ghost" onClick={() => setNieuw(true)}>Nieuwe vakantieronde</button></div>}
      {nieuw && (
        <form className="box grid gap-4" onSubmit={(e) => { e.preventDefault(); actie(() => { openVakantieronde({ naam: f.naam.trim(), cluster: f.cluster, van: f.van, tot: f.tot, data: { aanvragen: f.aanvragen, analyse: f.analyse, advies: f.advies, gesprek: f.gesprek, besluit: f.besluit } }, door); setNieuw(false); }, 'Vakantieronde geopend. Medewerkers krijgen een bericht.'); }}>
          <h3 className="kop-s">Vakantieronde openen</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="label"><span>Naam</span><input className="input" value={f.naam} onChange={(e) => setF({ ...f, naam: e.target.value })} /></label>
            <label className="label"><span>Voor</span>
              <select className="input" value={f.cluster} onChange={(e) => setF({ ...f, cluster: e.target.value })}>
                <option value="NL">Heel Nederland</option>
                {Object.keys(CLUSTERS).map((c) => <option key={c} value={c}>Cluster {CLUSTER_NAAM[c]}</option>)}
              </select>
            </label>
            <label className="label"><span>Vakantieperiode van</span><input className="input" type="date" value={f.van} onChange={(e) => setF({ ...f, van: e.target.value })} /></label>
            <label className="label"><span>tot en met</span><input className="input" type="date" value={f.tot} min={f.van} onChange={(e) => setF({ ...f, tot: e.target.value })} /></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {(['aanvragen', 'analyse', 'advies', 'gesprek', 'besluit'] as const).map((k, i) => (
              <label key={k} className="label"><span>{['Aanvragen binnen', 'Analyse klaar', 'Advies gegeven', 'Gesprek gevoerd', 'Besluit'][i]}</span><input className="input" type="date" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
            ))}
          </div>
          <p className="note">Het roosterbeleid (§ 4.1) adviseert voor de zomer: aanvragen binnen op 17 november, besluit op 17 december; voor oktober tot en met mei: 17 juni en 17 juli.</p>
          <div className="flex gap-2"><button className="btn" disabled={!f.naam.trim() || f.tot < f.van}>Openen</button><button type="button" className="btn btn-ghost" onClick={() => setNieuw(false)}>Annuleren</button></div>
        </form>
      )}
    </div>
  );
}

function Ronde({ r, regios, ctx, onFase, onBesluit, magBeheren, magBesluiten }: { r: Vakantieronde; regios: string[]; ctx: VerlofContext; onFase: (f: VakantieFase) => void; onBesluit: (b: Record<string, 'goedgekeurd' | 'afgewezen'>) => void; magBeheren: boolean; magBesluiten: boolean }) {
  const vandaag = todayIso();
  const medewerkers = useApp((x) => x.medewerkers);
  const verlofAlle = useApp((x) => x.verlof);
  const clusters = r.cluster === 'NL' ? [...new Set(regios.map((x) => REGION_CLUSTER[x]))] : [r.cluster];
  const [cluster, setCluster] = useState(clusters[0]);
  const aanvragen = verlofAlle.filter((v) => v.rondeId === r.id && v.status === 'aangevraagd' && CLUSTERS[cluster]?.includes(v.regio));
  const advies = useMemo(() => verlofAdvies({ ...ctx, verlof: ctx.verlof.filter((v) => v.status !== 'aangevraagd' || v.rondeId === r.id) }, cluster), [ctx, cluster, r.id]);
  const [keuze, setKeuze] = useState<Record<string, 'goedgekeurd' | 'afgewezen'>>({});
  const besluit = (v: Verlof): 'goedgekeurd' | 'afgewezen' => keuze[v.id] ?? (advies.get(v.id)?.soort === 'past_niet' ? 'afgewezen' : 'goedgekeurd');
  const fi = FASEN.indexOf(r.fase);
  const tellen = (s: AdviesSoort) => aanvragen.filter((v) => advies.get(v.id)?.soort === s).length;
  const naam = (id: string) => medewerkers.find((m) => m.id === id)?.naam ?? '–';
  const contract = (id: string) => medewerkers.find((m) => m.id === id)?.contract ?? 0;

  return (
    <div className="box">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="kicker">Vakantieronde · {r.cluster === 'NL' ? 'heel Nederland' : `cluster ${CLUSTER_NAAM[r.cluster]}`}</div>
          <h3 className="kop">{r.naam}</h3>
          <p className="note mt-1">Vakantie van {fmtDJ(r.van)} t/m {fmtDJ(r.tot)}. {plural(ctx.verlof.filter((v) => v.rondeId === r.id && v.status === 'aangevraagd').length, 'aanvraag staat', 'aanvragen staan')} open.</p>
        </div>
        {magBeheren && r.fase !== 'besloten' && r.fase !== 'gesprek' && (
          <button type="button" className="btn" onClick={() => onFase(FASEN[fi + 1])}>Door naar: {VAKANTIE_FASE[FASEN[fi + 1]].naam.toLowerCase()} <ArrowRight size={15} /></button>
        )}
      </div>

      <ol className="mt-4 grid gap-2 md:grid-cols-5">
        {FASEN.map((f, i) => {
          const d = datumVan(r, f);
          const nu = f === r.fase, klaar = i < fi;
          return (
            <li key={f} className={cx('rounded-lg border p-3 text-[13.5px]', nu ? 'border-[color:var(--primary)] bg-soft' : 'border-line')}>
              <div className="flex items-center gap-1.5 font-semibold">
                {klaar ? <CheckCircle2 size={15} className="text-teal" /> : nu ? <CircleDot size={15} className="text-accent" /> : <CircleDot size={15} className="text-muted" />}
                {VAKANTIE_FASE[f].naam}
              </div>
              <div className="note mt-1">{VAKANTIE_FASE[f].wie} · {fmtD(d)}{nu && diffDays(d, vandaag) < 0 ? ' · over de datum' : ''}</div>
              {nu && <p className="note mt-1.5">{VAKANTIE_FASE[f].uitleg}</p>}
            </li>
          );
        })}
      </ol>

      {r.fase !== 'besloten' && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {clusters.length > 1 && <Segment label="Cluster" waarde={cluster} onChange={setCluster} opties={clusters.map((c) => [c, CLUSTER_NAAM[c]] as [string, string])} />}
            <div className="flex flex-wrap gap-1.5">
              {(['past', 'krap', 'cluster', 'past_niet'] as AdviesSoort[]).map((s) => <Pill key={s} soort={ADVIES_PILL[s]}>{tellen(s)} {ADVIES_LABEL[s].toLowerCase()}</Pill>)}
            </div>
          </div>
          {aanvragen.length ? (
            <>
              <div className="scroll max-h-[520px]">
                <table className="tb">
                  <thead><tr><th>Medewerker</th><th>Regio</th><th>Periode</th><th className="r">Uren</th><th>Advies</th><th>Besluit</th></tr></thead>
                  <tbody>
                    {aanvragen.sort((a, b) => a.regio.localeCompare(b.regio) || a.van.localeCompare(b.van)).map((v) => {
                      const a: Advies | undefined = advies.get(v.id);
                      const uren = [...verlofUrenPerWeek(v, contract(v.medewerkerId)).values()].reduce((x, y) => x + y, 0);
                      return (
                        <tr key={v.id}>
                          <td className="whitespace-nowrap font-semibold">{naam(v.medewerkerId)}</td>
                          <td>{v.regio}</td>
                          <td className="whitespace-nowrap">{fmtD(v.van)} t/m {fmtD(v.tot)}</td>
                          <td className="r">{nlInt(uren)}</td>
                          <td>{a ? <><Pill soort={ADVIES_PILL[a.soort]}>{ADVIES_LABEL[a.soort]}</Pill><div className="note">{a.uitleg}</div></> : '–'}</td>
                          <td>
                            {magBesluiten ? (
                              <Segment label={`Besluit ${naam(v.medewerkerId)}`} waarde={besluit(v)} onChange={(b) => setKeuze({ ...keuze, [v.id]: b })} opties={[['goedgekeurd', 'Goed'], ['afgewezen', 'Af']]} />
                            ) : <Pill>{besluit(v) === 'goedgekeurd' ? 'goed' : 'af'}</Pill>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {magBeheren && (r.fase === 'gesprek' || r.fase === 'advies') && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="note flex-1">Het besluit volgt het advies; pas het per aanvraag aan na het gesprek met het team. Goedgekeurd verlof komt meteen in het rooster.</p>
                  {magBesluiten
                    ? <button type="button" className="btn" onClick={() => onBesluit(Object.fromEntries(aanvragen.map((v) => [v.id, besluit(v)])))}><Check size={16} /> Besluit nemen voor {CLUSTER_NAAM[cluster]}</button>
                    : <AlleenRegiomanager wat="Het besluit" paragraaf="4.1" />}
                </div>
              )}
            </>
          ) : verlofAlle.some((v) => v.rondeId === r.id && v.status !== 'aangevraagd' && CLUSTERS[cluster]?.includes(v.regio))
            ? <p className="flex items-center gap-2 text-[15px]"><CheckCircle2 size={18} className="text-teal" /> Besloten voor cluster {CLUSTER_NAAM[cluster]}. De goedgekeurde vakanties staan in het rooster.</p>
            : <p className="note">Geen open aanvragen in cluster {CLUSTER_NAAM[cluster]} voor deze ronde.</p>}
        </div>
      )}
      {r.fase === 'besloten' && <p className="mt-4 flex items-center gap-2 text-[15px]"><CheckCircle2 size={18} className="text-teal" /> Besloten. De goedgekeurde vakanties staan in het rooster.</p>}
    </div>
  );
}

/** Voor een losse aanvraag: past het in de verlofruimte van de weken die het raakt? */
export function useAanvraagAdvies(v: { id?: string; medewerkerId: string; regio: string; van: string; tot: string } | null): { soort: AdviesSoort; uitleg: string; weken: WeekRuimte[] } | null {
  const ctx = useVerlofContext();
  return useMemo(() => {
    if (!v || v.tot < v.van) return null;
    const m = ctx.medewerkers.find((x) => x.id === v.medewerkerId);
    if (!m) return null;
    const anderen = ctx.verlof.filter((x) => x.id !== v.id);
    const weken = verlofRuimte({ ...ctx, verlof: anderen }, v.regio, v.van, Math.floor((mondayOf(toDay(v.tot)) - mondayOf(toDay(v.van))) / 7) + 1);
    const uren = verlofUrenPerWeek({ ...v, id: v.id ?? 'nieuw', status: 'aangevraagd', aangevraagd: '' }, m.contract);
    let soort: AdviesSoort = 'past', uitleg = 'Er is ruimte in alle weken.';
    for (const w of weken) {
      const h = uren.get(w.maandag) ?? 0;
      const over = w.over - w.aangevraagd - h;
      if (over >= 8) continue;
      if (over >= 0) { if (soort === 'past') { soort = 'krap'; uitleg = `Krap in week ${isoWeek(toDay(w.maandag))}: andere aanvragen lopen nog.`; } continue; }
      if (w.over - h >= 0) { soort = 'krap'; uitleg = `In week ${isoWeek(toDay(w.maandag))} is er ruimte, maar er lopen meer aanvragen.`; continue; }
      soort = w.schoolvakantie ? 'cluster' : 'past_niet';
      uitleg = w.schoolvakantie ? `Geen ruimte in week ${isoWeek(toDay(w.maandag))} (${vakantieNaam(w.schoolvakantie)}); de planner kijkt naar het cluster.` : `Geen ruimte in week ${isoWeek(toDay(w.maandag))}.`;
      if (soort === 'past_niet') break;
    }
    return { soort, uitleg, weken };
  }, [v?.id, v?.medewerkerId, v?.regio, v?.van, v?.tot, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function AdviesRegel({ advies }: { advies: { soort: AdviesSoort; uitleg: string } | null }) {
  if (!advies) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[14px]">
      <Pill soort={ADVIES_PILL[advies.soort]}>{ADVIES_LABEL[advies.soort]}</Pill>
      <span className="note">{advies.uitleg}</span>
    </div>
  );
}

