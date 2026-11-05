import type { Metadata } from "next";
import { Sell } from "./terminal";

export const metadata: Metadata = {
  title: "Sell — LLM Token Exchange",
};

export default function SellPage() {
  return <Sell privyReady={Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)} />;
}
