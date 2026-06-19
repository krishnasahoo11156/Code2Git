# Project Documentation: LeetCode → GitHub Auto Sync

This document provides a comprehensive overview of the **LeetCode → GitHub Auto Sync** Chrome extension, detailing its aim, architecture, folder structure, files, source code, and future roadmap.

---

## 1. Project Main Aim

The **LeetCode → GitHub Auto Sync** Chrome extension automatically synchronizes your **Accepted** LeetCode submissions directly to a designated GitHub repository in real time. 

### Why it was built this way (Client-Side Architecture)
LeetCode does not expose a public, official OAuth API for third-party sync integrations. Building a traditional website that acts as a backend proxy would require:
1. Users to hand over their LeetCode session cookies/credentials.
2. A server to store these session keys and perform continuous polling.

This introduces severe security vulnerabilities, data privacy concerns, and violates LeetCode's Terms of Service. 

Instead, this extension runs **entirely client-side inside the user's browser**. By leveraging the user's existing logged-in session, the extension can perform GraphQL queries locally and authenticate to GitHub using a Personal Access Token (PAT) or OAuth Device Flow, ensuring that credentials never leave the user's local machine.

---

## 2. Project Folder Structure

The project directory is structured as a lightweight, non-compiled Google Chrome Extension (Manifest V3):

```text
leetcode-to-github/
├── manifest.json            # Extension metadata, permissions, and script definitions
├── background.js            # Background service worker (intercepts network calls and syncs to GitHub)
├── content.js               # Content script injected into LeetCode problem pages (displays notifications)
├── popup.html               # Frontend HTML structure for the configuration popup
├── popup.js                 # Frontend interaction and OAuth Device Flow logic for the popup
├── PROJECT_DOCUMENTATION.md # Project documentation (this file)
└── icons/                   # Directory containing extension branding and UI assets
    ├── icon16.png           # 16x16 icon for the extension toolbar
    ├── icon48.png           # 48x48 icon for the extensions management page
    └── icon128.png          # 128x128 icon for the Chrome Web Store listing
```

---

## 3. Detailed File Breakdown

Here is a detailed analysis of every file in the project, including its purpose, mechanism, and complete source code.

### 3.1 `manifest.json`
* **File Purpose:** Contains metadata, registers the service worker (`background.js`), configures content script matching for LeetCode problem pages, sets up the popup interface, and requests permissions from Chrome.
* **Permissions Requested:**
  * `storage`: To persist settings like GitHub credentials, repository names, and sync counters locally.
  * `activeTab` / `scripting`: To send message payloads and inject visual styles into the LeetCode tabs.
  * `webRequest`: Observational API to detect when the browser makes network calls to poll submission checks.
  * `cookies`: Used to fetch the LeetCode `csrftoken` cookie to validate requests sent to LeetCode's GraphQL server.
  * `host_permissions`: Explicit domains allowed for cross-origin fetches (`leetcode.com`, `api.github.com`, `github.com`).

#### Complete Code (`manifest.json`):
```json
{
  "manifest_version": 3,
  "name": "LeetCode → GitHub Auto Sync",
  "version": "1.0.0",
  "description": "Automatically push your accepted LeetCode solutions to a GitHub repository.",
  "permissions": ["storage", "activeTab", "scripting", "webRequest", "cookies"],
  "host_permissions": [
    "https://leetcode.com/*",
    "https://api.github.com/*",
    "https://github.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://leetcode.com/problems/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

### 3.2 `background.js`
* **File Purpose:** The background service worker acts as the main execution engine. It listens to network traffic in LeetCode tabs.
* **Mechanism:**
  1. It monitors completed network requests. When it detects LeetCode's polling request `/submissions/detail/<id>/v2/check/`, it extracts the `submissionId`.
  2. It reads the local LeetCode `csrftoken` cookie and performs a local `POST` fetch to `https://leetcode.com/graphql` using the user's active session, retrieving the code, language, problem name, and status.
  3. If the status is `10` (Accepted), it base64-encodes the code and commits it to the user's GitHub repository via a `PUT` request to the GitHub API. It dynamically updates the file if it already exists by querying its `sha` hash beforehand.
  4. It sends a message to the active tab via `chrome.tabs.sendMessage` to trigger a visual success/error toast.

