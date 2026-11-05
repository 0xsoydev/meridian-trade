import { Navbar } from "../../components/site-nav";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-white">
      <Navbar variant="page" />
      <main className="flex-1 px-[calc(96*min(100vw,1728px)/1728_+_max(0px,(100vw_-_1728px)/2))] pb-16 pt-[76px]">
        {children}
      </main>
    </div>
  );
}
