// popup.js — Extension popup logic
// Handles: config load/save, tab switching, PAT validation, OAuth Device Flow
// (handed off to background.js to survive popup close), live stats, debug logs.

"use strict";

// ─── Helpers ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── State ────────────────────────────────────────────────────────────────
let currentTab = "token"; // "token" | "oauth"
let oauthCountdownTimer = null;

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await loadConfig();
  await checkLeetCodeLogin();
  await loadStats();
  await renderLogs();
  bindEvents();
});

// ─── Load & Restore Config ────────────────────────────────────────────────
async function loadConfig() {
  const data = await chrome.storage.local.get([
    "ghToken", "ghOwner", "ghRepo", "ghBranch",
    "connMethod", "clientId", "oauthStatus",
    "cfHandle", "displayName", "leaderboardUrl", "optInLeaderboard"
  ]);

  if (data.ghToken)          $("token").value    = data.ghToken;
  if (data.ghOwner)          $("owner").value    = data.ghOwner;
  if (data.ghRepo)           $("repo").value     = data.ghRepo;
  if (data.ghBranch)         $("branch").value   = data.ghBranch;
  if (data.clientId)         $("clientId").value = data.clientId;
  if (data.cfHandle)         $("cfHandle").value = data.cfHandle;
  if (data.displayName)      $("displayName").value = data.displayName;
  if (data.leaderboardUrl)   $("leaderboardUrl").value = data.leaderboardUrl;
  $("optInLeaderboard").checked = data.optInLeaderboard !== false;

  // Restore connection method
  switchTab(data.connMethod === "oauth" ? "oauth" : "token");

  // Restore GitHub connection status
  const isConnected = !!(data.ghToken && data.ghOwner && data.ghRepo);
  setGhStatus(isConnected ? "connected" : "disconnected");

  // If OAuth was in progress and token now exists → show connected
  if (data.oauthStatus === "connected" && data.ghToken) {
    setGhStatus("connected");
    showStatus("✓ Successfully connected via OAuth!", false);
    await chrome.storage.local.remove("oauthStatus");
  } else if (data.oauthStatus === "expired") {
    showStatus("OAuth code expired. Please try again.", true);
    await chrome.storage.local.remove("oauthStatus");
  } else if (data.oauthStatus?.startsWith("error")) {
    showStatus(`OAuth failed: ${data.oauthStatus}`, true);
    await chrome.storage.local.remove("oauthStatus");
  }
}

// ─── LeetCode Login Check ─────────────────────────────────────────────────
async function checkLeetCodeLogin() {
  try {
    const cookie = await chrome.cookies.get({
      url: "https://leetcode.com",
      name: "csrftoken"
    });
    const loggedIn = !!(cookie && cookie.value);
    $("lcStatusText").textContent = loggedIn
      ? "✓ Logged in to LeetCode"
      : "✗ Not logged in to LeetCode";
    $("lcStatusText").style.color = loggedIn
      ? "var(--green)"
      : "var(--red)";
    $("lcLoginLink").style.display = loggedIn ? "none" : "inline";
  } catch {
    $("lcStatusText").textContent = "Could not check LeetCode status";
  }
}

// ─── Stats Loader ─────────────────────────────────────────────────────────
async function loadStats() {
  const data = await chrome.storage.local.get([
    "syncedCount", "lastSync", "streakCount"
  ]);
  $("syncedCount").textContent = data.syncedCount || 0;
  $("streakCount").textContent = data.streakCount || 0;
  $("lastSync").textContent    = data.lastSync
    ? formatRelativeTime(data.lastSync)
    : "—";
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

// ─── GitHub Status Pill ───────────────────────────────────────────────────
function setGhStatus(state) {
  // state: "connected" | "disconnected" | "checking"
  const pill = $("ghStatusPill");
  const dot  = $("ghStatusDot");
  const txt  = $("ghStatusText");

  pill.className = `status-pill ${state}`;
  dot.className  = `status-dot${state === "checking" ? " pulse" : ""}`;
  txt.textContent =
    state === "connected"    ? "Connected"    :
    state === "checking"     ? "Checking…"    :
    "Not connected";
}

// ─── Status Message ───────────────────────────────────────────────────────
function showStatus(msg, isError = false) {
  const el = $("statusMsg");
  el.textContent = msg;
  el.style.color = isError ? "var(--red)" : "var(--green)";
}

function clearStatus() {
  $("statusMsg").textContent = "";
}

// ─── Tab Switching ────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  const isToken = tab === "token";

  $("tabToken").classList.toggle("active",  isToken);
  $("tabOauth").classList.toggle("active", !isToken);
  $("patSection").classList.toggle("section-hidden",  !isToken);
  $("oauthSection").classList.toggle("section-hidden", isToken);

  clearStatus();
}

