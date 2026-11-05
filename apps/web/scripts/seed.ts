import { createHmac } from "node:crypto";
import { Client, PrivateKey, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { eq, inArray } from "drizzle-orm";
import { isAddress, keccak256, toBytes } from "viem";
import { indexOracleAbi, mockUsdcAbi, perpMarketAbi } from "../lib/abi.ts";
import { hashKey } from "../lib/auth.ts";
import { addresses, keeperWallet, publicClient } from "../lib/chain.ts";
import { db } from "../lib/db.ts";
import { blended } from "../lib/price.ts";
import { reference } from "../lib/rails.ts";
import { keys, listings, sellers } from "../lib/schema.ts";
import { seal } from "../lib/secrets.ts";

const MODEL = "0gm-1.0-35b-a3b";
const SELLER = "0x3b036a01d0785be98a260e939df4f1779daf04fa" as const;
const CHEAP_NONCE = "seed-0gm-cheap";
const LARGE_NONCE = "seed-0gm-large";
const CHEAP_TOKENS = 120_000n;
const LARGE_TOKENS = 1_000_000n;
const SEED_BALANCE = 5_000_000n;
const SEED_CAP = 5_000_000n;
const SEED_NULLIFIER = BigInt(keccak256(SELLER)).toString();
const FALLBACK_PRICING = { prompt: 80_000n, completion: 480_000n };
const USDC_TARGET = 100_000_000n;
const VAULT_TARGET = 500_000_000n;
const MINT_CAP = 1_000_000_000n;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function treasuryKey(secret: string): PrivateKey {
  return secret.startsWith("302a") || secret.startsWith("302e")
    ? PrivateKey.fromStringDer(secret)
    : PrivateKey.fromStringECDSA(secret);
}

async function seedDatabase() {
  const secret = required("SECRETS_KEY");
  const credential = required("OG_API_KEY");

  await db()
    .insert(sellers)
    .values({ address: SELLER, worldNullifier: SEED_NULLIFIER })
    .onConflictDoNothing();

  const [seller] = await db().select().from(sellers).where(eq(sellers.address, SELLER)).limit(1);
  if (!seller) throw new Error("could not create the seed seller");

  const rawKey =
    process.env.SEED_ROUTER_KEY ??
    `rk_seed_${createHmac("sha256", Buffer.from(secret, "base64")).update("celestial-trade-seed").digest("base64url")}`;

  const [key] = await db()
    .insert(keys)
    .values({
      hash: hashKey(rawKey),
      balanceUsdMicro: SEED_BALANCE,
      dailyTopupCapUsdMicro: SEED_CAP,
      defaultModel: MODEL,
    })
    .onConflictDoUpdate({
      target: keys.hash,
      set: {
        balanceUsdMicro: SEED_BALANCE,
        reservedUsdMicro: 0n,
        autoTopupUsdMicro: 0n,
        dailyTopupCapUsdMicro: SEED_CAP,
        defaultModel: MODEL,
        worldSub: null,
      },
    })
    .returning({ id: keys.id });
  if (!key) throw new Error("could not create the seed router key");

  let pricing = FALLBACK_PRICING;
  try {
    const live = await reference(MODEL);
    if (live) pricing = live.pricing;
    else console.warn(`no live reference for ${MODEL}; using the known testnet list price`);
  } catch {
    console.warn(`reference lookup failed; using the known testnet list price`);
  }

  const base = blended(pricing);
  const cheapPrice = (base * 85n) / 100n;
  const largePrice = (base * 97n) / 100n;
  const sealed = seal(credential);

  const rows = [
    { nonce: CHEAP_NONCE, price: cheapPrice, capacity: CHEAP_TOKENS },
    { nonce: LARGE_NONCE, price: largePrice, capacity: LARGE_TOKENS },
  ];

  for (const row of rows) {
    await db()
      .insert(listings)
      .values({
        sellerId: seller.id,
        rail: "0g",
        model: MODEL,
        authKind: "key",
        credentialCiphertext: sealed,
        priceMicroPerMtok: row.price,
        capacityTokens: row.capacity,
        status: "active",
        clientNonce: row.nonce,
      })
      .onConflictDoUpdate({
        target: listings.clientNonce,
        set: {
          sellerId: seller.id,
          rail: "0g",
          model: MODEL,
          authKind: "key",
          credentialCiphertext: sealed,
          priceMicroPerMtok: row.price,
          capacityTokens: row.capacity,
          usedTokens: 0n,
          reservedTokens: 0n,
          throttledUntil: null,
          status: "active",
        },
      });
  }

  const seeded = await db()
    .select({ id: listings.id, nonce: listings.clientNonce })
    .from(listings)
    .where(inArray(listings.clientNonce, rows.map((row) => row.nonce)));
  const cheap = seeded.find((row) => row.nonce === CHEAP_NONCE);
  const large = seeded.find((row) => row.nonce === LARGE_NONCE);

  console.log(`seller        ${seller.id}  ${SELLER}`);
  console.log(`model         ${MODEL}`);
  console.log(`cheap ask     ${cheap?.id}  ${cheapPrice} micro/MTok  ${CHEAP_TOKENS} tokens`);
  console.log(`large ask     ${large?.id}  ${largePrice} micro/MTok  ${LARGE_TOKENS} tokens`);
  console.log(`router key    ${rawKey}`);
  console.log(`key id        ${key.id}`);
  console.log(`demo buy      150000 tokens drains the cheap ask and spills into the large one`);
}

async function referencePrice(): Promise<bigint> {
  try {
    const live = await reference(MODEL);
    if (live) return blended(live.pricing);
  } catch {
    console.warn(`index price lookup failed; using the known testnet list price`);
  }
  return blended(FALLBACK_PRICING);
}

async function fundChain(): Promise<void> {
  try {
    const { perpMarket, indexOracle, mockUsdc } = addresses();
    const wallet = keeperWallet();
    const reader = publicClient();
    const keeper = wallet.account.address;

    const market = keccak256(toBytes(MODEL));
    const listed = await reader.readContract({
      address: perpMarket,
      abi: perpMarketAbi,
      functionName: "markets",
      args: [market],
    });
    if (!listed[7]) {
      const hash = await wallet.writeContract({
        address: perpMarket,
        abi: perpMarketAbi,
        functionName: "listMarket",
        args: [market, 5n, 10_000_000_000n, 277_777_777_777n],
      });
      await reader.waitForTransactionReceipt({ hash });
      console.log(`market        listed ${MODEL}`);
    } else {
      console.log(`market        ${MODEL} already listed`);
    }

    const latest = await reader.readContract({
      address: indexOracle,
      abi: indexOracleAbi,
      functionName: "latest",
      args: [market],
    });
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (latest[0] === 0n || now - latest[1] > 600n) {
      const price = latest[0] > 0n ? latest[0] : await referencePrice();
      const hash = await wallet.writeContract({
        address: indexOracle,
        abi: indexOracleAbi,
        functionName: "post",
        args: [market, price, 0n, 0n],
      });
      await reader.waitForTransactionReceipt({ hash });
      console.log(`index         posted ${price} for ${MODEL}`);
    } else {
      console.log(`index         fresh at ${latest[0]} for ${MODEL}`);
    }

    const vault = await reader.readContract({
      address: perpMarket,
      abi: perpMarketAbi,
      functionName: "vault",
    });

    if (vault < VAULT_TARGET) {
      const delta = VAULT_TARGET - vault;
      const balance = await reader.readContract({
        address: mockUsdc,
        abi: mockUsdcAbi,
        functionName: "balanceOf",
        args: [keeper],
      });
      if (balance < delta) {
        const mint = delta - balance;
        if (mint > MINT_CAP) throw new Error("vault delta exceeds the MockUSDC mint cap");
        const hash = await wallet.writeContract({
          address: mockUsdc,
          abi: mockUsdcAbi,
          functionName: "mint",
          args: [keeper, mint],
        });
        await reader.waitForTransactionReceipt({ hash });
      }
      const approveHash = await wallet.writeContract({
        address: mockUsdc,
        abi: mockUsdcAbi,
        functionName: "approve",
        args: [perpMarket, delta],
      });
      await reader.waitForTransactionReceipt({ hash: approveHash });
      const fundHash = await wallet.writeContract({
        address: perpMarket,
        abi: perpMarketAbi,
        functionName: "fundVault",
        args: [delta],
      });
      await reader.waitForTransactionReceipt({ hash: fundHash });
      console.log(`vault         funded ${delta} micro USDC`);
    } else {
      console.log(`vault         already at ${vault} micro USDC`);
    }

    const recipient = process.env.SEED_USDC_RECIPIENT ?? SELLER;
    if (!isAddress(recipient)) throw new Error("SEED_USDC_RECIPIENT is not an address");
    const held = await reader.readContract({
      address: mockUsdc,
      abi: mockUsdcAbi,
      functionName: "balanceOf",
      args: [recipient],
    });
    if (held < USDC_TARGET) {
      const mint = USDC_TARGET - held;
      if (mint > MINT_CAP) throw new Error("judge allocation exceeds the MockUSDC mint cap");
      const hash = await wallet.writeContract({
        address: mockUsdc,
        abi: mockUsdcAbi,
        functionName: "mint",
        args: [recipient, mint],
      });
      await reader.waitForTransactionReceipt({ hash });
      console.log(`mock usdc     minted ${mint} to ${recipient}`);
    } else {
      console.log(`mock usdc     ${recipient} already holds ${held}`);
    }
  } catch (error) {
    console.warn(`chain step skipped: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function markHcs(): Promise<void> {
  const topic = process.env.HCS_TOPIC_ID;
  const account = process.env.HEDERA_TREASURY_ID;
  const secret = process.env.HEDERA_TREASURY_KEY;
  if (!topic || !account || !secret) return;

  try {
    const mirror = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
    const existing = await fetch(`${mirror}/api/v1/topics/${topic}/messages?limit=1`);
    if (existing.ok) {
      const body = (await existing.json()) as { messages?: unknown[] };
      if ((body.messages ?? []).length > 0) {
        console.log(`hcs           topic already has messages`);
        return;
      }
    }

    const client = Client.forTestnet();
    client.setRequestTimeout(30_000);
    client.setOperator(account, treasuryKey(secret));
    try {
      const receipt = await (
        await new TopicMessageSubmitTransaction()
          .setTopicId(topic)
          .setMessage(JSON.stringify({ v: 1, seed: "celestial-trade" }))
          .execute(client)
      ).getReceipt(client);
      console.log(`hcs           marker ${receipt.status.toString()} on ${topic}`);
    } finally {
      client.close();
    }
  } catch (error) {
    console.warn(`hcs step skipped: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function main(): Promise<void> {
  await seedDatabase();
  await fundChain();
  await markHcs();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
