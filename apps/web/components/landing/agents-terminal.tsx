"use client";

import { useState } from "react";
import {
  type TabContent,
  TerminalAnimationCommandBar,
  TerminalAnimationOutput,
  TerminalAnimationRoot,
  TerminalAnimationTabList,
  TerminalAnimationTabTrigger,
  TerminalAnimationTrailingPrompt,
} from "../ui/terminal-animation";

const OK = "text-[#2EBD85]";
const ROUTE = "text-[#8FA2FF]";
const MUTED = "text-[#9A9A9A]";

const STEPS: TabContent[] = [
  {
    label: "top-up",
    command: 'curl -X POST "$MERIDIAN/api/v1/topup?usd=0.10"',
    lines: [
      { text: "← 402 Payment Required", color: ROUTE, delay: 450 },
      { text: "  x402: 0.10 USDC on hedera-testnet to the venue treasury", color: MUTED, delay: 300 },
      { text: "→ paid from 0.0.11223929, tx 0.0.7162784-1793971550.448302558", color: MUTED, delay: 1100 },
      { text: "✓ 200 credited $0.10, router key minted", color: OK, delay: 900 },
    ],
  },
  {
    label: "buy",
    command: `curl -X POST $MERIDIAN/api/v1/trades -d '{"model":"0gm-1.0-35b-a3b","tokens":"100000"}'`,
    lines: [
      { text: "  best ask 0.153 USD/MTok on the 0G rail", color: MUTED, delay: 450 },
      { text: "  quote 0.1 MTok for $0.0153", color: ROUTE, delay: 500 },
      { text: "✓ filled 0.1 MTok for $0.0153 in 1 fill", color: OK, delay: 800 },
    ],
  },
  {
    label: "inference",
    command: 'curl $MERIDIAN/api/v1/chat/completions -H "Authorization: Bearer $KEY" -d @prompt.json',
    lines: [
      { text: "  routed to the 0G rail at the cheapest live ask", color: ROUTE, delay: 500 },
      { text: "  paid from the MTokens just bought", color: MUTED, delay: 400 },
      { text: "✓ 200 answer streamed, 1,400 tokens used", color: OK, delay: 1000 },
    ],
  },
  {
    label: "sell",
    command: `curl -X POST $MERIDIAN/api/v1/sells -d '{"model":"0gm-1.0-35b-a3b","tokens":"98600"}'`,
    lines: [
      { text: "  holding 0.0986 MTok after the answer", color: MUTED, delay: 450 },
      { text: "  best bid 0.15 USD/MTok", color: MUTED, delay: 400 },
      { text: "✓ sold 0.0986 MTok at market for $0.0148", color: OK, delay: 800 },
      { text: "  received $0.0133 after the 10% venue fee", color: ROUTE, delay: 400 },
    ],
  },
];

export function AgentsTerminal({ variant }: { variant: "page" | "canvas" }) {
  const canvas = variant === "canvas";
  const [step, setStep] = useState(0);

  return (
    <section className={canvas ? "absolute left-[55px] top-[3448px] w-[1617px]" : "mt-16 border-t border-[#CECECE] pb-14 pt-10"}>
      <h2
        className={
          canvas
            ? "ml-[48px] font-serif text-[60px] font-normal leading-[72px] text-black"
            : "px-6 font-serif text-[34px] leading-[1.1] text-black"
        }
      >
        How agents use Meridian
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
        <TerminalAnimationRoot
          tabs={STEPS}
          activeTab={step}
          onActiveTabChange={setStep}
          onComplete={() => setStep((current) => (current + 1) % STEPS.length)}
          className={`absolute bottom-0 flex flex-col rounded-t-[6px] border border-b-0 border-white/10 bg-[#1A1A1A] ${
            canvas ? "left-1/2 top-[110px] w-[1000px] -translate-x-1/2" : "inset-x-4 top-12"
          }`}
        >
          <div
            className={`min-h-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[#F5F5F5] ${
              canvas ? "px-10 pb-6 pt-9 text-[16px] leading-[30px]" : "px-4 pb-4 pt-5 text-[12px] leading-[22px]"
            }`}
          >
            <div className="flex">
              <span className={MUTED}>$ </span>
              <TerminalAnimationCommandBar />
            </div>
            <TerminalAnimationOutput />
            <TerminalAnimationTrailingPrompt>
              <span className={MUTED}>$ </span>
              <span aria-hidden className={MUTED}>
                ▌
              </span>
            </TerminalAnimationTrailingPrompt>
          </div>
          <TerminalAnimationTabList
            className={`mx-auto flex rounded-[8px] border border-white/10 bg-white/5 p-1 font-mono ${
              canvas ? "mb-7 text-[16px]" : "mb-4 text-[12px]"
            }`}
          >
            {STEPS.map((item, index) => (
              <TerminalAnimationTabTrigger
                key={item.label}
                index={index}
                className={`rounded-[6px] text-[#9A9A9A] transition-colors duration-200 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8FA2FF] data-[state=active]:bg-[#EDEDED] data-[state=active]:text-[#1E1E1E] ${
                  canvas ? "px-4 py-1.5" : "px-2.5 py-1"
                }`}
              >
                {item.label}
              </TerminalAnimationTabTrigger>
            ))}
          </TerminalAnimationTabList>
        </TerminalAnimationRoot>
      </div>
    </section>
  );
}
