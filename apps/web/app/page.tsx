import { AgentsTerminal } from "../components/landing/agents-terminal";
import { Flow } from "../components/landing/flow";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { Panorama } from "../components/landing/panorama";
import { Proof } from "../components/landing/proof";
import { SiteFooter } from "../components/landing/site-footer";
import { WhatWeDo } from "../components/landing/what-we-do";
import { Navbar, NavLinks } from "../components/site-nav";

export default function Home() {
  return (
    <main className="bg-white">
      <div className="lg:hidden">
        <div className="min-h-svh">
          <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 border-b border-[#CECECE] px-6 py-4 text-[15px] leading-[20px] text-[#1E1E1E]">
            <NavLinks />
          </nav>
          <Hero variant="page" />
        </div>
        <WhatWeDo variant="page" />
        <HowItWorks variant="page" />
        <Flow variant="page" />
        <Proof variant="page" />
        <Panorama variant="page" />
        <AgentsTerminal variant="page" />
        <SiteFooter variant="page" />
      </div>

      <div className="desktop-wrap hidden lg:block">
        <div className="desktop-canvas relative h-[5302px] w-[1728px] overflow-hidden bg-white">
          <Hero variant="canvas" nav={<Navbar />} />
          <div className="absolute inset-x-0 top-[307px]">
            <WhatWeDo variant="canvas" />
            <HowItWorks variant="canvas" />
            <Flow variant="canvas" />
            <div className="absolute inset-x-0 top-[602px]">
              <Proof variant="canvas" />
              <Panorama variant="canvas" />
            </div>
            <AgentsTerminal variant="canvas" />
            <div className="absolute inset-x-0 top-[914px]">
              <SiteFooter variant="canvas" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
