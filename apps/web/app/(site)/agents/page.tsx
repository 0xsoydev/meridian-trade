import type { Metadata } from "next";
import { headers } from "next/headers";
import { Agents } from "./terminal";

export const metadata: Metadata = {
  title: "Agents — LLM Token Exchange",
};

async function baseUrl(): Promise<string> {
  const configured = process.env.PUBLIC_HOST;
  if (configured) return (/^https?:\/\//.test(configured) ? configured : `https://${configured}`).replace(/\/+$/, "");
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const proto = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function AgentsPage() {
  return <Agents base={await baseUrl()} network={process.env.HEDERA_NETWORK ?? "hedera:testnet"} />;
}
