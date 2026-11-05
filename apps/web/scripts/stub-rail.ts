import { createServer } from "node:http";

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

const server = createServer((request, response) => {
  if (request.url?.endsWith("/models")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        object: "list",
        data: models.map((id) => ({ id, pricing_usd: pricing, pricing })),
      }),
    );
    return;
  }
  if (request.url?.endsWith("/chat/completions")) {
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      const parsed = raw ? (JSON.parse(raw) as { model?: string }) : {};
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: `chatcmpl-stub-${Date.now()}`,
          object: "chat.completion",
          model: parsed.model,
          choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
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
