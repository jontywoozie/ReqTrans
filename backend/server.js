const fs = require("fs");
const path = require("path");
const http = require("http");

loadEnvFile(path.join(process.cwd(), ".env"));

const PORT = Number(process.env.BACKEND_PORT || 43127);
const VALID_DIRECTIONS = new Set(["product_to_dev", "dev_to_product"]);

const llmConfig = {
  provider: String(process.env.LLM_PROVIDER || "openai_compatible").trim(),
  baseUrl: String(process.env.LLM_BASE_URL || "https://api.openai.com/v1").trim(),
  apiKey: String(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim(),
  model: String(process.env.LLM_MODEL || "gpt-4.1-mini").trim()
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) continue;

    const key = trimmed.slice(0, splitAt).trim();
    const value = trimmed.slice(splitAt + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function writeSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function collectJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 1024 * 1024) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", () => reject(new Error("Failed to read request body")));
  });
}

function buildSystemPrompt(direction) {
  if (direction === "product_to_dev") {
    return [
      "你是资深技术方案架构师，负责把产品语言翻译为工程可执行语言。",
      "输出语言必须与用户输入一致；若输入是中文，输出必须是中文。",
      "禁止空泛表达，必须给出可落地项。",
      "必须严格使用以下结构并按顺序输出：",
      "【技术目标】1-2条",
      "【实现方案】2-4条（算法/架构方向）",
      "【数据与依赖】2-4条（数据来源、埋点、外部依赖）",
      "【性能与风险】2-4条（时延、吞吐、稳定性、风险）",
      "【工作量预估】1-3条（按MVP/增强版）",
      "【Missing info】列出3条以内待确认问题；若信息充分，写“无”。"
    ].join(" ");
  }

  return [
    "你是资深产品策略顾问，负责把技术语言翻译为产品/业务语言。",
    "输出语言必须与用户输入一致；若输入是中文，输出必须是中文。",
    "禁止只讲技术细节，必须转化为业务含义和用户价值。",
    "必须严格使用以下结构并按顺序输出：",
    "【变更解读】1-2条（技术动作被翻译成业务动作）",
    "【用户影响】2-4条（体验、成功率、等待时长等）",
    "【业务影响】2-4条（转化、留存、增长空间）",
    "【成本与效率】1-3条（资源成本、人效、交付速度）",
    "【上线建议】1-3条（灰度、监控指标、对齐事项）",
    "【Missing info】列出3条以内待确认问题；若信息充分，写“无”。"
  ].join(" ");
}

function buildUserPrompt(direction, text) {
  if (direction === "product_to_dev") {
    return [
      "请将以下“产品需求描述”翻译为“工程执行说明”。",
      "要求：每条尽量具体，可直接用于需求评审。",
      "",
      "产品需求描述：",
      text
    ].join("\n");
  }

  return [
    "请将以下“技术实现描述”翻译为“产品/业务说明”。",
    "要求：每条都要体现业务价值，便于产品和管理层理解。",
    "",
    "技术实现描述：",
    text
  ].join("\n");
}

async function streamFromOpenAiCompatible({ direction, text, res }) {
  if (!llmConfig.apiKey) {
    throw new Error("Missing LLM_API_KEY (or OPENAI_API_KEY) in .env");
  }
  if (!llmConfig.baseUrl) {
    throw new Error("Missing LLM_BASE_URL in .env");
  }
  if (!llmConfig.model) {
    throw new Error("Missing LLM_MODEL in .env");
  }

  const endpoint = `${llmConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llmConfig.apiKey}`
    },
    body: JSON.stringify({
      model: llmConfig.model,
      stream: true,
      temperature: 0.3,
      messages: [
        { role: "system", content: buildSystemPrompt(direction) },
        { role: "user", content: buildUserPrompt(direction, text) }
      ]
    })
  });

  if (!upstream.ok || !upstream.body) {
    const reason = await upstream.text();
    throw new Error(`Upstream LLM error (${upstream.status}): ${reason || "unknown error"}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      const token = parsed?.choices?.[0]?.delta?.content;
      if (token) writeSseEvent(res, "chunk", { chunk: token });
    }
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, {
      ok: true,
      service: "reqtrans-agent",
      llm_provider: llmConfig.provider,
      llm_model: llmConfig.model
    });
    return;
  }

  if (req.method === "POST" && req.url === "/translate/stream") {
    let body;
    try {
      body = await collectJsonBody(req);
    } catch (error) {
      writeJson(res, 400, { error: error.message });
      return;
    }

    const direction = String(body.direction || "").trim();
    const text = String(body.text || "").trim();

    if (!VALID_DIRECTIONS.has(direction)) {
      writeJson(res, 400, { error: "Invalid direction, use product_to_dev or dev_to_product" });
      return;
    }
    if (!text) {
      writeJson(res, 400, { error: "text is required" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    try {
      if (llmConfig.provider !== "openai_compatible") {
        throw new Error("Only LLM_PROVIDER=openai_compatible is supported currently");
      }
      await streamFromOpenAiCompatible({ direction, text, res });
      writeSseEvent(res, "done", { finished: true });
      res.end();
    } catch (error) {
      writeSseEvent(res, "error", { message: error.message || "Streaming failed" });
      res.end();
    }
    return;
  }

  writeJson(res, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