#### Complete Code (`background.js`):
```javascript
// background.js
// Detects LeetCode submission results in-flight and, on Accepted, pushes the
// solution code to the user's configured GitHub repo.

const LANG_EXT = {
  python: "py",
  python3: "py",
  java: "java",
  cpp: "cpp",
  c: "c",
  csharp: "cs",
  javascript: "js",
  typescript: "ts",
  golang: "go",
  go: "go",
  kotlin: "kt",
  swift: "swift",
  rust: "rs",
  ruby: "rb",
  scala: "scala",
  php: "php",
  racket: "rkt",
  erlang: "erl",
  elixir: "ex",
  dart: "dart"
};

const ACCEPTED_STATUS_CODE = 10;

// Track ids we've already processed in-memory (storage backs this across restarts)
let processing = new Set();

async function logDebug(msg) {
  console.log(msg);
  try {
    const { debugLogs = [] } = await chrome.storage.local.get(["debugLogs"]);
    const newLogs = [...debugLogs, `[${new Date().toLocaleTimeString()}] ${msg}`].slice(-100);
    await chrome.storage.local.set({ debugLogs: newLogs });
  } catch (e) {}
}

// Log startup
logDebug("Service Worker started.");

// Observational listener to log ALL completed leetcode.com requests to see what is called!
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Only log if it could be related to submissions or checks
    if (details.url.includes("submit") || details.url.includes("check") || details.url.includes("submissions")) {
      logDebug(`Request seen: ${details.url}`);
    }
    const match = details.url.match(/\/submissions\/detail\/(\d+)\/(?:v2\/)?check\/?/);
    if (match) {
      const submissionId = match[1];
      logDebug(`Submission check matched! ID: ${submissionId}, TabId: ${details.tabId}`);
      handleSubmissionSeen(submissionId, details.tabId);
    }
  },
  { urls: ["https://leetcode.com/*"] }
);

async function handleSubmissionSeen(submissionId, tabId) {
  if (processing.has(submissionId)) {
    logDebug(`Submission ${submissionId} is already processing. Skip.`);
    return;
  }

  const { syncedIds = [] } = await chrome.storage.local.get(["syncedIds"]);
  if (syncedIds.includes(submissionId)) {
    logDebug(`Submission ${submissionId} already synced. Skip.`);
    return;
  }

  logDebug(`Processing submission ID: ${submissionId}`);
  processing.add(submissionId);
  try {
    const details = await fetchSubmissionDetails(submissionId);
    if (!details) {
      logDebug(`Could not fetch details for submission ID ${submissionId}`);
      return;
    }

    logDebug(`Details: status=${details.statusCode}, title=${details.question?.title}, lang=${details.lang?.name}`);

    if (details.statusCode !== ACCEPTED_STATUS_CODE) {
      logDebug(`Submission ${submissionId} not Accepted (statusCode: ${details.statusCode}). Skip.`);
      return;
    }

    logDebug(`Syncing to GitHub...`);
    const result = await pushToGithub(details);
    logDebug(`GitHub Sync result: ok=${result.ok}, message=${result.message}`);

    if (result.ok) {
      const updatedIds = [...syncedIds, submissionId].slice(-500); // cap history
      const { syncedCount = 0 } = await chrome.storage.local.get(["syncedCount"]);
      await chrome.storage.local.set({
        syncedIds: updatedIds,
        syncedCount: syncedCount + 1,
        lastSync: Date.now()
      });
    }

    notifyTab(tabId, {
      type: "SYNC_RESULT",
      ok: result.ok,
      title: details.question?.title,
      message: result.message
    });
  } catch (err) {
    logDebug(`Error processing submission ${submissionId}: ${err.message}`);
    notifyTab(tabId, { type: "SYNC_RESULT", ok: false, message: err.message });
  } finally {
    processing.delete(submissionId);
  }
}

async function getCsrfToken() {
  try {
    const cookie = await chrome.cookies.get({
      url: "https://leetcode.com",
      name: "csrftoken"
    });
    return cookie ? cookie.value : "";
  } catch (err) {
    logDebug(`Error fetching CSRF token cookie: ${err.message}`);
    return "";
  }
}

async function fetchSubmissionDetails(submissionId) {
  const csrfToken = await getCsrfToken();
  logDebug(`Got CSRF token: ${csrfToken ? "Yes (starts with " + csrfToken.substring(0, 5) + ")" : "No"}`);
  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        runtime
        runtimeDisplay
        memory
        memoryDisplay
        code
        timestamp
        statusCode
        lang { name verboseName }
        question { questionId titleSlug title difficulty }
      }
    }
  `;

  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-csrftoken": csrfToken,
      "Referer": "https://leetcode.com"
    },
    body: JSON.stringify({
      query,
      variables: { submissionId: parseInt(submissionId, 10) }
    })
  });

  logDebug(`GraphQL fetch response status: ${res.status}`);
  if (!res.ok) throw new Error(`LeetCode GraphQL error: ${res.status}`);
  const json = await res.json();
  return json?.data?.submissionDetails || null;
}

