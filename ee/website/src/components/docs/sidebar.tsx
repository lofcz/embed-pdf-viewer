'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useConfig } from './config-provider';

type TreeItem = {
  name: string;
  route?: string;
  title: ReactNode;
  children?: TreeItem[];
};

function SidebarTree({ items, pathname }: { items: TreeItem[]; pathname: string }) {
  return (
    <>
      {items.map((item) => {
        const hasChildren = Boolean(item.children && item.children.length > 0);

        if (hasChildren) {
          return (
            <div key={item.name} className="mt-4 first:mt-0">
              <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {item.title}
              </p>
              <div className="flex flex-col gap-1">
                <SidebarTree items={item.children ?? []} pathname={pathname} />
              </div>
            </div>
          );
        }

        if (!item.route) return null;
        const active = pathname === item.route;

        return (
          <Link
            key={item.route}
            href={item.route}
            className={`rounded-md px-2 py-1 transition ${
              active
                ? 'bg-primary-50 text-primary-700 font-medium'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            {item.title}
          </Link>
        );
      })}
    </>
  );
}

export function Sidebar() {
  const { docsDirectories, activeType } = useConfig();
  const pathname = usePathname();

  // Hide the sidebar on standalone pages such as the /docs landing.
  if (activeType === 'page') return null;
  if (!docsDirectories || docsDirectories.length === 0) return null;

  return (
    <aside className="hidden w-64 shrink-0 border-r border-gray-200 py-10 pr-6 md:block">
      <nav className="flex flex-col gap-1 text-sm">
        <SidebarTree items={docsDirectories as TreeItem[]} pathname={pathname} />
      </nav>
    </aside>
  );
}
