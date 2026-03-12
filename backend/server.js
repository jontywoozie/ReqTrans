const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

loadEnvFile(path.join(process.cwd(), ".env"));

const PORT = Number(process.env.BACKEND_PORT || 43127);
const VALID_DIRECTIONS = new Set(["product_to_dev", "dev_to_product", "free_chat"]);
const MAX_CONTEXT_MESSAGES = Number(process.env.SESSION_CONTEXT_MESSAGES || 12);

const llmConfig = {
  provider: String(process.env.LLM_PROVIDER || "openai_compatible").trim(),
  baseUrl: String(process.env.LLM_BASE_URL || "https://api.openai.com/v1").trim(),
  apiKey: String(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim(),
  model: String(process.env.LLM_MODEL || "gpt-4.1-mini").trim(),
  maxTokens: process.env.LLM_MAX_TOKENS,
  retryMax: Number(process.env.LLM_RETRY_MAX || 3),
  retryBaseMs: Number(process.env.LLM_RETRY_BASE_MS || 800)
};

const parsedMaxTokens = Number(llmConfig.maxTokens);
const resolvedMaxTokens =
  llmConfig.maxTokens === undefined || llmConfig.maxTokens === null || llmConfig.maxTokens === ""
    ? null
    : Number.isFinite(parsedMaxTokens)
      ? Math.max(64, Math.floor(parsedMaxTokens))
      : null;

const sessions = new Map();
const STORAGE_DIR = path.join(process.cwd(), "storage");
const SESSIONS_FILE = path.join(STORAGE_DIR, "sessions.json");
const SESSIONS_TMP_FILE = path.join(STORAGE_DIR, "sessions.json.tmp");
let persistTimer = null;

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

function ensureStorageDir() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function toSerializableSession(session) {
  return {
    id: session.id,
    direction: session.direction,
    title: session.title,
    preview: session.preview || "",
    history: Array.isArray(session.history) ? session.history : [],
    transcript: Array.isArray(session.transcript) ? session.transcript : [],
    createdAt: Number(session.createdAt || Date.now()),
    updatedAt: Number(session.updatedAt || Date.now())
  };
}

function persistSessionsToDiskSync() {
  ensureStorageDir();
  const payload = {
    version: 1,
    updatedAt: Date.now(),
    sessions: Array.from(sessions.values()).map(toSerializableSession)
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(SESSIONS_TMP_FILE, json, "utf8");
  fs.renameSync(SESSIONS_TMP_FILE, SESSIONS_FILE);
}

function schedulePersistSessions() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      persistSessionsToDiskSync();
    } catch (error) {
      console.error("Failed to persist sessions:", error.message);
    }
  }, 200);
}

