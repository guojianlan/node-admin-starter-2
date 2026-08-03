import http from "node:http";

const port = Number(process.env.PORT || 8081);
const requests = [];

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function record(kind, request, body) {
  requests.push({
    kind,
    method: request.method,
    url: request.url,
    headers: request.headers,
    body,
    createdAt: new Date().toISOString(),
  });
  if (requests.length > 100) requests.shift();
}

function requireBearer(request, expected) {
  return request.headers.authorization === `Bearer ${expected}`;
}

function writeChatStream(response, model) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const chunks = ["Local ", "acceptance ", "stream OK"];
  for (const [index, content] of chunks.entries()) {
    response.write(
      `data: ${JSON.stringify({
        id: "chatcmpl-admin-base-acceptance",
        object: "chat.completion.chunk",
        created: 0,
        model,
        choices: [
          {
            index: 0,
            delta: index === 0 ? { role: "assistant", content } : { content },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
  }
  response.write(
    `data: ${JSON.stringify({
      id: "chatcmpl-admin-base-acceptance",
      object: "chat.completion.chunk",
      created: 0,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { status: "ok" });
  }

  if (request.method === "POST" && url.pathname === "/__admin/reset") {
    requests.length = 0;
    return json(response, 200, { success: true });
  }

  if (request.method === "GET" && url.pathname === "/__admin/requests") {
    const kind = url.searchParams.get("kind");
    return json(response, 200, {
      requests: kind ? requests.filter((item) => item.kind === kind) : requests,
    });
  }

  if (request.method === "POST" && url.pathname === "/sms/send") {
    const body = await readJson(request);
    record("sms", request, body);
    if (
      !requireBearer(request, "acceptance-sms-secret") ||
      request.headers["x-admin-base-sms-access-key"] !== "acceptance-sms-access"
    ) {
      return json(response, 401, { error: "invalid acceptance SMS credentials" });
    }
    if (!body.to || !body.content) {
      return json(response, 400, { error: "to and content are required" });
    }
    return json(response, 200, { success: true, messageId: "sms-local-acceptance" });
  }

  if (url.pathname.startsWith("/v1/")) {
    if (!requireBearer(request, "acceptance-ai-key")) {
      return json(response, 401, { error: { message: "invalid acceptance AI key" } });
    }
    if (request.method === "GET" && url.pathname === "/v1/models") {
      record("ai-models", request, null);
      return json(response, 200, {
        object: "list",
        data: [
          { id: "mock-chat", object: "model", owned_by: "admin-base" },
          { id: "mock-embedding", object: "model", owned_by: "admin-base" },
        ],
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/embeddings") {
      const body = await readJson(request);
      record("ai-embedding", request, body);
      return json(response, 200, {
        object: "list",
        model: body.model || "mock-embedding",
        data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3, 0.4] }],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = await readJson(request);
      record("ai-chat", request, body);
      if (body.stream) return writeChatStream(response, body.model || "mock-chat");
      return json(response, 200, {
        id: "chatcmpl-admin-base-acceptance",
        object: "chat.completion",
        created: 0,
        model: body.model || "mock-chat",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Local acceptance chat OK" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });
    }
  }

  return json(response, 404, { error: "not found" });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Admin Base external acceptance mock listening on ${port}\n`);
});
