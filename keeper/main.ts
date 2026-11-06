import { createServer } from "node:http";
import { dailyClose, liquidateUnderwater, matchRestingBids, postIndexes, publishRollups, sweepStale } from "./jobs.ts";

const REQUIRED = [
  "DATABASE_URL",
  "KEEPER_PRIVATE_KEY",
  "HEDERA_TREASURY_ID",
  "HEDERA_TREASURY_KEY",
  "HCS_TOPIC_ID",
  "NEXT_PUBLIC_PERP_MARKET",
  "NEXT_PUBLIC_INDEX_ORACLE",
  "NEXT_PUBLIC_MOCK_USDC",
  "PERP_DEPLOY_BLOCK",
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`keeper: missing env ${missing.join(", ")}`);
  process.exit(1);
}

if (process.env.PORT) createServer((_, res) => res.end("ok")).listen(Number(process.env.PORT));

function every(name: string, ms: number, job: () => Promise<unknown>): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    job()
      .catch((error: unknown) => console.error(`[${name}]`, error instanceof Error ? error.message : error))
      .finally(() => {
        running = false;
      });
  };
  run();
  setInterval(run, ms);
  return run;
}

const postNow = every("index", 180_000, postIndexes);
every("rollup", 60_000, async () => {
  if (await publishRollups()) setTimeout(postNow, 10_000);
});
every("sweep", 60_000, sweepStale);
every("match", 60_000, matchRestingBids);
every("liquidate", 30_000, liquidateUnderwater);
every("payouts", 60_000, dailyClose);
console.log(`keeper running, index window ${process.env.INDEX_WINDOW_MIN ?? "60"} min`);