// ─── Input Validation ─────────────────────────────────────────────────────
function validateTokenFormat(token) {
  // GitHub PATs start with ghp_, gho_, or github_pat_
  if (!token) return "Token is required";
  if (
    !token.startsWith("ghp_") &&
    !token.startsWith("gho_") &&
    !token.startsWith("github_pat_")
  ) {
    return "Token should start with ghp_, gho_, or github_pat_";
  }
  if (token.length < 20) return "Token looks too short";
  return null; // valid
}

function validateOwner(owner) {
  if (!owner) return "GitHub username is required";
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,37}[a-zA-Z0-9])?$/.test(owner)) {
    return "Invalid GitHub username (only letters, numbers, hyphens)";
  }
  return null;
}

function validateRepo(repo) {
  if (!repo) return "Repository name is required";
  if (!/^[a-zA-Z0-9._\-]+$/.test(repo)) {
    return "Invalid repository name";
  }
  if (repo.length > 100) return "Repository name too long (max 100 chars)";
  return null;
}

function showFieldError(fieldId, errorId, msg) {
  const input = $(fieldId);
  const errEl = $(errorId);
  if (msg) {
    input.classList.add("error");
    input.classList.remove("valid");
    errEl.textContent = msg;
    errEl.classList.add("visible");
    return false;
  } else {
    input.classList.remove("error");
    input.classList.add("valid");
    errEl.textContent = "";
    errEl.classList.remove("visible");
    return true;
  }
}

// ─── Save Config ──────────────────────────────────────────────────────────
async function saveConfig() {
  const token    = $("token").value.trim();
  const owner    = $("owner").value.trim();
  const repo     = $("repo").value.trim();
  const branch   = $("branch").value.trim() || "main";
  const cfHandle = $("cfHandle").value.trim();
  const displayName = $("displayName").value.trim();
  const leaderboardUrl = $("leaderboardUrl").value.trim();
  const optInLeaderboard = $("optInLeaderboard").checked;

  // Validate
  const tokenErr = validateTokenFormat(token);
  const ownerErr = validateOwner(owner);
  const repoErr  = validateRepo(repo);

  const tokenOk = showFieldError("token", "tokenError", tokenErr);
  const ownerOk = showFieldError("owner", "ownerError", ownerErr);
  const repoOk  = showFieldError("repo",  "repoError",  repoErr);

  if (!tokenOk || !ownerOk || !repoOk) {
    showStatus("Please fix the errors above.", true);
    return;
  }

  const saveBtn = $("saveBtn");
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="spinner"></span> Saving…`;

  await chrome.storage.local.set({
    ghToken: token,
    ghOwner: owner,
    ghRepo: repo,
    ghBranch: branch,
    cfHandle,
    displayName,
    leaderboardUrl,
    optInLeaderboard,
    connMethod: "token"
  });

  // Trigger immediate leaderboard sync to update display name and stats
  chrome.runtime.sendMessage({ type: "FORCE_LEADERBOARD_SYNC" });

  setGhStatus("connected");
  showStatus("✓ Saved! Go solve a problem on LeetCode.");

  saveBtn.disabled = false;
  saveBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    Save Settings`;
}

