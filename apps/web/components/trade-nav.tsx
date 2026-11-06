"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useConnection, useDisconnect } from "wagmi";

const LINKS = [
  { label: "Trade", href: "/trade" },
  { label: "Perps", href: "/perps" },
  { label: "Sell", href: "/sell" },
  { label: "Agents", href: "/agents" },
];

const MORE = [
  { label: "Keys", href: "/keys" },
  { label: "Receipts", href: "/receipts" },
];

const itemClass = (active: boolean) =>
  `underline-offset-[6px] hover:underline ${active ? "text-[#1743FF]" : ""}`;

export function TradeNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname.startsWith(href);
  const { ready, login, logout } = usePrivy();
  const { address } = useConnection();
  const { mutate: disconnect } = useDisconnect();

  return (
    <header className="sticky top-0 z-40 border-b border-[#CECECE] bg-white">
      <div className="flex h-14 items-center gap-8 px-6">
        <Link href="/" className="flex shrink-0 items-center text-[#1E1E1E]">
          <img src="/images/namelogo.svg" alt="Celestial Trade" className="h-[22px] w-auto" />
        </Link>

        <nav className="hidden items-center gap-8 text-[15px] text-[#1E1E1E] lg:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={itemClass(isActive(link.href))}
            >
              {link.label}
            </Link>
          ))}

          <details className="group relative">
            <summary
              className={`flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden ${
                MORE.some((link) => isActive(link.href)) ? "text-[#1743FF]" : ""
              }`}
            >
              More
              <Chevron />
            </summary>
            <div className="absolute left-0 top-full mt-3 w-40 rounded-[6px] border border-[#CECECE] bg-white py-1">
              {MORE.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={(event) =>
                    event.currentTarget.closest("details")?.removeAttribute("open")
                  }
                  className={`block px-4 py-2 hover:bg-[#F5F5F5] ${itemClass(isActive(link.href))}`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </details>
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          {address ? (
            <details className="group relative">
              <summary className="flex h-[34px] cursor-pointer list-none items-center gap-1.5 rounded-[6px] border border-[#CECECE] bg-white px-3 text-[14px] tabular-nums text-[#1E1E1E] hover:border-[#1743FF] [&::-webkit-details-marker]:hidden">
                {address.slice(0, 6)}…{address.slice(-4)}
                <Chevron />
              </summary>
              <div className="absolute right-0 top-full mt-2 w-40 rounded-[6px] border border-[#CECECE] bg-white py-1">
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    void logout().finally(() => disconnect());
                  }}
                  className="block w-full px-4 py-2 text-left text-[14px] text-[#1E1E1E] hover:bg-[#F5F5F5]"
                >
                  Disconnect
                </button>
              </div>
            </details>
          ) : (
            <button
              type="button"
              disabled={!ready}
              onClick={() => login()}
              className="h-[34px] rounded-[6px] bg-black px-4 text-[14px] font-semibold text-white hover:bg-[#1E1E1E] disabled:bg-[#D4D4D4]"
            >
              Connect
            </button>
          )}
          <IconButton label="language">
            <Globe />
          </IconButton>
          <IconButton label="settings">
            <Gear />
          </IconButton>
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#CECECE] px-6 py-3 text-[15px] text-[#1E1E1E] lg:hidden">
        {[...LINKS, ...MORE].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive(link.href) ? "page" : undefined}
            className={itemClass(isActive(link.href))}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function IconButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-[34px] w-[34px] items-center justify-center rounded-[6px] border border-[#CECECE] bg-white text-[#1E1E1E] hover:border-[#1743FF]"
    >
      {children}
    </button>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4 transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Globe() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

function Gear() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
