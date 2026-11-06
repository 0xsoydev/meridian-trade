import type { ApprovalStart, RouterError, RouterErrorCode } from "./types";

const TYPES: Record<RouterErrorCode, RouterError["error"]["type"]> = {
  invalid_api_key: "authentication_error",
  insufficient_balance: "payment_error",
  approval_required: "permission_error",
  model_not_found: "invalid_request_error",
  no_liquidity: "invalid_request_error",
  invalid_request: "invalid_request_error",
  upstream_failed: "server_error",
};

export function fail(
  status: number,
  code: RouterErrorCode,
  message: string,
  headers: HeadersInit = {},
  approval?: ApprovalStart,
): Response {
  const body: RouterError = { error: { message, type: TYPES[code], code } };
  if (approval) body.approval = approval;
  return Response.json(body, { status, headers });
}
