import type { Metadata } from 'next';
import './globals.css';

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
