'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftRight, Check, X, Undo2, Hand, Palmtree } from 'lucide-react';
import { useDoor, useSessie } from '@/components/sessie';
import { useActie } from '@/components/toast';
import { Box, Laden, PaginaKop, Pill, Sectie } from '@/components/ui';
import { AanbiedModal, Dienst, DienstOmschrijving, periode, regioNaam, RuilRegel, RUIL_STATUS, ToetsUitkomst, VerlofRuilModal } from '@/components/ruil/RuilOnderdelen';
import { accepteerRuil, maakRuil, maakVerlofRuil, toetsRuil, trekRuilIn, useApp, weigerRuil } from '@/lib/store/store';
import { NaarNbd } from '@/components/nbd/NaarNbd';
import { RuilenPlanner, RuilTabel, useNamen } from '@/components/ruil/RuilenPlanner';
import { addDays, fmtDag, isoRange, todayIso } from '@/lib/dates';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { cel } from '@/lib/rooster/toets';

export default function RuilenPagina() {
  const s = useSessie();
  return <Suspense fallback={<Laden />}>{s.rol === 'medewerker' ? <MijnRuilen /> : <NaarNbd naar="/nbd/ruilen"><RuilenPlanner regios={s.regios} /></NaarNbd>}</Suspense>;
}

