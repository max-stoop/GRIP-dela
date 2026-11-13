import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, Literata } from 'next/font/google';
import './globals.css';

const display = Literata({ subsets: ['latin'], variable: '--font-display', display: 'swap', style: ['normal', 'italic'] });
const body = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'GRIP Regelplekken', template: '%s · GRIP Regelplekken' },
  description: 'Voorspellen, roosteren en toetsen van regelplekken in één app.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0D4463',
};

/** Zet het thema vóór de eerste weergave, zodat er geen witte flits is in donkere modus. */
const themaScript = `try{var t=localStorage.getItem('grip-thema');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning className={`${display.variable} ${body.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themaScript }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
