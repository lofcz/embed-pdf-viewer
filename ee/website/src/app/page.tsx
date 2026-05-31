import type { ReactNode } from 'react';

const CONTACT_EMAIL = 'hello@cloudpdf.io';
const EMBEDPDF_URL = 'https://www.embedpdf.com';

export default function HomePage() {
  return (
    <div className="bg-white text-gray-900">
      <Hero />
      <Foundation />
      <FrontEnd />
      <Capabilities />
      <Deploy />
      <FinalCta />
      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,theme(colors.primary.100),transparent)]"
      />
      <div className="mx-auto max-w-4xl px-6 py-24 text-center sm:py-32">
        <span className="border-primary-200 bg-primary-50 text-primary-700 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium">
          <span className="bg-primary-500 h-1.5 w-1.5 rounded-full" />
          From the makers of EmbedPDF · 1M+ downloads / month
        </span>

        <h1 className="mt-6 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
          The cloud PDF viewer for modern apps
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-gray-600">
          CloudPDF renders PDFs natively in React, Vue, and Svelte — and adds everything a real
          product needs: real-time collaboration, access control, secure storage, forms, redaction,
          and e-signatures. Headless or ready-made, managed for you or self-hosted.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="bg-primary-600 hover:bg-primary-700 w-full rounded-lg px-6 py-3 text-sm font-semibold text-white shadow-sm transition sm:w-auto"
          >
            Talk to us
          </a>
          <a
            href={EMBEDPDF_URL}
            className="group inline-flex w-full items-center justify-center gap-1 rounded-lg border border-gray-200 px-6 py-3 text-sm font-semibold text-gray-900 transition hover:border-gray-300 hover:bg-gray-50 sm:w-auto"
          >
            Explore EmbedPDF (open source)
            <ArrowRight className="transition group-hover:translate-x-0.5" />
          </a>
        </div>

        <p className="mt-6 text-sm text-gray-500">
          Native React, Vue &amp; Svelte · Headless or ready-made · Self-hosted or managed
        </p>
      </div>
    </section>
  );
}

const FOUNDATION_STATS = [
  { value: '1M+', label: 'downloads / month' },
  { value: 'MIT', label: 'open-source core' },
  { value: 'PDFium', label: 'rendering engine' },
  { value: '3', label: 'native frameworks' },
];

