import Link from "next/link";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { Panorama } from "../components/landing/panorama";
import { Proof } from "../components/landing/proof";
import { WhatWeDo } from "../components/landing/what-we-do";
import { Navbar, NavLinks } from "../components/site-nav";

export default function Home() {
  return (
    <main className="bg-white">
      <div className="lg:hidden">
        <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 border-b border-[#CECECE] px-6 py-4 text-[15px] leading-[20px] text-[#1E1E1E]">
          <NavLinks />
        </nav>

        <Hero variant="page" />

        <WhatWeDo variant="page" />

        <Proof variant="page" />

        <Panorama variant="page" />

        <HowItWorks variant="page" />

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
      </div>

      <div className="desktop-wrap hidden lg:block">
        <div className="desktop-canvas relative h-[4081px] w-[1728px] overflow-hidden bg-white">
          <Hero variant="canvas" nav={<Navbar variant="canvas" />} />

          <div className="absolute left-[55px] top-[3351px] h-[286px] w-[1617px] border border-[#CECECE] bg-[#EBEBEB]" />

          <WhatWeDo variant="canvas" />

          <Proof variant="canvas" />

          <Panorama variant="canvas" />

          <HowItWorks variant="canvas" />

          <div className="absolute left-[413px] top-[3427px] h-[658px] w-[1315px] bg-cover bg-center" style={{ backgroundImage: "url(/images/goddess.png)" }} />
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
        </div>
      </div>
    </main>
  );
}
