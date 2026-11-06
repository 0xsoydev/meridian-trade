import { LiveStrip } from "../../components/live-strip";
import { Navbar } from "../../components/site-nav";
import { Providers } from "./providers";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not set");
  return (
    <Providers appId={appId}>
      <div className="relative flex min-h-screen flex-col bg-white">
        <Navbar variant="page" />
        <main className="flex-1 px-[calc(96*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] pb-16 pt-[76px]">
          <div className="mb-6 border-b border-[#CECECE]">
            <LiveStrip />
          </div>
          {children}
        </main>
      </div>
    </Providers>
  );
}
