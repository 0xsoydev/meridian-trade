import { Fragment } from "react";
import { CARDS } from "./copy";

export function WhatWeDo({ variant }: { variant: "page" | "canvas" }) {
  if (variant === "page") {
    return (
      <section className="mt-16 border-t border-[#CECECE] px-6 pt-10">
        <p className="text-[15px] text-black">[ what we do ]</p>
        <h2 className="mt-5 font-serif text-[34px] leading-[1.1] text-[#1E1E1E]">
          Sell what expires. Trade the rest.
        </h2>
        <div className="mt-9 flex flex-col gap-6">
          {CARDS.map((c) => (
            <article key={c.title} className="border border-[#CECECE] bg-[#EBEBEB] px-6 py-7">
              <p className="text-[15px] text-[#1E1E1E]">{c.title}</p>
              <img
                src={c.art.src}
                alt=""
                width={c.art.w}
                height={c.art.h}
                className="mx-auto my-7 h-auto w-[62%] max-w-[230px]"
              />
              <p className="text-[16px] leading-[24px] text-black">{c.bodyText}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="absolute inset-0 -translate-x-[125px]">
      <div className="absolute left-[575px] top-[726px] h-[821px] w-[1080px] border border-[#CECECE] bg-white" />

      <p className="absolute left-[610px] top-[717px] whitespace-pre text-[20px] leading-[100px] text-black">
        [ what we do ]
      </p>
      <h2 className="absolute left-[610px] top-[808px] whitespace-pre font-serif text-[60px] font-normal leading-[60px] text-[#1E1E1E]">
        {"Sell what expires.\nTrade the rest."}
      </h2>

      {CARDS.map((c) => (
        <Fragment key={c.card}>
          <div
            className="absolute top-[965px] h-[547px] w-[336px] border border-[#CECECE] bg-[#EBEBEB]"
            style={{ left: c.card }}
          />
          <p
            className="absolute whitespace-pre text-[20px] leading-[24px] text-[#1E1E1E]"
            style={{ left: c.label, top: 987 }}
          >
            {c.title}
          </p>
          <img
            src={c.art.src}
            alt=""
            width={c.art.w}
            height={c.art.h}
            className="absolute"
            style={{ left: c.sphere, top: c.sphereTop }}
          />
          <p
            className="absolute w-[244px] whitespace-pre-wrap text-[20px] leading-[24px] text-black"
            style={{ left: c.body, top: 1330 }}
          >
            {c.bodyText}
          </p>
        </Fragment>
      ))}
    </div>
  );
}
