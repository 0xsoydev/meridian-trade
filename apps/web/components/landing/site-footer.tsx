import Link from "next/link";

export function SiteFooter({ variant }: { variant: "page" | "canvas" | "site" }) {
  if (variant === "page") {
    return (
      <footer className="border-t border-[#CECECE] bg-[#EBEBEB] px-6 pb-10 pt-12">
        <div className="flex gap-16 text-[16px] text-[#1E1E1E]">
          <div className="flex flex-col gap-1.5">
            <p>Socials</p>
            <p>Twitter X</p>
            <p>Telegram</p>
            <p>HashScan</p>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-[15px] leading-[22px] text-[#757575]">
          <a href="https://github.com/0xsoydev/celestial-trade/blob/develop/docs/plan.md">Plan</a>
          <a href="https://github.com/0xsoydev/celestial-trade">README</a>
          <Link href="/receipts">Receipts</Link>
        </div>
        <div
          className="mt-8 h-[220px] w-full bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: "url(/images/goddess.png)" }}
        />
      </footer>
    );
  }

  if (variant === "site") {
    return (
      <footer className="relative h-[min(42.4769vw,734px)]">
        <div className="absolute left-[calc(55*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] right-[calc(56*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] top-0 h-[min(16.5509vw,286px)] border border-[#CECECE] bg-[#EBEBEB]" />

        <div
          className="absolute bottom-0 left-[calc(413*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] h-[min(38.0787vw,658px)] w-[min(76.0995vw,1315px)] bg-cover bg-center"
          style={{ backgroundImage: "url(/images/goddess.png)" }}
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
      <div className="absolute left-[55px] top-[3351px] h-[286px] w-[1617px] border border-[#CECECE] bg-[#EBEBEB]" />

      <div
        className="absolute left-[413px] top-[3427px] h-[658px] w-[1315px] bg-cover bg-center"
        style={{ backgroundImage: "url(/images/goddess.png)" }}
      />
      <div className="absolute left-[138px] top-[3384px] flex w-[119px] flex-col gap-[5px] text-[20px] text-[#1E1E1E]">
        <p className="leading-[36px]">Socials</p>
        <p className="leading-[30px]">Twitter X</p>
        <p className="leading-[30px]">Telegram</p>
        <p className="leading-[30px]">HashScan</p>
      </div>
      <div className="absolute left-[138px] top-[3576px] flex gap-[50px] text-[20px] leading-[24px] text-[#757575]">
        <a href="https://github.com/0xsoydev/celestial-trade/blob/develop/docs/plan.md">Plan</a>
        <a href="https://github.com/0xsoydev/celestial-trade">README</a>
        <Link href="/receipts">Receipts</Link>
      </div>
    </>
  );
}
