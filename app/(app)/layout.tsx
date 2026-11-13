import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { GeenToegang } from '@/components/auth/GeenToegang';
import { bepaalSessie } from '@/lib/sessie';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await bepaalSessie();
  if (u.soort === 'niet_ingelogd') redirect('/login');
  // ingelogd, maar niet bekend in de tabel users: geen toegang tot de app
  if (u.soort === 'geen_profiel') return <GeenToegang email={u.email} reden={u.reden} />;
  return <AppShell sessie={u.sessie}>{children}</AppShell>;
}
