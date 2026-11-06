# Demo video script

Length 2:45 to 2:55, 1080p, recorded with a human voice (ETHGlobal does not accept an AI voiceover). Record against the deployed app with the keeper running for at least 30 minutes, so the index has history.

## Before recording

- The live strip at the top of any app page reads "keeper posted …s ago", and the market you show is open.
- `NEXT_PUBLIC_WORLD_BYPASS=false` in both env copies, and a World App with an orb-verified identity on the phone.
- A seller ask on `deepseek-v4.1-flash` with capacity left. Without one the market reads "no spot price yet".
- The demo agent's Hedera account holds USDC, and its Galileo address holds 0G gas.
- A browser router key on `/keys` with about 1 USD. MetaMask has Hedera testnet (296) and 0G Galileo (16602), with test USDC on Galileo from the faucet button on `/perps`.
- Tabs open: the landing page, `/sell`, a terminal with the agent ready, `/trade?model=deepseek-v4.1-flash`, `/perps?model=deepseek-v4.1-flash`, `/receipts`, HashScan.

## Shots

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00 | Landing | Hold on the hero | Provider credits expire and can't be cashed out. Celestial Trade is a market for that capacity: buy it, resell it, hedge it. |
| 0:20 | `/sell` | Verify with World ID; pick Command Code and `deepseek-v4.1-flash`; price it below list; reuse the stored key; list. Open the Listings tab. | One human, one seller, proven with World ID. The key is checked once, sealed, and never leaves the server. |
| 0:45 | Terminal | `pnpm --filter demo-agent start`; open the printed HashScan link | This agent has no balance. Its first request gets a 402; it pays in USDC on Hedera over x402, and the answer streams. Here's the payment on HashScan. |
| 1:10 | `/trade` | Market-buy 1 MTok. Switch to Sell: list 0.5 MTok above the best bid, then sell 0.2 into a bid. Open Open Orders, then Trade History. | MTokens trade like any asset. Buy at the cheapest ask; resell what you hold into the bids, or list it as an ask. The agent spends what it bought at no further charge. |
| 1:40 | `/perps` | Point at the index and its age. Long 5x, add margin, then short more than the long; the button reads "Close … long, short …". Open Trade History. | The index is the venue's per-minute price from a public log on Hedera, posted on-chain by the keeper. A long locks tomorrow's compute cost, and a short locks in revenue on expiring credits. |
| 2:05 | Terminal, then `/approve/…` | The agent hits its daily cap and prints an approval link. Deny it, and show the agent print the deny path. Then approve with World App and show the cap rise. | Spending past the cap needs a person. The approval is bound to this one request, and denying it really stops the agent. |
| 2:30 | `/receipts`, then the `/sell` Payouts tab | Recompute the index from the log; open an executed payout schedule on HashScan | You don't have to trust us: recompute the index in your browser. Sellers are paid daily by scheduled Hedera transfers. |
| 2:50 | Landing | End card | Celestial Trade: one market for inference. |

## Sponsor beats to say out loud

- **Hedera:**
  - x402 top-ups in USDC;
  - deposits from a wallet on Hedera EVM;
  - the HCS public log behind the index;
  - scheduled payouts.
- **0G:**
  - perps on Galileo against the venue's own index;
  - 0G models priced from 0G's catalog.

  0G inference needs a provider on the testnet router; if none is serving, say so rather than show it.
- **World:**
  - one human per seller;
  - approvals bound to an approval id;
  - the denied path is real.

## If something breaks on the day

- **A market reads "no spot price yet":** list an ask on that model on `/sell` and wait for the keeper's next post, at most 3 minutes.
- **An x402 facilitator is down:** the router benches it and offers from the next one, so just retry.
- **A provider is slow or failing:** the router fails over to the next ask. If every ask fails, show the top-up and approvals, and use a pre-recorded stream.
