// ===========================================================
// CYMOR SPEED — Frontend Engine
// Single button, real testing, no server selection needed.
// ===========================================================

const startBtn = document.getElementById("startBtn");
const speedValue = document.getElementById("speedValue");
const phaseLabel = document.getElementById("phaseLabel");
const results = document.getElementById("results");
const retestBtn = document.getElementById("retestBtn");
const shareBtn = document.getElementById("shareBtn");
const toast = document.getElementById("toast");

const canvas = document.getElementById("gauge");
const ctx = canvas.getContext("2d");

// ---- Gauge config ----
const GAUGE_MAX = 300; // Mbps — gauge scale max (adjust if needed)
const START_ANGLE = Math.PI * 0.75; // gauge sweep start
const END_ANGLE = Math.PI * 2.25;   // gauge sweep end (270deg sweep)

function drawGauge(valueMbps) {
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 14;

  ctx.clearRect(0, 0, w, h);

  // background track
  ctx.beginPath();
  ctx.arc(cx, cy, radius, START_ANGLE, END_ANGLE);
  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineCap = "round";
  ctx.stroke();

  // value arc
  const pct = Math.min(valueMbps / GAUGE_MAX, 1);
  const valueAngle = START_ANGLE + (END_ANGLE - START_ANGLE) * pct;

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#00e5ff");
  grad.addColorStop(1, "#ff2e9f");

  ctx.beginPath();
  ctx.arc(cx, cy, radius, START_ANGLE, valueAngle);
  ctx.lineWidth = 14;
  ctx.strokeStyle = grad;
  ctx.lineCap = "round";
  ctx.stroke();

  // tick marks
  ctx.font = "10px Inter";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.textAlign = "center";
  for (let i = 0; i <= 6; i++) {
    const tickVal = (GAUGE_MAX / 6) * i;
    const tickAngle = START_ANGLE + (END_ANGLE - START_ANGLE) * (i / 6);
    const tx = cx + Math.cos(tickAngle) * (radius + 22);
    const ty = cy + Math.sin(tickAngle) * (radius + 22);
    ctx.fillText(Math.round(tickVal), tx, ty + 3);
  }
}

drawGauge(0);

