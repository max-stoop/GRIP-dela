'use client';
import Link from 'next/link';
import { CalendarDays, ArrowLeftRight, CalendarPlus, Bell, Info } from 'lucide-react';
import { useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Box, GeenToegang, Laden, Modal, PaginaKop, Pill, Sectie, Stat } from '@/components/ui';
import { PlekkenDag } from '@/components/voorspelling/Plekken';
import { Dienst } from '@/components/ruil/RuilOnderdelen';
import { Activiteiten } from '@/components/Activiteiten';
import { RondeBanner } from '@/components/voorkeur/Voorkeuren';
import { useApp } from '@/lib/store/store';
import { addDays, DAG_LANG, fmtD, fmtDag, fromDay, isoRange, isoWeek, isWeekend, mondayOf, toDay, todayIso, weekday } from '@/lib/dates';
import { maandEind, maandNaam, maandVan, volgendeMaand } from '@/lib/rooster/maand';
import { DIENSTEN, afwezigVoorNorm, dienstTijd, WENS_LABEL } from '@/lib/rooster/diensten';
import { cel } from '@/lib/rooster/toets';
import { downloadIcs } from '@/lib/export';
import { TijdInvoer } from '@/components/rooster/Tijden';
import { uurTekst } from '@/lib/rooster/tijden';
import { tijdVan } from '@/lib/rooster/toets';
import { dienstTekst, netto, pauzeTekst, taakTekst, uitTijd } from '@/lib/nbd/dienst';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { cx, nlUren, plural } from '@/lib/format';
import { useRuns } from '@/lib/store/hooks';
import { behoefteVoor } from '@/lib/store/afgeleid';
import { kans1BPerDag } from '@/lib/rooster/kans1b';
import { plekKansen, procenten, type PlekKans } from '@/lib/capaciteit/plekkans';
import type { ClusterDag } from '@/lib/capaciteit/beschikbaarheid';
import { CLUSTERS, CLUSTER_NAAM, REGION_CLUSTER } from '@/lib/model/config';
import { BEHOEFTE_BRON, inRooster, type DienstCode } from '@/lib/rooster/types';

/** Een dienst met een regelplek of een 1B: daarvoor is er uitleg over de plekken van die dag. */
const metPlek = (c: DienstCode | null | undefined) => !!c && (DIENSTEN[c].categorie === 'beschikbaar' || DIENSTEN[c].plekken > 0);

