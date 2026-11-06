import type { Metadata } from "next";
import { headers } from "next/headers";
import { listComfy } from "../../../lib/comfy.ts";
import { formatUsd } from "../../../lib/price.ts";
import { Agents, type ConnectedAgent } from "./terminal";

export const metadata: Metadata = {
  title: "Agents — LLM Token Exchange",
};
export const dynamic = "force-dynamic";

async function baseUrl(): Promise<string> {
  const configured = process.env.PUBLIC_HOST;
  if (configured) return (/^https?:\/\//.test(configured) ? configured : `https://${configured}`).replace(/\/+$/, "");
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const proto = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function connected(): Promise<ConnectedAgent[] | null> {
  try {
    return (await listComfy()).map((row) => ({
      agent: row.agent,
      since: row.since.toISOString(),
      requests: row.requests,
      spent: formatUsd(row.spentUsdMicro),
    }));
  } catch (error) {
    console.error("comfy agents list failed", error);
    return null;
  }
}

export default async function AgentsPage() {
  return (
    <Agents
      base={await baseUrl()}
      network={process.env.HEDERA_NETWORK ?? "hedera:testnet"}
      connected={await connected()}
    />
  );
}
