import type { Metadata } from "next";
import { Sell } from "./terminal";

export const metadata: Metadata = {
  title: "Sell — LLM Token Exchange",
};

export default function SellPage() {
  return <Sell />;
}