function MijnRuilen() {
  const s = useSessie();
  const door = useDoor();
  const actie = useActie();
  const params = useSearchParams();
  const namen = useNamen();
  const vandaag = todayIso();
  const ik = useApp((x) => x.medewerkers.find((m) => m.id === s.medewerkerId));
  const pub = useApp((x) => (ik ? x.publicaties[ik.regio] : undefined));
  const ruil = useApp((x) => x.ruil);
  const alleVerlof = useApp((x) => x.verlof);
  const [modal, setModal] = useState<string | null>(null);
  const [verlofModal, setVerlofModal] = useState<string | null>(null);
  const [alles, setAlles] = useState(false);
  useEffect(() => {
    const d = params.get('dienst'); if (d) setModal(d);
    const v = params.get('verlof'); if (v) setVerlofModal(v);
    if (params.get('tab') === 'verlof') document.getElementById('verlof-ruilen')?.scrollIntoView({ block: 'start' });
  }, [params]);
  if (!ik) return <Laden />;

  const mijnVerlof = alleVerlof.filter((v) => v.medewerkerId === ik.id && v.status === 'goedgekeurd' && v.van > vandaag).sort((a, b) => a.van.localeCompare(b.van));
  const lopendVerlof = (id: string) => ruil.find((r) => r.soort === 'verlof' && (r.verlofId === id || r.tegenVerlofId === id) && ['open', 'wacht_planner'].includes(r.status));
  const verlofVoorModal = alleVerlof.find((v) => v.id === verlofModal && v.medewerkerId === ik.id) ?? null;

  const mijnDiensten = pub ? isoRange(addDays(vandaag, 1), pub.tot).filter((d) => DIENSTEN[cel(pub.cellen, ik.id, d)].werk && cel(pub.cellen, ik.id, d) !== 'V') : [];
  const lopend = (d: string) => ruil.find((r) => r.aanbiederId === ik.id && r.datum === d && ['open', 'wacht_planner'].includes(r.status));
  const aanbod = ruil.filter((r) => r.regio === ik.regio && r.status === 'open' && r.soort === 'aanbieden' && r.aanbiederId !== ik.id && r.datum > vandaag);
  const aanMij = ruil.filter((r) => r.status === 'open' && r.soort !== 'aanbieden' && r.ontvangerId === ik.id);
  const mijn = ruil.filter((r) => r.aanbiederId === ik.id || r.ontvangerId === ik.id).sort((a, b) => b.gemaakt.localeCompare(a.gemaakt));

  return (
    <>
      <PaginaKop titel="Ruilen" lead="Bied een dienst aan, ruil een dienst of je verlof met een collega, of neem een dienst over. Elke ruil wordt automatisch getoetst aan ATW, CAO en het roosterbeleid en daarna door de planner goedgekeurd." />

      {aanMij.length > 0 && (
        <Box titel="Verzoeken aan jou" className="mb-5" rechts={<Pill soort="warn">{aanMij.length}</Pill>}>
          <ul className="grid gap-3">
            {aanMij.map((r) => (
              <li key={r.id} className="grid gap-2 rounded-xl border border-line p-3">
                <RuilRegel r={r} namen={namen} />
                {r.opmerking && <span className="note">“{r.opmerking}”</span>}
                <ToetsUitkomst t={toetsRuil(r, ik.id)} />
                <div className="flex gap-2">
                  <button type="button" className="btn btn-teal btn-sm" onClick={() => actie(() => accepteerRuil(r.id, ik.id, door), 'Akkoord gegeven. De planner keurt de ruil nog goed.')}><Check size={15} /> Akkoord</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(() => weigerRuil(r.id, door), 'Verzoek geweigerd.')}><X size={15} /> Weigeren</button>
                </div>
              </li>
            ))}
          </ul>
        </Box>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Box titel="Mijn komende diensten" className="min-w-0">
          {mijnDiensten.length ? (
            <>
            <ul className="divide-y divide-[color:var(--line)]">
              {(alles ? mijnDiensten : mijnDiensten.filter((d) => d <= addDays(vandaag, 28))).map((d) => {
                const code = cel(pub!.cellen, ik.id, d), l = lopend(d);
                return (
                  <li key={d} className="flex items-center gap-3 py-2.5">
                    <Dienst code={code} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{fmtDag(d)}</div>
                      <div className="note truncate"><DienstOmschrijving code={code} mid={ik.id} datum={d} /></div>
                    </div>
                    {l ? <Pill soort={RUIL_STATUS[l.status][0]}>{RUIL_STATUS[l.status][1]}</Pill> : (
                      <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setModal(d)} aria-label="Aanbieden of ruilen"><ArrowLeftRight size={15} /> <span className="hidden sm:inline">Aanbieden of ruilen</span><span className="sm:hidden">Ruilen</span></button>
                    )}
                  </li>
                );
              })}
            </ul>
            {!alles && mijnDiensten.some((d) => d > addDays(vandaag, 28)) && (
              <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setAlles(true)}>Alle {mijnDiensten.length} diensten tonen (t/m {fmtDag(pub!.tot)})</button>
            )}
            </>
          ) : <p className="note">Geen gepubliceerde diensten in de komende periode.</p>}
        </Box>

        <Box titel="Aangeboden door collega's" className="min-w-0">
          {aanbod.length ? (
            <ul className="grid gap-3">
              {aanbod.map((r) => {
                const t = toetsRuil(r, ik.id);
                const bezet = cel(pub?.cellen ?? {}, ik.id, r.datum) !== '-';
                return (
                  <li key={r.id} className="grid gap-2 rounded-xl border border-line p-3">
                    <RuilRegel r={r} namen={namen} />
                    {r.opmerking && <span className="note">“{r.opmerking}”</span>}
                    {bezet ? <span className="note">Je bent die dag niet vrij (dienst, verlof of ziek).</span> : <ToetsUitkomst t={t} />}
                    <div><button type="button" className="btn btn-teal btn-sm" disabled={bezet || !t.ok} onClick={() => actie(() => accepteerRuil(r.id, ik.id, door), 'Je neemt de dienst over. De planner keurt het nog goed.')}><Hand size={15} /> Overnemen</button></div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="note">Er wordt nu niets aangeboden in {regioNaam(ik.regio)}.</p>}
        </Box>
      </div>

      <div id="verlof-ruilen" className="mt-5 scroll-mt-24">
        <Box titel="Verlof ruilen" className="min-w-0" rechts={<Link className="text-sm font-semibold text-accent" href="/verlof">Naar verlof</Link>}>
          <p className="note mb-3">Ruil goedgekeurd verlof met dat van een collega met dezelfde functie. Jullie nemen in beide periodes elkaars rooster over, zodat de bezetting gelijk blijft.</p>
          {mijnVerlof.length ? (
            <ul className="divide-y divide-[color:var(--line)]">
              {mijnVerlof.map((v) => {
                const l = lopendVerlof(v.id);
                return (
                  <li key={v.id} className="flex items-center gap-3 py-2.5">
                    <Dienst code="V" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{periode(v.van, v.tot)}</div>
                      <div className="note truncate">{v.soort}{v.opmerking ? ` · ${v.opmerking}` : ''}</div>
                    </div>
                    {l ? <Pill soort={RUIL_STATUS[l.status][0]}>{RUIL_STATUS[l.status][1]}</Pill> : (
                      <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setVerlofModal(v.id)}><Palmtree size={15} /> Ruilen</button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : <p className="note">Je hebt geen goedgekeurd verlof dat nog moet beginnen.</p>}
        </Box>
      </div>

      <Sectie titel="Mijn verzoeken">
        <RuilTabel lijst={mijn} namen={namen} acties={(r) => r.aanbiederId === ik.id && ['open', 'wacht_planner'].includes(r.status) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => actie(() => trekRuilIn(r.id, door), 'Verzoek ingetrokken.')}><Undo2 size={14} /> Intrekken</button> : null} />
      </Sectie>

      <AanbiedModal
        open={!!modal}
        ik={ik}
        datum={modal}
        onClose={() => setModal(null)}
        onVerstuur={(r) => {
          actie(() => { maakRuil({ ...r, aanbiederId: ik.id, dienst: '-' }, door); setModal(null); }, r.soort === 'aanbieden' ? "Je dienst staat in het aanbod voor je collega's." : 'Ruilverzoek verstuurd naar je collega.');
        }}
      />
      <VerlofRuilModal
        open={!!verlofVoorModal}
        ik={ik}
        verlof={verlofVoorModal}
        onClose={() => setVerlofModal(null)}
        onVerstuur={(r) => {
          actie(() => { maakVerlofRuil({ aanbiederId: ik.id, verlofId: verlofVoorModal!.id, ...r }, door); setVerlofModal(null); }, 'Verzoek om verlof te ruilen verstuurd naar je collega.');
        }}
      />
    </>
  );
}

