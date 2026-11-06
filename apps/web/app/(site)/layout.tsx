import { SiteShell } from "../../components/site-shell";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-white">
      <SiteShell>{children}</SiteShell>
    </div>
  );
}
