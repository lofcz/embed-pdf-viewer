import Link from 'next/link';
import type { ReactNode } from 'react';

import { ArrowRight, CheckIcon, CloudIcon, ReactLogo, SvelteLogo, VueLogo } from './icons';

type Tone = 'blue' | 'violet';

const toneStyles: Record<
  Tone,
  { iconBox: string; check: string; lead: string; hover: string; fwHover: string }
> = {
  blue: {
    iconBox: 'bg-[#E7F0FF] text-cp-blue',
    check: 'bg-[#E7F0FF] text-cp-blue',
    lead: 'text-cp-blue',
    hover: 'hover:border-[#CFE0FF] hover:shadow-[0_30px_60px_-34px_rgba(22,119,255,0.3)]',
    fwHover:
      'hover:border-[#CFE0FF] hover:bg-[#FAFCFF] hover:shadow-[0_10px_22px_-14px_rgba(22,119,255,0.4)]',
  },
  violet: {
    iconBox: 'bg-[#F0ECFF] text-cp-violet',
    check: 'bg-[#F0ECFF] text-cp-violet',
    lead: 'text-cp-violet',
    hover: 'hover:border-[#DAD0FF] hover:shadow-[0_30px_60px_-34px_rgba(124,92,252,0.3)]',
    fwHover:
      'hover:border-[#DAD0FF] hover:bg-[#FCFAFF] hover:shadow-[0_10px_22px_-14px_rgba(124,92,252,0.42)]',
  },
};

type Framework = { name: string; cmd: string; logo: ReactNode };

const REACT = <ReactLogo width={20} height={20} />;
const VUE = <VueLogo width={19} height={19} />;
const SVELTE = <SvelteLogo width={17} height={17} />;
const VANILLA = (
  <span className="font-display inline-flex h-[19px] w-[19px] items-center justify-center rounded bg-[#F7DF1E] text-[9px] font-extrabold tracking-[-0.02em] text-[#1A1A1A]">
    JS
  </span>
);

