/** Uitleg bij een toewijzing: waarom deze persoon en dit dagdeel, en wat het alternatief had gekost. */
import { alternatief, uur, type Plan } from './verdeel';
import { wegVan } from './geo';
import type { Kostenopbouw } from './types';

export const ONDERDELEN: { key: Exclude<keyof Kostenopbouw, 'totaal'>; label: string; uitleg: string }[] = [
  { key: 'reis', label: 'Reistijd', uitleg: 'Extra rijden in de dagroute: heen, door naar een volgend gesprek, en de helft van de terugreis.' },
  { key: 'werkdruk', label: 'Werkdruk', uitleg: 'Hoe meer recente dossiers (naar contract), hoe zwaarder een extra dossier weegt.' },
  { key: 'reeks', label: 'Dagen achter elkaar', uitleg: 'Al meerdere dagen achter elkaar een gesprek.' },
  { key: 'regio', label: 'Buiten regio/cluster', uitleg: 'Iemand van buiten de eigen regio of het eigen cluster.' },
  { key: 'tweede', label: 'Tweede gesprek (2)', uitleg: 'Het tweede gesprek van iemand met een 2: die plek komt pas na de eerste plekken in het cluster.' },
  { key: 'inzet1B', label: '1B inzetten', uitleg: 'De beschikbaarheidsdienst valt, en is dan geen achtervang meer.' },
  { key: 'flexibiliteit', label: 'Ruimte later op de dag', uitleg: 'Deze plek is niet meer vrij voor een melding die later binnenkomt: verwacht tekort x prijs van een tekort.' },
  { key: 'klant', label: 'Familie', uitleg: 'Middag in plaats van ochtend, of afwijken van de voorkeur van de familie.' },
];

function min(n: number): string {
  const r = Math.round(n);
  return `${r} min`;
}

/** De regel bij een toewijzing die al is toegezegd (doorgegeven). */
export const AL_TOEGEZEGD = 'Al toegezegd; blijft staan.';

const VANAF: Record<string, string> = { thuis: 'van huis', gesprek: 'na het vorige gesprek', voorgang: 'na een voorgang', afspraak: 'na een afspraak' };

export interface Uitleg {
  kop: string;
  regels: string[];
  /** Vergelijking met de dichtstbijzijnde andere plek. */
  vergelijking?: string;
  verschil?: { label: string; delta: number }[];
}

export function uitleg(plan: Plan, mid: string): Uitleg | null {
  const sid = plan.slotVan.get(mid);
  if (!sid) return null;
  const s = plan.slots.get(sid)!, p = plan.personen.get(s.persoonId)!, m = plan.meldingen.get(mid)!;
  const stap = plan.stapVan(sid)!;
  const o = plan.opbouw(mid);
  const kop = `${p.naam} (${p.regio}), ${s.dagdeel} ${uur(stap.start)}, ${min(stap.reistijd)} rijden ${VANAF[stap.vanaf]}`;
  const regels: string[] = [];
  if (plan.isVast(mid)) regels.push(AL_TOEGEZEGD);
  if (stap.waarschuwing) regels.push(stap.waarschuwing);
  if (m.vast && !plan.isVast(mid)) regels.push('Was toegezegd aan een plek die er niet meer is (bijvoorbeeld door ziekte); daarom een nieuwe plek.');
  const w = wegVan(stap.van, m.plek);
  if (w.veer > 0) regels.push(`Met de veerboot: ongeveer ${Math.round(w.veer)} minuten varen en wachten.`);
  else if (w.omweg) regels.push('Om het water heen of eroverheen via een brug, dam of tunnel.');
  // met een vaste volgorde (eerst de eerste plekken in het cluster, dan het tweede gesprek van een 2, dan de 1B) zeggen we dat erbij
  const volgorde = plan.par.tweedeGesprek > 0;
  if (s.soort === '1B') regels.push(volgorde ? 'Beschikbaarheidsdienst ingezet: in het cluster was geen gewone plek meer die paste, ook geen tweede gesprek van een 2.' : 'Beschikbaarheidsdienst ingezet: er was geen gewone plek die beter paste.');
  else if (plan.isTweede(p, sid)) regels.push(volgorde ? `Het tweede gesprek van ${p.naam} (een 2): de eerste plekken in het cluster waren bezet of pasten niet.` : `Het tweede gesprek van ${p.naam} vandaag.`);
  if (m.regio !== p.regio) regels.push(m.cluster === p.cluster ? `Melding in ${m.regio}, ${p.naam} komt uit ${p.regio} (zelfde cluster).` : `Melding in ${m.regio}, ${p.naam} komt uit een ander cluster.`);
  if (stap.vanaf !== 'thuis') regels.push(`Begint ${VANAF[stap.vanaf]}, niet van huis.`);
  if (m.voorkeurDagdeel && m.voorkeurDagdeel !== s.dagdeel) regels.push(`De familie had liever de ${m.voorkeurDagdeel}.`);
  if (m.uiterlijk != null) regels.push(`Uiterlijk ${uur(m.uiterlijk)} (24 uur na de melding).`);
  const andere = [...plan.slotVan.entries()].filter(([x, y]) => x !== mid && plan.slots.get(y)!.persoonId === p.id).length;
  if (andere && !plan.isTweede(p, sid)) regels.push(`${p.naam} heeft vandaag nog een gesprek.`);
  regels.push(`Recente dossiers ${p.belasting.toFixed(1)}, contract ${p.contract} uur${p.reeks >= 2 ? `, ${p.reeks} dagen achter elkaar` : ''}.`);

  const uit: Uitleg = { kop, regels };
  const alt = alternatief(plan, mid);
  if (alt) {
    const as = plan.slots.get(alt.sid)!, ap = plan.personen.get(as.persoonId)!;
    const verschil = ONDERDELEN.map((d) => ({ label: d.label, delta: alt.opbouw[d.key] - o[d.key] })).filter((x) => Math.abs(x.delta) >= 0.5);
    uit.vergelijking = `De dichtstbijzijnde andere vrije plek: ${ap.naam} (${ap.regio}), ${as.dagdeel}, ${min(alt.reistijd)} rijden. Die kost in totaal ${alt.delta >= 0 ? `${min(alt.delta)} meer` : `${min(-alt.delta)} minder`}${verschil.length ? ':' : '.'}`;
    uit.verschil = verschil;
  }
  return uit;
}
