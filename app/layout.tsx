import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AuraType AI',
  description:
    'Cinematic & Dynamic Typing Studio with grapheme-accurate Vietnamese & English engine, Ghost Replay, and AI passage generation.',
  openGraph: {
    title: 'AuraType AI',
    description:
      'Cinematic & Dynamic Typing Studio with grapheme-accurate Vietnamese & English engine, Ghost Replay, and AI passage generation.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AuraType AI',
    description:
      'Cinematic & Dynamic Typing Studio with grapheme-accurate Vietnamese & English engine, Ghost Replay, and AI passage generation.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="vi"
      className={`${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <body suppressHydrationWarning className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
