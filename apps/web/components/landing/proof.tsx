import { Fragment } from "react";
import { COLUMN_COPY, LINE } from "./copy";

const DIVIDER_X = [138, 428, 718, 1008, 1298, 1588];
const TICKS = Array.from({ length: 24 }, (_, k) => 196 + 58 * k).filter(
  (x) => !DIVIDER_X.includes(x),
);

export function Proof({ variant }: { variant: "page" | "canvas" }) {
  if (variant === "page") {
    return (
      <section className="mt-16 border-t border-[#CECECE] px-6 pt-10">
        <h2 className="font-serif text-[32px] leading-[1.12] text-black">
          Proof over marketing. Recompute our index in your browser.
        </h2>
        <div className="mt-8 border-b border-[#CECECE]">
          {COLUMN_COPY.map((c) => (
            <div key={c.x} className="border-t border-[#CECECE] py-5">
              <p className="text-[15px] leading-[22px] text-[#1E1E1E]">{c.head}</p>
              <p className="mt-1 text-[15px] leading-[22px] text-black">{c.bodyText}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <>
      <p className="absolute left-[96px] top-[1605px] w-[876px] whitespace-pre-wrap font-serif text-[60px] font-normal leading-[60px] text-black">
        Proof over marketing. Recompute our index in your browser.
      </p>

      <div className={`absolute left-[55px] top-[2078px] h-px w-[1618px] ${LINE}`} />
      {DIVIDER_X.map((x) => (
        <div key={x} className={`absolute top-[1814px] h-[265px] w-px ${LINE}`} style={{ left: x - 1 }} />
      ))}
      {TICKS.map((x) => (
        <div key={x} className={`absolute top-[2039px] h-[40px] w-px ${LINE}`} style={{ left: x - 1 }} />
      ))}
      {COLUMN_COPY.map((c) => (
        <Fragment key={c.x}>
          <p
            className="absolute whitespace-pre text-[20px] leading-[24px] text-[#1E1E1E]"
            style={{ left: c.x, top: 1816 }}
          >
            {c.head}
          </p>
          <p
            className="absolute w-[199px] whitespace-pre-wrap text-[20px] leading-[24px] text-black"
            style={{ left: c.x, top: 1850 }}
          >
            {c.bodyText}
          </p>
        </Fragment>
      ))}
    </>
  );
}
