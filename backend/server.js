const http = require("http");

const PORT = process.env.BACKEND_PORT || 43127;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "reqtrans-agent" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("ReqTrans agent bootstrap is running.");
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