function Foundation() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <SectionHeading
        eyebrow="We make EmbedPDF"
        title="From the team behind EmbedPDF"
        subtitle="We build EmbedPDF, the open-source TypeScript PDF viewer that developers download more than a million times a month. CloudPDF is our cloud platform — the same fast, framework-agnostic rendering engine, now with collaboration, security, and storage built around it."
      />
      <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 text-center md:grid-cols-4">
        {FOUNDATION_STATS.map((stat) => (
          <div key={stat.label} className="bg-white px-6 py-8">
            <dt className="text-3xl font-bold tracking-tight text-gray-900">{stat.value}</dt>
            <dd className="mt-1 text-sm text-gray-500">{stat.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const FRAMEWORKS = ['React', 'Vue', 'Svelte', 'Preact', 'Vanilla JS'];

function FrontEnd() {
  return (
    <section id="frontend" className="border-y border-gray-100 bg-gray-50/60">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeading
          eyebrow="The viewer"
          title="Native in every framework. Built your way."
          subtitle="The CloudPDF viewer runs natively in React, Vue and Svelte. Choose how much of the UI you want to own."
        />

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {FRAMEWORKS.map((fw) => (
            <span
              key={fw}
              className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-700"
            >
              {fw}
            </span>
          ))}
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-8">
            <h3 className="text-xl font-semibold">Headless</h3>
            <p className="mt-2 text-gray-600">
              Build a viewer from scratch inside your own design system. Compose unstyled,
              tree-shakeable plugins and wire them into the components you already use.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {['MUI', 'Chakra', 'shadcn/ui', 'Tailwind', 'Vuetify'].map((ui) => (
                <span
                  key={ui}
                  className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600"
                >
                  {ui}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-8">
            <h3 className="text-xl font-semibold">Ready-made viewer</h3>
            <p className="mt-2 text-gray-600">
              Drop in a fully-featured viewer with a single line of code — or one CDN script tag. A
              polished toolbar, sidebars, search and annotations, out of the box.
            </p>
            <pre className="mt-5 overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">
              <code>{`<PDFViewer config={{ src: "/document.pdf" }} />`}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

type Capability = {
  title: string;
  description: string;
  icon: ReactNode;
};

const CAPABILITIES: Capability[] = [
  {
    title: 'Secure document storage',
    description:
      'Store PDFs in your own S3, GCS, Azure, or local disk. Tenant-isolated, content-addressed, and delivered through signed CDN URLs.',
    icon: <IconShield />,
  },
  {
    title: 'Access control',
    description:
      'Short-lived, scoped tokens per document and per user. Multi-tenant from day one, with password-protected PDF unlock.',
    icon: <IconKey />,
  },
  {
    title: 'Real-time collaboration',
    description:
      'Annotate together with live presence and co-editing. Per-user and per-group permissions keep every contribution in its lane.',
    icon: <IconUsers />,
  },
  {
    title: 'Annotations & layers',
    description:
      'Server-persisted annotations with layered, versioned edits — highlights, ink, notes, shapes and stamps that sync everywhere.',
    icon: <IconHighlight />,
  },
  {
    title: 'Form filling',
    description:
      'Fill, validate and save AcroForm fields server-side — text fields, checkboxes, radios, dropdowns and signatures.',
    icon: <IconForm />,
  },
  {
    title: 'Redaction',
    description:
      'True redaction that permanently removes text and image content from the file — not just a black box on top.',
    icon: <IconRedact />,
  },
  {
    title: 'E-signatures',
    description:
      'Capture and apply electronic signatures and initials, then save a sealed, audit-ready document.',
    icon: <IconSignature />,
  },
  {
    title: 'Server-side processing',
    description:
      'Rendering, text and geometry extraction, and document assembly powered by native PDFium in a managed worker pool.',
    icon: <IconCpu />,
  },
  {
    title: 'Audit logging',
    description:
      'Every change recorded with who, what and when — exportable for compliance and security reviews.',
    icon: <IconLog />,
  },
];

function Capabilities() {
  return (
    <section id="platform" className="mx-auto max-w-6xl px-6 py-20">
      <SectionHeading
        eyebrow="The platform"
        title="More than a viewer"
        subtitle="CloudPDF adds the cloud capabilities a standalone PDF viewer can't — storage, security, collaboration and server-side processing — all through one API."
      />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((cap) => (
          <div
            key={cap.title}
            className="hover:border-primary-200 rounded-2xl border border-gray-200 p-6 transition hover:shadow-sm"
          >
            <div className="bg-primary-50 text-primary-600 flex h-10 w-10 items-center justify-center rounded-lg">
              {cap.icon}
            </div>
            <h3 className="mt-4 text-base font-semibold">{cap.title}</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">{cap.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Deploy() {
  return (
    <section id="deploy" className="border-y border-gray-100 bg-gray-50/60">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeading
          eyebrow="Deploy your way"
          title="Managed for you, or on your own infrastructure"
          subtitle="Same platform, your choice of operating model."
        />
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-8">
            <h3 className="text-xl font-semibold">Managed SaaS</h3>
            <p className="mt-2 text-gray-600">
              We run and scale CloudPDF for you. Connect your front-end, mint a token, and ship — no
              infrastructure to operate.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-8">
            <h3 className="text-xl font-semibold">Self-hosted</h3>
            <p className="mt-2 text-gray-600">
              Run CloudPDF in your own cloud or on-prem with your storage and your keys. Your
              documents never leave your infrastructure.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="overflow-hidden rounded-3xl bg-gray-900 px-8 py-16 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Ready to build on CloudPDF?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-gray-300">
          Tell us what you&apos;re building and we&apos;ll help you get a complete document
          experience into production.
        </p>
        <div className="mt-8 flex justify-center">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-100"
          >
            Talk to us
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-100">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-gray-500 sm:flex-row">
        <div className="flex items-center gap-2 font-semibold text-gray-900">
          <Logo />
          CloudPDF
        </div>
        <p>© {new Date().getFullYear()} CloudPDF. All rights reserved.</p>
        <a className="transition hover:text-gray-900" href={EMBEDPDF_URL}>
          We make EmbedPDF
        </a>
      </div>
    </footer>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-primary-600 text-sm font-semibold uppercase tracking-wide">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-lg leading-8 text-gray-600">{subtitle}</p>
    </div>
  );
}

function Logo() {
  return (
    <span className="bg-primary-600 flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white">
      C
    </span>
  );
}

function ArrowRight({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 ${className}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

function iconProps() {
  return {
    className: 'h-5 w-5',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

function IconShield() {
  return (
    <svg {...iconProps()}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg {...iconProps()}>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l9 9M17 17l2-2M14 14l2-2" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg {...iconProps()}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
      <path d="M16 6a3 3 0 010 6M18 20c0-2-.7-3.6-2-4.6" />
    </svg>
  );
}

function IconHighlight() {
  return (
    <svg {...iconProps()}>
      <path d="M4 20h16" />
      <path d="M6 16l8-8 4 4-8 8H6v-4z" />
      <path d="M13 7l4 4" />
    </svg>
  );
}

function IconForm() {
  return (
    <svg {...iconProps()}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h4" />
    </svg>
  );
}

function IconRedact() {
  return (
    <svg {...iconProps()}>
      <path d="M4 7h16M4 12h6M4 17h10" />
      <rect x="13" y="14" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconSignature() {
  return (
    <svg {...iconProps()}>
      <path d="M3 17c3 0 3-8 6-8s1 6 4 6 2-4 5-4" />
      <path d="M3 21h18" />
    </svg>
  );
}

function IconCpu() {
  return (
    <svg {...iconProps()}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M10 10h4v4h-4z" />
      <path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" />
    </svg>
  );
}

function IconLog() {
  return (
    <svg {...iconProps()}>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </svg>
  );
}
