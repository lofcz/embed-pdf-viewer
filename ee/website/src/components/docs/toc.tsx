import Link from 'next/link';
import type { ReactNode } from 'react';

export type TocItem = {
  value: ReactNode;
  id: string;
  depth: number;
};

export function Toc({ toc }: { toc?: TocItem[] }) {
  if (!toc || toc.length === 0) return null;

  return (
    <aside className="hidden w-56 shrink-0 py-10 pl-6 xl:block">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
        On this page
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {toc.map((item) => (
          <li key={item.id} style={{ paddingLeft: `${(item.depth - 2) * 12}px` }}>
            <Link href={`#${item.id}`} className="text-gray-500 transition hover:text-gray-900">
              {item.value}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
