import { LiveStrip } from "../../components/live-strip";
import { SiteShell } from "../../components/site-shell";
import { Providers } from "./providers";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not set");
  return (
    <Providers appId={appId}>
      <div className="relative flex min-h-screen flex-col bg-white">
        <SiteShell>
          <div className="mb-6 border-b border-[#CECECE]">
            <LiveStrip />
          </div>
          {children}
        </SiteShell>
      </div>
    </Providers>
  );
}
