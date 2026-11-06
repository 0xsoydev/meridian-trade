import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_HREF } from "./copy";

const COLOSSEUM_FILTER = "brightness(112%) contrast(92%)";
export const CTA =
  "group bg-[#1E1E1E] transition-[background-color,scale] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-[#1743FF] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-[10px] focus-visible:outline-[#1743FF] motion-reduce:transition-none";
export const CORNER =
  "absolute size-[10px] border-[#1743FF] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
export const CORNERS = [
  `${CORNER} -left-[6px] -top-[6px] border-l border-t group-hover:-translate-x-[3px] group-hover:-translate-y-[3px]`,
  `${CORNER} -right-[6px] -top-[6px] border-r border-t group-hover:translate-x-[3px] group-hover:-translate-y-[3px]`,
  `${CORNER} -bottom-[6px] -left-[6px] border-b border-l group-hover:-translate-x-[3px] group-hover:translate-y-[3px]`,
  `${CORNER} -bottom-[6px] -right-[6px] border-b border-r group-hover:translate-x-[3px] group-hover:translate-y-[3px]`,
];

export function Hero({ variant, nav }: { variant: "page" | "canvas"; nav?: ReactNode }) {
  if (variant === "page") {
    return (
      <section className="px-6 pt-10">
        <div
          className="h-[210px] w-full bg-cover bg-top"
          style={{ backgroundImage: "url(/images/colosseum.webp)", filter: COLOSSEUM_FILTER }}
        />
        <h1 className="mt-9 font-serif text-[44px] leading-[1.06] text-[#1E1E1E]">
          Compute expires. Markets don't.
        </h1>
        <p className="mt-5 text-[16px] leading-[24px] text-black">
          A spot market and a perp curve for spare LLM capacity. Sellers list
          what they can't cash out; agents pay in USDC and stream on, without
          a human in the loop.
        </p>
        <Link
          href={DEMO_HREF}
          className={`${CTA} relative mt-7 inline-flex h-[46px] items-center px-9 text-[16px] text-white`}
        >
          {CORNERS.map((c) => (
            <span key={c} aria-hidden className={c} />
          ))}
          Enter the market
        </Link>
      </section>
    );
  }

  return (
    <>
      <div
        className="absolute left-0 top-0 h-[1184px] w-[1728px]"
        style={{
          backgroundImage: "url(/images/colosseum.webp)",
          backgroundSize: "100% 100%",
          filter: COLOSSEUM_FILTER,
          maskImage: "linear-gradient(#000 calc(100% - 200px), transparent)",
        }}
      />
      {nav}

      <div className="absolute left-[484px] top-[90px] h-[450px] w-[760px] bg-white/85 blur-[36px]" />
      <h1 className="absolute left-1/2 top-[135px] -translate-x-1/2 whitespace-pre text-center font-serif text-[100px] font-normal leading-[100px] text-[#1E1E1E]">
        {"Compute expires.\nMarkets don't."}
      </h1>
      <p className="absolute left-1/2 top-[354px] -translate-x-1/2 w-[494px] whitespace-pre-wrap text-center text-[16px] leading-[24px] text-black">
        {"A spot market and a perp curve for spare LLM capacity. Sellers list what they can't cash out; agents pay in USDC and stream on, without a human in the loop."}
      </p>
      <Link
        href={DEMO_HREF}
        className={`${CTA} absolute left-1/2 top-[462px] flex h-[60px] w-[294px] -translate-x-1/2 items-center justify-center`}
      >
        {CORNERS.map((c) => (
          <span key={c} aria-hidden className={c} />
        ))}
        <span className="text-2xl leading-[24px] text-white">Enter the Market</span>
      </Link>
    </>
  );
}