async function pushToGithub(details) {
  const cfg = await chrome.storage.local.get([
    "ghToken", "ghOwner", "ghRepo", "ghBranch"
  ]);
  if (!cfg.ghToken || !cfg.ghOwner || !cfg.ghRepo) {
    return { ok: false, message: "GitHub not configured. Open the extension popup." };
  }
  const branch = cfg.ghBranch || "main";

  const ext = LANG_EXT[details.lang?.name] || "txt";
  const difficulty = details.question?.difficulty || "Unknown";
  const slug = details.question?.titleSlug || `submission-${Date.now()}`;
  const path = `${difficulty}/${slug}/Solution.${ext}`;

  const apiBase = `https://api.github.com/repos/${cfg.ghOwner}/${cfg.ghRepo}/contents/${encodeURI(path)}`;
  const headers = {
    Authorization: `Bearer ${cfg.ghToken}`,
    Accept: "application/vnd.github+json"
  };

  logDebug(`Checking if file already exists in GitHub...`);
  // Check if file already exists (need sha to update vs create)
  let sha;
  try {
    const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers });
    logDebug(`GitHub GET file response status: ${getRes.status}`);
    if (getRes.ok) {
      const getJson = await getRes.json();
      sha = getJson.sha;
      logDebug(`File exists, SHA: ${sha}`);
    }
  } catch (err) {
    logDebug(`Error checking file existence: ${err.message}`);
  }

  const content = btoa(unescape(encodeURIComponent(details.code)));
  const commitMessage = `Add solution: ${details.question?.questionId}. ${details.question?.title} (${details.lang?.verboseName})`;

  logDebug(`Writing file content to GitHub...`);
  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMessage,
      content,
      branch,
      ...(sha ? { sha } : {})
    })
  });

  logDebug(`GitHub PUT file response status: ${putRes.status}`);
  if (!putRes.ok) {
    const errJson = await putRes.json().catch(() => ({}));
    return { ok: false, message: errJson.message || `GitHub push failed (${putRes.status})` };
  }

  return { ok: true, message: `Pushed to ${cfg.ghRepo}/${path}` };
}

function notifyTab(tabId, payload) {
  if (!tabId || tabId < 0) {
    logDebug(`No valid tabId to notify (${tabId})`);
    return;
  }
  logDebug(`Notifying tab ${tabId} with result...`);
  chrome.tabs.sendMessage(tabId, payload).catch((err) => {
    logDebug(`Failed to notify tab: ${err.message}`);
  });
}
```

---

### 3.3 `content.js`
* **File Purpose:** Injected into LeetCode tabs matching `https://leetcode.com/problems/*`. It listens for messages sent by the background service worker and renders a beautiful, auto-dismissing HTML toast notification showing whether the solution was successfully pushed to GitHub.

