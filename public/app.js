// ---- tiny helpers -------------------------------------------------------
const $ = (id) => document.getElementById(id);
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const fmt = (secs) => {
  const s = Math.max(0, secs | 0);
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// ---- state --------------------------------------------------------------
let sessionId = null;
let statusTimer = null;   // polls /status + /events while active
let tickTimer = null;     // 1s local clock while connected
let connectedAtMs = null;

const PILL_LABEL = {
  idle: "—", waiting: "Waiting", ringing: "Ringing…", connected: "Connected",
  ended: "Ended", declined: "Declined", no_answer: "No answer", failed: "Failed", canceled: "Canceled",
};
const PHASE_TITLE = {
  starting: "Starting call…", contacting_provider: "Calling you…",
  contacting_client: "Ringing your client…", connected: "Call in progress",
  ended: "Call ended", client_declined: "Client declined the call",
  canceled: "Call canceled", failed: "Call couldn't connect",
};
const pillClass = (s) => "pill " + (["ringing","connected","declined","no_answer","failed"].includes(s) ? s : "");

// ---- Contact client → place the call -----------------------------------
$("contactBtn").addEventListener("click", async () => {
  $("setupErr").textContent = "";
  const partyA = $("provider").value.trim();
  const partyB = $("client").value.trim();
  if (!partyA || !partyB) { $("setupErr").textContent = "Enter both phone numbers (E.164, e.g. +15551230001)."; return; }
  try {
    const { sessionId: id } = await api("POST", "/connect", { partyA, partyB });
    sessionId = id;
    setVideoPaused(true);
    show("callCard"); show("logCard"); hide("setupCard");
    hide("summaryCard"); hide("transcriptCard");
    startPolling();
  } catch (e) { $("setupErr").textContent = e.message; }
});

// ---- Cancel / leave -----------------------------------------------------
$("cancelBtn").addEventListener("click", () => { $("cancelErr").textContent = ""; show("cancelOverlay"); });
$("cancelDismiss").addEventListener("click", () => hide("cancelOverlay"));
$("cancelConfirm").addEventListener("click", async () => {
  try {
    await api("POST", `/sessions/${sessionId}/cancel`, { confirm: true });
    hide("cancelOverlay");
    // status poll will pick up the terminal state and render the summary
  } catch (e) { $("cancelErr").textContent = e.message; }
});

$("newCallBtn").addEventListener("click", resetToSetup);

// ---- polling ------------------------------------------------------------
function startPolling() {
  stopPolling();
  poll();
  statusTimer = setInterval(poll, 1500);
}
function stopPolling() {
  if (statusTimer) clearInterval(statusTimer); statusTimer = null;
  if (tickTimer) clearInterval(tickTimer); tickTimer = null;
}

async function poll() {
  if (!sessionId) return;
  try {
    const s = await api("GET", `/sessions/${sessionId}/status`);
    renderStatus(s);
    renderLog(await api("GET", `/sessions/${sessionId}/events`));
    if (!s.active) { stopPolling(); onCallEnded(s); }
  } catch (e) { /* transient; keep polling */ }
}

function renderStatus(s) {
  $("phaseTitle").textContent = PHASE_TITLE[s.phase] || s.phase;
  $("phaseMsg").textContent = s.message || "";

  const p = s.parties.provider.state, c = s.parties.client.state;
  $("pillProvider").className = pillClass(p); $("pillProvider").textContent = PILL_LABEL[p] || p;
  $("pillClient").className = pillClass(c); $("pillClient").textContent = PILL_LABEL[c] || c;

  // timer
  if (s.connectedAt) {
    connectedAtMs = new Date(s.connectedAt).getTime();
    $("timer").classList.remove("dim");
    if (s.active && !tickTimer) tickTimer = setInterval(tick, 1000);
    if (!s.active) { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } $("timer").textContent = fmt(s.durationSeconds || 0); }
    else tick();
  } else {
    $("timer").classList.add("dim");
    $("timer").textContent = "00:00";
  }
}
function tick() { if (connectedAtMs) $("timer").textContent = fmt((Date.now() - connectedAtMs) / 1000); }

