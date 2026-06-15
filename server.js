import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// -------------------------------------------------
// DOWNLOAD TEST
// Streams random bytes directly to the client without
// ever buffering the whole payload in memory or writing
// to disk. We generate a single reusable chunk and pipe
// it repeatedly, which is cheap on CPU and RAM.
// -------------------------------------------------
const CHUNK_SIZE = 64 * 1024; // 64KB chunk reused for streaming
const RANDOM_CHUNK = crypto.randomBytes(CHUNK_SIZE);

app.get("/api/download", (req, res) => {
  // size in bytes requested by client, capped to avoid abuse
  let size = parseInt(req.query.size, 10) || 10 * 1024 * 1024; // default 10MB
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB hard cap per request
  if (size > MAX_SIZE) size = MAX_SIZE;

  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": "no-store",
  });

  let sent = 0;
  function pushChunk() {
    if (sent >= size) {
      res.end();
      return;
    }
    const remaining = size - sent;
    const chunk = remaining >= CHUNK_SIZE ? RANDOM_CHUNK : RANDOM_CHUNK.subarray(0, remaining);

    sent += chunk.length;
    const ok = res.write(chunk);
    if (!ok) {
      res.once("drain", pushChunk);
    } else {
      // avoid blocking event loop on huge sizes
      setImmediate(pushChunk);
    }
  }

  req.on("close", () => {
    sent = size; // stop writing if client disconnects early
  });

  pushChunk();
});

// -------------------------------------------------
// UPLOAD TEST
// Receives data, counts bytes, discards immediately.
// Never written to disk, never buffered in full.
// -------------------------------------------------
app.post("/api/upload", (req, res) => {
  let received = 0;

  req.on("data", (chunk) => {
    received += chunk.length;
    // chunk is discarded automatically (no storage)
  });

  req.on("end", () => {
    res.json({ received });
  });

  req.on("error", () => {
    res.status(400).end();
  });
});

// -------------------------------------------------
// PING / LATENCY
// Lightweight endpoint returning current server time.
// -------------------------------------------------
app.get("/api/ping", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ t: Date.now() });
});

// -------------------------------------------------
// IP / ISP INFO PROXY
// Proxies to ip-api.com so the client gets the real
// public IP as seen by our server's request (works
// even though the request is server-side, ip-api will
// return info for the visitor's IP if we forward it,
// otherwise falls back to server IP — see notes below)
// -------------------------------------------------
app.get("/api/ipinfo", async (req, res) => {
  try {
    // Get the client's real IP from headers (Render sits behind a proxy)
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;

    const url = clientIp
      ? `http://ip-api.com/json/${clientIp}?fields=status,message,country,regionName,city,isp,org,as,query`
      : `http://ip-api.com/json/?fields=status,message,country,regionName,city,isp,org,as,query`;

    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Could not fetch IP info" });
  }
});

app.get("/health", (req, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`Cymor Speed server running on port ${PORT}`);
});
