export const state = {
  stream: null,
  track: null,
  cameraStarted: false,
  torchSupported: false,
  torchRequested: false,
  torchActual: null,
  torchResult: "未実行",
  torchOnResult: "not tested",
  torchOffResult: "not tested",
  torchOnLatency: null,
  torchOffLatency: null,
  strobeRunning: false,
  recording: false,
  recorder: null,
  wakeLockActive: false,
  wakeLock: null,
  selectedMimeType: "",
  recordingWhileTorch: "not tested",
  strobeResult: "not tested",
  logs: [],
};

export const $ = (id) => document.getElementById(id);

export function formatError(error) {
  if (!error) return "UnknownError";
  return `${error.name || "Error"}${error.message ? `: ${error.message}` : ""}`;
}

export function log(message, error) {
  const now = new Date();
  const stamp = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}.${String(now.getMilliseconds()).padStart(3,"0")}`;
  const line = `${stamp} ${message}${error ? ` | ${formatError(error)}` : ""}`;
  state.logs.push(line);
  if (state.logs.length > 500) state.logs.shift();
  const output = $("debugLog");
  if (output) {
    output.textContent = state.logs.join("\n");
    output.scrollTop = output.scrollHeight;
  }
}

export function message(text, isError = false) {
  const output = $("globalMessage");
  output.textContent = text;
  output.classList.toggle("error-text", isError);
}

export function setBadge(id, text, kind = "") {
  const badge = $(id);
  badge.textContent = text;
  badge.className = "status-badge";
  if (kind) badge.classList.add(kind);
}

export function safeJson(value) {
  try { return JSON.stringify(value ?? {}, null, 2); }
  catch (error) { return JSON.stringify({ error: formatError(error) }, null, 2); }
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    log("Clipboard API failed; using fallback", error);
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try { copied = document.execCommand("copy"); }
  finally { area.remove(); }
  return copied;
}

export function browserDetails() {
  return [
    `UA: ${navigator.userAgent}`,
    `platform: ${navigator.platform}`,
    `vendor: ${navigator.vendor}`,
    `touch: ${navigator.maxTouchPoints}`,
    `DPR: ${window.devicePixelRatio}`,
    `screen: ${screen.width}x${screen.height}`,
    `viewport: ${innerWidth}x${innerHeight}`,
    `HTTPS/secure: ${location.protocol === "https:"}/${window.isSecureContext}`,
  ].join(" | ");
}
