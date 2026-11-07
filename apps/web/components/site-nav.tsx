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

export function Navbar() {
  return (
    <>
      <nav className="absolute right-[56px] top-0 flex h-[73px] w-[500px] items-center justify-center gap-[31px] border-b border-l border-[#CECECE] text-[16px] leading-[20px] text-[#1E1E1E]">
        <NavLinks />
      </nav>
      <div aria-hidden className="pointer-events-none absolute left-[54px] top-0 h-[5462px] w-px bg-[#CECECE]" />
      <div aria-hidden className="pointer-events-none absolute left-[1671px] top-[73px] h-[5389px] w-px bg-[#CECECE]" />
    </>
  );
}
