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
    <main className="mx-auto max-w-5xl p-6">
      <header className="border-b border-zinc-800">
        <nav className="flex gap-5 py-4 text-sm">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className="text-zinc-400 hover:text-zinc-100">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </main>
  );
}