function loadSessionsFromDisk() {
  try {
    ensureStorageDir();
    if (!fs.existsSync(SESSIONS_FILE)) {
      persistSessionsToDiskSync();
      return;
    }

    const raw = fs.readFileSync(SESSIONS_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const arr = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    sessions.clear();

    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const id = String(item.id || "").trim();
      if (!id) continue;

      sessions.set(id, {
        id,
        direction: VALID_DIRECTIONS.has(item.direction) ? item.direction : "free_chat",
        title: summarizeTitle(item.title || "新会话"),
        preview: String(item.preview || ""),
        history: Array.isArray(item.history) ? item.history : [],
        transcript: Array.isArray(item.transcript) ? item.transcript : [],
        createdAt: Number(item.createdAt || Date.now()),
        updatedAt: Number(item.updatedAt || Date.now())
      });
    }
  } catch (error) {
    console.error("Failed to load sessions:", error.message);
    sessions.clear();
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

function summarizeTitle(text, fallback = "新会话") {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  if (!oneLine) return fallback;
  const firstSentence = oneLine.split(/[。！？!?]/).find((s) => s.trim()) || oneLine;
  const clean = firstSentence.trim();
  return clean.length > 30 ? `${clean.slice(0, 30)}...` : clean;
}

function getSessionSummaries() {
  return Array.from(sessions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({
      id: s.id,
      title: s.title,
      direction: s.direction,
      preview: s.preview || "",
      updated_at: s.updatedAt,
      created_at: s.createdAt
    }));
}

function createSession(direction = "free_chat", title = "新会话") {
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    direction,
    title: summarizeTitle(title),
    preview: "",
    history: [],
    transcript: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  sessions.set(sessionId, session);
  schedulePersistSessions();
  return session;
}

function getOrCreateSession(sessionId, direction, title) {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    let changed = false;
    if (direction && VALID_DIRECTIONS.has(direction)) session.direction = direction;
    if (title) {
      const nextTitle = summarizeTitle(title, session.title);
      if (nextTitle !== session.title) {
        session.title = nextTitle;
        changed = true;
      }
    }
    session.updatedAt = Date.now();
    if (changed) schedulePersistSessions();
    return session;
  }

  return createSession(direction, title);
}

function trimHistory(session) {
  if (session.history.length > MAX_CONTEXT_MESSAGES) {
    session.history = session.history.slice(-MAX_CONTEXT_MESSAGES);
  }
}

function trimTranscript(session) {
  const maxTranscript = MAX_CONTEXT_MESSAGES * 4;
  if (session.transcript.length > maxTranscript) {
    session.transcript = session.transcript.slice(-maxTranscript);
  }
}

function detectInputLanguage(text) {
  const content = String(text || "");
  const cjkCount = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinCount = (content.match(/[A-Za-z]/g) || []).length;
  return cjkCount >= latinCount ? "zh" : "en";
}

function buildSystemPrompt(direction) {
  if (direction === "free_chat") {
    return [
      "You are a helpful and concise bilingual assistant.",
      "Keep responses natural, practical, and friendly.",
      "You must use the same language as the user's latest input.",
      "Do not fabricate facts, percentages, benchmark numbers, or business outcomes.",
      "If specific numbers are not provided by user input or chat history, explicitly label them as '需验证' or 'to be verified'.",
      "Do not force structured sections unless the user asks for them."
    ].join(" ");
  }

  if (direction === "product_to_dev") {
    return [
      "You translate product requirements into engineering language.",
      "Use concise bullet points.",
      "You must use the same language as the user's latest input.",
      "Must include: technical approach, data needs, performance expectations, workload estimate, and risks.",
      "Do not fabricate facts, percentages, benchmark numbers, or business outcomes.",
      "If specific numbers are not provided by user input or chat history, explicitly label them as '需验证' or 'to be verified'.",
      "If details are missing, add a short 'Missing info' list."
    ].join(" ");
  }

  return [
    "You translate engineering updates into product/business language.",
    "Use concise bullet points.",
    "You must use the same language as the user's latest input.",
    "Must include: user impact, business impact, cost/efficiency impact, and rollout implications.",
    "Do not fabricate facts, percentages, benchmark numbers, or business outcomes.",
    "If specific numbers are not provided by user input or chat history, explicitly label them as '需验证' or 'to be verified'.",
    "If details are missing, add a short 'Missing info' list."
  ].join(" ");
}

function buildUserPrompt(direction, text) {
  const lang = detectInputLanguage(text);
  const languageHint =
    lang === "zh"
      ? "请用中文回答，并保持术语准确。无法确认的数据请标注“需验证”。"
      : "Please answer in English. Mark uncertain numbers as 'to be verified'.";

  if (direction === "free_chat") return text;

  if (direction === "product_to_dev") {
    return [
      "Translate the following product requirement into executable engineering language.",
      "Focus on specific and actionable details.",
      languageHint,
      "",
      "Product requirement:",
      text
    ].join("\n");
  }

  return [
    "Translate the following engineering update into product/business language.",
    "Focus on business impact and user value.",
    languageHint,
    "",
    "Engineering update:",
    text
  ].join("\n");
}

function buildMessages(direction, text, sessionHistory) {
  const messages = [{ role: "system", content: buildSystemPrompt(direction) }];

  for (const item of sessionHistory) {
    messages.push({ role: item.role, content: item.content });
  }

  messages.push({ role: "user", content: buildUserPrompt(direction, text) });
  return messages;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

async function streamFromOpenAiCompatible({ messages, res }) {
  if (!llmConfig.apiKey) throw new Error("Missing LLM_API_KEY (or OPENAI_API_KEY) in .env");
  if (!llmConfig.baseUrl) throw new Error("Missing LLM_BASE_URL in .env");
  if (!llmConfig.model) throw new Error("Missing LLM_MODEL in .env");

  const endpoint = `${llmConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const maxAttempts = Math.max(1, Math.floor(llmConfig.retryMax));
  let upstream;
  let lastReason = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify({
        model: llmConfig.model,
        stream: true,
        temperature: 0.6,
        ...(resolvedMaxTokens ? { max_tokens: resolvedMaxTokens } : {}),
        messages
      })
    });

    if (upstream.ok && upstream.body) break;

    lastReason = await upstream.text();
    if (!isRetryableStatus(upstream.status) || attempt === maxAttempts) {
      break;
    }

    const backoff = Math.max(200, Math.floor(llmConfig.retryBaseMs)) * 2 ** (attempt - 1);
    await sleep(backoff);
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    const status = upstream ? upstream.status : "unknown";
    if (status === 429) {
      throw new Error("模型当前繁忙（429），已自动重试仍失败，请稍后再试。");
    }
    throw new Error(`Upstream LLM error (${status}): ${lastReason || "unknown error"}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

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

      const choice = parsed?.choices?.[0] || {};
      const token =
        choice?.delta?.content ||
        choice?.delta?.reasoning_content ||
        choice?.message?.content ||
        choice?.text ||
        "";

      if (token) {
        const piece = String(token);
        fullText += piece;
        writeSseEvent(res, "chunk", { chunk: piece });
      }
    }
  }

  if (!fullText.trim()) {
    throw new Error("Model produced no visible text. Try a different model or retry.");
  }

  return fullText;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/health") {
    writeJson(res, 200, {
      ok: true,
      service: "reqtrans-agent",
      llm_provider: llmConfig.provider,
      llm_model: llmConfig.model,
      llm_max_tokens: resolvedMaxTokens ?? "provider_default",
      sessions: sessions.size
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/session/list") {
    writeJson(res, 200, { sessions: getSessionSummaries() });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/session/history") {
    const sessionId = String(requestUrl.searchParams.get("session_id") || "").trim();
    if (!sessionId) {
      writeJson(res, 400, { error: "session_id is required" });
      return;
    }
    if (!sessions.has(sessionId)) {
      writeJson(res, 404, { error: "session not found" });
      return;
    }

    const session = sessions.get(sessionId);
    writeJson(res, 200, {
      session: {
        id: session.id,
        title: session.title,
        direction: session.direction,
        updated_at: session.updatedAt
      },
      messages: session.transcript || []
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/session/new") {
    let body = {};
    try {
      body = await collectJsonBody(req);
    } catch {
      body = {};
    }

    const direction = VALID_DIRECTIONS.has(body.direction) ? body.direction : "free_chat";
    const title = String(body.title || "").trim() || "新会话";
    const session = createSession(direction, title);
    writeJson(res, 200, {
      session_id: session.id,
      direction: session.direction,
      title: session.title
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/session/clear") {
    let body;
    try {
      body = await collectJsonBody(req);
    } catch (error) {
      writeJson(res, 400, { error: error.message });
      return;
    }

    const sessionId = String(body.session_id || "").trim();
    if (!sessionId) {
      writeJson(res, 400, { error: "session_id is required" });
      return;
    }

    sessions.delete(sessionId);
    schedulePersistSessions();
    writeJson(res, 200, { ok: true, cleared: sessionId });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/translate/stream") {
    let body;
    try {
      body = await collectJsonBody(req);
    } catch (error) {
      writeJson(res, 400, { error: error.message });
      return;
    }

    const direction = String(body.direction || "").trim();
    const text = String(body.text || "").trim();
    const incomingSessionId = String(body.session_id || "").trim();
    const incomingTitle = String(body.title || "").trim();

    if (!VALID_DIRECTIONS.has(direction)) {
      writeJson(res, 400, { error: "Invalid direction, use product_to_dev, dev_to_product or free_chat" });
      return;
    }
    if (!text) {
      writeJson(res, 400, { error: "text is required" });
      return;
    }

    const session = getOrCreateSession(incomingSessionId, direction, incomingTitle);
    if (!session.history.length && !incomingTitle) {
      session.title = summarizeTitle(text, session.title);
    }
    const messages = buildMessages(direction, text, session.history);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    writeSseEvent(res, "session", {
      session_id: session.id,
      direction: session.direction,
      title: session.title
    });

    try {
      if (llmConfig.provider !== "openai_compatible") {
        throw new Error("Only LLM_PROVIDER=openai_compatible is supported currently");
      }

      const assistantText = await streamFromOpenAiCompatible({ messages, res });

      session.history.push({ role: "user", content: buildUserPrompt(direction, text) });
      session.history.push({ role: "assistant", content: assistantText });
      session.transcript.push({ role: "user", content: text, ts: Date.now() });
      session.transcript.push({ role: "assistant", content: assistantText, ts: Date.now() });
      session.preview = summarizeTitle(text, session.preview);
      session.updatedAt = Date.now();
      trimHistory(session);
      trimTranscript(session);
      schedulePersistSessions();

      writeSseEvent(res, "done", {
        finished: true,
        session_id: session.id,
        title: session.title
      });
      res.end();
    } catch (error) {
      writeSseEvent(res, "error", { message: error.message || "Streaming failed" });
      res.end();
    }
    return;
  }

  writeJson(res, 404, { error: "Not Found" });
});

loadSessionsFromDisk();

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  try {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistSessionsToDiskSync();
  } catch {}
  process.exit(0);
});

process.on("SIGTERM", () => {
  try {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistSessionsToDiskSync();
  } catch {}
  process.exit(0);
});
