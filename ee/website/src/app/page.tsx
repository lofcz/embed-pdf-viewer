import { CpButton } from '@/components/site/button';
import { HeroScene } from '@/components/site/hero-scene';
import { ArrowRight, PlayIcon } from '@/components/site/icons';
import { PlanSection } from '@/components/site/plan-section';
import { ProblemSection } from '@/components/site/problem-section';

const TRUST = [
  {
    label: 'Developer first',
    path: (
      <>
        <path d="m8 8-4 4 4 4" />
        <path d="m16 8 4 4-4 4" />
      </>
    ),
  },
  {
    label: 'Built for scale',
    path: (
      <>
        <path d="M2 17l6.5-6.5 5 5L22 7" />
        <path d="M16 7h6v6" />
      </>
    ),
  },
  {
    label: 'Secure by design',
    path: (
      <>
        <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  },
];

export default function HomePage() {
  return (
    <main className="bg-cp-bg relative overflow-x-clip">
      <div className="relative mx-auto w-full max-w-[1440px] px-[clamp(20px,4vw,78px)] py-[clamp(72px,9vw,130px)]">
        <div className="grid grid-cols-1 items-center gap-12 min-[981px]:grid-cols-[minmax(400px,0.95fr)_minmax(0,1.42fr)] min-[981px]:gap-[clamp(18px,2vw,32px)]">
          {/* LEFT */}
          <div className="flex min-w-0 flex-col">
            <h1 className="font-display text-cp-navy text-[clamp(38px,4.4vw,56px)] font-extrabold leading-[1.06] tracking-[-0.02em]">
              Add <em className="text-cp-blue not-italic">enterprise PDF workflows</em> to your
              product.
            </h1>
            <div className="bg-cp-blue mt-7 h-[7px] w-[60px] rounded-[10px]" />
            <p className="text-cp-ink mt-[26px] max-w-[480px] font-sans text-[18px] leading-[1.6]">
              CloudPDF is developer-first infrastructure for secure PDF viewing and workflows—built
              to integrate seamlessly inside your app.
            </p>
            <div className="mt-[34px] flex flex-wrap gap-4">
              <CpButton href="#" variant="primary">
                <span>Start building</span>
                <ArrowRight width={20} height={20} />
              </CpButton>
              <CpButton href="/docs" variant="outline">
                <PlayIcon width={16} height={16} />
                <span>View API docs</span>
              </CpButton>
            </div>

            <div className="border-cp-border mt-9 inline-flex flex-wrap items-center gap-4 self-start rounded-full border bg-white px-[18px] py-[11px] shadow-[0_1px_2px_rgba(10,26,77,0.04)]">
              {TRUST.map((item, i) => (
                <span key={item.label} className="flex items-center">
                  {i > 0 && (
                    <span className="bg-cp-border mr-4 hidden h-4 w-px min-[481px]:block" />
                  )}
                  <span className="text-cp-navy inline-flex items-center gap-2 whitespace-nowrap font-sans text-[13px] font-semibold">
                    <svg
                      width={15}
                      height={15}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-cp-blue flex-shrink-0"
                    >
                      {item.path}
                    </svg>
                    {item.label}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* RIGHT SCENE */}
          <HeroScene />
        </div>

        {/* hero bottom-left dot grid */}
        <div className="cp-dots-fine pointer-events-none absolute bottom-[-104px] left-[-30px] z-0 h-[110px] w-[132px] text-[#ABC9FD] max-[980px]:hidden" />
      </div>

      <ProblemSection />
      <PlanSection />
    </main>
  );
}