function setSpeedDisplay(mbps) {
  speedValue.textContent = mbps.toFixed(1);
  drawGauge(mbps);

  if (mbps < 5) speedValue.style.color = "var(--bad)";
  else if (mbps < 25) speedValue.style.color = "var(--warn)";
  else speedValue.style.color = "var(--cyan)";
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

// ===========================================================
// TEST ENGINE
// ===========================================================

const PING_SAMPLES = 6;
const DOWNLOAD_DURATION_MS = 6000; // total download phase time
const UPLOAD_DURATION_MS = 5000;   // total upload phase time
const WARMUP_MS = 1000;            // discard first second of samples
const PARALLEL_CONNECTIONS = 4;

async function measurePing() {
  phaseLabel.textContent = "Measuring ping...";
  const samples = [];

  for (let i = 0; i < PING_SAMPLES; i++) {
    const start = performance.now();
    try {
      await fetch("/api/ping", { cache: "no-store" });
    } catch (e) {
      continue;
    }
    const elapsed = performance.now() - start;
    samples.push(elapsed);
    await new Promise((r) => setTimeout(r, 80));
  }

  if (samples.length === 0) return { ping: 0, jitter: 0 };

  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;

  // jitter = average absolute deviation between consecutive samples
  let jitterSum = 0;
  for (let i = 1; i < samples.length; i++) {
    jitterSum += Math.abs(samples[i] - samples[i - 1]);
  }
  const jitter = samples.length > 1 ? jitterSum / (samples.length - 1) : 0;

  return { ping: avg, jitter };
}

async function measureDownload() {
  phaseLabel.textContent = "Testing download...";

  let totalBytes = 0;
  const startTime = performance.now();
  let lastUpdate = startTime;
  let lastBytes = 0;

  const chunkSize = 5 * 1024 * 1024; // 5MB per request
  let running = true;
  const samples = [];

  function stop() {
    running = false;
  }
  setTimeout(stop, DOWNLOAD_DURATION_MS);

  async function worker() {
    while (running) {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), DOWNLOAD_DURATION_MS + 2000);

      try {
        const res = await fetch(`/api/download?size=${chunkSize}&_=${Math.random()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const reader = res.body.getReader();

        while (running) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;

          const now = performance.now();
          if (now - lastUpdate > 200) {
            const elapsedSec = (now - lastUpdate) / 1000;
            const bytesDelta = totalBytes - lastBytes;
            const mbps = (bytesDelta * 8) / elapsedSec / 1_000_000;

            if (now - startTime > WARMUP_MS) {
              samples.push(mbps);
              setSpeedDisplay(median(samples.slice(-5)));
            }

            lastUpdate = now;
            lastBytes = totalBytes;
          }

          if (!running) {
            try { await reader.cancel(); } catch (e) {}
            break;
          }
        }
      } catch (e) {
        // connection error/abort — loop will exit if !running
      } finally {
        clearTimeout(abortTimer);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < PARALLEL_CONNECTIONS; i++) {
    workers.push(worker());
    await new Promise((r) => setTimeout(r, 150)); // stagger starts
  }

  await Promise.all(workers);

  const totalElapsedSec = (performance.now() - startTime - WARMUP_MS) / 1000;
  if (totalElapsedSec <= 0 || samples.length === 0) return 0;

  // Final result: median of collected samples for stability
  return median(samples);
}

async function measureUpload() {
  phaseLabel.textContent = "Testing upload...";

  const chunkSize = 1 * 1024 * 1024; // 1MB chunks
  const blob = new Blob([new Uint8Array(chunkSize)]);

  let running = true;
  setTimeout(() => (running = false), UPLOAD_DURATION_MS);

  const samples = [];
  const startTime = performance.now();

  async function worker() {
    while (running) {
      const t0 = performance.now();
      try {
        await fetch("/api/upload", {
          method: "POST",
          body: blob,
          cache: "no-store",
        });
      } catch (e) {
        continue;
      }
      const t1 = performance.now();
      const elapsedSec = (t1 - t0) / 1000;
      const mbps = (chunkSize * 8) / elapsedSec / 1_000_000;

      if (t1 - startTime > WARMUP_MS) {
        samples.push(mbps);
        setSpeedDisplay(median(samples.slice(-5)));
      }
    }
  }

  const workers = [];
  for (let i = 0; i < PARALLEL_CONNECTIONS; i++) {
    workers.push(worker());
    await new Promise((r) => setTimeout(r, 150));
  }

  await Promise.all(workers);

  if (samples.length === 0) return 0;
  return median(samples);
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function fetchIpInfo() {
  try {
    const res = await fetch("/api/ipinfo", { cache: "no-store" });
    const data = await res.json();
    if (data.status === "success") {
      return {
        ip: data.query || "Unknown",
        isp: data.isp || data.org || "Unknown",
        location: [data.city, data.regionName, data.country].filter(Boolean).join(", ") || "Unknown",
      };
    }
  } catch (e) {}
  return { ip: "Unknown", isp: "Unknown", location: "Unknown" };
}

// ===========================================================
// MAIN FLOW
// ===========================================================

let lastResults = null;

async function runTest() {
  startBtn.disabled = true;
  startBtn.classList.add("hidden");
  results.classList.remove("visible");
  setSpeedDisplay(0);
  phaseLabel.textContent = "Starting...";

  const ipInfoPromise = fetchIpInfo();

  const { ping, jitter } = await measurePing();

  const downloadMbps = await measureDownload();

  setSpeedDisplay(0);
  await new Promise((r) => setTimeout(r, 300));

  const uploadMbps = await measureUpload();

  const ipInfo = await ipInfoPromise;

  phaseLabel.textContent = "Done!";
  setSpeedDisplay(downloadMbps);

  lastResults = {
    download: downloadMbps,
    upload: uploadMbps,
    ping,
    jitter,
    ...ipInfo,
    date: new Date(),
  };

  document.getElementById("dlResult").innerHTML = `${downloadMbps.toFixed(1)}<small> Mbps</small>`;
  document.getElementById("ulResult").innerHTML = `${uploadMbps.toFixed(1)}<small> Mbps</small>`;
  document.getElementById("pingResult").innerHTML = `${ping.toFixed(0)}<small> ms</small>`;
  document.getElementById("jitterResult").innerHTML = `${jitter.toFixed(1)}<small> ms</small>`;
  document.getElementById("ipAddr").textContent = ipInfo.ip;
  document.getElementById("ispName").textContent = ipInfo.isp;
  document.getElementById("ipLoc").textContent = ipInfo.location;

  results.classList.add("visible");
  startBtn.disabled = false;
}

startBtn.addEventListener("click", runTest);
retestBtn.addEventListener("click", () => {
  results.classList.remove("visible");
  startBtn.classList.remove("hidden");
  phaseLabel.textContent = "Ready";
  setSpeedDisplay(0);
  runTest();
});

// ===========================================================
// SHARE CARD
// ===========================================================

shareBtn.addEventListener("click", async () => {
  if (!lastResults) return;

  document.getElementById("scDl").textContent = lastResults.download.toFixed(1);
  document.getElementById("scUl").textContent = lastResults.upload.toFixed(1);
  document.getElementById("scPing").textContent = lastResults.ping.toFixed(0);
  document.getElementById("scIsp").textContent = lastResults.isp;
  document.getElementById("scIp").textContent = lastResults.ip;
  document.getElementById("scLoc").textContent = lastResults.location;
  document.getElementById("scDate").textContent = lastResults.date.toLocaleString();

  const shareCard = document.getElementById("share-card");

  // Temporarily bring onscreen for rendering (off-viewport but visible to html2canvas)
  shareCard.style.top = "0px";
  shareCard.style.left = "-9999px";

  try {
    const canvasImg = await html2canvas(shareCard, {
      backgroundColor: "#0a0e1a",
      scale: 2,
    });

    shareCard.style.top = "-9999px";

    canvasImg.toBlob(async (blob) => {
      const file = new File([blob], "cymor-speed-result.png", { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "My Cymor Speed Result",
            text: `My internet speed: ${lastResults.download.toFixed(1)} Mbps down / ${lastResults.upload.toFixed(1)} Mbps up`,
          });
        } catch (e) {
          downloadImage(canvasImg);
        }
      } else {
        downloadImage(canvasImg);
      }
    }, "image/png");
  } catch (e) {
    shareCard.style.top = "-9999px";
    showToast("Could not generate image");
  }
});

function downloadImage(canvasImg) {
  const link = document.createElement("a");
  link.download = "cymor-speed-result.png";
  link.href = canvasImg.toDataURL("image/png");
  link.click();
  showToast("Image saved!");
}
