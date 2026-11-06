import { createPublicClient, erc20Abi, http, isAddress } from "viem";
import { hederaTestnet } from "viem/chains";
import { useConnection, useSwitchChain, useWriteContract } from "wagmi";
import { z } from "zod";
import { formatUsd, TOPUP_MAX_MICRO } from "../../lib/price.ts";
import type { Balance, DepositResult } from "../../lib/types";

const hedera = createPublicClient({ chain: hederaTestnet, transport: http() });
const creditedSchema = z.object({ tx_id: z.string(), amount_usd_micro: z.string(), balance_usd_micro: z.string() });
const failureSchema = z.object({ error: z.object({ message: z.string() }) });

export function useWalletDeposit() {
  const { address, chainId } = useConnection();
  const { mutateAsync: switchChain } = useSwitchChain();
  const { mutateAsync: writeContract } = useWriteContract();

  return async (key: string, amountMicro: bigint, balance: Balance | null): Promise<DepositResult> => {
    if (!balance?.wallet) throw new Error("this key has no wallet; deposit with the key id as the memo");
    if (!address || address.toLowerCase() !== balance.wallet) {
      throw new Error(`connect ${balance.wallet}, the wallet that created this key`);
    }
    if (amountMicro <= 0n || amountMicro > TOPUP_MAX_MICRO) {
      throw new Error(`one wallet deposit carries at most ${formatUsd(TOPUP_MAX_MICRO)}`);
    }
    const { usdc_evm: usdc, treasury_evm: treasury } = balance;
    if (!usdc || !treasury || !isAddress(usdc) || !isAddress(treasury)) {
      throw new Error("wallet deposits are unavailable right now; reload and retry");
    }
    const held = await hedera.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] });
    if (held < amountMicro) {
      throw new Error(`your wallet holds ${formatUsd(held)} USDC on Hedera testnet; this needs ${formatUsd(amountMicro)}`);
    }
    if (chainId !== hederaTestnet.id) await switchChain({ chainId: hederaTestnet.id });
    const hash = await writeContract({
      chainId: hederaTestnet.id,
      address: usdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [treasury, amountMicro],
    });

    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const res = await fetch("/api/v1/keys/deposit", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ tx_id: hash }),
      }).catch(() => null);
      if (!res || res.status >= 500) continue;
      const body: unknown = await res.json().catch(() => null);
      const credited = creditedSchema.safeParse(body);
      if (res.ok && credited.success) return credited.data;
      const message = failureSchema.safeParse(body).data?.error.message ?? `deposit failed (${res.status})`;
      if (!message.includes("not on the mirror yet")) throw new Error(`${message} (transaction ${hash})`);
    }
    throw new Error(`the mirror has not shown ${hash} yet; paste that hash under Transfer on Keys in a minute`);
  };
}
