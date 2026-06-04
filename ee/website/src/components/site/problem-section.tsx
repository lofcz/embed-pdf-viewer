type ProblemCard = {
  title: string;
  body: string;
  callout: string;
  image: string;
  imageAlt: string;
};

const CARDS: ProblemCard[] = [
  {
    title: 'Annotations and comments',
    body: 'Users need to highlight, comment, and collaborate inside documents.',
    callout: 'Without it, workflows break outside your product.',
    image: '/annotations-comments.svg',
    imageAlt: 'Document with highlights and a comment bubble',
  },
  {
    title: 'Permissions and signed URLs',
    body: 'Secure access, expirations, and role-based controls are table stakes.',
    callout: 'Ad-hoc sharing and downloads create risk and support load.',
    image: '/permissions-signed-urls.svg',
    imageAlt: 'Secure document with a link and lock',
  },
  {
    title: 'Custom UI complexity',
    body: 'Building a polished PDF experience with permissions and tools takes months.',
    callout: 'Reinventing the viewer slows down your roadmap.',
    image: '/custom-ui-complexity.svg',
    imageAlt: 'Code editor next to a UI layout',
  },
  {
    title: 'Hosting, scale, and compliance',
    body: 'Global delivery, large files, compliance, and audit logs are hard to get right.',
    callout: 'Infrastructure distractions pull focus from your product.',
    image: '/hosting-scale-compliance.svg',
    imageAlt: 'Cloud server with a globe and security shield',
  },
];

function InfoIcon() {
  return (
    <svg
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

export function ProblemSection() {
  return (
    <section className="relative w-full overflow-clip bg-[linear-gradient(180deg,#FBFCFE_0%,#F5F8FE_38%,#F3F7FE_100%)] py-[clamp(64px,8vw,112px)] pb-[clamp(72px,9vw,124px)]">
      {/* decorations */}
      <img
        src="/Cloud-3-pale.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute left-[-56px] top-[clamp(120px,16vw,200px)] z-0 h-auto w-[320px] scale-125 select-none opacity-90 max-[1080px]:hidden"
      />
      <img
        src="/Cloud-3-pale.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute bottom-10 right-[-70px] z-0 h-auto w-[280px] select-none opacity-90 max-[1080px]:hidden"
      />
      <div className="cp-dots-fine pointer-events-none absolute right-[clamp(24px,6vw,96px)] top-[clamp(72px,8vw,116px)] z-[1] h-24 w-[150px] text-[#BBD3FB] [mask-image:linear-gradient(255deg,#000_30%,transparent_92%)] max-[1080px]:hidden" />

      <div className="relative z-[2] mx-auto w-full max-w-[1440px] px-[clamp(20px,4vw,78px)]">
        <h2 className="font-display text-cp-navy m-0 text-balance text-center text-[clamp(34px,4.2vw,54px)] font-extrabold leading-[1.05] tracking-[-0.02em]">
          A viewer is <em className="text-cp-blue not-italic">just the beginning.</em>
        </h2>
        <p className="text-cp-muted mx-auto mt-[22px] max-w-[720px] text-pretty text-center font-sans text-[clamp(17px,1.4vw,19px)] leading-[1.6]">
          The moment PDFs hit production, basic viewing isn&apos;t enough. Teams run into the same
          roadblocks that slow down launches and add complexity.
        </p>

        <div className="mt-[clamp(44px,5vw,64px)] grid grid-cols-1 gap-[clamp(16px,1.5vw,24px)] min-[561px]:grid-cols-2 min-[1081px]:grid-cols-4">
          {CARDS.map((card) => (
            <article
              key={card.title}
              className="border-cp-border flex flex-col rounded-[18px] border bg-white p-[20px_20px_24px] shadow-[0_1px_2px_rgba(10,26,77,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-[#D8E4FB] hover:shadow-[0_22px_44px_-22px_rgba(10,26,77,0.28),0_3px_10px_rgba(10,26,77,0.05)]"
            >
              <div className="overflow-hidden rounded-[12px]">
                <img
                  src={card.image}
                  alt={card.imageAlt}
                  loading="lazy"
                  className="block aspect-[1611/1012] w-full object-cover"
                />
              </div>
              <h3 className="font-display text-cp-navy m-0 mx-auto mt-[20px] max-w-[180px] text-balance text-center text-[18px] font-extrabold leading-[1.22] tracking-[-0.012em]">
                {card.title}
              </h3>
              <p className="text-cp-muted m-0 mt-[12px] flex-1 text-pretty text-center font-sans text-[15px] leading-[1.55]">
                {card.body}
              </p>
              <div className="bg-cp-blue/[0.065] mt-[20px] flex items-start gap-2.5 rounded-[12px] border border-[rgba(22,119,255,0.14)] p-[13px_14px]">
                <span className="text-cp-blue mt-px inline-flex flex-shrink-0">
                  <InfoIcon />
                </span>
                <span className="text-cp-blue600 font-sans text-[13px] font-semibold leading-[1.42]">
                  {card.callout}
                </span>
              </div>
            </article>
          ))}
        </div>

        <div className="border-cp-border mx-auto mt-[clamp(40px,4.5vw,60px)] flex w-fit max-w-[760px] items-center gap-[22px] rounded-full border bg-white p-[18px_36px_18px_22px] shadow-[0_20px_44px_-24px_rgba(10,26,77,0.26),0_2px_6px_rgba(10,26,77,0.05)] max-[560px]:flex-col max-[560px]:gap-4 max-[560px]:rounded-[28px] max-[560px]:p-[24px_28px] max-[560px]:text-center">
          <span className="border-cp-border inline-flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full border bg-white shadow-[0_6px_16px_-8px_rgba(22,119,255,0.4)]">
            <svg width={38} height={25} viewBox="0 0 160 107" fill="none">
              <path
                d="M71.1094 71.1094H142.224C142.224 51.474 126.302 35.5573 106.667 35.5573C106.667 15.9167 90.75 0 71.1094 0C51.474 0 35.5573 15.9167 35.5573 35.5573C15.9167 35.5573 0 51.474 0 71.1094C0 90.75 15.9167 106.667 35.5573 106.667C55.1927 106.667 71.1094 90.75 71.1094 71.1094Z"
                fill="#23278A"
              />
              <path
                d="M142.225 71.1094C142.225 90.75 126.303 106.667 106.668 106.667H124.444C144.085 106.667 160.001 90.75 160.001 71.1094H142.225Z"
                fill="#2CADF4"
              />
              <path
                d="M142.225 71.1094H71.1107C71.1107 90.75 55.194 106.667 35.5586 106.667H106.668C126.303 106.667 142.225 90.75 142.225 71.1094Z"
                fill="#1189FA"
              />
            </svg>
          </span>
          <p className="font-display text-cp-navy m-0 text-balance text-[clamp(18px,1.6vw,22px)] font-semibold leading-[1.4] tracking-[-0.01em]">
            CloudPDF gives you the <em className="text-cp-blue not-italic">workflow layer</em>, not
            just the viewer.
          </p>
        </div>
      </div>
    </section>
  );
}
