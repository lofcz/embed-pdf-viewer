'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const CONTACT_EMAIL = 'hello@cloudpdf.io';
const EMBEDPDF_URL = 'https://www.embedpdf.com';

export function SiteNavbar() {
  const pathname = usePathname();
  const onDocs = pathname.startsWith('/docs');

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="bg-primary-600 flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white">
            C
          </span>
          <span className="text-lg">CloudPDF</span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-gray-600 md:flex">
          <Link className="transition hover:text-gray-900" href="/#platform">
            Platform
          </Link>
          <Link className="transition hover:text-gray-900" href="/#frontend">
            Front-end
          </Link>
          <Link className="transition hover:text-gray-900" href="/#deploy">
            Deploy
          </Link>
          <Link
            className={onDocs ? 'text-primary-700' : 'transition hover:text-gray-900'}
            href="/docs"
          >
            Docs
          </Link>
          <a className="transition hover:text-gray-900" href={EMBEDPDF_URL}>
            EmbedPDF
          </a>
        </nav>

        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="bg-primary-600 hover:bg-primary-700 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition"
        >
          Talk to us
        </a>
      </div>
    </header>
  );
}
