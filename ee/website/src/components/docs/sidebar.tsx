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

function SidebarLink({ item, pathname }: { item: TreeItem; pathname: string }) {
  if (!item.route) return null;
  const active = pathname === item.route;

  return (
    <Link
      href={item.route}
      className={`group flex items-center gap-2.5 rounded-[9px] px-3 py-2 font-sans text-[14.5px] leading-[1.3] no-underline transition-colors ${
        active
          ? 'bg-cp-surface text-cp-blue font-bold shadow-[inset_2px_0_0_#1677FF]'
          : 'text-cp-ink hover:text-cp-navy hover:bg-[#EEF3FC]'
      }`}
    >
      <span
        className={`h-[5px] w-[5px] flex-shrink-0 rounded-full transition-colors ${
          active ? 'bg-cp-blue' : 'group-hover:bg-cp-blue bg-[#C2CEE6]'
        }`}
      />
      {item.title}
    </Link>
  );
}

function SidebarTree({ items, pathname }: { items: TreeItem[]; pathname: string }) {
  return (
    <>
      {items.map((item) => {
        const hasChildren = Boolean(item.children && item.children.length > 0);

        if (hasChildren) {
          return (
            <div key={item.name} className="mt-[26px] first:mt-0">
              <p className="font-display text-cp-muted px-3 pb-2.5 text-[11.5px] font-extrabold uppercase tracking-[0.1em]">
                {item.title}
              </p>
              <div className="flex flex-col gap-px">
                <SidebarTree items={item.children ?? []} pathname={pathname} />
              </div>
            </div>
          );
        }

        return <SidebarLink key={item.route ?? item.name} item={item} pathname={pathname} />;
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
    <aside className="sticky top-[84px] hidden h-[calc(100vh-84px)] w-[268px] shrink-0 overflow-y-auto py-8 pr-3.5 [scrollbar-color:#D5DEEF_transparent] [scrollbar-width:thin] md:block">
      <nav className="flex flex-col">
        <SidebarTree items={docsDirectories as TreeItem[]} pathname={pathname} />
      </nav>
    </aside>
  );
}
