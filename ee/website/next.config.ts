import type { NextConfig } from 'next';
import nextra from 'nextra';

import { rehypeCodeExample } from './src/lib/rehype-code-example';
import { remarkCodeExample } from './src/lib/remark-code-example';

const withNextra = nextra({
  mdxOptions: {
    // Single dark theme so tokens get direct inline colors (matches the
    // CloudPDF design's hand-built code palette).
    rehypePrettyCodeOptions: {
      theme: 'material-theme-palenight',
      keepBackground: false,
    },
    remarkPlugins: [remarkCodeExample],
    rehypePlugins: [rehypeCodeExample],
  },
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withNextra(nextConfig);