#### Complete Code (`content.js`):
```javascript
// content.js
// Shows a small toast on the LeetCode page confirming a GitHub sync.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "SYNC_RESULT") return;
  showToast(msg);
});

function showToast({ ok, title, message }) {
  const existing = document.getElementById("lc-gh-sync-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "lc-gh-sync-toast";
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999999;
    background: ${ok ? "#1f6f3f" : "#7a1f1f"};
    color: #fff;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.3);
    max-width: 320px;
    line-height: 1.4;
    transition: opacity 0.4s ease;
  `;
  toast.innerHTML = ok
    ? `<strong>✓ Synced to GitHub</strong><br>${title ? title + "<br>" : ""}${message || ""}`
    : `<strong>✗ Sync failed</strong><br>${message || ""}`;

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
```

---

### 3.4 `popup.html`
* **File Purpose:** HTML layout of the extension's configure card. Features connection tabs (Token vs OAuth), configuration fields (Username, Repo Name, Branch), live synchronization counters, connection status indications, and a live scrollable Debug Log viewport at the bottom.

#### Complete Code (`popup.html`):
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>LeetCode → GitHub Sync</title>
  <style>
    * { box-sizing: border-box; }
    body {
      width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 16px;
      background: #0f1115;
      color: #e6e6e6;
    }
    h1 {
      font-size: 15px;
      font-weight: 600;
      margin: 0 0 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h1 .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #555;
    }
    h1 .dot.connected { background: #3fb950; }
    label {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #9aa0a6;
      margin: 12px 0 4px;
    }
    input {
      width: 100%;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid #2a2d34;
      background: #1a1d23;
      color: #e6e6e6;
      font-size: 13px;
      outline: none;
    }
    input:focus { border-color: #3f7bf5; }
    button {
      width: 100%;
      margin-top: 16px;
      padding: 10px;
      border: none;
      border-radius: 6px;
      background: #3f7bf5;
      color: white;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #336fe0; }
    button.secondary {
      background: transparent;
      border: 1px solid #2a2d34;
      color: #9aa0a6;
      margin-top: 8px;
    }
    #status {
      margin-top: 12px;
      font-size: 12px;
      color: #9aa0a6;
      min-height: 16px;
    }
    .stats {
      display: flex;
      justify-content: space-between;
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid #2a2d34;
    }
    .stat { text-align: center; flex: 1; }
    .stat .num { font-size: 18px; font-weight: 700; color: #3f7bf5; }
    .stat .label { font-size: 10px; color: #9aa0a6; margin-top: 2px; }
    .hint { font-size: 11px; color: #6b7280; margin-top: 4px; line-height: 1.4; }
    a { color: #3f7bf5; text-decoration: none; }
  </style>
</head>
<body>
  <h1><span class="dot" id="statusDot"></span> LeetCode → GitHub</h1>

  <!-- Connection Method Tabs -->
  <div style="display: flex; gap: 8px; margin-bottom: 12px; border-bottom: 1px solid #2a2d34; padding-bottom: 8px;">
    <button id="tabToken" style="flex: 1; margin: 0; padding: 6px; font-size: 11px; background: #3f7bf5; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: 600; outline: none;">Token (PAT)</button>
    <button id="tabOauth" style="flex: 1; margin: 0; padding: 6px; font-size: 11px; background: transparent; border: 1px solid #2a2d34; border-radius: 4px; color: #9aa0a6; cursor: pointer; font-weight: 600; outline: none;">OAuth (Device)</button>
  </div>

  <!-- PAT Connection Section -->
  <div id="patSection">
    <label for="token">GitHub Personal Access Token</label>
    <input id="token" type="password" placeholder="ghp_..." />
    <div class="hint">Needs <code>repo</code> scope. <a href="https://github.com/settings/tokens/new?scopes=repo&description=LeetCode-Sync" target="_blank">Create one here</a></div>
  </div>

  <!-- OAuth Connection Section -->
  <div id="oauthSection" style="display: none;">
    <label for="clientId">GitHub Client ID</label>
    <input id="clientId" type="text" placeholder="e.g. Ov23wp..." />
    <div class="hint">Enable Device Flow in your GitHub OAuth App settings.</div>

    <!-- OAuth Activation UI (Hidden initially) -->
    <div id="oauthActivation" style="display: none; background: #1a1d23; border: 1px solid #2a2d34; border-radius: 6px; padding: 12px; margin-top: 12px; text-align: center;">
      <div style="font-size: 11px; text-transform: uppercase; color: #9aa0a6; margin-bottom: 4px;">Activation Code</div>
      <div id="oauthUserCode" style="font-size: 20px; font-weight: 700; color: #3f7bf5; letter-spacing: 0.05em; margin: 8px 0; font-family: monospace;">-----</div>
      <div class="hint" style="margin-bottom: 10px;">Click the button below and enter this code to authorize the app.</div>
      <button id="oauthVerifyBtn" style="margin: 0; padding: 8px; width: auto; display: inline-block;">Authorize on GitHub</button>
    </div>

    <button id="oauthConnectBtn">Connect with GitHub</button>
  </div>

  <!-- Shared Configuration -->
  <div id="sharedConfig">
    <label for="owner">GitHub Username / Org</label>
    <input id="owner" type="text" placeholder="your-username" />

    <label for="repo">Repository Name</label>
    <input id="repo" type="text" placeholder="leetcode-solutions" />

    <label for="branch">Branch</label>
    <input id="branch" type="text" placeholder="main" value="main" />

    <button id="save">Save Settings</button>
  </div>

  <button id="testBtn" class="secondary" style="margin-top: 8px;">Test Connection</button>

  <div id="status"></div>

  <div class="stats">
    <div class="stat">
      <div class="num" id="syncedCount">0</div>
      <div class="label">Synced</div>
    </div>
    <div class="stat">
      <div class="num" id="lastSync">—</div>
      <div class="label">Last Sync</div>
    </div>
  </div>

  <div style="margin-top: 16px; border-top: 1px solid #2a2d34; padding-top: 10px;">
    <div style="font-size: 11px; text-transform: uppercase; color: #9aa0a6; display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
      <span>Debug Logs</span>
      <a href="#" id="clearLogs" style="font-size: 10px; color: #f85149; text-decoration: none;">Clear Logs</a>
    </div>
    <div id="logs" style="font-size: 10px; font-family: monospace; background: #1a1d23; padding: 6px 10px; border-radius: 4px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; color: #c9d1d9; border: 1px solid #2a2d34; line-height: 1.4;">No logs yet.</div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

---

### 3.5 `popup.js`
* **File Purpose:** Contains all interaction code for the configuration popup. Handles connection mode tabs (token/oauth), loading/saving details to `chrome.storage.local`, testing repository connections via the GitHub API, and implementing the **GitHub OAuth Device Flow** (which allows tokenless authorization by generating user verification codes and polling GitHub for authorization status).

#### Complete Code (`popup.js`):
```javascript
// popup.js
const $ = (id) => document.getElementById(id);