// ─── Test Connection ──────────────────────────────────────────────────────
async function testConnection() {
  const { ghToken, ghOwner, ghRepo } = await chrome.storage.local.get([
    "ghToken", "ghOwner", "ghRepo"
  ]);

  if (!ghToken || !ghOwner || !ghRepo) {
    showStatus("Please save your configuration first.", true);
    return;
  }

  const btn = $("testBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Testing…`;
  setGhStatus("checking");
  showStatus("Testing connection…");

  try {
    const res = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}`, {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (res.ok) {
      const data = await res.json();
      setGhStatus("connected");
      const visibility = data.private ? "private" : "public";
      showStatus(`✓ Connected to ${ghOwner}/${ghRepo} (${visibility} repo)`);
    } else if (res.status === 404) {
      setGhStatus("disconnected");
      showStatus(`Repository "${ghOwner}/${ghRepo}" not found. Create it on GitHub first.`, true);
    } else if (res.status === 401) {
      setGhStatus("disconnected");
      showStatus("Invalid or expired token. Please create a new one.", true);
    } else if (res.status === 403) {
      setGhStatus("disconnected");
      showStatus("Access denied. Check your token has the 'repo' scope.", true);
    } else {
      setGhStatus("disconnected");
      showStatus(`GitHub error: HTTP ${res.status}`, true);
    }
  } catch (e) {
    setGhStatus("disconnected");
    showStatus(`Network error: ${e.message}`, true);
  }

  btn.disabled = false;
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    Test Connection`;
}

// ─── OAuth Device Flow ────────────────────────────────────────────────────
async function startDeviceFlow() {
  const clientId = $("clientId").value.trim();
  const owner    = $("owner").value.trim();
  const repo     = $("repo").value.trim();
  const branch   = $("branch").value.trim() || "main";
  const cfHandle = $("cfHandle").value.trim();
  const displayName = $("displayName").value.trim();
  const leaderboardUrl = $("leaderboardUrl").value.trim();
  const optInLeaderboard = $("optInLeaderboard").checked;

  if (!clientId) {
    showStatus("Please enter your GitHub OAuth App Client ID.", true);
    return;
  }
  const ownerErr = validateOwner(owner);
  const repoErr  = validateRepo(repo);
  if (ownerErr || repoErr) {
    showStatus("Please fill in valid GitHub username and repository name.", true);
    return;
  }

  // Save config values locally immediately
  await chrome.storage.local.set({
    ghOwner: owner,
    ghRepo: repo,
    ghBranch: branch,
    cfHandle,
    displayName,
    leaderboardUrl,
    optInLeaderboard,
    connMethod: "oauth"
  });

  const btn = $("oauthConnectBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Initiating…`;
  showStatus("Requesting device code from GitHub…");

  try {
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ client_id: clientId, scope: "repo" })
    });

    if (!res.ok) {
      throw new Error(`GitHub responded with HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    const { device_code, user_code, verification_uri, interval, expires_in } = data;

    // Show the user code UI
    $("oauthUserCode").textContent = user_code;
    $("oauthActivation").style.display = "block";
    $("oauthVerifyBtn").onclick = () => window.open(verification_uri, "_blank");

    // Start countdown timer
    startOAuthCountdown(expires_in || 900);

    // Hand off polling to background.js (survives popup close)
    chrome.runtime.sendMessage({
      type: "START_OAUTH_POLL",
      clientId,
      deviceCode: device_code,
      interval: (interval || 5) * 1000,
      ghOwner: owner,
      ghRepo: repo,
      ghBranch: branch
    });

    showStatus("Waiting for GitHub authorization…");
    $("oauthPollStatus").textContent = "Waiting for you to authorize on GitHub…";

  } catch (err) {
    showStatus(err.message, true);
  }

  btn.disabled = false;
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
    </svg>
    Connect with GitHub`;
}

function startOAuthCountdown(seconds) {
  if (oauthCountdownTimer) clearInterval(oauthCountdownTimer);
  let remaining = seconds;
  $("oauthCountdown").textContent = remaining;
  oauthCountdownTimer = setInterval(() => {
    remaining--;
    const el = $("oauthCountdown");
    if (el) el.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(oauthCountdownTimer);
      const activation = $("oauthActivation");
      if (activation) activation.style.display = "none";
    }
  }, 1000);
}

// ─── Log Rendering ────────────────────────────────────────────────────────
async function renderLogs() {
  const { debugLogs = [] } = await chrome.storage.local.get(["debugLogs"]);
  renderLogLines(debugLogs);
}

