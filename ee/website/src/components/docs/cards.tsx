import Link from 'next/link';
import type { ReactNode } from 'react';

export function Cards({ children }: { children: ReactNode }) {
  return <div className="my-6 grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Card({
  title,
  description,
  href,
}: {
  title: string;
  description?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="hover:border-primary-300 group block rounded-xl border border-gray-200 p-5 transition hover:shadow-sm"
    >
      <span className="flex items-center justify-between font-semibold text-gray-900">
        {title}
        <span
          aria-hidden
          className="group-hover:text-primary-600 text-gray-300 transition group-hover:translate-x-0.5"
        >
          &rarr;
        </span>
      </span>
      {description ? <span className="mt-1 block text-sm text-gray-600">{description}</span> : null}
    </Link>
  );
}
