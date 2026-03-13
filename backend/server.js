const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { detectInputLanguage } = require("./utils/language");
const { buildMessages, buildUserPrompt } = require("./prompts");
const { validateOutputQuality } = require("./quality/outputValidator");

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

function summarizeTitle(text, fallback = "新会话") {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  if (!oneLine) return fallback;
  const firstSentence = oneLine.split(/[。！？!?]/).find((item) => item.trim()) || oneLine;
  const clean = firstSentence.trim();
  return clean.length > 30 ? `${clean.slice(0, 30)}...` : clean;
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

function getSessionSummaries() {
  return Array.from(sessions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((session) => ({
      id: session.id,
      title: session.title,
      direction: session.direction,
      preview: session.preview || "",
      updated_at: session.updatedAt,
      created_at: session.createdAt
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

async function callOpenAiCompatible({ messages, temperature = 0.6 }) {
  const endpoint = `${llmConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const maxAttempts = Math.max(1, Math.floor(llmConfig.retryMax));

  let lastStatus = 0;
  let lastReason = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify({
        model: llmConfig.model,
        stream: false,
        temperature,
        ...(resolvedMaxTokens ? { max_tokens: resolvedMaxTokens } : {}),
        messages
      })
    });

    lastStatus = upstream.status;
    const raw = await upstream.text();

    if (!upstream.ok) {
      lastReason = raw;
      if (!isRetryableStatus(upstream.status) || attempt === maxAttempts) break;
      const backoff = Math.max(200, Math.floor(llmConfig.retryBaseMs)) * 2 ** (attempt - 1);
      await sleep(backoff);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Invalid upstream JSON response");
    }

    const choice = parsed?.choices?.[0] || {};
    const content = choice?.message?.content || choice?.text || choice?.delta?.content || "";

    if (!String(content).trim()) {
      throw new Error("Model produced no visible text");
    }

    return String(content);
  }

  if (lastStatus === 429) {
    throw new Error("模型当前繁忙（429），已自动重试仍失败，请稍后再试。");
  }

  throw new Error(`Upstream LLM error (${lastStatus || "unknown"}): ${lastReason || "unknown error"}`);
}

async function generateWithQualityGuard({ direction, text, sessionHistory }) {
  const { messages, lang } = buildMessages(direction, text, sessionHistory);
  const firstPass = await callOpenAiCompatible({ messages, temperature: 0.6 });

  const check = validateOutputQuality({
    direction,
    inputText: text,
    outputText: firstPass,
    lang
  });

  if (check.pass) return firstPass;

  const rewriteMessages = [
    {
      role: "system",
      content:
        "You are a strict quality rewriter. Keep intent unchanged, only fix violations. Follow all constraints exactly."
    },
    {
      role: "user",
      content: [
        `Direction: ${direction}`,
        `Input language: ${lang}`,
        "Issues:",
        ...check.issues.map((item) => `- ${item}`),
        "",
        "Original user input:",
        text,
        "",
        "Draft output to repair:",
        firstPass,
        "",
        "Return only the repaired final answer."
      ].join("\n")
    }
  ];

  return callOpenAiCompatible({ messages: rewriteMessages, temperature: 0.2 });
}

function streamTextAsSse(res, text) {
  const content = String(text || "");
  let index = 0;

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (index >= content.length) {
        clearInterval(timer);
        resolve();
        return;
      }

      const step = Math.max(4, Math.min(18, Math.floor(content.length / 60)));
      const chunk = content.slice(index, index + step);
      index += step;
      writeSseEvent(res, "chunk", { chunk });
    }, 12);
  });
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

      const assistantText = await generateWithQualityGuard({
        direction,
        text,
        sessionHistory: session.history
      });

      await streamTextAsSse(res, assistantText);

      const wrappedUser = buildUserPrompt(direction, text, detectInputLanguage(text));
      session.history.push({ role: "user", content: wrappedUser });
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

function flushAndExit() {
  try {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistSessionsToDiskSync();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", flushAndExit);
process.on("SIGTERM", flushAndExit);