function renderLogLines(logs) {
  const panel = $("logPanel");
  if (!logs || logs.length === 0) {
    panel.textContent = "No logs yet.";
    return;
  }

  // Color-code by log level
  panel.innerHTML = logs.map(line => {
    const level =
      line.includes("[SUCCESS]") ? "SUCCESS" :
      line.includes("[ERROR]")   ? "ERROR"   :
      line.includes("[WARN]")    ? "WARN"    : "INFO";
    const escaped = line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<span class="log-${level}">${escaped}</span>`;
  }).join("\n");

  // Auto-scroll to bottom
  panel.scrollTop = panel.scrollHeight;
}

// ─── PAT Reveal Toggle ────────────────────────────────────────────────────
function bindRevealToggle() {
  let revealed = false;
  $("revealTokenBtn").addEventListener("click", () => {
    revealed = !revealed;
    $("token").type = revealed ? "text" : "password";
    $("eyeIcon").innerHTML = revealed
      ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  });
}

// ─── Bind All Events ─────────────────────────────────────────────────────
function bindEvents() {
  // Tab switching
  $("tabToken").addEventListener("click", () => {
    switchTab("token");
    chrome.storage.local.set({ connMethod: "token" });
  });
  $("tabOauth").addEventListener("click", () => {
    switchTab("oauth");
    chrome.storage.local.set({ connMethod: "oauth" });
  });

  // Buttons
  $("saveBtn").addEventListener("click", saveConfig);
  $("testBtn").addEventListener("click", testConnection);
  $("oauthConnectBtn").addEventListener("click", startDeviceFlow);

  // Dashboard
  const openDash = () => chrome.runtime.openOptionsPage();
  $("openDashboardBtn").addEventListener("click", openDash);
  $("footerDashboard").addEventListener("click", (e) => { e.preventDefault(); openDash(); });

  // Logs
  $("clearLogsBtn").addEventListener("click", async () => {
    await chrome.storage.local.remove("debugLogs");
    $("logPanel").textContent = "No logs yet.";
  });
  $("copyLogsBtn").addEventListener("click", async () => {
    const { debugLogs = [] } = await chrome.storage.local.get(["debugLogs"]);
    const text = debugLogs.join("\n") || "No logs.";
    await navigator.clipboard.writeText(text).catch(() => {});
    $("copyLogsBtn").textContent = "Copied!";
    setTimeout(() => { $("copyLogsBtn").textContent = "Copy"; }, 1500);
  });

  // Token reveal
  bindRevealToggle();

  // Live input validation on blur
  $("token").addEventListener("blur", () => {
    const v = $("token").value.trim();
    if (v) showFieldError("token", "tokenError", validateTokenFormat(v));
  });
  $("owner").addEventListener("blur", () => {
    const v = $("owner").value.trim();
    if (v) showFieldError("owner", "ownerError", validateOwner(v));
  });
  $("repo").addEventListener("blur", () => {
    const v = $("repo").value.trim();
    if (v) showFieldError("repo", "repoError", validateRepo(v));
  });
}

// ─── Live Storage Listener (stats & logs & OAuth status update) ───────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.syncedCount)
    $("syncedCount").textContent = changes.syncedCount.newValue || 0;

  if (changes.streakCount)
    $("streakCount").textContent = changes.streakCount.newValue || 0;

  if (changes.lastSync)
    $("lastSync").textContent = formatRelativeTime(changes.lastSync.newValue);

  if (changes.debugLogs)
    renderLogLines(changes.debugLogs.newValue || []);

  // OAuth completed in background while popup is still open
  if (changes.oauthStatus) {
    const status = changes.oauthStatus.newValue;
    if (status === "connected") {
      setGhStatus("connected");
      showStatus("✓ Successfully connected via OAuth!", false);
      if ($("oauthActivation")) $("oauthActivation").style.display = "none";
      if (oauthCountdownTimer) clearInterval(oauthCountdownTimer);
      chrome.storage.local.remove("oauthStatus");
      
      // Trigger immediate leaderboard sync to register user with display name
      chrome.runtime.sendMessage({ type: "FORCE_LEADERBOARD_SYNC" });
    } else if (status === "expired") {
      showStatus("OAuth code expired. Please try again.", true);
      if ($("oauthActivation")) $("oauthActivation").style.display = "none";
      chrome.storage.local.remove("oauthStatus");
    } else if (status?.startsWith("error")) {
      showStatus(`OAuth failed: ${status}`, true);
      chrome.storage.local.remove("oauthStatus");
    }
  }
});
