import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { buildRollups, merkleRoot, type Fill } from "./hcs.ts";
import { clampIndex, readRollups, recomputeIndex, shouldPost, stepToward, twap } from "./rollup.ts";
import type { Rollup } from "./types";

const fill = (id: string, model: string, price: bigint, charge: bigint, tokens: bigint): Fill => ({
  id,
  keyId: "00000000-0000-0000-0000-0000000000aa",
  model,
  price,
  charge,
  tokens,
  usage: true,
});

const rollup = (model: string, minute: number, vwapMicro: string): Rollup => ({
  v: 1,
  model,
  minute,
  fills: 1,
  mixed_tokens: "1000000",
  charge_usd_micro: vwapMicro,
  vwap_micro_per_mtok: vwapMicro,
  usage_root: "ab".repeat(32),
});

test("twap is the mean over filled minutes", () => {
  assert.equal(twap([rollup("m", 1, "4000000"), rollup("m", 2, "5000000")]), 4_500_000n);
  assert.equal(twap([]), null);
});

test("index clamps to a tenth..one times the reference, so deep discounts still move it", () => {
  assert.equal(clampIndex(1_000_000n, 4_000_000n), 1_000_000n);
  assert.equal(clampIndex(100_000n, 4_000_000n), 400_000n);
  assert.equal(clampIndex(9_000_000n, 4_000_000n), 4_000_000n);
  assert.equal(clampIndex(3_000_000n, 4_000_000n), 3_000_000n);
});

test("each post stays inside the oracle's 10% move guard", () => {
  const last = 5_000_003n;
  for (const target of [1n, 10_000_000n]) {
    const next = stepToward(target, last);
    const move = next > last ? next - last : last - next;
    assert.ok(move * 10_000n <= last * 1000n);
  }
  assert.equal(stepToward(4_900_000n, 5_000_000n), 4_900_000n);
  assert.equal(stepToward(7n, 0n), 7n);
});

test("posts on a 10 bps move, on the 5 minute heartbeat, or when unseeded", () => {
  assert.equal(shouldPost(5_005_000n, 5_000_000n, 1000n, 1100n), true);
  assert.equal(shouldPost(5_004_999n, 5_000_000n, 1000n, 1100n), false);
  assert.equal(shouldPost(5_000_000n, 5_000_000n, 1000n, 1300n), true);
  assert.equal(shouldPost(1n, 0n, 0n, 0n), true);
});

test("recomputeIndex replays the keeper's math and reports the pending move", () => {
  const window = [rollup("m", 100, "4000000"), rollup("m", 101, "5000000")];
  assert.deepEqual(recomputeIndex({ rollups: [], reference: 4_000_000n, latest: 0n }), {
    state: "no-post",
    twap: null,
    band: [400_000n, 4_000_000n],
  });
  assert.deepEqual(recomputeIndex({ rollups: [], reference: 4_000_000n, latest: 4_000_000n }), {
    state: "no-input",
    latest: 4_000_000n,
  });
  assert.deepEqual(recomputeIndex({ rollups: window, reference: 5_000_000n, latest: 4_500_000n }), {
    state: "sync",
    twap: 4_500_000n,
    band: [500_000n, 5_000_000n],
    next: 4_500_000n,
    latest: 4_500_000n,
  });
  const high = [rollup("m", 100, "6000000"), rollup("m", 101, "8000000")];
  assert.deepEqual(recomputeIndex({ rollups: high, reference: 5_000_000n, latest: 5_000_000n }), {
    state: "sync",
    twap: 7_000_000n,
    band: [500_000n, 5_000_000n],
    next: 5_000_000n,
    latest: 5_000_000n,
  });
  assert.deepEqual(recomputeIndex({ rollups: window, reference: 5_000_000n, latest: 4_000_000n }), {
    state: "pending",
    twap: 4_500_000n,
    band: [500_000n, 5_000_000n],
    next: 4_400_000n,
    latest: 4_000_000n,
    diffBps: 1_000n,
  });
});

test("a minute's vwap weighs prices by tokens, so rounded-up charges on tiny requests do not inflate it", () => {
  const [tiny] = buildRollups(29_000_000, [fill("00000000-0000-0000-0000-000000000009", "deepseek-v4.1-flash", 50_000n, 2n, 31n)]);
  assert.deepEqual([tiny?.charge_usd_micro, tiny?.mixed_tokens, tiny?.vwap_micro_per_mtok], ["2", "31", "50000"]);
});

test("buildRollups groups by model and commits to the rows", () => {
  const fills = [
    fill("00000000-0000-0000-0000-000000000001", "glm-5.3", 4_000_000n, 1_000_000n, 250_000n),
    fill("00000000-0000-0000-0000-000000000002", "glm-5.3", 4_000_000n, 1_000_000n, 250_000n),
    fill("00000000-0000-0000-0000-000000000003", "deepseek-v4.1-flash", 300_000n, 300_000n, 1_000_000n),
  ];
  const [glm, deepseek] = buildRollups(29_000_000, fills);
  assert.deepEqual(
    { ...glm, usage_root: undefined },
    {
      v: 1,
      model: "glm-5.3",
      minute: 29_000_000,
      fills: 2,
      mixed_tokens: "500000",
      charge_usd_micro: "2000000",
      vwap_micro_per_mtok: "4000000",
      usage_root: undefined,
    },
  );
  assert.equal(deepseek?.vwap_micro_per_mtok, "300000");
  const leaf = (f: Fill) => createHash("sha256").update(`${f.id}|${f.keyId}|${f.charge}|${f.tokens}`).digest();
  const [a, b] = fills.map(leaf);
  assert.ok(a && b);
  assert.equal(glm?.usage_root, createHash("sha256").update(Buffer.concat([a, b])).digest("hex"));
  assert.equal(merkleRoot(fills.slice(2)), leaf(fills[2] as Fill).toString("hex"));
  assert.ok(Buffer.byteLength(JSON.stringify(glm)) < 1024);
});

test("readRollups pages the mirror, keeps only the treasury's valid rollups, first per minute", async () => {
  const encode = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64");
  const msg = (seq: number, payer: string, body: unknown) => ({
    consensus_timestamp: `${seq}.0`,
    message: encode(body),
    sequence_number: seq,
    payer_account_id: payer,
  });
  const pages: Record<string, unknown> = {
    first: {
      messages: [
        msg(1, "0.0.1", rollup("glm-5.3", 100, "4000000")),
        msg(2, "0.0.666", rollup("glm-5.3", 101, "1")),
        msg(3, "0.0.1", "not json"),
      ],
      links: { next: "/api/v1/topics/0.0.9/messages?page=2" },
    },
    second: {
      messages: [
        msg(4, "0.0.1", rollup("glm-5.3", 100, "9999999")),
        msg(5, "0.0.1", rollup("glm-5.3", 99, "4000000")),
        msg(6, "0.0.1", rollup("glm-5.3", 102, "5000000")),
      ],
      links: { next: null },
    },
  };
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(request.url?.includes("page=2") ? pages.second : pages.first));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const result = await readRollups({ mirrorUrl: `http://127.0.0.1:${port}`, topicId: "0.0.9", payer: "0.0.1", sinceMinute: 100 });
    assert.deepEqual(
      result.map((r) => [r.seq, r.rollup.minute, r.rollup.vwap_micro_per_mtok]),
      [
        [1, 100, "4000000"],
        [6, 102, "5000000"],
      ],
    );
  } finally {
    server.close();
  }
});
