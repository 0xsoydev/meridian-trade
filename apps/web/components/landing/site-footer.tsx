import Link from "next/link";

const LINK =
  "w-fit text-[#1E1E1E] underline decoration-transparent underline-offset-[6px] transition-[text-decoration-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:decoration-[#1743FF] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1743FF] motion-reduce:transition-none";
const GROUPS: { title: string; links: { label: string; href?: string }[] }[] = [
  {
    title: "socials",
    links: [
      { label: "Twitter X" },
      { label: "Telegram" },
      { label: "HashScan", href: "https://hashscan.io/testnet/topic/0.0.11222352" },
    ],
  },
  {
    title: "docs",
    links: [
      { label: "Plan", href: "https://github.com/0xsoydev/celestial-trade/blob/develop/docs/plan.md" },
      { label: "README", href: "https://github.com/0xsoydev/celestial-trade" },
      { label: "Receipts", href: "/receipts" },
    ],
  },
];

export function SiteFooter({ variant }: { variant: "page" | "canvas" | "site" }) {
  if (variant === "page") {
    return (
      <footer className="border-t border-[#CECECE] bg-[#EBEBEB] px-6 pb-10 pt-12">
        <div className="flex gap-16">
          {GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-1.5 text-[16px] text-[#1E1E1E]">
              <p className="text-[13px] text-[#757575]">[ {g.title} ]</p>
              {g.links.map((l) =>
                l.href ? (
                  <Link key={l.label} href={l.href} className={LINK}>
                    {l.label}
                  </Link>
                ) : (
                  <span key={l.label}>{l.label}</span>
                ),
              )}
            </div>
          ))}
        </div>
        <div
          className="mt-8 h-[220px] w-full bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: "url(/images/goddess.webp)" }}
        />
      </footer>
    );
  }

  if (variant === "site") {
    return (
      <footer className="relative h-[min(42.4769vw,734px)]">
        <div className="absolute left-[calc(55*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] right-[calc(56*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] top-0 h-[min(16.5509vw,286px)] rounded-[6px] border border-[#CECECE] bg-[#EBEBEB]" />

        <div
          className="absolute bottom-0 left-[calc(413*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] h-[min(38.0787vw,658px)] w-[min(76.0995vw,1315px)] bg-cover bg-center"
          style={{ backgroundImage: "url(/images/goddess.webp)" }}
        />
        <div className="absolute left-[calc(138*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] top-[min(1.9097vw,33px)] flex flex-col gap-[min(0.28935vw,5px)] text-[min(1.1574vw,20px)] text-[#1E1E1E]">
          <p className="leading-[min(2.0833vw,36px)]">Socials</p>
          <p className="leading-[min(1.7361vw,30px)]">Twitter X</p>
          <p className="leading-[min(1.7361vw,30px)]">Telegram</p>
          <p className="leading-[min(1.7361vw,30px)]">HashScan</p>
        </div>
        <div className="absolute left-[calc(138*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] top-[min(13.0208vw,225px)] flex gap-[min(2.8935vw,50px)] text-[min(1.1574vw,20px)] leading-[min(1.3889vw,24px)] text-[#757575]">
          <a href="https://github.com/0xsoydev/celestial-trade/blob/develop/docs/plan.md">Plan</a>
          <a href="https://github.com/0xsoydev/celestial-trade">README</a>
          <Link href="/receipts">Receipts</Link>
        </div>
      </footer>
    );
  }

  return (
    <>
      <div className="absolute left-[55px] top-[3351px] h-[730px] w-[1617px] rounded-[6px] border border-[#CECECE] bg-[#EBEBEB]" />
      <p className="absolute left-[864px] top-[3747px] -translate-x-1/2 font-['Instrument_Sans','Instrument_Serif_Fallback'] font-black text-[320px] leading-none text-[#757575]/30">MERIDIAN</p>

      <div
        className="absolute left-[676px] top-[3559px] h-[526px] w-[1052px] bg-cover bg-center"
        style={{ backgroundImage: "url(/images/goddess.webp)" }}
      />
      <div className="absolute left-[138px] top-[3384px] flex gap-[120px]">
        {GROUPS.map((g) => (
          <div key={g.title} className="flex flex-col gap-[10px] text-[20px] leading-[30px] text-[#1E1E1E]">
            <p className="text-[16px] leading-[24px] text-[#757575]">[ {g.title} ]</p>
            {g.links.map((l) =>
              l.href ? (
                <Link key={l.label} href={l.href} className={LINK}>
                  {l.label}
                </Link>
              ) : (
                <span key={l.label}>{l.label}</span>
              ),
            )}
          </div>
        ))}
      </div>
    </>
  );
}