let pollIntervalId = null;

// Load and restore configuration when popup opens
async function loadConfig() {
  const data = await chrome.storage.local.get([
    "ghToken", "ghOwner", "ghRepo", "ghBranch", "syncedCount", "lastSync", "connMethod", "clientId"
  ]);

  if (data.ghToken) $("token").value = data.ghToken;
  if (data.ghOwner) $("owner").value = data.ghOwner;
  if (data.ghRepo) $("repo").value = data.ghRepo;
  if (data.ghBranch) $("branch").value = data.ghBranch;
  if (data.clientId) $("clientId").value = data.clientId;

  $("syncedCount").textContent = data.syncedCount || 0;
  $("lastSync").textContent = data.lastSync
    ? new Date(data.lastSync).toLocaleDateString()
    : "—";

  // Restore connection method tab selection
  const method = data.connMethod || "token";
  switchTab(method);

  setStatusDot(!!(data.ghToken && data.ghOwner && data.ghRepo));
}

function setStatusDot(connected) {
  $("statusDot").classList.toggle("connected", connected);
}

function showStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").style.color = isError ? "#f85149" : "#3fb950";
}

// Switch Connection Method Tabs
function switchTab(method) {
  if (method === "token") {
    $("tabToken").style.background = "#3f7bf5";
    $("tabToken").style.color = "white";
    $("tabToken").style.border = "none";

    $("tabOauth").style.background = "transparent";
    $("tabOauth").style.color = "#9aa0a6";
    $("tabOauth").style.border = "1px solid #2a2d34";

    $("patSection").style.display = "block";
    $("oauthSection").style.display = "none";
  } else {
    $("tabOauth").style.background = "#3f7bf5";
    $("tabOauth").style.color = "white";
    $("tabOauth").style.border = "none";

    $("tabToken").style.background = "transparent";
    $("tabToken").style.color = "#9aa0a6";
    $("tabToken").style.border = "1px solid #2a2d34";

    $("oauthSection").style.display = "block";
    $("patSection").style.display = "none";
  }
}

