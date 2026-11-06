"use client";

import { useState } from "react";
import {
  type TabContent,
  TerminalAnimationCommandBar,
  TerminalAnimationOutput,
  TerminalAnimationRoot,
  TerminalAnimationTabList,
  TerminalAnimationTabTrigger,
} from "../ui/terminal-animation";

const OK = "text-[#2EBD85]";
const ROUTE = "text-[#8FA2FF]";
const MUTED = "text-[#9A9A9A]";

const STEPS: TabContent[] = [
  {
    label: "Auto top-up",
    command: 'curl -X POST "$MERIDIAN/api/v1/topup?usd=0.10"',
    lines: [
      { text: "← 402 Payment Required", color: ROUTE, delay: 450 },
      { text: "  x402: 0.10 USDC on hedera-testnet to the venue treasury", color: MUTED, delay: 300 },
      { text: "→ paid from 0.0.11223929, tx 0.0.7162784-1793971550.448302558", color: MUTED, delay: 1100 },
      { text: "✓ 200 credited $0.10, router key minted", color: OK, delay: 900 },
    ],
  },
  {
    label: "Quote and buy",
    command: `curl -X POST $MERIDIAN/api/v1/trades -d '{"model":"0gm-1.0-35b-a3b","tokens":"100000"}'`,
    lines: [
      { text: "  best ask 0.153 USD/MTok on the 0G rail", color: MUTED, delay: 450 },
      { text: "  quote 0.1 MTok for $0.0153", color: ROUTE, delay: 500 },
      { text: "✓ filled 0.1 MTok for $0.0153 in 1 fill", color: OK, delay: 800 },
    ],
  },
  {
    label: "Inference",
    command: 'curl $MERIDIAN/api/v1/chat/completions -H "Authorization: Bearer $KEY" -d @prompt.json',
    lines: [
      { text: "  routed to the 0G rail at the cheapest live ask", color: ROUTE, delay: 500 },
      { text: "  paid from the MTokens just bought", color: MUTED, delay: 400 },
      { text: "✓ 200 answer streamed, 1,400 tokens used", color: OK, delay: 1000 },
    ],
  },
  {
    label: "Sell the rest",
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
    <section
      className={canvas ? "absolute left-[103px] top-[3400px] w-[1522px]" : "border-t border-[#CECECE] px-6 pb-14 pt-10"}
    >
      <h2
        className={
          canvas
            ? "font-serif text-[60px] font-normal leading-[72px] text-black"
            : "font-serif text-[34px] leading-[1.1] text-black"
        }
      >
        How agents use Meridian
      </h2>
      <TerminalAnimationRoot
        tabs={STEPS}
        activeTab={step}
        onActiveTabChange={setStep}
        onComplete={() => setStep((current) => (current + 1) % STEPS.length)}
        className={`overflow-hidden rounded-[6px] bg-[#1E1E1E] ${canvas ? "mt-[34px]" : "mt-6"}`}
      >
        <div className={`flex items-center border-b border-white/10 ${canvas ? "gap-8 px-6 py-4" : "gap-4 px-4 py-3"}`}>
          <span aria-hidden className="flex shrink-0 gap-2">
            <span className="size-3 rounded-full bg-[#FF5F57]" />
            <span className="size-3 rounded-full bg-[#FEBC2E]" />
            <span className="size-3 rounded-full bg-[#28C840]" />
          </span>
          <TerminalAnimationTabList className={`flex flex-wrap ${canvas ? "gap-x-8 text-[18px]" : "gap-x-4 gap-y-1 text-[13px]"}`}>
            {STEPS.map((item, index) => (
              <TerminalAnimationTabTrigger
                key={item.label}
                index={index}
                className="text-[#9A9A9A] underline-offset-[6px] transition-colors duration-200 hover:text-white data-[state=active]:text-white data-[state=active]:underline data-[state=active]:decoration-[#8FA2FF]"
              >
                {String(index + 1).padStart(2, "0")} {item.label}
              </TerminalAnimationTabTrigger>
            ))}
          </TerminalAnimationTabList>
        </div>
        <div
          className={`overflow-x-auto whitespace-pre font-mono text-[#F5F5F5] ${
            canvas ? "min-h-[250px] px-8 py-7 text-[18px] leading-[32px]" : "min-h-[260px] px-4 py-5 text-[12px] leading-[22px]"
          }`}
        >
          <div className="flex">
            <span className="text-[#9A9A9A]">$ </span>
            <TerminalAnimationCommandBar />
          </div>
          <TerminalAnimationOutput />
        </div>
      </TerminalAnimationRoot>
    </section>
  );
}
