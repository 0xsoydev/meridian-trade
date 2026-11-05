"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Trade", href: "/trade" },
  { label: "Perps", href: "/perps" },
  { label: "Sell", href: "/sell" },
  { label: "Keys", href: "/keys" },
  { label: "Receipts", href: "/receipts" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {NAV_LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`underline-offset-[6px] hover:underline ${
              active ? "underline decoration-[#1743FF]" : ""
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}

export function Navbar({ variant = "page" }: { variant?: "page" | "canvas" }) {
  return (
    <>
      <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 border-b border-[#CECECE] px-6 py-4 text-[15px] leading-[20px] text-[#1E1E1E] lg:hidden">
        <NavLinks />
      </nav>

      <div className="hidden lg:block">
        {variant === "canvas" ? (
          <>
            <nav className="absolute right-[56px] top-[37px] flex h-[24px] items-center gap-[39px] text-[20px] leading-[24px] text-[#1E1E1E]">
              <NavLinks />
            </nav>
            <div aria-hidden className="pointer-events-none absolute left-[54px] top-0 h-[4081px] w-px bg-[#CECECE]" />
            <div aria-hidden className="pointer-events-none absolute left-[1671px] top-[90px] h-[3991px] w-px bg-[#CECECE]" />
          </>
        ) : (
          <>
            <nav className="absolute top-[min(2.1412vw,37px)] right-[calc(56*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] flex h-[min(1.3889vw,24px)] items-center gap-[min(2.2569vw,39px)] text-[min(1.1574vw,20px)] leading-[min(1.3889vw,24px)] text-[#1E1E1E]">
              <NavLinks />
            </nav>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-[calc(54*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] w-px bg-[#CECECE]"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-[calc(57*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] w-px bg-[#CECECE]"
            />
          </>
        )}
      </div>
    </>
  );
}