// Switch tabs on click
$("tabToken").addEventListener("click", () => {
  switchTab("token");
  chrome.storage.local.set({ connMethod: "token" });
  stopPolling();
  $("oauthActivation").style.display = "none";
});

$("tabOauth").addEventListener("click", () => {
  switchTab("oauth");
  chrome.storage.local.set({ connMethod: "oauth" });
});

// Save direct Personal Access Token Configuration
async function saveConfig() {
  const ghToken = $("token").value.trim();
  const ghOwner = $("owner").value.trim();
  const ghRepo = $("repo").value.trim();
  const ghBranch = $("branch").value.trim() || "main";

  if (!ghToken || !ghOwner || !ghRepo) {
    showStatus("Please fill in token, owner, and repo.", true);
    return;
  }

  await chrome.storage.local.set({ ghToken, ghOwner, ghRepo, ghBranch, connMethod: "token" });
  setStatusDot(true);
  showStatus("Saved. Go solve a problem on LeetCode!");
}

// GitHub OAuth Device Flow connection flow
async function startDeviceFlow() {
  const clientId = $("clientId").value.trim();
  const ghOwner = $("owner").value.trim();
  const ghRepo = $("repo").value.trim();
  const ghBranch = $("branch").value.trim() || "main";

  if (!clientId || !ghOwner || !ghRepo) {
    showStatus("Please fill in Client ID, owner, and repo first.", true);
    return;
  }

  showStatus("Initiating connection...");
  stopPolling();

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
      throw new Error(`Device flow code request failed: ${res.status}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    const { device_code, user_code, verification_uri, interval } = data;

    // Show User Code & activate authorization components
    $("oauthUserCode").textContent = user_code;
    $("oauthActivation").style.display = "block";
    showStatus("Please authorize the device on GitHub.");

    // Setup Verify button to open link
    const openVerifyPage = () => {
      window.open(verification_uri, "_blank");
    };
    $("oauthVerifyBtn").onclick = openVerifyPage;

    // Start Polling for OAuth access token
    let pollInterval = (interval || 5) * 1000;
    pollForToken(clientId, device_code, pollInterval, ghOwner, ghRepo, ghBranch);

  } catch (err) {
    showStatus(err.message, true);
  }
}

function pollForToken(clientId, deviceCode, interval, ghOwner, ghRepo, ghBranch) {
  pollIntervalId = setInterval(async () => {
    try {
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        })
      });

      if (!res.ok) return; // Retry on next cycle

      const data = await res.json();
      if (data.error) {
        if (data.error === "authorization_pending") {
          return; // Still waiting for authorization
        } else if (data.error === "slow_down") {
          // Double the interval as requested
          stopPolling();
          pollForToken(clientId, deviceCode, interval * 2, ghOwner, ghRepo, ghBranch);
          return;
        } else if (data.error === "expired_token") {
          showStatus("Code expired. Please request a new code.", true);
          stopPolling();
          $("oauthActivation").style.display = "none";
          return;
        } else {
          showStatus(`OAuth error: ${data.error_description || data.error}`, true);
          stopPolling();
          return;
        }
      }

      if (data.access_token) {
        // Success: Store access token, close polling, hide code card
        stopPolling();
        $("oauthActivation").style.display = "none";

        await chrome.storage.local.set({
          ghToken: data.access_token,
          ghOwner,
          ghRepo,
          ghBranch,
          clientId,
          connMethod: "oauth"
        });

        setStatusDot(true);
        showStatus("✓ Successfully connected to GitHub!");
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, interval);
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

// Clean up polling if popup closes/unloads
window.addEventListener("unload", stopPolling);

async function testConnection() {
  const { ghToken, ghOwner, ghRepo } = await chrome.storage.local.get([
    "ghToken", "ghOwner", "ghRepo"
  ]);
  if (!ghToken || !ghOwner || !ghRepo) {
    showStatus("Configure and connect your account first.", true);
    return;
  }
  showStatus("Testing connection...");
  try {
    const res = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}`, {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (res.ok) {
      showStatus("✓ Connected to repository successfully.");
      setStatusDot(true);
    } else if (res.status === 404) {
      showStatus("Repo not found. Check owner/repo name, or create it first.", true);
    } else if (res.status === 401) {
      showStatus("Invalid token.", true);
    } else {
      showStatus(`GitHub error: ${res.status}`, true);
    }
  } catch (e) {
    showStatus("Network error: " + e.message, true);
  }
}

$("save").addEventListener("click", saveConfig);
$("oauthConnectBtn").addEventListener("click", startDeviceFlow);
$("testBtn").addEventListener("click", testConnection);

loadConfig();

async function updateLogs() {
  const data = await chrome.storage.local.get(["debugLogs"]);
  $("logs").textContent = (data.debugLogs || []).join("\n") || "No logs yet.";
}
updateLogs();

$("clearLogs").addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.storage.local.remove("debugLogs");
  $("logs").textContent = "No logs yet.";
});

