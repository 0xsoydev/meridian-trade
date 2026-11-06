"use client";

import Link from "next/link";
import { useState } from "react";

const MUTED = "text-[#757575]";
const LINK = "text-[#1743FF] hover:underline";
const SHORTLIST = "cheapest:0gm-1.0-35b-a3b,deepseek-v4.1-flash";

function prompt(base: string, network: string): string {
  return `You can buy LLM inference from the LLM Token Exchange at ${base}. Pay per use over x402 in USDC on Hedera (${network}) from the Hedera account in HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY. No signup is needed.

1. POST ${base}/api/v1/topup?usd=0.50 with an x402 client (@x402/fetch + @x402/hedera, exact scheme). Pay the 402 and retry. The JSON reply holds "key". Keep it secret and reuse it.
2. PATCH ${base}/api/v1/keys/settings with "Authorization: Bearer <key>" and {"auto_topup_usd_micro":"1000000"} so an empty balance answers 402 and your x402 client refills $1 by itself.
3. Call the OpenAI-compatible ${base}/api/v1/chat/completions with the key, through the same x402 fetch.
4. For each task, choose 2-4 models good enough for it and send model "cheapest:<id>,<id>". The router fills at the lowest live ask among them and names its pick in the X-Router-Model header. GET ${base}/api/v1/models lists ids and best asks.
5. The daily top-up cap starts at $5. To spend more, first POST ${base}/api/v1/approvals with {"kind":"link_human"} and show your human verification_uri_complete to approve with World ID. Then PATCH ${base}/api/v1/keys/settings with {"daily_topup_cap_usd_micro":"<new cap>"}. It answers 403 with an "approval" object; show your human that verification_uri_complete too. Poll GET ${base}/api/v1/approvals/<approval_id> until it is approved.`;
}

function code(base: string, network: string): string {
  return `import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactHederaScheme, PrivateKey, createClientHederaSigner } from "@x402/hedera";
import OpenAI from "openai";

const BASE = "${base}";
const signer = createClientHederaSigner(
  process.env.HEDERA_ACCOUNT_ID!,
  PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY!),
  { network: "${network}" },
);
const pay = wrapFetchWithPayment(fetch, new x402Client().register("${network}", new ExactHederaScheme(signer)));

const { key } = await (await pay(\`\${BASE}/api/v1/topup?usd=0.50\`, { method: "POST" })).json();
await fetch(\`\${BASE}/api/v1/keys/settings\`, {
  method: "PATCH",
  headers: { authorization: \`Bearer \${key}\`, "content-type": "application/json" },
  body: JSON.stringify({ auto_topup_usd_micro: "1000000" }),
});

const ai = new OpenAI({ baseURL: \`\${BASE}/api/v1\`, apiKey: key, fetch: pay as typeof fetch });
const reply = await ai.chat.completions.create({
  model: "${SHORTLIST}",
  messages: [{ role: "user", content: "Summarise today's 0G compute prices in one line." }],
});
console.log(reply.choices[0]?.message.content);`;
}

function Block({ id, label, text, copied, onCopy }: {
  id: string;
  label: string;
  text: string;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
}) {
  return (
    <div className="mt-3 border border-[#CECECE] bg-[#EBEBEB]">
      <div className="flex items-center justify-between border-b border-[#CECECE] px-4 py-2">
        <span className="text-[13px] text-[#1E1E1E]">{label}</span>
        <button type="button" onClick={() => onCopy(id, text)} className={`text-[13px] ${LINK}`}>
          {copied === id ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 text-[12px] leading-[17px] text-[#1E1E1E]">{text}</pre>
    </div>
  );
}

export function Agents({ base, network }: { base: string; network: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<"prompt" | "code">("prompt");

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className="max-w-[860px]">
      <h1 className="font-serif text-[50px] leading-[1.05] text-[#1E1E1E]">
        Plug in your <span className="text-[#A3A3A3]">comfy agent</span>
      </h1>
      <p className="mt-4 max-w-[600px] text-[14px] leading-[18px] text-black">
        Your agent buys the cheapest inference for each task and pays per use over x402. There is no signup and no key
        to paste. The first payment mints its router key. You only step in, with World ID, if it wants to spend past its
        daily cap.
      </p>

      <ol className="mt-8 space-y-8">
        <li>
          <p className="text-[13px] text-[#1E1E1E]">[ 1 · give it a Hedera wallet ]</p>
          <p className="mt-2 max-w-[600px] text-[14px] leading-[18px] text-black">
            comfy agents hold 0G, but payments here settle in USDC on Hedera ({network}). Create an account at the{" "}
            <a href="https://portal.hedera.com" target="_blank" rel="noreferrer" className={LINK}>
              Hedera portal
            </a>
            , fund it from the{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className={LINK}>
              Circle USDC faucet
            </a>
            , and set <code>HEDERA_ACCOUNT_ID</code> and <code>HEDERA_PRIVATE_KEY</code> in the agent&apos;s environment.
            $1 covers a long session.
          </p>
        </li>

        <li>
          <p className="text-[13px] text-[#1E1E1E]">[ 2 · hand it the instructions ]</p>
          <div className="mt-2 flex gap-5" role="tablist">
            {(["prompt", "code"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`text-[14px] ${tab === value ? "text-[#1E1E1E] underline decoration-[#1743FF] underline-offset-[6px]" : MUTED}`}
              >
                {value === "prompt" ? "paste into the agent" : "drop into its code"}
              </button>
            ))}
          </div>
          {tab === "prompt" ? (
            <Block id="prompt" label="agent instructions" text={prompt(base, network)} copied={copied} onCopy={copy} />
          ) : (
            <Block id="code" label="agent.ts · Node 22" text={code(base, network)} copied={copied} onCopy={copy} />
          )}
          {tab === "code" && (
            <Block
              id="install"
              label="install"
              text="npm i @x402/core @x402/fetch @x402/hedera openai"
              copied={copied}
              onCopy={copy}
            />
          )}
        </li>

        <li>
          <p className="text-[13px] text-[#1E1E1E]">[ 3 · watch it spend ]</p>
          <p className="mt-2 max-w-[600px] text-[14px] leading-[18px] text-black">
            Every top-up lands on{" "}
            <Link href="/receipts" className={LINK}>
              Receipts
            </Link>{" "}
            with its HashScan transaction. Live asks per model are on{" "}
            <Link href="/trade" className={LINK}>
              Trade
            </Link>
            . To cap or link the key to you, open{" "}
            <Link href="/keys" className={LINK}>
              Keys
            </Link>
            .
          </p>
        </li>
      </ol>
    </section>
  );
}
