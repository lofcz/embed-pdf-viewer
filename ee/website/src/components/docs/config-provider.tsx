'use client';

import { usePathname } from 'next/navigation';
import type { PageMapItem } from 'nextra';
import { normalizePages } from 'nextra/normalize-pages';
import { createContext, useContext, type ReactNode } from 'react';

import { Sidebar } from './sidebar';

type NormalizeResult = ReturnType<typeof normalizePages>;

const ConfigContext = createContext<NormalizeResult | null>(null);

export function useConfig(): NormalizeResult {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return ctx;
}

export function ConfigProvider({
  pageMap,
  children,
}: {
  pageMap: PageMapItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const normalized = normalizePages({ list: pageMap, route: pathname });

  return (
    <ConfigContext.Provider value={normalized}>
      <div className="mx-auto flex w-full max-w-7xl gap-8 px-6">
        <Sidebar />
        <main className="min-w-0 flex-1 py-10">{children}</main>
      </div>
    </ConfigContext.Provider>
  );
}