// Keep stats and logs live if popup stays open while a sync happens
chrome.storage.onChanged.addListener((changes) => {
  if (changes.syncedCount) $("syncedCount").textContent = changes.syncedCount.newValue;
  if (changes.lastSync) $("lastSync").textContent = new Date(changes.lastSync.newValue).toLocaleDateString();
  if (changes.debugLogs) $("logs").textContent = (changes.debugLogs.newValue || []).join("\n") || "No logs yet.";
});
```

---

## 4. Future Roadmap & Feature Implementation Guidelines

This section describes how we can implement the proposed future features of this project.

### 4.1 Syncing History & Dashboard Pages
#### Goal:
Provide users with an interactive, rich UI dashboard showing their sync histories, commit success rates, and basic charts.

#### How to Implement:
1. **Create an Options Page:**
   Add an `"options_page": "dashboard.html"` or `"options_ui": { "page": "dashboard.html" }` entry in `manifest.json`.
2. **Track detailed sync history in local storage:**
   Update `background.js` when a sync succeeds:
   ```javascript
   const { syncHistory = [] } = await chrome.storage.local.get(["syncHistory"]);
   const logEntry = {
     id: submissionId,
     title: details.question.title,
     slug: details.question.titleSlug,
     lang: details.lang.verboseName,
     difficulty: details.question.difficulty,
     timestamp: Date.now()
   };
   await chrome.storage.local.set({ syncHistory: [logEntry, ...syncHistory].slice(0, 100) });
   ```
3. **Build the dashboard UI (`dashboard.html`):**
   Create a responsive grid containing:
   - A list of recent synchronized problems with clickable GitHub commit links.
   - Dynamic charts (using Chart.js UMD from a CDN) showing languages used and difficulty distribution (Easy/Medium/Hard).
   - Stats blocks showing total commits, streak counts, and last sync times.

---

### 4.2 Auto-Generation of `README.md`
#### Goal:
For every synchronized solution, automatically generate a `README.md` file in the problem's directory on GitHub containing the question statement, constraints, approach notes, and complexity metrics.

#### How to Implement:
1. **Retrieve the Problem Description:**
   Modify the GraphQL query `submissionDetails` in `background.js` to also query the question description, or execute a secondary GraphQL query `questionContent` using the `titleSlug`:
   ```graphql
   query questionContent($titleSlug: String!) {
     question(titleSlug: $titleSlug) {
       content
       mysqlSchemas
     }
   }
   ```
2. **Format as Markdown:**
   Inside `background.js`, parse the retrieved HTML content using basic string replacement or a regex parser to clean up LeetCode's HTML tags into clean, human-readable GitHub Flavored Markdown (GFM).
3. **Commit the README:**
   During the sync process in `pushToGithub(details)`:
   - Perform a secondary `PUT` request to write the parsed problem statement to `${difficulty}/${slug}/README.md`.
   - Ensure the commit message is structured: `Add README: ${details.question.title}`.

---

### 4.3 Multi-Platform Support (Codeforces, GeeksforGeeks, etc.)
#### Goal:
Expand the extension to intercept submissions and sync code from platforms other than LeetCode.

#### How to Implement:
1. **Broaden Host Permissions:**
   Update `manifest.json` `host_permissions` to include:
   - `*://codeforces.com/*`
   - `*://*.geeksforgeeks.org/*`
