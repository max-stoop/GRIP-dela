'use client';
import { fmtMoment } from '@/lib/dates';
import type { Activiteit } from '@/lib/store/types';

export function Activiteiten({ lijst }: { lijst: Activiteit[] }) {
  if (!lijst.length) return <p className="note">Nog geen activiteit.</p>;
  return (
    <ul className="grid gap-3">
      {lijst.map((a) => (
        <li key={a.id} className="grid grid-cols-[86px_1fr] gap-3 text-[15px]">
          <span className="note num pt-px">{fmtMoment(a.moment)}</span>
          <span>{a.tekst}{a.door && a.door !== 'demo' ? <span className="note"> · {a.door}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}