function renderLog(events) {
  $("log").innerHTML = events.map((e) =>
    `<div class="log-item"><span class="t">${time(e.at)}</span>` +
    `<span class="m">${escapeHtml(e.message || e.type)}</span>` +
    `<span class="tag ${e.party || ""}">${e.party || "system"}</span></div>`
  ).reverse().join("");
}

// ---- end of call → summary ---------------------------------------------
async function onCallEnded(status) {
  const sum = await api("GET", `/sessions/${sessionId}/summary`);
  const declined = status.phase === "client_declined";
  const canceled = status.phase === "canceled";
  const ok = sum.outcome === "completed";

  $("summaryTitle").textContent = PHASE_TITLE[status.phase] || "Call summary";
  const banner = $("summaryBanner");
  banner.className = "banner " + (declined || status.phase === "failed" ? "declined" : "ok");
  banner.textContent = status.message || sum.message;

  const rec = sum.documented.recorded, tr = sum.documented.transcribed;
  $("summaryKv").innerHTML = `
    <div><div class="k">Outcome</div><div class="v">${labelOutcome(sum.outcome, sum.endReason)}</div></div>
    <div><div class="k">Duration</div><div class="v">${sum.durationSeconds != null ? fmt(sum.durationSeconds) : "—"}</div></div>
    <div><div class="k">Recorded</div><div class="v ${rec ? "check" : "cross"}">${rec ? "✓ Yes" : "Pending"}</div></div>
    <div><div class="k">Transcript</div><div class="v ${tr ? "check" : "cross"}">${tr ? "✓ Ready" : "Processing…"}</div></div>
    <div><div class="k">Events logged</div><div class="v">${sum.eventCount}</div></div>`;

  hide("callCard"); show("summaryCard");
  setVideoPaused(false);
}
function labelOutcome(outcome, reason) {
  if (outcome === "completed") return "Completed";
  if (outcome === "declined") return "Client declined";
  if (outcome === "canceled") return "Canceled by you";
  if (reason === "provider_no_answer") return "You didn't answer";
  if (reason === "provider_voicemail") return "Your voicemail answered";
  return "Not connected";
}

// ---- transcript ---------------------------------------------------------
$("viewTranscriptBtn").addEventListener("click", async () => {
  const sess = await api("GET", `/sessions/${sessionId}`);
  const lines = sess.ciTranscript || [];
  $("transcriptBody").innerHTML = lines.length
    ? lines.map((l) => `<div class="line"><span class="sp ${l.speaker}">${l.speaker === "A" ? "Provider" : "Client"}:</span>${escapeHtml(l.text)}</div>`).join("")
    : `<div class="sub">Transcript isn't ready yet. You'll get a notification when it finishes processing.</div>`;
  $("transcriptSub").textContent = lines.length ? "Phone segment, speaker-labeled." : "";
  show("transcriptCard");
});

// ---- notifications ------------------------------------------------------
let knownNotif = new Set();
async function pollNotifications() {
  try {
    const list = await api("GET", "/notifications");
    const unread = list.filter((n) => !n.read);
    const badge = $("bellBadge");
    badge.textContent = unread.length;
    badge.style.display = unread.length ? "block" : "none";
    for (const n of unread) {
      if (!knownNotif.has(n.id)) { knownNotif.add(n.id); toast(n.title, n.body); }
    }
  } catch (e) { /* ignore */ }
}
$("bell").addEventListener("click", async () => {
  const list = await api("GET", "/notifications?unread=true");
  for (const n of list) await api("POST", `/notifications/${n.id}/read`);
  pollNotifications();
});
function toast(title, body) {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<div class="tt">🔔 ${escapeHtml(title)}</div><div class="tb">${escapeHtml(body)}</div>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

// ---- misc ---------------------------------------------------------------
function resetToSetup() {
  stopPolling(); sessionId = null; connectedAtMs = null;
  show("setupCard"); hide("callCard"); hide("summaryCard"); hide("transcriptCard"); hide("logCard");
  setVideoPaused(false);
}
function setVideoPaused(paused) {
  const el = $("vidStatus");
  el.classList.toggle("paused", paused);
  el.childNodes[1].textContent = paused ? " Video paused — on phone call" : " Video connected";
}
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

setInterval(pollNotifications, 3000);
pollNotifications();
