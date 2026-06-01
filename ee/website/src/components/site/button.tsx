import Link from 'next/link';
import type { ReactNode } from 'react';

type Variant = 'primary' | 'outline' | 'violet';
type Size = 'sm' | 'md';

const base =
  'relative inline-flex items-center justify-center gap-2.5 rounded-[10px] font-sans font-bold whitespace-nowrap no-underline transition-all duration-200 hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-cp-blue';

const sizes: Record<Size, string> = {
  md: 'h-[50px] px-[22px] text-base',
  sm: 'h-[42px] px-[18px] text-[15px]',
};

const variants: Record<Variant, string> = {
  primary:
    'bg-cp-blue text-white hover:bg-cp-blue600 hover:shadow-[0_8px_20px_rgba(22,119,255,0.28)] active:bg-cp-blue700',
  outline:
    'border-2 border-cp-blue text-cp-blue hover:border-cp-blue600 hover:bg-[rgba(22,119,255,0.08)] hover:text-cp-blue600 active:bg-[rgba(22,119,255,0.16)]',
  violet:
    'bg-cp-violet text-white hover:bg-cp-violet600 hover:shadow-[0_8px_20px_rgba(124,92,252,0.30)] active:bg-cp-violetDeep',
};

export type CpButtonProps = {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
};

export function CpButton({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
}: CpButtonProps) {
  const classes = `${base} ${sizes[size]} ${variants[variant]} ${className}`;
  const isExternal = /^(https?:|mailto:|tel:|#)/.test(href);

  if (isExternal) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