function FrameworkLink({ fw, tone }: { fw: Framework; tone: Tone }) {
  return (
    <Link
      href="/docs/engine/getting-started"
      className={`border-cp-border group flex items-center gap-2.5 rounded-xl border bg-white px-3 py-3 no-underline transition-all hover:-translate-y-0.5 ${toneStyles[tone].fwHover}`}
    >
      <span className="inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] bg-[#F4F7FD] transition-colors">
        {fw.logo}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-display text-cp-navy text-[15px] font-bold tracking-[-0.01em]">
          {fw.name}
        </span>
        <span className="truncate font-mono text-[11.5px] font-medium text-[#8C9BBA]">
          {fw.cmd}
        </span>
      </span>
      <ArrowRight
        width={18}
        height={18}
        strokeWidth={2.4}
        className="flex-shrink-0 text-[#B9C6E0] transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

function PathCard({
  tone,
  icon,
  title,
  desc,
  feats,
  frameworks,
}: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  desc: string;
  feats: ReactNode[];
  frameworks: Framework[];
}) {
  const s = toneStyles[tone];
  return (
    <div
      className={`border-cp-border flex min-w-0 flex-col rounded-[22px] border bg-white p-[34px] pb-7 shadow-[0_1px_2px_rgba(10,26,77,0.04),0_22px_48px_-32px_rgba(10,26,77,0.22)] transition-all ${s.hover}`}
    >
      <div className="flex items-start gap-[22px]">
        <span
          className={`inline-flex h-[74px] w-[74px] flex-shrink-0 items-center justify-center rounded-[18px] ${s.iconBox}`}
        >
          {icon}
        </span>
        <div className="min-w-0 pt-1">
          <div className="font-display text-cp-navy text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em]">
            {title}
          </div>
          <p className="text-cp-muted mt-2.5 font-sans text-base leading-[1.55]">{desc}</p>
        </div>
      </div>

      <div className="mt-[26px] flex flex-col gap-[13px]">
        {feats.map((feat, i) => (
          <div key={i} className="flex items-center gap-3">
            <span
              className={`inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full ${s.check}`}
            >
              <CheckIcon width={13} height={13} />
            </span>
            <span className="text-cp-ink [&_b]:text-cp-navy font-sans text-[15px] leading-[1.4] [&_b]:font-bold">
              {feat}
            </span>
          </div>
        ))}
      </div>

      <div className="border-cp-borderSoft mt-7 flex items-center gap-2.5 border-t pt-6">
        <span
          className={`inline-flex flex-shrink-0 ${tone === 'blue' ? 'text-cp-blue' : 'text-cp-violet'}`}
        >
          <svg
            width={17}
            height={17}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m18 16 4-4-4-4" />
            <path d="m6 8-4 4 4 4" />
            <path d="m14.5 4-5 16" />
          </svg>
        </span>
        <span className="font-display text-cp-navy text-sm font-bold tracking-[-0.01em]">
          Get started in your framework
        </span>
        <span className="border-cp-border text-cp-muted ml-auto rounded-full border bg-[#F1F5FC] px-2.5 py-[5px] font-mono text-[11px] font-semibold tracking-[0.02em]">
          pick&nbsp;one
        </span>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-2.5">
        {frameworks.map((fw) => (
          <FrameworkLink key={fw.name} fw={fw} tone={tone} />
        ))}
      </div>
    </div>
  );
}

function DeployCard({
  tone,
  icon,
  title,
  lead,
  sub,
  href,
}: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  lead: string;
  sub: string;
  href: string;
}) {
  const s = toneStyles[tone];
  return (
    <Link
      href={href}
      className={`border-cp-border group flex items-center gap-[18px] rounded-[18px] border bg-white px-6 py-[22px] no-underline shadow-[0_1px_2px_rgba(10,26,77,0.04),0_18px_40px_-32px_rgba(10,26,77,0.18)] transition-all ${s.hover}`}
    >
      <span
        className={`inline-flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[14px] ${s.iconBox}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-cp-navy text-[18px] font-extrabold tracking-[-0.01em]">
          {title}
        </div>
        <div className={`mt-1 font-sans text-sm font-semibold ${s.lead}`}>{lead}</div>
        <div className="text-cp-muted mt-0.5 font-sans text-[13.5px] leading-[1.45]">{sub}</div>
      </div>
      <ArrowRight
        width={22}
        height={22}
        strokeWidth={2.4}
        className={`flex-shrink-0 transition-transform group-hover:translate-x-1 ${
          tone === 'blue' ? 'text-cp-blue' : 'text-cp-violet'
        }`}
      />
    </Link>
  );
}

function Line({ className }: { className: string }) {
  return <div className={`absolute bg-[#CDDCF4] ${className}`} />;
}

export function DocsLanding() {
  return (
    <section className="relative py-[clamp(40px,5vw,56px)]">
      <div className="relative mx-auto w-full max-w-[1180px]">
        {/* heading */}
        <div className="mx-auto max-w-[880px] text-center">
          <h1 className="font-display text-cp-navy text-balance text-[clamp(38px,5vw,60px)] font-extrabold leading-[1.06] tracking-[-0.03em]">
            Choose the right path to build better{' '}
            <em className="text-cp-blue not-italic">PDF experiences.</em>
          </h1>
          <p className="text-cp-ink mx-auto mt-[22px] max-w-[560px] font-sans text-[19px] leading-[1.6]">
            Launch faster with a ready-made viewer, or build exactly what you need with our headless
            components.
          </p>
        </div>

        {/* path pill */}
        <div className="mt-[clamp(40px,5vw,64px)] flex justify-center">
          <span className="font-display text-cp-blue relative z-[2] inline-flex items-center gap-2.5 rounded-full border border-[#D4E4FF] bg-white px-[22px] py-[13px] text-base font-extrabold tracking-[-0.01em] shadow-[0_8px_22px_-14px_rgba(22,119,255,0.4),0_1px_2px_rgba(10,26,77,0.05)]">
            <svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0"
            >
              <rect x="9" y="3" width="6" height="6" rx="1.5" />
              <rect x="3" y="15" width="6" height="6" rx="1.5" />
              <rect x="15" y="15" width="6" height="6" rx="1.5" />
              <path d="M12 9v3M12 12H6v3M12 12h6v3" />
            </svg>
            Choose your implementation path
          </span>
        </div>

        {/* branch connector (desktop) */}
        <div className="relative -mt-0.5 h-14 max-[880px]:hidden">
          <Line className="left-1/2 top-0 h-[26px] w-0.5 -translate-x-px" />
          <Line className="left-1/4 right-1/4 top-6 h-0.5" />
          <Line className="left-1/4 top-6 h-8 w-0.5 -translate-x-px" />
          <Line className="right-1/4 top-6 h-8 w-0.5 translate-x-px" />
          <div className="border-cp-blue absolute bottom-[-5px] left-1/4 h-[11px] w-[11px] -translate-x-1/2 rounded-full border-2 bg-white" />
          <div className="border-cp-violet absolute bottom-[-5px] right-1/4 h-[11px] w-[11px] translate-x-1/2 rounded-full border-2 bg-white" />
        </div>

        {/* paths */}
        <div className="grid grid-cols-1 gap-x-[clamp(28px,4vw,64px)] gap-y-3.5 min-[881px]:grid-cols-2 min-[881px]:gap-y-0">
          <div className="max-[880px]:order-1">
            <PathCard
              tone="blue"
              icon={
                <svg
                  width={34}
                  height={34}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              }
              title="Ready-made Viewer"
              desc="Embed a complete, feature-rich PDF viewer in minutes."
              feats={[
                <>
                  Full-featured UI, <b>ready out of the box</b>
                </>,
                <>Annotations, search &amp; thumbnails built in</>,
                <>Responsive &amp; mobile-ready on every device</>,
              ]}
              frameworks={[
                { name: 'Vanilla', cmd: '@cloudpdf/js', logo: VANILLA },
                { name: 'React', cmd: '@cloudpdf/react', logo: REACT },
                { name: 'Vue', cmd: '@cloudpdf/vue', logo: VUE },
                { name: 'Svelte', cmd: '@cloudpdf/svelte', logo: SVELTE },
              ]}
            />
          </div>

          <div className="max-[880px]:order-3">
            <PathCard
              tone="violet"
              icon={
                <svg
                  width={34}
                  height={34}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1" />
                </svg>
              }
              title="Headless Components"
              desc="Build custom PDF experiences with our modular, headless API."
              feats={[
                <>
                  Complete control over <b>your own UI</b>
                </>,
                <>Compose only the pieces you need</>,
                <>Bring your own design system</>,
              ]}
              frameworks={[
                { name: 'React', cmd: '@cloudpdf/react', logo: REACT },
                { name: 'Vue', cmd: '@cloudpdf/vue', logo: VUE },
                { name: 'Svelte', cmd: '@cloudpdf/svelte', logo: SVELTE },
              ]}
            />
          </div>

          {/* converge-then-branch connector */}
          <div className="relative h-[152px] max-[880px]:hidden min-[881px]:col-span-2">
            <Line className="left-1/4 top-0 h-[30px] w-0.5 -translate-x-px" />
            <Line className="right-1/4 top-0 h-[30px] w-0.5 translate-x-px" />
            <Line className="left-1/4 right-1/4 top-[29px] h-0.5" />
            <Line className="left-1/2 top-[29px] h-[27px] w-0.5 -translate-x-px" />
            <div className="border-cp-border font-display text-cp-muted absolute left-1/2 top-[68px] z-[3] inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-[7px] whitespace-nowrap rounded-full border bg-[#F1F5FC] px-3.5 py-1.5 text-[12.5px] font-bold tracking-[0.01em] shadow-[0_0_0_5px_#FBFCFE]">
              <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[#9AA9C7]"
              >
                <path d="M12 2 2 7l10 5 10-5-10-5z" />
                <path d="m2 17 10 5 10-5" />
                <path d="m2 12 10 5 10-5" />
              </svg>
              Choose your deployment
            </div>
            <Line className="left-1/2 top-20 h-[27px] w-0.5 -translate-x-px" />
            <Line className="left-1/4 right-1/4 top-[105px] h-0.5" />
            <Line className="bottom-0 left-1/4 top-[105px] w-0.5 -translate-x-px" />
            <Line className="bottom-0 right-1/4 top-[105px] w-0.5 translate-x-px" />
            <div className="border-cp-blue absolute bottom-[-5px] left-1/4 h-[11px] w-[11px] -translate-x-1/2 rounded-full border-2 bg-white" />
            <div className="border-cp-violet absolute bottom-[-5px] right-1/4 h-[11px] w-[11px] translate-x-1/2 rounded-full border-2 bg-white" />
          </div>

          <div className="max-[880px]:order-2 max-[880px]:mb-3.5">
            <DeployCard
              tone="blue"
              icon={<CloudIcon width={28} height={28} strokeWidth={1.9} />}
              title="Managed SaaS"
              lead="We host and manage everything."
              sub="Get secure, scalable infrastructure so you can focus on your product."
              href="/docs/engine/getting-started"
            />
          </div>
          <div className="max-[880px]:order-4">
            <DeployCard
              tone="violet"
              icon={
                <svg
                  width={26}
                  height={26}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="6" rx="1.5" />
                  <rect x="3" y="14" width="18" height="6" rx="1.5" />
                  <path d="M7 7h.01M7 17h.01" />
                </svg>
              }
              title="Self-hosted Server"
              lead="Deploy in your own environment."
              sub="Full control, private data, and enterprise compliance on your terms."
              href="/docs/server/getting-started"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
