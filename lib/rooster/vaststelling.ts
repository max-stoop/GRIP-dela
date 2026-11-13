/** Eén plek voor de status van de vaststelling (§ 5.1), zodat het rooster en het dashboard hetzelfde zeggen. */
import type { Goedkeuring } from '../store/types';

export type Vaststelling = 'goed' | 'wacht' | 'afgekeurd' | 'geen';

export const VASTSTELLING: Record<Vaststelling, { kort: string; lang: string }> = {
  goed: { kort: 'Vastgesteld', lang: 'Goedgekeurd door de regiomanager' },
  wacht: { kort: 'Bij de regiomanager', lang: 'Aangeboden, wacht op goedkeuring door de regiomanager' },
  afgekeurd: { kort: 'Afgekeurd', lang: 'Afgekeurd door de regiomanager: nieuw advies nodig' },
  geen: { kort: 'Advies nodig', lang: 'Nog geen advies van de planner' },
};

export function vaststellingVan(g: Goedkeuring | undefined): Vaststelling {
  if (g?.status === 'goedgekeurd' && g.advies) return 'goed';
  if (g?.status === 'ter_goedkeuring' && g.advies) return 'wacht';
  if (g?.status === 'afgekeurd') return 'afgekeurd';
  return 'geen';
}
