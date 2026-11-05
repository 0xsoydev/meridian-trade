import Link from "next/link";

const nav = [
  ["/", "Home"],
  ["/trade", "Trade"],
  ["/perps", "Perps"],
  ["/sell", "Sell"],
  ["/keys", "Keys"],
  ["/receipts", "Receipts"],
] as const;

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-zinc-800">
        <nav className="mx-auto flex max-w-5xl gap-5 p-4 text-sm">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className="text-zinc-400 hover:text-zinc-100">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </>
  );
}
