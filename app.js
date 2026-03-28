const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const clearBtn = document.getElementById("clearBtn");
const baudRateEl = document.getElementById("baudRate");
const maxPointsEl = document.getElementById("maxPoints");
const statusEl = document.getElementById("status");
const supportPillEl = document.getElementById("supportPill") || document.getElementById("serialPill");
const streamEl = document.getElementById("stream");
const lastValueEl = document.getElementById("lastValue");
const sampleCountEl = document.getElementById("sampleCount");
const deviceStateEl = document.getElementById("deviceState");

let port = null;
let reader = null;
let keepReading = false;
let samples = 0;
let partialFlushTimer = null;
let serialLineBuffer = "";

const hasWebSerial = "serial" in navigator;
if (supportPillEl) {
  supportPillEl.textContent = `Web Serial: ${hasWebSerial ? "supported" : "not supported"}`;
}

const MAX_STREAM_LINES = 800;
const STREAM_FLUSH_MS = 120;
const CHART_UPDATE_MS = 50;

const streamLines = [];
let streamDirty = false;
let streamTimer = null;
let chartUpdateScheduled = false;
let lastChartUpdateAt = 0;

const chart = new Chart(document.getElementById("chart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "Telemetry",
        data: [],
        borderColor: "rgba(61, 231, 255, 1)",
        backgroundColor: "rgba(61, 231, 255, 0.16)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.22,
        fill: true,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    normalized: true,
    plugins: {
      legend: { labels: { color: "rgba(203, 232, 255, 0.92)" } },
    },
    scales: {
      x: { ticks: { display: false }, grid: { color: "rgba(126, 220, 255, 0.13)" } },
      y: { ticks: { color: "rgba(203, 232, 255, 0.8)" }, grid: { color: "rgba(126, 220, 255, 0.13)" } },
    },
  },
});

function setStatus(text) {
  statusEl.textContent = `Status: ${text}`;
}

function setDeviceState(text) {
  deviceStateEl.textContent = text;
}

function flushStream() {
  if (!streamDirty) return;
  streamEl.textContent = streamLines.join("\n");
  streamEl.scrollTop = streamEl.scrollHeight;
  streamDirty = false;
}

function queueStreamFlush() {
  if (streamTimer) return;
  streamTimer = setTimeout(() => {
    streamTimer = null;
    flushStream();
  }, STREAM_FLUSH_MS);
}

function appendLine(text) {
  streamLines.push(text);
  if (streamLines.length > MAX_STREAM_LINES) {
    streamLines.splice(0, streamLines.length - MAX_STREAM_LINES);
  }
  streamDirty = true;
  queueStreamFlush();
}

function parseNumber(line) {
  const match = line.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
  return match ? Number(match[0]) : null;
}

