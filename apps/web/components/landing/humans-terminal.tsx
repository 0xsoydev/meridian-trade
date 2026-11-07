import { BrowserWindow } from "../ui/mock-browser-window";

const ASKS = [
  { price: "0.180", size: "12", total: "2.16" },
  { price: "0.181", size: "40", total: "7.24" },
  { price: "0.182", size: "96", total: "17.47" },
  { price: "0.183", size: "130", total: "23.79" },
  { price: "0.184", size: "210", total: "38.64" },
];

function MarketPreview() {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-6 border-b border-[#ECECEC] px-5 py-3 text-[12px]">
        <span className="font-semibold text-[#1E1E1E]">glm-5.3 / USDC</span>
        <span className="rounded-[4px] border border-[#E4E4E4] px-1.5 py-0.5 text-[10px] text-[#757575]">spot</span>
        <span className="ml-auto flex items-center gap-5 tabular-nums">
          <span>
            <span className="text-[11px] text-[#757575]">Mark </span>
            0.178
          </span>
          <span className="text-[#2EBD85]">+2.41%</span>
          <span>
            <span className="text-[11px] text-[#757575]">24h </span>
            $1,204.60
          </span>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_190px]">
        <div className="min-h-0 p-5">
          <div className="flex justify-between pb-2 text-[10px] tracking-[0.14em] text-[#757575] uppercase">
            <span>Price</span>
            <span>Size · MTok</span>
            <span>Total</span>
          </div>
          {ASKS.map((ask) => (
            <div key={ask.price} className="flex justify-between border-t border-[#ECECEC] py-1.5 text-[12px] tabular-nums">
              <span className="text-[#F6465D]">{ask.price}</span>
              <span className="text-[#1E1E1E]">{ask.size}</span>
              <span className="text-[#757575]">${ask.total}</span>
            </div>
          ))}
        </div>

        <div className="border-l border-[#ECECEC] p-4 text-[12px]">
          <p className="text-[10px] tracking-[0.14em] text-[#757575] uppercase">Order</p>
          <div className="mt-3 flex justify-between">
            <span className="text-[#757575]">Size</span>
            <span className="tabular-nums text-[#1E1E1E]">100 MTok</span>
          </div>
          <div className="mt-1.5 flex justify-between">
            <span className="text-[#757575]">Value</span>
            <span className="tabular-nums text-[#1E1E1E]">$17.80</span>
          </div>
          <div className="mt-1.5 flex justify-between">
            <span className="text-[#757575]">Fee</span>
            <span className="tabular-nums text-[#1E1E1E]">$1.78</span>
          </div>
          <div className="mt-3 flex justify-between border-t border-[#ECECEC] pt-2 font-semibold">
            <span>You pay</span>
            <span className="tabular-nums text-[#1743FF]">$19.58</span>
          </div>
          <div className="mt-3 h-[30px] bg-black text-center text-[12px] leading-[30px] font-semibold text-white">
            Buy MTokens
          </div>
        </div>
      </div>
    </div>
  );
}

export function HumansTerminal({ variant }: { variant: "page" | "canvas" }) {
  const canvas = variant === "canvas";

  return (
    <section className={canvas ? "absolute left-[55px] top-[3448px] w-[1617px]" : "mt-16 border-t border-[#CECECE] pb-14 pt-10"}>
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
        className={`relative overflow-hidden bg-[#56595D] ${canvas ? "mt-[34px] h-[600px] rounded-[6px]" : "mt-6 h-[440px]"}`}
      >
        <img
          src="/images/terminal-rays.webp"
          alt=""
          aria-hidden
          loading="lazy"
          width={1217}
          height={768}
          className="absolute inset-0 size-full object-cover object-bottom"
        />
        <div
          className={
            canvas
              ? "absolute left-1/2 top-[96px] h-[464px] w-[1000px] -translate-x-1/2"
              : "absolute inset-x-4 top-8 bottom-8"
          }
        >
          <BrowserWindow variant="chrome" headerStyle="full" url="https://meridian.trade/trade">
            <MarketPreview />
          </BrowserWindow>
        </div>
      </div>
    </section>
  );
}
