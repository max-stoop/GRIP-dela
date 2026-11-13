import { NextResponse } from 'next/server';
import { platform } from '@/lib/platform';

export const dynamic = 'force-dynamic';

/** Welke versie hier draait (de commit). De uitrol naar productie neemt precies de versie die op test staat. */
export function GET() {
  const omgeving = process.env.GRIP_OMGEVING || (platform() === 'azure' ? 'productie' : 'lokaal');
  return NextResponse.json({ versie: process.env.GRIP_VERSIE, omgeving });
}
