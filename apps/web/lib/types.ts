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

export type Rail = {
  id: RailId;
  protocol: RailProtocol;
  baseUrl: string;
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

export type TradeResult = { fills: Trade[]; prepaid_tokens: string };

export type BookAsk = {
  listing_id: string;
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

export type Book = { model: string; asks: BookAsk[]; fills: BookFill[] };

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
