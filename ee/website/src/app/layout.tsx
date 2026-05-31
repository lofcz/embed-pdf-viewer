import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SiteNavbar } from '@/components/site-navbar';

import './globals.css';

export const metadata: Metadata = {
  title: 'CloudPDF — The document platform for modern apps',
  description:
    'CloudPDF is the backend for your PDFs: secure storage, multi-tenant access control, real-time collaboration, annotations, forms, redaction, e-signatures, and server-side processing. Built on the open-source EmbedPDF viewer. Managed SaaS or self-hosted.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <SiteNavbar />
        {children}
      </body>
    </html>
  );
}
