# Handoff — Person A: Chain and Keeper

**Event:** ETHGlobal Mumbai, 5–7 Nov 2026. **Deadline:** Sat 7 Nov, 09:00 IST.
**Your name:** ______________
**Read first:** the plan at `llm-token-exchange.md`, §11 (contracts), §12 (keeper), §10.5 (daily close), §10.7 (index pipeline).
**You own:** `contracts/**`, `keeper/**`, `apps/web/lib/chain.ts`, `apps/web/lib/perp.ts`.

---

## 1. Your mission

Every number that comes from a chain is yours. You write the two contracts, deploy them to 0G Galileo, and keep the process alive that publishes the price index, liquidates positions and pays sellers. If your part is late, the perps pages have nothing to show and the demo has no second act.

You do not touch the web app's API routes or pages. You publish helpers that the frontend calls.

---

## 2. First 30 minutes

1. Read the plan sections above. Do not read the whole plan.
2. Confirm with Person B the exact columns of `usage`, `trades` and `listings` that the keeper will query. The schema is frozen at T+2; after that, changing it is a meeting, not a commit.
3. Confirm with Person D that the HCS topic exists and you have `HEDERA_TREASURY_ID` and `HEDERA_TREASURY_KEY`.
4. Check the Galileo wallet has gas. You need roughly 0.25 0G for 36 hours of index posts. Faucets give about 0.1 0G per address per day, so stock up before kickoff.
5. Create your branch: `git switch -c feat/contracts`.

---

## 3. What you deliver, and when

| Hour | Deliverable | Why it matters |
|---|---|---|
| T+2 | Market parameters and ABI shape agreed with B; `foundry.toml` set to solc 0.8.30, `evm_version = "cancun"` | Galileo supports Cancun; the transient reentrancy guard needs it |
| T+8 | `PerpMarket`, `IndexOracle`, `MockUSDC` compile; forge tests green | Unblocks deploy |
| T+12 | Deployed to Galileo, addresses in `.env.example`, ABIs exported to `contracts/abi/` | Unblocks C and D |
| T+16 | `apps/web/lib/perp.ts`: reads and writes the frontend needs | **C is blocked without this** |
| T+20 | Keeper posts the index every 5 minutes and liquidates underwater positions | Unblocks the `/perps` demo |
| T+24 | Daily close: payouts scheduled on Hedera, listings reset | M7 |
| T+26 | Freeze. Only bug fixes | Demo rehearsal starts |

If you are behind at T+20, the cut order is: liquidation loop becomes a button in the UI, then payouts become a script you run by hand. Never cut the index posting — the perps market is meaningless without it.

---

## 4. Contracts

### 4.1 `IndexOracle`

```solidity
interface IIndexOracle {
    event IndexPosted(bytes32 indexed market, uint256 priceMicroPerMTok, uint64 hcsSeqFrom, uint64 hcsSeqTo);
    error PriceMoveTooLarge();
    error NotKeeper();
    function post(bytes32 market, uint256 priceMicroPerMTok, uint64 hcsSeqFrom, uint64 hcsSeqTo) external;
    function latest(bytes32 market) external view returns (uint256 priceMicroPerMTok, uint64 updatedAt);
    function setKeeper(address keeper) external;
}
```

- Owner sets the keeper. Only the keeper posts.
- A post may move at most `MAX_MOVE_BPS = 1000` (10%) from the last price for that market. The **first** post for a market is exempt, otherwise the oracle could never be seeded.
- No price older than 600 seconds may be used to trade; that check lives in `PerpMarket`.

### 4.2 `PerpMarket`

```solidity
interface IPerpMarket {
    struct Market {
        uint256 maxLeverage;
        uint256 maxOiTokens;
        int256 fundingK;
        uint256 longOi;
        uint256 shortOi;
        int256 cumFunding;
        uint64 lastAccrual;
        bool listed;
    }
    struct Position {
        int256 size;
        uint256 margin;
        uint256 entryPrice;
        int256 entryCumFunding;
    }
    event MarketListed(bytes32 indexed market, uint256 maxLeverage, uint256 maxOiTokens, int256 fundingK);
    event PositionModified(address indexed account, bytes32 indexed market, int256 size, uint256 margin, uint256 price, int256 realizedPnl, uint256 fee);
    event Liquidated(address indexed account, bytes32 indexed market, address indexed liquidator, uint256 reward);
    event VaultFunded(uint256 amount);

    error MarketUnknown();
    error StalePrice();
    error FlipNotAllowed();
    error OiCapExceeded();
    error InsufficientMargin();
    error NotLiquidatable();
    error VaultInsufficient();

    function listMarket(bytes32 market, uint256 maxLeverage, uint256 maxOiTokens, int256 fundingK) external;
    function fundVault(uint256 amount) external;
    function modify(bytes32 market, int256 sizeDelta, int256 marginDelta) external;
    function liquidate(address account, bytes32 market) external;
    function positions(address account, bytes32 market) external view returns (Position memory);
    function equity(address account, bytes32 market) external view returns (int256);
    function canLiquidate(address account, bytes32 market) external view returns (bool);
}
```

