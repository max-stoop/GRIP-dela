import { expect, type Page } from '@playwright/test';
import type { AppState } from '../lib/store/types';

/** Wat de app in de browser beschikbaar maakt voor tests (lib/store/store.ts). */
export type Grip = { getState: () => AppState; bewaarNu: () => Promise<void> };

/** Laadt de demo in een schone browser en wacht tot het dashboard er is. */
export async function laadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo laden' }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Actie nodig' })).toBeVisible();
}

/** Bekijk de app als medewerker (eerste medewerker in de regio). */
export async function alsMedewerker(page: Page, regio = 'Utrecht') {
  // een uitvaartverzorger (geen uitvaartleider), zodat er regeldiensten zijn om te ruilen
  const id = await page.evaluate((r) => (window as unknown as { __grip: Grip }).__grip.getState().medewerkers.find((m) => m.regio === r && (m.functie ?? 'UV') === 'UV')!.id, regio);
  await page.evaluate((mid) => localStorage.setItem('grip-bekijk-als', JSON.stringify({ rol: 'medewerker', medewerkerId: mid })), id);
  return id as string;
}

export async function staat<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(${fn})(window.__grip.getState())`) as Promise<T>;
}

/** Bekijk de app als een andere rol, bijvoorbeeld de regiomanager die het rooster en verlof goedkeurt (§ 5.1). */
export async function alsRol(page: Page, rol: 'regiomanager' | 'planner') {
  await page.evaluate((r) => localStorage.setItem('grip-bekijk-als', JSON.stringify({ rol: r, medewerkerId: null })), rol);
}
