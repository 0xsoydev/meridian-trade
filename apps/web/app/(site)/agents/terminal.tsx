"use client";

import Link from "next/link";
import { useState } from "react";

const MUTED = "text-[#757575]";
const LINK = "text-[#1743FF] hover:underline";
const BUTTON =
  "mt-2 border border-[#CECECE] bg-white px-3 py-1.5 text-[13px] text-[#1E1E1E] hover:border-[#1743FF]";

function prompt(base: string, network: string, agent: string): string {
  const name = agent.trim() || "<your comfy agent name>";
  return `You are a comfy.fun agent named ${name}. You can buy LLM inference from the LLM Token Exchange at ${base}. Pay per use over x402 in USDC on Hedera (${network}) from the Hedera account in HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY in ./.env. Load them in code and never print them.

Setup: npm i @x402/fetch @x402/hedera, set "type": "module" in package.json, write your client in ./agent.ts and run it with node --env-file=.env --experimental-strip-types agent.ts. If ${name} is not on comfy.fun yet, register it first with the comfy plugin.

1. POST ${base}/api/v1/topup?usd=0.50 with an x402 client (@x402/fetch + @x402/hedera, exact scheme). Pay the 402 and retry. The JSON reply holds "key". Keep it secret, save it to a gitignored file so a rerun reuses it instead of topping up again, and send it as "Authorization: Bearer <key>".
2. PATCH ${base}/api/v1/keys/settings with {"auto_topup_usd_micro":"1000000"} so an empty balance answers 402 and your x402 client refills $1 by itself.
3. Connect to your human: POST ${base}/api/v1/approvals with {"kind":"link_human"}. Show your human verification_uri_complete and ask them to approve with World ID. Poll GET ${base}/api/v1/approvals/<approval_id> every interval seconds until status is "approved".
4. Connect your comfy agent: PUT ${base}/api/v1/agents/comfy with {"agent":"${name}"}. You now show on ${base}/agents as a comfy agent with a verified human.
5. For each task, choose 2-4 models good enough for it and call the OpenAI-compatible ${base}/api/v1/chat/completions, through the same x402 fetch, with model "cheapest:<id>,<id>". The router tries them cheapest live ask first, moves on if a model fails, and names the model that answered in the X-Router-Model header. GET ${base}/api/v1/models lists ids and best asks.
6. The daily top-up cap starts low. To raise it, PATCH ${base}/api/v1/keys/settings with {"daily_topup_cap_usd_micro":"<new cap>"}. It answers 403 with an "approval" object; show your human its verification_uri_complete and poll as in step 3.`;
}

export type ConnectedAgent = { agent: string; since: string; requests: number; spent: string };

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-3 border-b border-[#D9D9D9] py-4">
      <span className="font-serif text-[22px] leading-none text-[#A3A3A3]">{n}</span>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-[#1E1E1E]">{title}</p>
        {children}
      </div>
    </li>
  );
}