export default function MijnRooster() {
  const s = useSessie();
  const actie = useActie();
  const ik = useApp((x) => x.medewerkers.find((m) => m.id === s.medewerkerId));
  const pub = useApp((x) => (ik ? x.publicaties[ik.regio] : undefined));
  const wensen = useApp((x) => x.wensen.filter((w) => w.medewerkerId === s.medewerkerId));
  const verlof = useApp((x) => x.verlof.filter((v) => v.medewerkerId === s.medewerkerId && ['aangevraagd', 'goedgekeurd'].includes(v.status)));
  const ruil = useApp((x) => x.ruil.filter((r) => (r.aanbiederId === s.medewerkerId || r.ontvangerId === s.medewerkerId) && ['open', 'wacht_planner'].includes(r.status)));
  const berichten = useApp((x) => {
    const regio = x.medewerkers.find((m) => m.id === s.medewerkerId)?.regio;
    return x.activiteit.filter((a) => a.voor === s.medewerkerId || (a.regioBreed && a.regio === regio)).slice(0, 8);
  });
  const ronde = useApp((x) => { const regio = x.medewerkers.find((m) => m.id === s.medewerkerId)?.regio; return x.rondes.find((r) => r.regio === regio && r.status === 'open') ?? null; });
  const mijnTijden = useApp((x) => { const regio = x.medewerkers.find((m) => m.id === s.medewerkerId)?.regio; return regio ? x.tijden[regio]?.[s.medewerkerId ?? ''] : undefined; });
  const beleid = useApp((x) => x.beleid);
  const normen = useApp((x) => x.normen);
  const verschuivingen = useApp((x) => x.verschuivingen);
  const medewerkers = useApp((x) => x.medewerkers);
  const publicaties = useApp((x) => x.publicaties);
  const { basisData, laatsteData } = useRuns();
  const [tijdOpen, setTijdOpen] = useState<string | null>(null);
  const [uitleg, setUitleg] = useState<string | null>(null);
  const vandaag = todayIso();

  // de plekken van het cluster op mijn dagen met een regelplek of 1B (gepubliceerd, vanaf vandaag)
  const plekDagen = useMemo(() => {
    const mijn = ik && pub ? pub.cellen[ik.id] ?? {} : {};
    const dagen = Object.keys(mijn).filter((d) => d >= vandaag && pub && d >= pub.van && d <= pub.tot && metPlek(mijn[d])).sort();
    if (!ik || !dagen.length) return null;
    const cluster = REGION_CLUSTER[ik.regio];
    const regios = CLUSTERS[cluster] ?? [ik.regio];
    const bronnen = { basis: basisData, laatste: laatsteData, norm: normen, verschuivingen };
    const behoefte = new Map(regios.map((r) => [r, behoefteVoor(bronnen, r, dagen, { alphaRegio: beleid.alphaRegio, tegen: 'basis' })]));
    const k = kans1BPerDag({
      normen, cluster, regios, dates: dagen,
      lam: (r, d) => behoefte.get(r)?.[d]?.lam,
      rooster: (r) => {
        const p = publicaties[r];
        const team = medewerkers.filter((m) => m.regio === r && inRooster(m)).map((m) => m.id);
        return p && team.length ? { cellen: p.cellen, team } : null;
      },
    });
    return { cluster, dag: new Map<string, ClusterDag | null>(dagen.map((d, i) => [d, k[i]])), behoefte: behoefte.get(ik.regio) ?? {} };
  }, [ik, pub, vandaag, basisData, laatsteData, normen, verschuivingen, beleid.alphaRegio, publicaties, medewerkers]);
  // de kans dat mijn 1B valt: even rekenen, daarom na het tekenen van de pagina
  const [mijn1B, setMijn1B] = useState<Map<string, PlekKans>>(new Map());
  useEffect(() => {
    if (!ik || !plekDagen) return;
    const t = setTimeout(() => {
      const m = new Map<string, PlekKans>();
      for (const [d, c] of plekDagen.dag) {
        if (!c || pub?.cellen[ik.id]?.[d] !== '1B') continue;
        const b = plekKansen(c.dagen, normen.uitval, c.speling).regios.find((r) => r.regio === ik.regio)?.plekken.find((p) => p.soort === '1B');
        if (b) m.set(d, b);
      }
      setMijn1B(m);
    }, 0);
    return () => clearTimeout(t);
  }, [ik, pub, plekDagen, normen.uitval]);

  if (s.rol !== 'medewerker') return <GeenToegang />;
  if (!ik) return <Laden />;

  // we roosteren per maand: deze en volgende maand, of verder als er al verder is gepubliceerd
  const start = fromDay(mondayOf(toDay(vandaag)));
  const eind = [maandEind(volgendeMaand(maandVan(vandaag))), pub?.tot ?? ''].sort().at(-1)!;
  const aantalWeken = Math.ceil((toDay(eind) - toDay(start) + 1) / 7);
  const dagen = isoRange(start, addDays(start, aantalWeken * 7 - 1));
  const dienst = (d: string) => (pub && d >= pub.van && d <= pub.tot ? cel(pub.cellen, ik.id, d) : null);
  const volgende = dagen.find((d) => d >= vandaag && dienst(d) && DIENSTEN[dienst(d)!].werk);
  const deze = dagen.slice(0, 7);
  // bij de NBD zijn de uren de werktijd uit de tijden (zonder pauze)
  const urenOp = (d: string) => { const c = dienst(d) ?? '-'; if (c !== 'N') return DIENSTEN[c].uren; const x = uitTijd(mijnTijden?.[d]); return x ? netto(x) : 0; };
  const urenWeek = deze.reduce((a, d) => a + urenOp(d), 0);
  const diensten4 = isoRange(vandaag, addDays(vandaag, 27)).filter((d) => DIENSTEN[dienst(d) ?? '-'].werk).length;
  const wensMap = new Map(wensen.map((w) => [w.datum, w]));
  // wat er in de laatste publicatie voor mij is veranderd (alleen toekomstige dagen)
  const gewijzigd = pub?.vorige
    ? [...new Set([...Object.keys(pub.cellen[ik.id] ?? {}), ...Object.keys(pub.vorige.cellen[ik.id] ?? {})])]
        .filter((d) => d >= vandaag && (pub.cellen[ik.id]?.[d] ?? '-') !== (pub.vorige!.cellen[ik.id]?.[d] ?? '-'))
        .sort()
        .map((d) => ({ d, oud: pub.vorige!.cellen[ik.id]?.[d] ?? '-', nieuw: pub.cellen[ik.id]?.[d] ?? '-' }))
    : [];

  /** Tijd van een dienst als tekst: vastgelegd, standaard, of "tijden volgen". */
  const tijdTekst = (d: string, c: NonNullable<ReturnType<typeof dienst>>) => {
    const v = mijnTijden?.[d];
    if (v && c === 'N' && (!v.code || v.code === c)) { const x = uitTijd(v); return x ? `${dienstTekst(x)}, ${pauzeTekst(x)}${x.taken?.length ? `, ${x.taken.map(taakTekst).join(', ')}` : ''}` : ''; }
    if (v && (!v.code || v.code === c)) return `${uurTekst(v.start)}–${uurTekst(v.eind)}`;
    return dienstTijd(c);
  };
  const vastgelegd = (d: string, c: NonNullable<ReturnType<typeof dienst>>) => { const v = mijnTijden?.[d]; return !!v && (!v.code || v.code === c); };

  const agenda = () => {
    const items = dagen.filter((d) => d >= vandaag && dienst(d) && dienst(d) !== '-' && dienst(d) !== 'Z').map((d) => {
      const c = dienst(d)!, def = DIENSTEN[c], t = tijdVan(c, mijnTijden?.[d]);
      const extra = !def.tijdenVast && !vastgelegd(d, c) ? ' Tijden staan uiterlijk 4 dagen vooraf vast; dit zijn indicatieve tijden.' : c === '1B' ? ' Uiterlijk 14:00 hoor je of de dienst doorgaat.' : '';
      return { uid: `${ik.id}-${d}`, datum: d, start: t?.start, eind: t?.eind, titel: c === 'V' ? 'Verlof' : `${def.naam} (${c})`, omschrijving: `GRIP Regelplekken, ${ik.regio}.${extra}` };
    });
    if (!items.length) throw new Error('Er zijn nog geen gepubliceerde diensten om te exporteren.');
    downloadIcs(items, `rooster-${ik.naam.split(' ')[0].toLowerCase()}`);
  };

  return (
    <>
      <PaginaKop titel={`Hallo ${ik.naam.split(' ')[0]}`} lead={<>Je rooster in {ik.regio}. {pub ? <>Gepubliceerd t/m {fmtD(pub.tot)}.</> : 'Er is nog geen rooster gepubliceerd.'}</>}>
        <button type="button" className="btn btn-ghost" onClick={() => actie(agenda, 'Agendabestand gedownload. Open het om je diensten in je agenda te zetten.')}><CalendarPlus size={16} /> In mijn agenda</button>
      </PaginaKop>

      {ronde && <RondeBanner ronde={ronde} medewerkerId={ik.id} />}
      {gewijzigd.length > 0 && (
        <div className="box mb-5" style={{ borderColor: 'var(--accent)' }}>
          <h3 className="kop-s">Gewijzigd in de laatste publicatie</h3>
          <p className="note mt-1">Gepubliceerd {fmtD(pub!.op.slice(0, 10))}. Deze diensten zijn veranderd ten opzichte van de vorige versie.</p>
          <ul className="mt-3 grid gap-1.5">
            {gewijzigd.slice(0, 10).map((g) => (
              <li key={g.d} className="flex flex-wrap items-center gap-2 text-[15px]">
                <span className="w-[86px] font-semibold">{fmtDag(g.d)}</span>
                {g.oud !== '-' ? <Dienst code={g.oud} klein /> : <span className="note">vrij</span>}
                <span className="text-muted">→</span>
                {g.nieuw !== '-' ? <Dienst code={g.nieuw} klein /> : <span className="note">vrij</span>}
                <span className="note">{g.nieuw !== '-' ? DIENSTEN[g.nieuw].naam : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="box" style={{ background: 'var(--hero)', color: '#fff', borderColor: 'transparent' }}>
          <div className="kicker" style={{ color: 'var(--hero-sub)' }}>Volgende dienst</div>
          {volgende ? (
            <div className="mt-2 flex items-center gap-4">
              <span className={cx('grid h-16 w-16 place-items-center rounded-xl text-[22px] font-semibold tabular-nums', `c-${dienst(volgende)}`)}>{dienst(volgende)}</span>
              <div>
                <div className="display text-[28px] font-semibold leading-tight">{volgende === vandaag ? 'Vandaag' : volgende === addDays(vandaag, 1) ? 'Morgen' : DAG_LANG[weekday(toDay(volgende))]} {fmtD(volgende)}</div>
                <div className="text-white/80">{DIENSTEN[dienst(volgende)!].naam}{tijdTekst(volgende, dienst(volgende)!) ? `, ${tijdTekst(volgende, dienst(volgende)!)}` : ''}</div>
                {DIENSTEN[dienst(volgende)!].open && <div className="text-[13.5px] text-white/60">Open voor regelgesprekken {DIENSTEN[dienst(volgende)!].open}</div>}
              </div>
            </div>
          ) : <p className="mt-2 text-white/80">Geen dienst gepland in de gepubliceerde periode.</p>}
        </div>
        <div className="box grid grid-cols-3 gap-4">
          <Stat waarde={nlUren(urenWeek)} label="Uren deze week" sub={`contract ${ik.contract}${deze.some((d) => dienst(d) === '1B') ? `, 1B telt ${DIENSTEN['1B'].uren} uur` : ''}`} />
          <Stat waarde={diensten4} label="Diensten" sub="komende 4 weken" />
          <Stat waarde={verlof.length + ruil.length} label="Lopend" sub={`${verlof.length} verlof, ${ruil.length} ruil`} />
        </div>
      </div>

      <Sectie titel={`Rooster t/m ${maandNaam(maandVan(eind))}`} lead={plekDagen ? <>Bij een 1B zie je de kans dat hij valt. Tik op <Info size={14} className="inline align-[-2px]" aria-label="het infoteken" /> voor die dag: hoeveel plekken er zijn, waarom, en hoe vaak elke plek valt.</> : undefined} rechts={<><Link href="/ruilen" className="btn btn-ghost btn-sm"><ArrowLeftRight size={15} /> Ruilen</Link><Link href="/verlof" className="btn btn-ghost btn-sm"><CalendarDays size={15} /> Verlof en wensen</Link></>}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: aantalWeken }, (_, w) => {
            const week = dagen.slice(w * 7, w * 7 + 7);
            const uren = week.reduce((a, d) => a + urenOp(d), 0);
            const ongepubliceerd = week.every((d) => dienst(d) == null);
            const deels = !ongepubliceerd && week.some((d) => dienst(d) == null);
            // het contract per week, min de werkdagen verlof en de dagen ziek (zoals de planner rekent)
            const afwezig = week.filter((d) => { const c = dienst(d); return c != null && afwezigVoorNorm(c, isWeekend(toDay(d))); }).length;
            const norm = Math.max(0, ik.contract - (afwezig * ik.contract) / 5);
            return (
              <div key={w} className="box min-w-0 p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="kop-s">Week {isoWeek(toDay(week[0]))}</h3>
                    <span className="note whitespace-nowrap">{fmtD(week[0])} – {fmtD(week[6])}</span>
                  </div>
                  {ongepubliceerd ? <span className="note text-right">nog niet gepubliceerd</span> : (
                    <div className="shrink-0 text-right" title={`Ingeroosterd in week ${isoWeek(toDay(week[0]))}: ${nlUren(uren)} uur. Contract ${nlUren(ik.contract)} uur per week${afwezig ? `, met ${plural(afwezig, 'dag', 'dagen')} verlof of ziek ${nlUren(norm)} uur` : ''}.${week.some((d) => dienst(d) === '1B') ? ` Een 1B telt ${DIENSTEN['1B'].uren} uur.` : ''}`}>
                      <div className={cx('text-[15px] font-semibold tabular-nums', Math.abs(uren - norm) > 0.5 && 'text-gold')}>{nlUren(uren)} uur ingeroosterd</div>
                      <div className="note text-[12.5px]">contract {nlUren(ik.contract)}{afwezig ? `, met ${plural(afwezig, 'dag', 'dagen')} verlof of ziek ${nlUren(norm)}` : ''}{deels ? ', deels gepubliceerd' : ''}</div>
                    </div>
                  )}
                </div>
                <ul className="grid gap-1">
                  {week.map((d) => {
                    const c = dienst(d), wens = wensMap.get(d);
                    const r = ruil.find((x) => x.soort === 'verlof' ? (d >= x.datum && d <= (x.tot ?? x.datum)) || (!!x.tegenDatum && d >= x.tegenDatum && d <= (x.tegenTot ?? x.tegenDatum)) : x.datum === d || x.tegenDatum === d);
                    const vl = verlof.find((v) => d >= v.van && d <= v.tot);
                    return (
                      <Fragment key={d}>
                      <li className={cx('flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 sm:gap-3', d === vandaag && 'ring-2 ring-[color:var(--teal)]', d < vandaag && 'opacity-50')}>
                        <span className="w-[74px] shrink-0 text-sm font-semibold">{fmtDag(d)}</span>
                        {c && c !== '-' ? <Dienst code={c} /> : <span className="inline-block min-w-[38px] text-center text-sm text-muted">{c == null ? '·' : 'vrij'}</span>}
                        <span className="min-w-0 flex-1 truncate text-sm text-muted">{c && c !== '-' ? `${DIENSTEN[c].naam}${tijdTekst(d, c) ? `, ${tijdTekst(d, c)}` : ''}` : ''}</span>
                        {c && !DIENSTEN[c].tijdenVast && DIENSTEN[c].werk && d >= vandaag && d <= addDays(vandaag, beleid.tijdenDagen + 10) && (
                          <button type="button" className={cx('text-[13px] font-semibold', vastgelegd(d, c) ? 'text-muted' : 'text-accent')} onClick={() => setTijdOpen(tijdOpen === d ? null : d)} aria-label={`Tijden van ${fmtDag(d)} vastleggen`}>{vastgelegd(d, c) ? 'tijden' : 'tijden?'}</button>
                        )}
                        {metPlek(c) && d >= vandaag && plekDagen?.dag.get(d) && (
                          <button type="button" className={cx('inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold', c === '1B' ? 'text-gold' : 'text-accent')} onClick={() => setUitleg(d)} aria-label={`Uitleg plekken ${fmtDag(d)}`} title={c === '1B' ? 'Kans dat je 1B valt. Klik voor de uitleg.' : 'Hoeveel plekken er die dag zijn, en waarom. Klik voor de uitleg.'}>
                            {c === '1B' && mijn1B.get(d) ? `valt ${procenten(mijn1B.get(d)!).valt}` : null}<Info size={14} />
                          </button>
                        )}
                        {vl && vl.status === 'aangevraagd' && <span title={`Je hebt voor ${fmtD(vl.van)}${vl.tot !== vl.van ? ` t/m ${fmtD(vl.tot)}` : ''} verlof aangevraagd. Dat is nog niet beoordeeld; tot die tijd blijft je dienst staan.`}><Pill soort="warn">verlof aangevraagd</Pill></span>}
                        {r && <Pill soort="info">{r.soort === 'verlof' ? 'verlofruil' : 'ruil'}</Pill>}
                        {c === 'Z' && <Pill soort="bad">ziek</Pill>}
                        {wens && !vl && <span className="text-[12px] text-muted" title={WENS_LABEL[wens.soort]}>{WENS_LABEL[wens.soort].replace('Liever ', '').replace('Wil graag ', '')}</span>}
                        {c && DIENSTEN[c].werk && c !== 'V' && d > vandaag && !r && <Link href={`/ruilen?dienst=${d}`} className="text-[13px] font-semibold text-accent" aria-label={`Dienst van ${fmtDag(d)} aanbieden of ruilen`}>ruil</Link>}
                      </li>
                      {tijdOpen === d && c && <li className="rounded-lg bg-soft px-3 py-2"><TijdInvoer regio={ik.regio} medewerkerId={ik.id} datum={d} code={c} compact /></li>}
                      </Fragment>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Sectie>

      <Modal open={!!uitleg} onClose={() => setUitleg(null)} breed titel={uitleg ? `${ik.regio}, ${fmtDag(uitleg)}: plekken${dienst(uitleg) === '1B' ? ' en je 1B' : ''}` : ''}>
        {uitleg && plekDagen && (() => {
          const b = plekDagen.behoefte[uitleg];
          const nodig = b ? { lam: b.lam, alpha: b.bron === 'norm' ? normen.dekkingRegio : beleid.alphaRegio, k: b.k, bron: `de ${BEHOEFTE_BRON[b.bron]}` } : null;
          return <PlekkenDag dag={plekDagen.dag.get(uitleg)} regio={ik.regio} clusterNaam={CLUSTER_NAAM[plekDagen.cluster] ?? plekDagen.cluster} uitval={normen.uitval} nodig={nodig} jouw1B={dienst(uitleg) === '1B'} compact />;
        })()}
      </Modal>

      <Sectie titel="Berichten">
        <Box rechts={<Bell size={18} className="text-muted" />}>
          <Activiteiten lijst={berichten} />
          {berichten.length > 0 && <p className="note mt-3">{plural(berichten.length, 'bericht', 'berichten')} over je verlof en ruilen.</p>}
        </Box>
      </Sectie>
    </>
  );
}
