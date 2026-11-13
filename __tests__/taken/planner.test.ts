// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { startPlanner, uurInNederland } from '@/lib/taken/planner';

describe('dagelijkse taak binnen de app', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('rekent in Nederlandse tijd, ook met zomertijd', () => {
    expect(uurInNederland(new Date('2026-01-15T05:30:00Z'))).toBe(6);
    expect(uurInNederland(new Date('2026-07-15T03:59:00Z'))).toBe(5);
    expect(uurInNederland(new Date('2026-07-15T04:00:00Z'))).toBe(6);
  });

  it('start pas vanaf 06:00 en nooit twee keer tegelijk', async () => {
    vi.useFakeTimers();
    let nu = new Date('2026-01-15T04:00:00Z'); // 05:00 in Nederland
    let klaar: () => void = () => {};
    const voer = vi.fn(() => new Promise<void>((r) => { klaar = r; }));
    const stop = startPlanner(voer, { elke: 1000, nu: () => nu });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(voer).not.toHaveBeenCalled();
    nu = new Date('2026-01-15T05:05:00Z');
    await vi.advanceTimersByTimeAsync(1000);
    expect(voer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(voer).toHaveBeenCalledTimes(1); // de vorige loopt nog
    klaar();
    await vi.advanceTimersByTimeAsync(1000);
    expect(voer).toHaveBeenCalledTimes(2);
    stop();
  });
});
