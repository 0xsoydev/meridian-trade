import { BrowserWindow } from "../ui/mock-browser-window";

export function HumansTerminal({ variant }: { variant: "page" | "canvas" }) {
  const canvas = variant === "canvas";

  return (
    <section className={canvas ? "absolute left-[55px] top-[2207px] w-[1617px]" : "mt-16 border-t border-[#CECECE] pb-14 pt-10"}>
      <h2
        className={
          canvas
            ? "ml-[48px] font-serif text-[60px] font-normal leading-[72px] text-black"
            : "px-6 font-serif text-[34px] leading-[1.1] text-black"
        }
      >
        How humans use Meridian
      </h2>
      <div
        className={`relative overflow-hidden bg-[#B7BEE9] ${canvas ? "mt-[34px] h-[600px] rounded-[6px]" : "mt-6 h-[440px]"}`}
      >
        <img
          src="/images/humans-stage.jpg"
          alt=""
          aria-hidden
          loading="lazy"
          width={1617}
          height={600}
          className="absolute inset-0 size-full object-cover object-center"
        />
        <div
          className={
            canvas
              ? "absolute left-1/2 top-[96px] h-[464px] w-[1000px] -translate-x-1/2"
              : "absolute inset-x-4 top-8 bottom-8"
          }
        >
          <BrowserWindow variant="chrome" headerStyle="full" url="https://meridian.trade/trade">
            <img
              src="/images/humans-window.png"
              alt="The Meridian trade screen: live book, chart, order book and the buy ticket"
              width={2812}
              height={1438}
              className="h-full w-full object-cover object-top"
            />
          </BrowserWindow>
        </div>
      </div>
    </section>
  );
}