export function Agents({
  base,
  network,
  connected,
}: {
  base: string;
  network: string;
  connected: ConnectedAgent[] | null;
}) {
  const [copied, setCopied] = useState(false);
  const [agent, setAgent] = useState("");
  const instructions = prompt(base, network, agent);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(instructions);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section>
      <h1 className="font-serif text-[50px] leading-[1.05] text-[#1E1E1E]">
        Plug in your <span className="text-[#A3A3A3]">comfy agent</span>
      </h1>
      <p className="mt-4 max-w-[425px] text-[14px] leading-[18px] text-black">
        Your comfy.fun agent buys the cheapest inference for each task and pays per use. No signup, no key to paste.
        You verify once with World ID, and it shows here as yours.
      </p>

      <div className="mt-6 border-t border-[#CECECE] pt-5">
        <p className="text-[13px] text-[#1E1E1E]">[ how it works ]</p>
        <dl className="mt-3 flex flex-wrap gap-x-[26px] gap-y-3">
          {[
            ["payment", `x402, USDC on Hedera (${network})`],
            ["signup", "none, the first payment mints its key"],
            ["routing", "cheapest live ask among models fit for the task"],
            ["rule", "only agents of a verified human connect"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className={`text-[13px] ${MUTED}`}>{label}</dt>
              <dd className="text-[13px] text-[#1E1E1E]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-5 border border-[#CECECE] bg-[#EBEBEB] p-4">
        <p className="text-[13px] text-[#1E1E1E]">[ connect a comfy agent ]</p>
        <h2 className="mt-2 font-serif text-[22px] leading-tight text-[#1E1E1E]">Fund it, brief it, verify once.</h2>

        <ol className="mt-4 border-t border-[#D9D9D9]">
          <Step n={1} title="Give it a Hedera wallet">
            <p className={`mt-1 max-w-[640px] text-[13px] leading-5 ${MUTED}`}>
              comfy agents hold 0G; payments here settle in USDC on Hedera. Create an account on the{" "}
              <a href="https://portal.hedera.com" target="_blank" rel="noreferrer" className={LINK}>
                Hedera portal
              </a>
              , associate it with USDC (<code>0.0.429274</code>) so it can receive it, fund it from the{" "}
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className={LINK}>
                Circle USDC faucet
              </a>
              , and put <code>HEDERA_ACCOUNT_ID</code> and <code>HEDERA_PRIVATE_KEY</code> in the agent&apos;s{" "}
              <code>.env</code>. One dollar covers a long session.
            </p>
          </Step>

          <Step n={2} title="Paste the instructions into your agent">
            <p className={`mt-1 max-w-[640px] text-[13px] leading-5 ${MUTED}`}>
              Running Claude Code with comfy&apos;s plugin? Type your agent&apos;s comfy name, then paste the
              instructions into that session. It writes its own client, pays, and picks the cheapest model per task.
            </p>
            <label className={`mt-2 block text-[12px] ${MUTED}`}>
              comfy agent name
              <input
                value={agent}
                onChange={(event) => setAgent(event.target.value)}
                maxLength={64}
                placeholder="yoyo"
                className="mt-1 block w-[240px] border border-[#CECECE] bg-white px-2 py-1.5 text-[13px] text-[#1E1E1E]"
              />
            </label>
            <button type="button" onClick={() => void copy()} className={BUTTON}>
              {copied ? "Copied" : "Copy instructions"}
            </button>
            <details className="mt-2">
              <summary className={`cursor-pointer text-[12px] ${LINK}`}>show the instructions</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words border border-[#CECECE] bg-white p-3 text-[12px] leading-[17px] text-[#1E1E1E]">
                {instructions}
              </pre>
            </details>
          </Step>

          <Step n={3} title="Approve it with World ID">
            <p className={`mt-1 max-w-[640px] text-[13px] leading-5 ${MUTED}`}>
              Your agent sends you an approval link. Verify with the World App, and the agent connects under its comfy
              name. An agent without a verified human cannot connect.
            </p>
          </Step>

          <Step n={4} title="Watch it work">
            <p className={`mt-1 max-w-[640px] text-[13px] leading-5 ${MUTED}`}>
              It appears below. Every top-up lands on{" "}
              <Link href="/receipts" className={LINK}>
                Receipts
              </Link>{" "}
              with its HashScan transaction; live asks per model are on{" "}
              <Link href="/trade" className={LINK}>
                Trade
              </Link>
              .
            </p>
          </Step>
        </ol>
      </div>

      <div className="mt-8 border-t border-[#CECECE] pt-5">
        <p className="text-[13px] text-[#1E1E1E]">[ connected comfy agents ]</p>
        {connected === null ? (
          <p className={`mt-3 text-[13px] ${MUTED}`}>the list is unavailable right now</p>
        ) : connected.length === 0 ? (
          <p className={`mt-3 text-[13px] ${MUTED}`}>no comfy agent has connected yet</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-[13px] [&_td]:pr-4 [&_th]:pr-4">
              <thead>
                <tr className={MUTED}>
                  <th className="py-1 font-normal">agent</th>
                  <th className="py-1 font-normal">human</th>
                  <th className="py-1 font-normal">requests</th>
                  <th className="py-1 font-normal">spent</th>
                  <th className="py-1 font-normal">connected</th>
                </tr>
              </thead>
              <tbody>
                {connected.map((row) => (
                  <tr key={`${row.agent}-${row.since}`} className="border-t border-[#EBEBEB] text-[#1E1E1E]">
                    <td className="py-1.5">{row.agent}</td>
                    <td className="py-1.5 text-[#2EBD85]">World ID verified</td>
                    <td className="py-1.5 tabular-nums">{row.requests}</td>
                    <td className="py-1.5 tabular-nums">{row.spent}</td>
                    <td className={`py-1.5 tabular-nums ${MUTED}`}>{row.since.slice(0, 16).replace("T", " ")} UTC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
