export type RailId =
  | "0g"
  | "stub"
  | "anthropic"
  | "openai"
  | "openrouter"
  | "commandcode"
  | "zen"
  | "opencode-go"
  | "claude-code"
  | "codex";

export type RailProtocol = "openai-chat" | "anthropic-messages" | "openai-responses";

export type Verifiability = "TeeML" | "TeeTLS" | null;

export type RailModel = {
  canonical: string;
  upstream: string;
  listPrompt: bigint;
  listCompletion: bigint;
  verifiability: Verifiability;
};

export type RailCheck = "probe" | "key" | "models" | "chat";

export type Rail = {
  id: RailId;
  protocol: RailProtocol;
  baseUrl: string;
  modelsUrl: string;
  check: RailCheck;
  auth: "key" | "oauth";
  extraHeaders: Record<string, string>;
  models: ReadonlyArray<RailModel>;
  resetPeriod: "daily" | "monthly" | null;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  enabled: boolean;
};

export type Micro = bigint;
export type MicroPerMTok = bigint;
export type Pricing = { prompt: MicroPerMTok; completion: MicroPerMTok };

export type RouterErrorCode =
  | "invalid_api_key"
  | "model_not_found"
  | "no_liquidity"
  | "insufficient_balance"
  | "approval_required"
  | "upstream_failed"
  | "invalid_request";

export type ApprovalStart = {
  approval_id: string;
  user_code: string;
  verification_uri_complete: string;
  expires_at: string;
};

export type RouterError = {
  error: {
    message: string;
    type:
      | "invalid_request_error"
      | "authentication_error"
      | "payment_error"
      | "permission_error"
      | "server_error";
    code: RouterErrorCode;
  };
  approval?: ApprovalStart;
};

export type ModelRow = {
  id: string;
  object: "model";
  rails: RailId[];
  verifiability: Verifiability;
  list_prompt_micro_per_mtok: string;
  list_completion_micro_per_mtok: string;
  reference_blended_micro_per_mtok: string;
  list_ceiling_micro_per_mtok: string;
  best_ask_micro_per_mtok: string | null;
  index_micro_per_mtok: string | null;
  available_tokens: string;
};

export type TopupResult = {
  key?: string;
  key_id: string;
  balance_usd_micro: string;
  tx_id: string;
};

export type CreateKeyResult = { key: string; key_id: string };

export type KeySummary = { key_id: string; balance_usd_micro: string; created_at: string };

export type DepositResult = {
  tx_id: string;
  amount_usd_micro: string;
  balance_usd_micro: string;
};

export type Balance = {
  memo: string;
  treasury: string | null;
  treasury_evm: string | null;
  usdc_evm: string | null;
  wallet: string | null;
  balance_usd_micro: string;
  reserved_usd_micro: string;
  topped_up_today_usd_micro: string;
  daily_topup_cap_usd_micro: string;
  auto_topup_usd_micro: string;
  default_model: string | null;
  human_linked: boolean;
};

export type KeySettings = {
  auto_topup_usd_micro?: string;
  daily_topup_cap_usd_micro?: string;
  default_model?: string | null;
};

export type ApprovalStatus = { status: "pending" | "approved" | "denied" | "expired" };

export type ListingIntent = {
  action: "list";
  rail: RailId;
  model: string;
  capacity_mtok: string;
  price_micro_per_mtok: string | null;
  client_nonce: string;
};

export type Credential = { kind: "key"; key: string } | { kind: "oauth" };

export type TradeIntent = { model: string; tokens: string };

export type Trade = {
  listing_id: string;
  tokens: string;
  price_micro_per_mtok: string;
  charge_usd_micro: string;
};

export type Bid = {
  bid_id: string;
  model: string;
  tokens: string;
  price_micro_per_mtok: string;
  hold_usd_micro: string;
  created_at: string;
};

export type TradeResult = { fills: Trade[]; bid: Bid | null; prepaid_tokens: string };

export type PerpFill = {
  tx_hash: string;
  at: string;
  model: string;
  kind: "modify" | "liquidate";
  size_change: string;
  size_after: string;
  price_micro_per_mtok: string;
  realized_pnl_usd_micro: string;
  fee_usd_micro: string;
  reward_usd_micro: string;
};

export type Offer = {
  offer_id: string;
  model: string;
  listing_id: string;
  tokens: string;
  price_micro_per_mtok: string;
  expires_at: string | null;
  created_at: string;
};

export type SellResult = { fills: Trade[]; offers: Offer[]; holding_tokens: string };

export type Holding = {
  prepaid_id: string;
  model: string;
  listing_id: string;
  rail: string;
  tokens: string;
  expires_at: string | null;
};

export type VenueStatus = {
  keeper_last_post_s: number | null;
  markets: { model: string; index_micro_per_mtok: string | null; age_s: number | null; open: boolean }[];
  payouts: { pending: number; scheduled: number; last_executed_day: string | null };
  venue: { fills_24h: number; volume_24h_tokens: string; open_asks: number };
};

export type KeyUsage = {
  at: string;
  model: string;
  rail: string;
  status: string;
  prompt_tokens: number;
  completion_tokens: number;
  mixed_tokens: string;
  charge_usd_micro: string;
  paid_from: "prepaid" | "balance";
  upstream_request_id: string | null;
};

export type KeyFill = {
  at: string;
  model: string;
  side: "buy" | "sell";
  tokens: string;
  price_micro_per_mtok: string;
  amount_usd_micro: string;
};

export type BookAsk = {
  listing_id: string;
  offer_id: string | null;
  kind: "listing" | "resale";
  rail: RailId;
  price_micro_per_mtok: string;
  tokens_left: string;
  verifiable: boolean;
};

export type BookFill = {
  listing_id: string;
  tokens: string;
  price_micro_per_mtok: string;
  created_at: string;
};

export type BookBid = { price_micro_per_mtok: string; tokens: string };

export type Book = { model: string; asks: BookAsk[]; bids: BookBid[]; fills: BookFill[] };

export type SellerListing = {
  listing_id: string;
  rail: string;
  model: string;
  price_micro_per_mtok: string | null;
  capacity_tokens: string;
  used_tokens: string;
  reserved_tokens: string;
  status: string;
};

export type SellerListings = { verified: boolean; listings: SellerListing[] };

export type SellerPayouts = {
  network: string;
  unpaid_usd_micro: string;
  data: { day: string; amount_usd_micro: string; schedule_id: string | null; execute_at: string | null; status: string }[];
};

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

export type ReceiptsConfig =
  | { ok: true; mirrorUrl: string; topicId: string; payer: string; network: "testnet" | "mainnet" }
  | { ok: false; reason: string };

export type TopupReceipt = {
  txId: string;
  amountUsdMicro: string;
  payer: string;
  keyId: string;
  createdAt: string;
};

export type IndexPostReceipt = {
  model: string;
  priceMicroPerMtok: string;
  hcsSeqFrom: string;
  hcsSeqTo: string;
  txHash: string;
  blockNumber: string;
  loggedAt: string | null;
};

export type MarketIndex = { model: string; priceMicroPerMtok: string };