Base: OpenZeppelin 5.6.1 `Ownable`, `ReentrancyGuardTransient`, `SafeERC20`. `market = keccak256(bytes(modelId))`.

**Units.** Price is USDC micro per MTok. Size is tokens as `int256`, so 1 MTok = `1e6`. `cumFunding` is USDC micro per MTok scaled by `1e18`.

**Formulas.**

| Quantity | Formula |
|---|---|
| notional | `abs(size) * price / 1e6` |
| pnl | `size * (price - entryPrice) / 1e6` |
| funding rate per second | `clamp(fundingK * (longOi - shortOi) / max(longOi + shortOi, 1e6), -fundingK, fundingK)` |
| accrual | `cumFunding += rate * (now - lastAccrual) * price` on every `modify` and `liquidate` |
| funding owed | `size * (cumFunding - entryCumFunding) / (1e18 * 1e6)`, positive means the trader pays |
| equity | `margin + pnl - fundingOwed` |
| fee | `ceil(abs(sizeDelta) * price / 1e6 * FEE_BPS / 10_000)`, paid to the treasury |
| initial margin | after a modify with `size != 0`: `equity * maxLeverage >= notional` |
| maintenance | liquidatable when `equity * 10_000 < notional * MM_BPS` |
| liquidation reward | `min(max(equity, 0), notional * LIQ_BPS / 10_000)` to the liquidator, rest of equity to the vault |

**`modify` rules, in order:** accrue funding; read the oracle and revert on staleness; increase or open settles funding into margin and updates the weighted-average entry price; reduce realises pnl on the reduced part and leaves the entry unchanged; crossing zero reverts; closing to zero pays `max(equity, 0)` and deletes the position; a positive `marginDelta` pulls USDC, a negative one sends it, then the initial-margin check runs; per-side OI must stay within `maxOiTokens`; trader gains come out of the vault and revert with `VaultInsufficient` if the vault is short; losses and funding paid go into the vault.

**Parameters.** `MAX_LEVERAGE = 5`, `MM_BPS = 500`, `FEE_BPS = 10`, `LIQ_BPS = 50`, `fundingK` set so full skew is about 0.1% per hour, oracle `MAX_MOVE_BPS = 1000`, staleness 600 s.

**`MockUSDC`.** ERC-20, 6 decimals, public `mint(to, amount)` capped at 1,000e6 per call, so judges can fund themselves.

### 4.3 Tests you must have before deploying

`contracts/test/PerpMarket.t.sol` covers: long and short pnl; fee to treasury; funding sign and magnitude after `vm.warp`; initial-margin rejection; liquidation boundary and reward; stale oracle revert; flip revert; OI cap; vault insufficient; oracle move guard; first post accepted; an underwater close pays the trader zero.

### 4.4 Deploy

`script/Deploy.s.sol` deploys `MockUSDC`, `IndexOracle(keeper)`, `PerpMarket(usdc, oracle, treasury)`, lists `glm-5.3`, `deepseek-v4-flash` and `0gm-1.0-35b-a3b`, and funds the vault with 50,000 USDC.

Reference costs from preflight: deploy 128,214 gas (0.000513 0G), price post 43,696 gas (0.000175 0G).

---

## 5. The keeper

One Node 22 process, started with `node --env-file=.env keeper/main.ts`. `setInterval` loops, each catching its own errors and never overlapping itself. It holds `KEEPER_PRIVATE_KEY` (Galileo) and `HEDERA_TREASURY_ID/KEY`.

| Every | Job |
|---|---|
| 60 s | Roll up the previous minute per model to HCS, then wake the index post if that minute had fills |
| 60 s | `releaseStale()` from `apps/web/lib/ledger.ts`: releases `open` usage rows older than 6 minutes — they exist only when a serverless function died mid-request |
| 180 s or woken | Read the trailing `INDEX_WINDOW_MIN` rollups back from the mirror node, compute the TWAP, clamp, post |
| 30 s | Scan accounts from `PositionModified` logs and liquidate anything below maintenance |
| 00:00 UTC | Insert payouts and schedule the USDC transfers |
| 01:05 UTC | Check that each scheduled transfer executed |

**Rollup input** is `trades` rows plus `usage` rows whose `charge_usd_micro > 0`. Usage rows at charge zero are prepaid consumption: already paid at fill time, and including them would drag the VWAP toward zero.

