export default function Home() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">LLM Token Exchange</h1>
      <p className="max-w-2xl text-zinc-400">
        Sellers list expiring provider credits as MTokens. Buyers and their agents buy through our router and pay over
        x402 on Hedera. Perps price the venue on 0G Galileo.
      </p>
      <div className="flex gap-3 text-sm">
        <a className="rounded border border-zinc-700 px-3 py-2 hover:border-zinc-500" href="/trade">
          Trade
        </a>
        <a className="rounded border border-zinc-700 px-3 py-2 hover:border-zinc-500" href="/perps">
          Perps
        </a>
      </div>
    </section>
  );
}
