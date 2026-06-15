# Cymor Speed

A fast, reliable, beautiful internet speed test by **Cymor Tech Services**.

One button. No server picker. Real multi-connection measurements for download, upload, ping, and jitter — plus IP/ISP/location info and a shareable result card.

## Features

- **Single tap** — auto-starts, no choices to make
- **Multi-connection download/upload** test (4 parallel streams, like fast.com) for accurate real-world throughput
- **Median-of-samples** scoring to avoid throttling/spike skew
- **Warm-up discard** — first second of data ignored for accuracy
- **Ping + jitter** via lightweight round-trip pings
- **IP / ISP / Location** lookup (via ip-api.com, no key required)
- **Shareable result card** generated client-side with html2canvas (no server image processing)
- **Zero disk usage** — all test data generated/discarded in-memory, safe for Render free tier

## Render free-tier notes

- Download test data is generated once (`crypto.randomBytes`, 64KB) and streamed repeatedly — never buffered fully or written to disk
- Upload test data is counted and discarded immediately — never stored
- No database required
- Each download request capped at 50MB to prevent abuse
- App spins down after 15 min idle (free tier) — first request after idle will be slow (cold start)

## Deploy on Render

1. Push this repo to GitHub
2. On Render: **New > Web Service** → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. No environment variables required

## Local development

```bash
npm install
npm start
```

Visit `http://localhost:3000`

---

Cymor Tech Services — Always a winner.
