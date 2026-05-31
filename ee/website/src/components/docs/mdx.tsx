import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

import { Toc, type TocItem } from './toc';

type WrapperProps = {
  children: ReactNode;
  toc?: TocItem[];
  metadata?: { title?: string; description?: string };
};

function Wrapper({ children, toc }: WrapperProps) {
  return (
    <div className="flex gap-8">
      <article className="prose-cloudpdf min-w-0 flex-1 py-2">{children}</article>
      <Toc toc={toc} />
    </div>
  );
}

function createHeading(Tag: 'h2' | 'h3' | 'h4', className: string) {
  return function Heading({ id, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
    return (
      <Tag id={id} className={`group scroll-mt-20 ${className}`} {...props}>
        {children}
        {id ? (
          <a
            href={`#${id}`}
            aria-label="Link to this section"
            className="hover:text-primary-600 ml-2 select-none text-gray-300 opacity-0 transition group-hover:opacity-100"
          >
            #
          </a>
        ) : null}
      </Tag>
    );
  };
}

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    wrapper: Wrapper,
    h1: (props) => (
      <h1
        className="mb-4 mt-2 scroll-mt-20 text-3xl font-bold tracking-tight text-gray-900"
        {...props}
      />
    ),
    h2: createHeading(
      'h2',
      'mb-3 mt-10 border-b border-gray-100 pb-2 text-2xl font-semibold tracking-tight text-gray-900',
    ),
    h3: createHeading('h3', 'mb-2 mt-8 text-xl font-semibold text-gray-900'),
    h4: createHeading('h4', 'mb-2 mt-6 text-lg font-semibold text-gray-900'),
    p: (props) => <p className="my-4 leading-7 text-gray-700" {...props} />,
    a: ({ href = '', ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <Link
        href={href}
        className="text-primary-600 font-medium underline-offset-4 hover:underline"
        {...props}
      />
    ),
    ul: (props) => <ul className="my-4 list-disc space-y-2 pl-6 text-gray-700" {...props} />,
    ol: (props) => <ol className="my-4 list-decimal space-y-2 pl-6 text-gray-700" {...props} />,
    li: (props) => <li className="leading-7" {...props} />,
    blockquote: (props) => (
      <blockquote
        className="my-4 border-l-4 border-gray-200 pl-4 italic text-gray-600"
        {...props}
      />
    ),
    hr: (props) => <hr className="my-8 border-gray-200" {...props} />,
    table: (props) => (
      <div className="my-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm" {...props} />
      </div>
    ),
    th: (props) => (
      <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold" {...props} />
    ),
    td: (props) => <td className="border-b border-gray-100 px-3 py-2" {...props} />,
    ...components,
  };
}
