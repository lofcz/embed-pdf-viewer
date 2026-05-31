import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'CloudPDF — Enterprise PDF infrastructure',
  description:
    'CloudPDF is the enterprise, self-hostable document engine and backend for EmbedPDF. Annotations, collaboration, and storage at scale.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}
