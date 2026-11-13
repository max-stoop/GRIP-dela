/** Demo voor de NBD: een team met voorkeuren, verlof en wensen, en een rooster dat de app zelf maakt. Reproduceerbaar. */
import { rng } from '../model/demo';
import type { RunData } from '../model/types';
import type { NormParameters } from '../capaciteit/parameters';
import { voorbeeldTeam } from '../rooster/demo';
import { ZZP_IN_ROOSTER, type Cellen, type DagVoorkeur, type Medewerker, type Tijden, type Voorkeurprofiel, type Wens, type WensSoort } from '../rooster/types';
import type { Verlof } from '../store/types';
import { addDays, fromDay, isoRange, mondayOf, toDay } from '../dates';
import { nbdBehoefte } from './behoefte';
import { NBD, type NbdParameters } from './parameters';
import { AANTAL_VAKKEN, leegUren, metDienst, SNELDIENSTEN } from './voorkeuren';
import { maakNbdRooster } from './voorstel';
import { nbdNa } from './ruil';
import { klachtenStandaard, maandstartDagen, planTaken, trainingStandaard, zoekMaandstart } from './taken';

interface NbdDemo {
  team: Medewerker[];
  profielen: Record<string, Voorkeurprofiel>;
  wensen: Wens[];
  verlof: Verlof[];
  cellen: Cellen;
  tijden: Tijden;
}

/** Ieder een eigen soort dienst, af en toe een dag die niet kan, om en om een weekend. */
export function nbdVoorbeeldVoorkeuren(team: Medewerker[], stempel: string): Record<string, Voorkeurprofiel> {
  const R = rng(777);
  const uit: Record<string, Voorkeurprofiel> = {};
  team.forEach((m, i) => {
    const soort = i % 5;
    const dienst = soort < 4 ? SNELDIENSTEN[soort] : null;
    const uren = leegUren();
    const nietDag = R.uniform() < 0.35 ? R.int(1, 5) : -1;
    for (const type of ['even', 'oneven'] as const) {
      for (let wd = 0; wd < 7; wd++) {
        const weekend = wd === 0 || wd === 6;
        let rij = '.'.repeat(AANTAL_VAKKEN);
        if (wd === nietDag) rij = 'n'.repeat(AANTAL_VAKKEN);
        else if (weekend && (type === 'even') === (m.weekendgroep === 1)) rij = R.uniform() < 0.6 ? 'n'.repeat(AANTAL_VAKKEN) : rij;
        else if (dienst && R.uniform() < (weekend ? 0.6 : 0.85)) rij = metDienst(rij, dienst.van, dienst.tot);
        uren[type][wd] = rij;
      }
    }
    const dagen: DagVoorkeur[] = ['neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal'];
    uit[m.id] = { medewerkerId: m.id, dagen, dienst: 'geen', beschikbaarheid: 'neutraal', maxDagenPerWeek: m.contract <= 24 ? 4 : null, uren, bijgewerkt: stempel };
  });
  return uit;
}

export function nbdDemo(o: {
  vandaag: string;
  van: string;
  tot: string;
  p: NbdParameters;
  normen: NormParameters;
  basis?: RunData | null;
  laatste?: RunData | null;
  maakId: () => string;
  minVrijeWeekenden: number;
  stempel: string;
}): NbdDemo {
  const R = rng(4242);
  const team = voorbeeldTeam(NBD, o.maakId);
  const profielen = nbdVoorbeeldVoorkeuren(team, o.stempel);

  const verlof: Verlof[] = [];
  const cellen: Cellen = {};
  team.slice(0, 4).forEach((m, i) => {
    const ma = fromDay(mondayOf(toDay(addDays(o.vandaag, 14 + 12 * i))));
    const tot = addDays(ma, i % 2 ? 4 : 6);
    if (tot > o.tot) return;
    verlof.push({ id: o.maakId(), medewerkerId: m.id, regio: NBD, van: ma, tot, soort: 'vakantie', status: 'goedgekeurd', aangevraagd: o.stempel, beoordeeld: o.stempel, beoordeelaar: 'demo' });
    for (const d of isoRange(ma, tot)) (cellen[m.id] ??= {})[d] = 'V';
  });

  const wensen: Wens[] = [];
  for (const m of team.slice(4, 10)) {
    const datum = addDays(o.vandaag, R.int(4, 40));
    if (cellen[m.id]?.[datum]) continue;
    wensen.push({ id: o.maakId(), medewerkerId: m.id, regio: NBD, datum, soort: R.pick(['vrij', 'vrij', 'ochtend', 'avond', 'werken'] as WensSoort[]), gemaakt: o.stempel });
  }

  const dates = isoRange(o.van, o.tot);
  const behoefte = nbdBehoefte({ basis: o.basis, laatste: o.laatste, norm: o.normen }, o.p, dates, 'basis');
  const v = maakNbdRooster({ team, dates, cellen, tijden: {}, behoefte, p: o.p, profielen, wensen, modus: 'opnieuw', minVrijeWeekenden: o.minVrijeWeekenden });
  let na = nbdNa(cellen, {}, v.wijzigingen);
  for (const maand of [...new Set(dates.map((d) => d.slice(0, 7)))]) {
    const dagen = dates.filter((d) => d.startsWith(maand));
    if (!dagen[0].endsWith('-01')) continue;
    na = nbdNa(na.cellen, na.tijden, zoekMaandstart({ team, dagen: maandstartDagen(dagen, dagen[0]), cellen: na.cellen, tijden: na.tijden, behoefte, p: o.p, duur: 1, groepen: 3, van: 8, tot: 20, minVrijeWeekenden: o.minVrijeWeekenden, profielen }).wijzigingen);
  }
  na = nbdNa(na.cellen, na.tijden, planTaken({ team, dates, cellen: na.cellen, tijden: na.tijden, behoefte, p: o.p, training: trainingStandaard(o.p), klachten: { ...klachtenStandaard(o.p), uren: 6 } }).wijzigingen);
  if (ZZP_IN_ROOSTER) team.push({ id: o.maakId(), regio: NBD, naam: 'Monique de Vries (ZZP)', contract: 24, voorkeur: 'O', weekendgroep: 0, functie: 'UV', extern: true, actief: true });
  return { team, profielen, wensen, verlof, cellen: na.cellen, tijden: na.tijden };
}
