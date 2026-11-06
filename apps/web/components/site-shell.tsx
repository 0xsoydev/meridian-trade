"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "./landing/site-footer";
import { Navbar } from "./site-nav";
import { TradeNav } from "./trade-nav";

export function SiteShell({ children }: { children: React.ReactNode }) {
  const onTrade = usePathname().startsWith("/trade");
  return (
    <>
      {onTrade ? <TradeNav /> : <Navbar variant="page" />}
      <main
        className={
          onTrade
            ? "flex-1 p-4 lg:p-6"
            : "flex-1 px-[calc(96*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] pb-16 pt-[76px]"
        }
      >
        {children}
      </main>
      {onTrade ? null : (
        <>
          <div className="lg:hidden">
            <SiteFooter variant="page" />
          </div>
          <div className="hidden lg:block">
            <SiteFooter variant="site" />
          </div>
        </>
      )}
    </>
  );
}
