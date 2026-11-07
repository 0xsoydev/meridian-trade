"use client";

import { type RefObject, useRef } from "react";
import { AnimatedBeam } from "../ui/animated-beam";
import { CORNERS } from "./hero";

const AGENTS = [
  { name: "Claude Code", logo: "/images/rails/claudecode.svg" },
  { name: "OpenCode", logo: "/images/rails/opencode.svg" },
  { name: "Codex", logo: "/images/rails/codex.svg" },
];

const PROVIDERS = [
  { name: "Claude Code", logo: "/images/rails/claudecode.svg" },
  { name: "DeepSeek", logo: "/images/rails/deepseek.svg" },
  { name: "Command Code", logo: "/images/rails/commandcode.svg" },
  { name: "0G AI", logo: "/images/rails/0g.svg" },
];

export function Flow({ variant }: { variant: "page" | "canvas" }) {
  const canvas = variant === "canvas";
  const container = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  const agents = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const providers = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ];

  return (
    <section className={canvas ? "absolute left-[103px] top-[1759px] w-[1522px]" : "px-6"}>
      <div
        ref={container}
        className={canvas ? "relative grid grid-cols-[360px_1fr_360px] items-center" : "flex flex-col gap-10"}
      >
        <Column label="your agent" items={AGENTS} refs={agents} canvas={canvas} />
        <div
          ref={hub}
          className={`relative z-10 mx-auto flex items-center justify-center rounded-[6px] border border-[#CECECE] bg-white ${
            canvas ? "px-14 py-12" : "px-10 py-8"
          }`}
        >
          {CORNERS.map((corner) => (
            <span key={corner} aria-hidden className={corner} />
          ))}
          <img
            src="/images/namelogo.svg"
            alt="Meridian"
            width={canvas ? 285 : 200}
            height={canvas ? 65 : 46}
            className="h-auto"
          />
        </div>
        <Column label="providers" items={PROVIDERS} refs={providers} canvas={canvas} />
        {canvas ? (
          <>
            {agents.map((ref, index) => (
              <AnimatedBeam key={`agent-${AGENTS[index]?.name}`} containerRef={container} fromRef={ref} toRef={hub} />
            ))}
            {providers.map((ref, index) => (
              <AnimatedBeam key={`provider-${PROVIDERS[index]?.name}`} containerRef={container} fromRef={hub} toRef={ref} />
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

function Column({
  label,
  items,
  refs,
  canvas,
}: {
  label: string;
  items: { name: string; logo: string }[];
  refs: RefObject<HTMLDivElement | null>[];
  canvas: boolean;
}) {
  return (
    <div className={`relative z-10 flex flex-col ${canvas ? "gap-4" : "gap-3"}`}>
      <p className={`text-[#757575] ${canvas ? "text-[16px] leading-[24px]" : "text-[13px]"}`}>[ {label} ]</p>
      {items.map((item, index) => (
        <div
          key={item.name}
          ref={refs[index]}
          className={`flex items-center rounded-[6px] border border-[#CECECE] bg-white ${canvas ? "gap-4 px-5 py-4" : "gap-3 px-4 py-3"}`}
        >
          <img src={item.logo} alt="" width={40} height={32} className={`object-contain ${canvas ? "h-8 w-10" : "h-7 w-8"}`} />
          <span className={`text-[#1E1E1E] ${canvas ? "text-[20px] leading-[24px]" : "text-[16px] leading-[22px]"}`}>{item.name}</span>
        </div>
      ))}
    </div>
  );
}
