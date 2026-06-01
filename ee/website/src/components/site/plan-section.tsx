import type { ReactNode } from 'react';

import { ArrowRight, CloudIcon, ReactLogo, SvelteLogo, VueLogo } from './icons';

function FwChip({ children }: { children: ReactNode }) {
  return (
    <span className="border-cp-border text-cp-navy inline-flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[9px] border bg-white px-3 font-sans text-[13px] font-semibold">
      {children}
    </span>
  );
}

function PlanLink({ children }: { children: ReactNode }) {
  return (
    <a
      href="#"
      className="text-cp-blue hover:text-cp-blue600 group/link inline-flex items-center gap-[7px] whitespace-nowrap font-sans text-[15px] font-bold no-underline transition-colors"
    >
      {children}
      <ArrowRight
        width={17}
        height={17}
        className="transition-transform duration-200 group-hover/link:translate-x-[3px]"
      />
    </a>
  );
}

export function PlanSection() {
  return (
    <section className="relative w-full overflow-clip bg-[linear-gradient(180deg,#F3F7FE_0%,#F7FAFE_60%,#FBFCFE_100%)] py-[clamp(64px,8vw,110px)] pb-[clamp(72px,9vw,120px)]">
      {/* decorations */}
      <div className="cp-dots-fine pointer-events-none absolute left-[clamp(16px,3vw,70px)] top-[clamp(140px,16vw,220px)] z-[1] h-[110px] w-[132px] text-[#BBD3FB] max-[1180px]:hidden" />
      <div className="cp-dots-fine pointer-events-none absolute right-[clamp(16px,3vw,70px)] top-[clamp(380px,40vw,560px)] z-[1] h-[110px] w-[132px] text-[#BBD3FB] [mask-image:linear-gradient(255deg,#000_30%,transparent_92%)] max-[1180px]:hidden" />

      <div className="relative z-[2] mx-auto w-full max-w-[1040px] px-[clamp(20px,4vw,78px)]">
        {/* heading */}
        <div className="text-center">
          <span className="font-display mb-[22px] inline-block rounded-full bg-[#7A5AF8]/10 px-4 py-[9px] text-[12px] font-extrabold uppercase leading-none tracking-[0.12em] text-[#7A5AF8]">
            The plan
          </span>
          <h2 className="font-display text-cp-navy m-0 text-balance text-[clamp(32px,3.8vw,48px)] font-extrabold leading-[1.08] tracking-[-0.02em]">
            Choose your path.
            <br />
            CloudPDF <em className="text-cp-blue not-italic">handles the hard parts.</em>
          </h2>
          <p className="text-cp-muted mx-auto mt-5 max-w-[600px] text-pretty font-sans text-[clamp(16px,1.3vw,18px)] leading-[1.6]">
            The moment PDFs hit production, basic viewing isn&apos;t enough. Teams run into the same
            roadblocks that slow down launches and add complexity.
          </p>
        </div>

        {/* flow */}
        <div className="mt-[clamp(44px,5vw,64px)]">
          {/* STEP 1 */}
          <div className="grid grid-cols-[44px_1fr] gap-x-6 max-[540px]:grid-cols-[36px_1fr] max-[540px]:gap-x-4">
            <div className="flex flex-col items-center">
              <span className="border-cp-blue text-cp-blue font-display inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border-2 bg-white text-[18px] font-extrabold leading-none shadow-[0_2px_6px_rgba(22,119,255,0.14)] max-[540px]:h-9 max-[540px]:w-9 max-[540px]:text-[16px]">
                1
              </span>
              <span className="mt-1.5 w-0.5 flex-1 bg-[#D8E4FB]" />
            </div>
            <div className="min-w-0 pb-2">
              <h3 className="font-display text-cp-navy mt-[7px] text-[clamp(20px,1.9vw,24px)] font-extrabold leading-[1.2] tracking-[-0.014em]">
                Choose your UI
              </h3>

              <div className="mt-[22px] flex flex-col gap-[18px]">
                {/* Ready-made Viewer */}
                <article className="border-cp-border grid grid-cols-[64px_1fr] gap-x-[22px] rounded-[18px] border bg-white p-[28px_30px] shadow-[0_1px_2px_rgba(10,26,77,0.04)] transition-all duration-200 hover:-translate-y-[3px] hover:border-[#D8E4FB] hover:shadow-[0_22px_44px_-22px_rgba(10,26,77,0.26),0_3px_10px_rgba(10,26,77,0.05)] max-[540px]:grid-cols-1 max-[540px]:gap-y-[18px] max-[540px]:p-[24px_22px]">
                  <span className="bg-cp-blue/10 text-cp-blue inline-flex h-16 w-16 items-center justify-center rounded-[16px]">
                    <svg
                      width={30}
                      height={30}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="16" rx="2.5" />
                      <path d="M3 9h18" />
                      <path d="M6.5 6.5h.01M9 6.5h.01" />
                    </svg>
                  </span>
                  <div>
                    <h4 className="font-display text-cp-navy m-0 text-[20px] font-extrabold leading-[1.2] tracking-[-0.012em]">
                      Ready-made Viewer
                    </h4>
                    <p className="text-cp-ink m-0 mt-[9px] max-w-[380px] font-sans text-[15px] leading-[1.55]">
                      Drop in a production-ready PDF viewer with powerful built-in features.
                    </p>
                    <p className="text-cp-muted font-display mt-5 text-[11px] font-bold uppercase leading-none tracking-[0.06em]">
                      Frameworks
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-[18px] gap-y-3.5">
                      <div className="flex flex-wrap gap-[9px]">
                        <FwChip>
                          <span className="font-display inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-[#F7DF1E] text-[9px] font-extrabold leading-none text-[#1A1A1A]">
                            JS
                          </span>
                          Vanilla JS
                        </FwChip>
                        <FwChip>
                          <ReactLogo width={15} height={15} />
                          React
                        </FwChip>
                        <FwChip>
                          <VueLogo width={15} height={15} />
                          Vue
                        </FwChip>
                        <FwChip>
                          <SvelteLogo width={15} height={15} />
                          Svelte
                        </FwChip>
                      </div>
                      <PlanLink>Get started</PlanLink>
                    </div>
                  </div>
                </article>

                {/* Headless Components */}
                <article className="border-cp-border grid grid-cols-[64px_1fr] gap-x-[22px] rounded-[18px] border bg-white p-[28px_30px] shadow-[0_1px_2px_rgba(10,26,77,0.04)] transition-all duration-200 hover:-translate-y-[3px] hover:border-[#D8E4FB] hover:shadow-[0_22px_44px_-22px_rgba(10,26,77,0.26),0_3px_10px_rgba(10,26,77,0.05)] max-[540px]:grid-cols-1 max-[540px]:gap-y-[18px] max-[540px]:p-[24px_22px]">
                  <span className="inline-flex h-16 w-16 items-center justify-center rounded-[16px] bg-[#7A5AF8]/10 text-[#7A5AF8]">
                    <svg
                      width={30}
                      height={30}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 4.5a2 2 0 1 0-4 0v.7a1.3 1.3 0 0 1-1.3 1.3H5.5a1 1 0 0 0-1 1v3.2a1.3 1.3 0 0 0 1.3 1.3h.4a2 2 0 1 1 0 4h-.4a1.3 1.3 0 0 0-1.3 1.3v3.2a1 1 0 0 0 1 1h3.2a1.3 1.3 0 0 0 1.3-1.3v-.4a2 2 0 1 1 4 0v.4a1.3 1.3 0 0 0 1.3 1.3h3.2a1 1 0 0 0 1-1v-3.2a1.3 1.3 0 0 0-1.3-1.3h-.7a2 2 0 1 1 0-4h.7a1.3 1.3 0 0 0 1.3-1.3V7.5a1 1 0 0 0-1-1h-3.2A1.3 1.3 0 0 1 14 5.2z" />
                    </svg>
                  </span>
                  <div>
                    <h4 className="font-display text-cp-navy m-0 text-[20px] font-extrabold leading-[1.2] tracking-[-0.012em]">
                      Headless Components
                    </h4>
                    <p className="text-cp-ink m-0 mt-[9px] max-w-[380px] font-sans text-[15px] leading-[1.55]">
                      Build your own UI with flexible, unstyled components and APIs.
                    </p>
                    <p className="text-cp-muted font-display mt-5 text-[11px] font-bold uppercase leading-none tracking-[0.06em]">
                      Frameworks
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-[18px] gap-y-3.5">
                      <div className="flex flex-wrap gap-[9px]">
                        <FwChip>
                          <ReactLogo width={15} height={15} />
                          React
                        </FwChip>
                        <FwChip>
                          <VueLogo width={15} height={15} />
                          Vue
                        </FwChip>
                        <FwChip>
                          <SvelteLogo width={15} height={15} />
                          Svelte
                        </FwChip>
                      </div>
                      <PlanLink>Explore components</PlanLink>
                    </div>
                  </div>
                </article>
              </div>

              {/* connector arrow */}
              <div className="mb-1 mt-[18px] flex justify-center">
                <span className="border-cp-border text-cp-blue inline-flex h-10 w-10 items-center justify-center rounded-full border bg-white shadow-[0_4px_12px_-4px_rgba(22,119,255,0.3)]">
                  <svg
                    width={18}
                    height={18}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 5v14M6 13l6 6 6-6" />
                  </svg>
                </span>
              </div>
            </div>
          </div>

          {/* STEP 2 */}
          <div className="grid grid-cols-[44px_1fr] gap-x-6 max-[540px]:grid-cols-[36px_1fr] max-[540px]:gap-x-4">
            <div className="flex flex-col items-center">
              <span className="border-cp-blue text-cp-blue font-display inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border-2 bg-white text-[18px] font-extrabold leading-none shadow-[0_2px_6px_rgba(22,119,255,0.14)] max-[540px]:h-9 max-[540px]:w-9 max-[540px]:text-[16px]">
                2
              </span>
            </div>
            <div className="min-w-0 pb-2">
              <h3 className="font-display text-cp-navy mt-[7px] text-[clamp(20px,1.9vw,24px)] font-extrabold leading-[1.2] tracking-[-0.014em]">
                Choose your deployment
              </h3>

              <div className="mt-[22px] grid grid-cols-1 gap-[18px] min-[621px]:grid-cols-2">
                {/* Managed SaaS */}
                <article className="border-cp-border flex flex-col rounded-[18px] border bg-white p-[26px_26px_24px] shadow-[0_1px_2px_rgba(10,26,77,0.04)] transition-all duration-200 hover:-translate-y-[3px] hover:border-[#D8E4FB] hover:shadow-[0_22px_44px_-22px_rgba(10,26,77,0.26),0_3px_10px_rgba(10,26,77,0.05)]">
                  <div className="flex items-center gap-3.5">
                    <span className="bg-cp-blue/10 text-cp-blue inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[13px]">
                      <CloudIcon width={24} height={24} />
                    </span>
                    <h4 className="font-display text-cp-navy m-0 text-[19px] font-extrabold leading-[1.2] tracking-[-0.012em]">
                      Managed SaaS
                    </h4>
                  </div>
                  <p className="text-cp-ink m-0 mt-4 flex-1 font-sans text-[14.5px] leading-[1.55]">
                    We run it. You focus on building. Always up-to-date, globally scalable, and
                    secure by default.
                  </p>
                  <div className="mt-[18px]">
                    <PlanLink>Learn more</PlanLink>
                  </div>
                </article>

                {/* Self-hosted Server */}
                <article className="border-cp-border flex flex-col rounded-[18px] border bg-white p-[26px_26px_24px] shadow-[0_1px_2px_rgba(10,26,77,0.04)] transition-all duration-200 hover:-translate-y-[3px] hover:border-[#D8E4FB] hover:shadow-[0_22px_44px_-22px_rgba(10,26,77,0.26),0_3px_10px_rgba(10,26,77,0.05)]">
                  <div className="flex items-center gap-3.5">
                    <span className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[13px] bg-[#7A5AF8]/10 text-[#7A5AF8]">
                      <svg
                        width={24}
                        height={24}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="4" width="18" height="7" rx="1.8" />
                        <rect x="3" y="13" width="18" height="7" rx="1.8" />
                        <path d="M7 7.5h.01M7 16.5h.01" />
                      </svg>
                    </span>
                    <h4 className="font-display text-cp-navy m-0 text-[19px] font-extrabold leading-[1.2] tracking-[-0.012em]">
                      Self-hosted Server
                    </h4>
                  </div>
                  <p className="text-cp-ink m-0 mt-4 flex-1 font-sans text-[14.5px] leading-[1.55]">
                    Deploy on your infrastructure. Full control, privacy, and compliance on your
                    terms.
                  </p>
                  <div className="mt-[18px]">
                    <PlanLink>Learn more</PlanLink>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </div>

        {/* closing feature strip */}
        <div className="border-cp-border mx-auto mt-[clamp(40px,4.5vw,56px)] grid w-fit max-w-[880px] grid-cols-3 gap-[clamp(20px,4vw,56px)] rounded-[26px] border bg-white p-[22px_clamp(28px,4vw,44px)] shadow-[0_20px_44px_-24px_rgba(10,26,77,0.22),0_2px_6px_rgba(10,26,77,0.05)] max-[720px]:w-auto max-[720px]:grid-cols-1 max-[720px]:gap-[22px] max-[720px]:rounded-[22px]">
          {[
            {
              title: 'Developer-first',
              desc: 'APIs and SDKs designed for real-world workflows.',
              icon: (
                <>
                  <path d="m8 8-4 4 4 4" />
                  <path d="m16 8 4 4-4 4" />
                  <path d="m13.5 6-3 12" />
                </>
              ),
            },
            {
              title: 'Secure by design',
              desc: 'Enterprise-grade security from end to end.',
              icon: (
                <>
                  <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" />
                  <path d="m9 12 2 2 4-4" />
                </>
              ),
            },
            {
              title: 'Built for scale',
              desc: 'From startups to enterprises, we scale with you.',
              icon: (
                <>
                  <path d="M2 17l6.5-6.5 5 5L22 7" />
                  <path d="M16 7h6v6" />
                </>
              ),
            },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-3.5">
              <span className="bg-cp-blue/10 text-cp-blue inline-flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full">
                <svg
                  width={21}
                  height={21}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {item.icon}
                </svg>
              </span>
              <div>
                <div className="font-display text-cp-navy text-[15px] font-extrabold leading-[1.2] tracking-[-0.01em]">
                  {item.title}
                </div>
                <div className="text-cp-muted mt-1 font-sans text-[13px] leading-[1.45]">
                  {item.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
