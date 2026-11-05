import { createServer, type ServerResponse } from "node:http";

const port = Number(process.env.STUB_PORT ?? "4010");
const pricing = { prompt: "0.0000014", completion: "0.0000044" };
const models = [
  "glm-5.3",
  "deepseek-v4.1-flash",
  "claude-opus-5.5",
  "gpt-6-sol",
  "z-ai/glm-5.3",
  "deepseek/deepseek-v4.1-flash",
  "anthropic/claude-opus-5.5",
  "openai/gpt-6-sol",
];
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

function wantsStream(raw: string): boolean {
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  return typeof parsed === "object" && parsed !== null && "stream" in parsed && parsed.stream === true;
}

async function stream(response: ServerResponse, id: string, slow: boolean): Promise<void> {
  response.writeHead(200, { "content-type": "text/event-stream" });
  const words = slow ? ["one ", "two ", "three ", "four ", "five ", "six "] : ["po", "ng"];
  for (const word of words) {
    if (response.destroyed) return;
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: word } }] })}\n\n`);
    if (slow) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (response.destroyed) return;
  response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", choices: [], usage })}\n\n`);
  response.end("data: [DONE]\n\n");
}

const server = createServer((request, response) => {
  if (request.url?.endsWith("/models")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: models.map((id) => ({ id, pricing_usd: pricing, pricing })) }));
    return;
  }
  if (request.url?.endsWith("/chat/completions")) {
    const expected = process.env.STUB_EXPECT_AUTH;
    const authorization = request.headers.authorization ?? "";
    if (expected && authorization !== expected) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "wrong bearer" } }));
      return;
    }
    if (authorization.endsWith("-policy")) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "content policy refused", type: "invalid_request_error", code: "content_policy_refused" } }));
      return;
    }
    if (authorization.endsWith("-upgrade")) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "this plan has no API access", type: "permission_error", code: "upgrade_required" } }));
      return;
    }
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      const seen: unknown = raw ? JSON.parse(raw) : null;
      const fields = typeof seen === "object" && seen !== null ? (seen as Record<string, unknown>) : {};
      const id =
        process.env.STUB_ECHO === "1"
          ? `seen:${String(fields.model)}:mt=${String(fields.max_tokens ?? "-")}:mct=${String(fields.max_completion_tokens ?? "-")}`
          : `chatcmpl-stub-${Date.now()}`;
      if (wantsStream(raw)) {
        void stream(response, id, request.headers.authorization === "Bearer sk-slow");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id,
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
          usage,
        }),
      );
    });
    return;
  }
  response.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`stub rail on http://127.0.0.1:${port}`);
});