2. **Register Multi-Platform Listeners:**
   In `background.js`, add `chrome.webRequest.onCompleted` listeners targeting the specific endpoint structures of these platforms:
   - **Codeforces:** Listen to requests containing `/data/submit` or poll requests to `/api/user.status` showing recent submissions.
   - **GeeksforGeeks:** Listen to requests targeting `https://practiceapi.geeksforgeeks.org/api/v1/submissions/` or similar.
3. **Unify the Push Engine:**
   Abstract the `pushToGithub` function in `background.js` to accept a unified `SubmissionObject` containing:
   ```json
   {
     "platform": "Codeforces",
     "title": "Watermelon",
     "slug": "4A",
     "code": "...",
     "lang": "cpp",
     "difficulty": "Easy"
   }
   ```
   Modify the output directory mapping on GitHub to include a root-level folder for the platform (e.g. `Codeforces/Easy/4A-watermelon/Solution.cpp`).

---

### 4.4 Streak Tracking and Leaderboard (Gamification)
#### Goal:
Increase user engagement by showing their daily streak and introducing a competitive leaderboard (e.g. for members of a coding club like AlgoMinds).

#### How to Implement:
1. **Streak Logic (Popup/Service Worker):**
   Track a `streakCount` in local storage. On every startup or sync, check the date difference:
   - If the last sync date was yesterday: increment `streakCount`.
   - If the last sync date was today: do nothing.
   - If the last sync date was more than 1 day ago: reset `streakCount` to 1.
2. **Shared Leaderboard Backend (Dual System):**
   - **Default Global Leaderboard:** Points to the shared default Firebase Realtime Database URL: `https://code2git-leaderboard-default-rtdb.firebaseio.com`.
   - **Private Club Leaderboards:** Users can configure a custom Firebase Realtime Database URL in the settings popup to create a private league.
   - **REST Syncing Algorithm:**
     - Whenever a problem is successfully synchronized or connection settings are saved, the extension checks `optInLeaderboard` setting.
     - If enabled, it compiles a user profile JSON payload:
       ```json
       {
         "username": "krishnasahoo11156",
         "displayName": "Krish",
         "syncedCount": 3,
         "streakCount": 1,
         "lastSync": 1781913167000,
         "avatarUrl": "https://github.com/krishnasahoo11156.png"
       }
       ```
     - It PUTs the payload to the Global database: `https://code2git-leaderboard-default-rtdb.firebaseio.com/leaderboard/<github_username>.json`.
     - If a custom `leaderboardUrl` is configured, it also PUTs the payload to that custom URL: `<custom_leaderboard_url>/leaderboard/<github_username>.json`.
3. **Display Leaderboard in Dashboard:**
   - In the extension Options/Dashboard page, fetch and display the leaderboard rankings in a sleek table.
   - If a custom database URL is configured, a filter toggle bar ("🌐 Global" / "👥 My Club") is displayed to switch between the shared global rankings and private club rankings in real-time.
   - User profiles are sorted dynamically: first by total solved solutions (`syncedCount` descending), and second by current streak (`streakCount` descending).

