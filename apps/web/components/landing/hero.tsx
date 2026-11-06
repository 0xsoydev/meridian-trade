import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_HREF, LINE } from "./copy";

const COLOSSEUM_FILTER = "brightness(112%) contrast(92%)";

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
          className="mt-7 inline-flex h-[46px] items-center rounded-[6px] bg-black px-9 text-[16px] text-white"
        >
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
        }}
      />
      {nav}
      <div className={`absolute left-[1049px] top-[92px] h-px w-[623px] ${LINE}`} />
      <div className={`absolute left-[1048px] top-[92px] h-[92px] w-px ${LINE}`} />

      <h1 className="absolute left-[641px] top-[175px] whitespace-pre font-serif text-[100px] font-normal leading-[100px] text-[#1E1E1E]">
        {"Compute expires.\nMarkets don't."}
      </h1>
      <p className="absolute left-[641px] top-[384px] w-[494px] whitespace-pre-wrap text-[20px] leading-[24px] text-black">
        {"A spot market and a perp curve for spare LLM capacity. Sellers list what they can't cash out; agents pay in USDC and stream on, without a human in the loop."}
      </p>
      <Link
        href={DEMO_HREF}
        className="absolute left-[717px] top-[488px] flex h-[43px] w-[294px] items-center justify-center rounded-[6px] bg-black"
      >
        <span className="text-[20px] leading-[24px] text-white">Enter the market</span>
      </Link>
    </>
  );
}
