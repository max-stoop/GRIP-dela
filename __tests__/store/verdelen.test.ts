import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  bewaarMedewerker, geefDagMeldingVrij, geefDagVerdelingDoor, getState, verwijderDagMelding, voegDagMeldingenToe, wijzigDagMelding, zetDagVerdeling, zetWoonpostcodes,
} from '@/lib/store/store';

// zonder IndexedDB (jsdom) mislukt het wegschrijven; de toestand in het geheugen is wat we testen
beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });

const datum = '2026-10-20';
const dag = () => getState().verdelingen[datum];

describe('meldingen van een dag', () => {
  it('toevoegen, verdelen, doorgeven, vrijgeven, wijzigen en weghalen', () => {
    expect(voegDagMeldingenToe(datum, [{ postcode: '3511', regio: 'Utrecht' }, { postcode: '1012', regio: 'Amsterdam', tijd: 780 }])).toEqual(['M1', 'M2']);
    expect(voegDagMeldingenToe(datum, [{ postcode: '6211', regio: 'Zuid Limburg' }])).toEqual(['M3']);
    expect(dag().meldingen.map((m) => m.id)).toEqual(['M1', 'M2', 'M3']);

    zetDagVerdeling(datum, [
      { meldingId: 'M1', persoonId: 'a', slotId: 'a#0', start: 600, reistijd: 12 },
      { meldingId: 'M2', persoonId: 'b', slotId: 'b#0', start: 780, reistijd: 20 },
    ], 'Plan');
    expect(dag()).toMatchObject({ door: 'Plan', toewijzingen: [{ meldingId: 'M1' }, { meldingId: 'M2' }] });
    expect(dag().verdeeld).toBeTruthy();
    expect(getState().activiteit[0].tekst).toMatch(/verdeeld: 2 van 3/);

    geefDagVerdelingDoor(datum, 'Plan');
    expect(dag().toewijzingen.every((t) => t.vast)).toBe(true);

    // opnieuw verdelen: wat is doorgegeven en op dezelfde plek blijft, blijft doorgegeven
    zetDagVerdeling(datum, [
      { meldingId: 'M1', persoonId: 'a', slotId: 'a#0', start: 600, reistijd: 12 },
      { meldingId: 'M2', persoonId: 'c', slotId: 'c#0', start: 780, reistijd: 25 },
      { meldingId: 'M3', persoonId: 'd', slotId: 'd#0', start: 600, reistijd: 9 },
    ], 'Plan');
    expect(dag().toewijzingen.map((t) => [t.meldingId, !!t.vast])).toEqual([['M1', true], ['M2', false], ['M3', false]]);

    geefDagMeldingVrij(datum, 'M1');
    expect(dag().toewijzingen.find((t) => t.meldingId === 'M1')!.vast).toBe(false);

    // een andere tijd: wat verdeeld was, vervalt
    wijzigDagMelding(datum, 'M3', { tijd: 690 });
    expect(dag().meldingen.find((m) => m.id === 'M3')!.tijd).toBe(690);
    expect(dag().toewijzingen.some((t) => t.meldingId === 'M3')).toBe(false);

    verwijderDagMelding(datum, 'M2');
    expect(dag().meldingen.map((m) => m.id)).toEqual(['M1', 'M3']);
    expect(dag().toewijzingen.map((t) => t.meldingId)).toEqual(['M1']);
    // een nieuwe melding krijgt een nieuw nummer
    expect(voegDagMeldingenToe(datum, [{ postcode: '3521', regio: 'Utrecht' }])).toEqual(['M4']);
  });

  it('woonplaatsen: alleen de 4 cijfers, leeg haalt hem weg', () => {
    const a = bewaarMedewerker({ regio: 'Utrecht', naam: 'Anna', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const b = bewaarMedewerker({ regio: 'Utrecht', naam: 'Bram', contract: 32, voorkeur: 'O', weekendgroep: 0, postcode: '3521' });
    zetWoonpostcodes({ [a]: '3511 AB', [b]: '' });
    const m = (id: string) => getState().medewerkers.find((x) => x.id === id)!;
    expect(m(a).postcode).toBe('3511');
    expect('postcode' in m(b)).toBe(false);
    zetWoonpostcodes({ [a]: 'onzin' });
    expect(m(a).postcode).toBeUndefined();
  });
});
