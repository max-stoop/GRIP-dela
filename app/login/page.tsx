import { redirect } from 'next/navigation';
import { gedeeld } from '@/lib/platform';
import { LoginFormulier } from './LoginFormulier';

export const metadata = { title: 'Inloggen' };
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  if (!gedeeld()) redirect('/');
  return <LoginFormulier omgeving={process.env.GRIP_OMGEVING} />;
}