**HCS message**, under 1024 bytes:

```ts
export type Rollup = {
  v: 1;
  model: string;
  minute: number;
  fills: number;
  mixed_tokens: string;
  charge_usd_micro: string;
  vwap_micro_per_mtok: string;
  usage_root: string;
};
```

`vwap = charge * 1e6 / mixed_tokens`. `usage_root` is a SHA-256 Merkle root over `sha256(id|key_id|charge|mixed_tokens)` of that minute's rows. Inclusion proofs are not served; do not claim they are.

**Index.** `twap` is the mean `vwap` over minutes that had fills. With no fills, use the effective best ask, else `marketPrice(null, reference, rail)`; if that is `null`, the market has no bid and there is nothing to post. Clamp to `[blended(reference)/2, blended(reference)]`. Post when the move is at least 10 bps or 5 minutes have passed, and clamp each post to 10% from the last on-chain value so a large move converges instead of reverting forever. `INDEX_WINDOW_MIN` is 60 in production and 10 for the demo.

**Payouts.** Sellers are paid from `usage.seller_earning` plus `trades.seller_earning`. One statement inserts the payout for `(seller_id, day)` with `on conflict do nothing` and sets `payout_id` on exactly the rows it sums. Then, for every `pending` payout including any left by a crash:

1. If the seller has no `hedera_account`, look the address up on the mirror; if absent, send 1 micro-USDC from the treasury to `AccountId.fromEvmAddress(0, 0, address)`. HIP-542 creates the account with USDC already associated and the treasury pays creation. Store the `0.0.N` id.
2. Wrap a USDC `TransferTransaction` in `ScheduleCreateTransaction` to that numeric id, with `setExpirationTime(payout.day + 1 day, 01:00 UTC)`, `setWaitForExpiry(true)`, `setAdminKey(treasury)`, and `setScheduleMemo(payout.id)`.

Every schedule input derives from the payout row, so a retry before 01:00 gets `IDENTICAL_SCHEDULE_ALREADY_CREATED` with the existing schedule id, and a retry after 01:00 fails and leaves the payout pending for an operator. That failure is the safe outcome; never let it create a second schedule.

**Listing reset.** Only rails with `resetPeriod = 'daily'`: `used_tokens = 0, status = 'active'` where the status is `active` or `exhausted`.

---

## 6. `lib/perp.ts` — the interface C needs at T+16

```ts
export function marketId(model: string): `0x${string}`;
export function readMarket(model: string): Promise<{ price: bigint; updatedAt: bigint; longOi: bigint; shortOi: bigint; fundingRatePerHour: bigint }>;
export function readPosition(model: string, account: `0x${string}`): Promise<{ size: bigint; margin: bigint; entryPrice: bigint; equity: bigint; liquidationPrice: bigint }>;
export function modify(model: string, sizeDelta: bigint, marginDelta: bigint): Promise<`0x${string}`>;
export function liquidate(account: `0x${string}`, model: string): Promise<`0x${string}`>;
```

The frontend also needs a liquidation-price function it can call while the user drags a slider. Compute it with the same formulas as the contract, in TypeScript, and unit-test it against a forge test with the same inputs. If the two disagree, the UI lies to the user.

---

## 7. Gotchas

- Galileo is chain **16602**; `evm_version = "cancun"` is required.
- Scheduled transfers must pay the **numeric** account id. Resolving an EVM alias inside a scheduled transaction is unverified.
- A new Hedera account needs about 2 seconds on the mirror node before facilitators will accept its payments.
- Oracle posts are the only recurring gas cost: roughly 0.13–0.25 0G per day for three markets. Stock the wallet before the event.
- If the keeper misses two ticks, the oracle goes stale and every trade reverts. That is the intended guard, but it looks like a bug on stage — keep the keeper in the foreground where you can see it.
- Do not add a funding job. Funding accrues on-chain whenever the market is touched.

---

## 8. Definition of done

- A forge test opens a position, warps time, and shows funding accrued in the right direction.
- A liquidation runs from the keeper on Galileo, and the transaction is on chainscan.
- The on-chain index matches a value recomputed by hand from HCS messages.
- A scheduled payout executes at 01:00 UTC and the seller's account receives USDC.
- `lib/perp.ts` is imported by `/perps` and the numbers match the contract.

## 9. Do not touch

`apps/web/app/**`, `apps/web/lib/x402.ts`, `apps/web/lib/schema.ts` (ask B), `agents/**`, `scripts/**`.

## 10. Your part in the demo

At 1:45 you are the person watching the keeper log while the presenter opens a long on `/perps`. At 2:35 the `/receipts` recompute should match the value your keeper posted. Have the keeper terminal visible but not projected.