/** One JSON object per line from Arduino, e.g. {"heartRate":72,"movement":"Stable"} */
function tryParseJsonObject(line) {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    const o = JSON.parse(t);
    return typeof o === "object" && o !== null && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** Pick a number for the chart from a JSON row (prefers common keys). */
function firstNumericFromJson(obj) {
  const prefer = ["value", "telemetry", "v", "sensor", "heartRate", "bpm", "distance"];
  const asNum = (x) => {
    if (typeof x === "number" && Number.isFinite(x)) return x;
    if (typeof x === "string" && x.trim() !== "") {
      const n = Number(x);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  for (const k of prefer) {
    const n = asNum(obj[k]);
    if (n != null) return n;
  }
  for (const k of Object.keys(obj)) {
    const n = asNum(obj[k]);
    if (n != null) return n;
  }
  return null;
}

let lastJsonApiPost = 0;
const JSON_API_MIN_MS = 400;

async function maybeForwardJsonToApi(obj) {
  const box = document.getElementById("forwardJsonApi");
  if (!box || !box.checked) return;
  const now = Date.now();
  if (now - lastJsonApiPost < JSON_API_MIN_MS) return;
  lastJsonApiPost = now;
  try {
    const res = await fetch("/api/update-sensors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj),
    });
    if (!res.ok) appendLine(`[warn] API POST ${res.status}`);
  } catch (e) {
    appendLine(`[warn] API POST: ${e.message || e} (run node server.js on same host)`);
  }
}

function clearPartialFlushTimer() {
  if (partialFlushTimer != null) {
    clearTimeout(partialFlushTimer);
    partialFlushTimer = null;
  }
}

function schedulePartialLineFlush() {
  clearPartialFlushTimer();
  partialFlushTimer = setTimeout(() => {
    partialFlushTimer = null;
    if (serialLineBuffer.length > 0) {
      const line = serialLineBuffer.trim();
      serialLineBuffer = "";
      if (line) processIncomingLine(line);
    }
  }, 280);
}

function processIncomingLine(line) {
  appendLine(line);
  const jsonObj = tryParseJsonObject(line);
  if (jsonObj) {
    void maybeForwardJsonToApi(jsonObj);
    const n = firstNumericFromJson(jsonObj);
    if (Number.isFinite(n)) addPoint(n);
    return;
  }
  const n = parseNumber(line);
  if (Number.isFinite(n)) addPoint(n);
}

function scheduleChartUpdate() {
  const now = performance.now();
  if (!chartUpdateScheduled && now - lastChartUpdateAt >= CHART_UPDATE_MS) {
    lastChartUpdateAt = now;
    chart.update("none");
    return;
  }
  if (chartUpdateScheduled) return;
  chartUpdateScheduled = true;
  setTimeout(() => {
    chartUpdateScheduled = false;
    lastChartUpdateAt = performance.now();
    chart.update("none");
  }, CHART_UPDATE_MS);
}

function addPoint(value) {
  const maxPoints = Math.min(3000, Math.max(10, Number(maxPointsEl.value) || 240));
  const labels = chart.data.labels;
  const values = chart.data.datasets[0].data;

  labels.push(String(labels.length + 1));
  values.push(value);
  while (values.length > maxPoints) {
    labels.shift();
    values.shift();
  }

  samples += 1;
  sampleCountEl.textContent = String(samples);
  lastValueEl.textContent = String(value);
  scheduleChartUpdate();
}

async function disconnect() {
  keepReading = false;
  clearPartialFlushTimer();
  serialLineBuffer = "";

  try {
    if (reader) {
      await reader.cancel();
      try {
        reader.releaseLock();
      } catch {}
    }
  } catch {}
  reader = null;

  try {
    if (port) await port.close();
  } catch {}
  port = null;

  flushStream();
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
  setStatus("disconnected");
  setDeviceState("idle");
}

/**
 * Read raw bytes, split on newlines, and flush buffered text if the board uses Serial.print without \n.
 */
async function readSerialLoop() {
  const textDecoder = new TextDecoder();
  const rawReader = port.readable.getReader();
  reader = rawReader;
  keepReading = true;
  serialLineBuffer = "";

  try {
    while (keepReading) {
      const { value, done } = await rawReader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      serialLineBuffer += textDecoder.decode(value, { stream: true });
      const parts = serialLineBuffer.split(/\r?\n/);
      serialLineBuffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (line) processIncomingLine(line);
      }

      if (serialLineBuffer.length > 0) {
        schedulePartialLineFlush();
      } else {
        clearPartialFlushTimer();
      }
    }
  } catch (err) {
    if (keepReading) {
      appendLine(`[error] ${err.message || err}`);
    }
  } finally {
    clearPartialFlushTimer();
    if (serialLineBuffer.trim()) {
      processIncomingLine(serialLineBuffer.trim());
      serialLineBuffer = "";
    }
    try {
      rawReader.releaseLock();
    } catch {}
    reader = null;

    if (port) {
      try {
        await port.close();
      } catch {}
      port = null;
    }
    flushStream();
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    setStatus("disconnected");
    setDeviceState("idle");
  }
}

connectBtn.addEventListener("click", async () => {
  if (!hasWebSerial) {
    setStatus("Web Serial not supported (use Chrome/Edge)");
    appendLine("[error] Web Serial is not available in this browser.");
    return;
  }

  try {
    const baudRate = Number(baudRateEl.value) || 115200;
    port = await navigator.serial.requestPort();
    await port.open({ baudRate });

    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    setStatus(`connected @ ${baudRate}`);
    setDeviceState("live");
    await readSerialLoop();
  } catch (err) {
    appendLine(`[error] ${err.message || err}`);
    appendUsbSerialHints(err);
    await disconnect();
  }
});

disconnectBtn.addEventListener("click", disconnect);

clearBtn.addEventListener("click", () => {
  streamLines.length = 0;
  streamDirty = true;
  flushStream();
});

/** Extra hints when Web Serial fails (common with USB-C charge-only cables, drivers, busy port). */
function appendUsbSerialHints(err) {
  const name = err && err.name ? String(err.name) : "";
  const msg = ((err && err.message) || String(err || "")).toLowerCase();
  const aborted = name === "AbortError" || msg.includes("abort") || msg.includes("cancel") || msg.includes("no port");
  const openFail =
    msg.includes("failed to open") ||
    msg.includes("networkerror") ||
    msg.includes("broken pipe") ||
    msg.includes("access denied") ||
    msg.includes("busy");

  if (aborted) {
    appendLine("[hint] Port picker was cancelled or no device chosen — click Connect again and select your Arduino / USB serial device.");
    return;
  }

  appendLine("[hint] USB-C: If nothing works, try a different cable labeled for data (many are charge-only).");
  appendLine("[hint] Plug directly into the computer; avoid cheap hubs. Try USB-A + known-good data cable if you have an adapter.");
  appendLine("[hint] Install drivers for CH340, CP210x, or FTDI (your board’s USB chip). Close Arduino IDE Serial Monitor first.");
  if (openFail) {
    appendLine("[hint] Port may be in use by another app — quit Arduino Serial Monitor, other terminals, and retry.");
  }
  appendLine("[hint] Full steps: open getting-started.html#usb-c (USB-C & Arduino section).");
}
