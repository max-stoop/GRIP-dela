'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cx } from '@/lib/format';

export function Stap({ nr, icoon, titel, href, focus, children }: { nr: number; icoon: React.ReactNode; titel: string; href?: string; focus?: boolean; children: React.ReactNode }) {
  const inhoud = (
    <div className={cx('h-full', focus ? 'box-focus' : 'box')}>
      <div className="mb-2 flex items-center gap-2">
        <span className={cx('grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold', focus ? 'bg-white/15' : 'bg-soft')}>{nr}</span>
        <span className="flex items-center gap-1.5 font-semibold">{icoon} {titel}</span>
        {href && <ArrowRight size={15} className="ml-auto opacity-60" />}
      </div>
      <div className="text-[14.5px] leading-relaxed">{children}</div>
    </div>
  );
  return <li className="list-none">{href ? <Link href={href} className="block h-full text-inherit no-underline">{inhoud}</Link> : inhoud}</li>;
}
