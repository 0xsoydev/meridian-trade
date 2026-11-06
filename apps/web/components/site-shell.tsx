import { TradeNav } from "./trade-nav";

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TradeNav />
      <main className="flex-1 p-4 lg:p-6">{children}</main>
    </>
  );
}
