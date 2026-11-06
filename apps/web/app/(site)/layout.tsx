import { LiveStrip } from "../../components/live-strip";
import { SiteShell } from "../../components/site-shell";
import { Providers } from "./providers";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not set");
  return (
    <Providers appId={appId}>
      <div className="relative flex min-h-screen flex-col bg-white pb-9">
        <SiteShell>
          <div id="status-bar" className="fixed inset-x-0 bottom-0 z-40 border-t border-[#CECECE] bg-white px-4 lg:px-6">
            <LiveStrip />
          </div>
          {children}
        </SiteShell>
      </div>
    </Providers>
  );
}
