// background.js — Service Worker (Manifest V3)
// The core engine of LeetCode → GitHub Auto Sync.
// Detects accepted LeetCode submissions and pushes code to GitHub.
//
// KEY FIXES over the documentation baseline:
//  1. Uses chrome.storage.session for deduplication (survives SW restarts)
//  2. TextEncoder-based base64 encoding (handles Unicode code safely)
//  3. Zero-padded question ID in file path (e.g. 0001-two-sum)
//  4. Branch existence check + auto-creation
//  5. GitHub rate-limit detection
//  6. Retry queue via chrome.alarms for network failures
//  7. OAuth Device Flow polling moved HERE (so it survives popup close)
//  8. Rich commit messages with runtime + memory stats
//  9. Sync history stored for the dashboard page
// 10. notifyTab falls back to scripting.executeScript if content script is missing
// 11. Native browser notification on sync
// 12. Badge text on extension icon

// ─── Language Extension Map ────────────────────────────────────────────────
const LANG_EXT = {
  python:       "py",
  python3:      "py",
  java:         "java",
  cpp:          "cpp",
  c:            "c",
  csharp:       "cs",
  javascript:   "js",
  typescript:   "ts",
  golang:       "go",
  go:           "go",
  kotlin:       "kt",
  swift:        "swift",
  rust:         "rs",
  ruby:         "rb",
  scala:        "scala",
  php:          "php",
  racket:       "rkt",
  erlang:       "erl",
  elixir:       "ex",
  dart:         "dart",
  // Additional languages
  mysql:        "sql",
  mssql:        "sql",
  oraclesql:    "sql",
  bash:         "sh",
  pandas:       "py",
  pythondata:   "py",
};

const ACCEPTED_STATUS_CODE = 10;

// ─── Structured Logging ────────────────────────────────────────────────────
const LOG_LEVEL = { INFO: "INFO", WARN: "WARN", ERROR: "ERROR", SUCCESS: "SUCCESS" };

async function logDebug(msg, level = LOG_LEVEL.INFO) {
  const entry = `[${new Date().toLocaleTimeString()}][${level}] ${msg}`;
  console.log(entry);
  try {
    const { debugLogs = [] } = await chrome.storage.local.get(["debugLogs"]);
    const newLogs = [...debugLogs, entry].slice(-100);
    await chrome.storage.local.set({ debugLogs: newLogs });
  } catch (_) {}
}

logDebug("Service Worker started.");

// ─── Deduplication via chrome.storage.session ──────────────────────────────
// chrome.storage.session persists across SW restarts within the same browser
// session, unlike an in-memory Set which is wiped whenever Chrome kills the SW.

async function isProcessing(submissionId) {
  try {
    const { processingIds = [] } = await chrome.storage.session.get(["processingIds"]);
    return processingIds.includes(submissionId);
  } catch (_) { return false; }
}

async function markProcessing(submissionId) {
  try {
    const { processingIds = [] } = await chrome.storage.session.get(["processingIds"]);
    await chrome.storage.session.set({
      processingIds: [...processingIds, submissionId]
    });
  } catch (_) {}
}

async function unmarkProcessing(submissionId) {
  try {
    const { processingIds = [] } = await chrome.storage.session.get(["processingIds"]);
    await chrome.storage.session.set({
      processingIds: processingIds.filter(id => id !== submissionId)
    });
  } catch (_) {}
}

// ─── WebRequest Listener ───────────────────────────────────────────────────
// Watches ALL completed leetcode.com requests.
// Matches submission check URLs and triggers the sync pipeline.
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Broad log for debugging URL pattern changes
    if (
      details.url.includes("submit") ||
      details.url.includes("check") ||
      details.url.includes("submissions")
    ) {
      logDebug(`Request seen: ${details.url}`);
    }

    // Match both v1 and v2 check endpoints
    const match = details.url.match(
      /\/submissions\/detail\/(\d+)\/(?:v2\/)?check\/?/
    );
    if (match) {
      const submissionId = match[1];
      logDebug(
        `Submission check matched! ID: ${submissionId}, TabId: ${details.tabId}`
      );
      handleSubmissionSeen(submissionId, details.tabId);
    }
  },
  { urls: ["https://leetcode.com/*"] }
);

// ─── Main Sync Pipeline ────────────────────────────────────────────────────
async function handleSubmissionSeen(submissionId, tabId) {
  // ① Deduplication
  if (await isProcessing(submissionId)) {
    logDebug(`Submission ${submissionId} is already processing. Skip.`);
    return;
  }
  const { syncedIds = [] } = await chrome.storage.local.get(["syncedIds"]);
  if (syncedIds.includes(submissionId)) {
    logDebug(`Submission ${submissionId} already synced. Skip.`);
    return;
  }

  logDebug(`Processing submission ID: ${submissionId}`);
  await markProcessing(submissionId);

  try {
    // ② Fetch submission details from LeetCode's GraphQL API
    const details = await fetchSubmissionDetails(submissionId);
    if (!details) {
      logDebug(
        `Could not fetch details for submission ${submissionId}.`,
        LOG_LEVEL.WARN
      );
      return;
    }

    logDebug(
      `Details: statusCode=${details.statusCode}, title=${details.question?.title}, lang=${details.lang?.name}`,
      LOG_LEVEL.INFO
    );

    // ③ Only proceed for Accepted submissions (status 10)
    if (details.statusCode !== ACCEPTED_STATUS_CODE) {
      logDebug(
        `Submission ${submissionId} not Accepted (code: ${details.statusCode}). Skip.`
      );
      return;
    }

    // ④ Push to GitHub
    logDebug("Syncing to GitHub...");
    const result = await pushToGithub(details, submissionId);
    logDebug(
      `GitHub Sync result: ok=${result.ok}, message=${result.message}`,
      result.ok ? LOG_LEVEL.SUCCESS : LOG_LEVEL.ERROR
    );

    if (result.ok) {
      // ⑤ Update persistent sync state
      const updatedIds = [...syncedIds, submissionId].slice(-500);
      const { syncedCount = 0 } = await chrome.storage.local.get(["syncedCount"]);
      await chrome.storage.local.set({
        syncedIds: updatedIds,
        syncedCount: syncedCount + 1,
        lastSync: Date.now()
      });

      // ⑥ Update streak
      await updateStreak();

      // ⑦ Update extension badge
      chrome.action.setBadgeText({ text: String(syncedCount + 1) });
      chrome.action.setBadgeBackgroundColor({ color: "#3fb950" });

      // ⑧ Store rich history entry for the dashboard
      await appendToSyncHistory({
        submissionId,
        questionId: details.question?.questionId,
        title: details.question?.title,
        titleSlug: details.question?.titleSlug,
        difficulty: details.question?.difficulty,
        lang: details.lang?.verboseName,
        runtime: details.runtimeDisplay,
        memory: details.memoryDisplay,
        githubPath: result.githubPath,
        timestamp: Date.now()
      });

      // ⑨ Native browser notification
      chrome.notifications.create(`sync-${submissionId}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "✅ LeetCode → GitHub Synced!",
        message: `${details.question?.title || "Solution"} pushed successfully.`,
        contextMessage: `${details.question?.difficulty || ""} | ${details.lang?.verboseName || ""}`
      });
    } else if (result.retryable) {
      // ⑩ Schedule retry for transient network failures
      await scheduleRetry(submissionId, tabId);
    }

    // ⑪ Notify the LeetCode tab with a toast
    await notifyTab(tabId, {
      type: "SYNC_RESULT",
      ok: result.ok,
      title: details.question?.title,
      difficulty: details.question?.difficulty,
      lang: details.lang?.verboseName,
      message: result.message
    });

  } catch (err) {
    logDebug(`Error processing submission ${submissionId}: ${err.message}`, LOG_LEVEL.ERROR);
    await notifyTab(tabId, {
      type: "SYNC_RESULT",
      ok: false,
      message: `Extension error: ${err.message}`
    });
  } finally {
    await unmarkProcessing(submissionId);
  }
}

// ─── LeetCode CSRF Token ───────────────────────────────────────────────────
async function getCsrfToken() {
  try {
    const cookie = await chrome.cookies.get({
      url: "https://leetcode.com",
      name: "csrftoken"
    });
    if (!cookie || !cookie.value) {
      logDebug("CSRF token cookie not found. Is the user logged in to LeetCode?", LOG_LEVEL.WARN);
      return "";
    }
    logDebug(`Got CSRF token (starts with ${cookie.value.substring(0, 5)})`);
    return cookie.value;
  } catch (err) {
    logDebug(`Error fetching CSRF token: ${err.message}`, LOG_LEVEL.ERROR);
    return "";
  }
}

// ─── LeetCode GraphQL Fetch ────────────────────────────────────────────────
async function fetchSubmissionDetails(submissionId) {
  const csrfToken = await getCsrfToken();

  if (!csrfToken) {
    throw new Error(
      "Not logged in to LeetCode. Please log in to LeetCode and try again."
    );
  }

  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        runtime
        runtimeDisplay
        runtimePercentile
        memory
        memoryDisplay
        memoryPercentile
        code
        timestamp
        statusCode
        lang { name verboseName }
        question {
          questionId
          titleSlug
          title
          difficulty
        }
      }
    }
  `;

  let res;
  try {
    res = await fetch("https://leetcode.com/graphql", {
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
  } catch (networkErr) {
    throw new Error(`Network error reaching LeetCode: ${networkErr.message}`);
  }

  logDebug(`GraphQL response status: ${res.status}`);

  if (res.status === 403) {
    throw new Error("LeetCode returned 403. Please log in to LeetCode and try again.");
  }
  if (res.status === 429) {
    throw new Error("LeetCode rate-limited the request. Please wait a moment.");
  }
  if (!res.ok) {
    throw new Error(`LeetCode GraphQL error: HTTP ${res.status}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    const errMsg = json.errors.map(e => e.message).join("; ");
    throw new Error(`LeetCode GraphQL returned errors: ${errMsg}`);
  }

  return json?.data?.submissionDetails || null;
}

// ─── Unicode-safe Base64 Encoding ─────────────────────────────────────────
// btoa() only handles Latin-1. Code with Unicode chars (comments, strings)
// will throw a DOMException. TextEncoder handles ALL Unicode safely.
function codeToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── GitHub Push ───────────────────────────────────────────────────────────
async function pushToGithub(details, submissionId) {
  const cfg = await chrome.storage.local.get([
    "ghToken", "ghOwner", "ghRepo", "ghBranch"
  ]);

  if (!cfg.ghToken || !cfg.ghOwner || !cfg.ghRepo) {
    return {
      ok: false,
      retryable: false,
      message: "GitHub not configured. Open the extension popup to set up your repository."
    };
  }

  if (!details.code) {
    logDebug("Submission has no code field — cannot push.", LOG_LEVEL.WARN);
    return { ok: false, retryable: false, message: "No code returned by LeetCode." };
  }

  const branch = cfg.ghBranch || "main";
  const ext = LANG_EXT[details.lang?.name?.toLowerCase()] || "txt";

  // Build a human-friendly path: Easy/0001-two-sum/Solution.py
  const difficulty = (details.question?.difficulty || "Unknown").replace(/[^a-zA-Z0-9]/g, "");
  const slug = details.question?.titleSlug || `submission-${submissionId}`;
  const questionId = String(details.question?.questionId || "0").padStart(4, "0");
  const filePath = `${difficulty}/${questionId}-${slug}/Solution.${ext}`;

  const apiBase = `https://api.github.com/repos/${cfg.ghOwner}/${cfg.ghRepo}`;
  const fileApiUrl = `${apiBase}/contents/${encodeURI(filePath)}`;

  const headers = {
    Authorization: `Bearer ${cfg.ghToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  // ① Validate token & repo access
  try {
    const repoCheck = await fetch(apiBase, { headers });
    if (repoCheck.status === 401) {
      return {
        ok: false,
        retryable: false,
        message: "GitHub token is invalid or expired. Please reconnect in the popup."
      };
    }
    if (repoCheck.status === 404) {
      return {
        ok: false,
        retryable: false,
        message: `Repository "${cfg.ghOwner}/${cfg.ghRepo}" not found. Please create it first or check the name.`
      };
    }
    if (repoCheck.status === 403) {
      return {
        ok: false,
        retryable: false,
        message: "No write access to this repository. Check your token's 'repo' scope."
      };
    }
  } catch (netErr) {
    return {
      ok: false,
      retryable: true,
      message: `Network error reaching GitHub: ${netErr.message}`
    };
  }

  // ② Ensure the target branch exists (auto-create from default if missing)
  await ensureBranchExists(headers, apiBase, branch);

  // ③ Check if the file already exists (need its SHA to update it)
  let existingSha;
  try {
    const getRes = await fetch(`${fileApiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    logDebug(`GitHub GET file status: ${getRes.status}`);
    if (getRes.status === 200) {
      const getJson = await getRes.json();
      existingSha = getJson.sha;
      logDebug(`File exists on GitHub. SHA: ${existingSha}`);
    } else if (getRes.status === 404) {
      logDebug("File does not exist yet — will create.");
    } else if (getRes.status === 401 || getRes.status === 403) {
      return {
        ok: false,
        retryable: false,
        message: `GitHub auth error (${getRes.status}) when checking file.`
      };
    }
  } catch (err) {
    logDebug(`Error checking file existence: ${err.message}`, LOG_LEVEL.WARN);
    // Non-fatal — attempt the PUT anyway
  }

  // ④ Build enriched commit message
  const title = details.question?.title || slug;
  const langName = details.lang?.verboseName || ext;
  let commitMessage = `✅ [${difficulty}] #${questionId} - ${title} | ${langName}`;
  if (details.runtimeDisplay) commitMessage += ` | Runtime: ${details.runtimeDisplay}`;
  if (details.memoryDisplay)  commitMessage += ` | Memory: ${details.memoryDisplay}`;

  // ⑤ Encode code to base64 (Unicode-safe)
  const content = codeToBase64(details.code);

  // ⑥ PUT the file
  logDebug(`Writing file to GitHub: ${filePath}`);
  let putRes;
  try {
    putRes = await fetch(fileApiUrl, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        content,
        branch,
        ...(existingSha ? { sha: existingSha } : {})
      })
    });
  } catch (netErr) {
    return {
      ok: false,
      retryable: true,
      message: `Network error writing to GitHub: ${netErr.message}`
    };
  }

  logDebug(`GitHub PUT status: ${putRes.status}`);

  if (putRes.status === 201 || putRes.status === 200) {
    return {
      ok: true,
      retryable: false,
      message: `Pushed to ${cfg.ghRepo}/${filePath}`,
      githubPath: filePath
    };
  }

  // Handle specific failure codes
  if (putRes.status === 401) {
    return { ok: false, retryable: false, message: "GitHub token rejected. Please reconnect." };
  }
  if (putRes.status === 403) {
    const remaining = putRes.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") {
      const reset = putRes.headers.get("X-RateLimit-Reset");
      const resetTime = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : "soon";
      return { ok: false, retryable: true, message: `GitHub rate limit exceeded. Resets at ${resetTime}.` };
    }
    return { ok: false, retryable: false, message: "GitHub push forbidden. Check token scopes." };
  }
  if (putRes.status === 409) {
    // Conflict — SHA mismatch (file changed externally between GET and PUT)
    return { ok: false, retryable: true, message: "Git conflict (SHA mismatch). Will retry." };
  }
  if (putRes.status === 422) {
    const errJson = await putRes.json().catch(() => ({}));
    return {
      ok: false,
      retryable: false,
      message: errJson.message || `GitHub validation error (422). Branch "${branch}" may not exist.`
    };
  }

  const errJson = await putRes.json().catch(() => ({}));
  return {
    ok: false,
    retryable: false,
    message: errJson.message || `GitHub push failed (HTTP ${putRes.status})`
  };
}

// ─── Branch Auto-Creation ──────────────────────────────────────────────────
async function ensureBranchExists(headers, apiBase, branch) {
  try {
    const branchRes = await fetch(
      `${apiBase}/git/ref/heads/${encodeURIComponent(branch)}`,
      { headers }
    );
    if (branchRes.status === 200) {
      logDebug(`Branch "${branch}" exists. ✓`);
      return; // Branch already exists
    }
    if (branchRes.status !== 404) return; // Unexpected error — skip

    logDebug(`Branch "${branch}" not found. Auto-creating from default branch...`, LOG_LEVEL.WARN);

    // Get the repo's default branch SHA
    const repoRes = await fetch(apiBase, { headers });
    if (!repoRes.ok) return;
    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch || "main";

    const refRes = await fetch(
      `${apiBase}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
      { headers }
    );
    if (!refRes.ok) return;
    const refData = await refRes.json();
    const sha = refData.object?.sha;
    if (!sha) return;

    const createRes = await fetch(`${apiBase}/git/refs`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
    });

    if (createRes.ok) {
      logDebug(`Auto-created branch "${branch}" from "${defaultBranch}". ✓`, LOG_LEVEL.SUCCESS);
    } else {
      const err = await createRes.json().catch(() => ({}));
      logDebug(`Failed to create branch "${branch}": ${err.message}`, LOG_LEVEL.ERROR);
    }
  } catch (err) {
    logDebug(`ensureBranchExists error: ${err.message}`, LOG_LEVEL.WARN);
  }
}

// ─── Tab Notification (with fallback injection) ────────────────────────────
async function notifyTab(tabId, payload) {
  if (!tabId || tabId < 0) {
    logDebug(`No valid tabId to notify (${tabId}).`);
    return;
  }
  logDebug(`Notifying tab ${tabId}...`);
  try {
    await chrome.tabs.sendMessage(tabId, payload);
    logDebug("Tab notified successfully. ✓");
  } catch (_) {
    // Content script might not be injected yet — inject then retry
    logDebug("Content script not found. Injecting via scripting API...", LOG_LEVEL.WARN);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      // Small delay to let the script register its message listener
      await new Promise(r => setTimeout(r, 150));
      await chrome.tabs.sendMessage(tabId, payload);
      logDebug("Tab notified after injection. ✓");
    } catch (err) {
      logDebug(`Could not notify tab ${tabId}: ${err.message}`, LOG_LEVEL.WARN);
    }
  }
}

// ─── Sync History (for Dashboard) ─────────────────────────────────────────
async function appendToSyncHistory(entry) {
  try {
    const { syncHistory = [] } = await chrome.storage.local.get(["syncHistory"]);
    await chrome.storage.local.set({
      syncHistory: [entry, ...syncHistory].slice(0, 200)
    });
  } catch (err) {
    logDebug(`Failed to update sync history: ${err.message}`, LOG_LEVEL.WARN);
  }
}

// ─── Streak Tracking ───────────────────────────────────────────────────────
async function updateStreak() {
  try {
    const { streakCount = 0, lastStreakDate } = await chrome.storage.local.get([
      "streakCount", "lastStreakDate"
    ]);
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    let newStreak = streakCount;
    if (lastStreakDate === today) {
      // Already solved today — no change
    } else if (lastStreakDate === yesterday) {
      // Solved yesterday — extend streak
      newStreak = streakCount + 1;
    } else {
      // Streak broken or first ever solve
      newStreak = 1;
    }

    await chrome.storage.local.set({
      streakCount: newStreak,
      lastStreakDate: today
    });
    logDebug(`Streak updated: ${newStreak} day(s).`);
  } catch (err) {
    logDebug(`Streak update error: ${err.message}`, LOG_LEVEL.WARN);
  }
}

// ─── Retry Queue via chrome.alarms ────────────────────────────────────────
async function scheduleRetry(submissionId, tabId) {
  try {
    const { retryQueue = [] } = await chrome.storage.local.get(["retryQueue"]);
    const alreadyQueued = retryQueue.some(r => r.submissionId === submissionId);
    if (alreadyQueued) return;
    await chrome.storage.local.set({
      retryQueue: [...retryQueue, { submissionId, tabId, queuedAt: Date.now() }].slice(-10)
    });
    chrome.alarms.create("retrySync", { delayInMinutes: 2 });
    logDebug(`Queued submission ${submissionId} for retry in 2 minutes.`, LOG_LEVEL.WARN);
  } catch (err) {
    logDebug(`Failed to schedule retry: ${err.message}`, LOG_LEVEL.ERROR);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "retrySync") {
    logDebug("Retry alarm fired. Processing retry queue...");
    try {
      const { retryQueue = [] } = await chrome.storage.local.get(["retryQueue"]);
      if (retryQueue.length === 0) return;
      await chrome.storage.local.remove("retryQueue");
      for (const item of retryQueue) {
        // Expire items older than 1 hour
        if (Date.now() - item.queuedAt > 3600000) {
          logDebug(`Retry expired for submission ${item.submissionId}.`, LOG_LEVEL.WARN);
          continue;
        }
        logDebug(`Retrying submission ${item.submissionId}...`);
        await handleSubmissionSeen(item.submissionId, item.tabId);
      }
    } catch (err) {
      logDebug(`Retry alarm error: ${err.message}`, LOG_LEVEL.ERROR);
    }
  }
});

// ─── OAuth Device Flow Polling (from background, survives popup close) ─────
// The popup starts the device flow and sends a message here.
// This way, if the user closes the popup while waiting for GitHub auth,
// the polling continues and the token is saved when ready.
let oauthPollTimer = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "START_OAUTH_POLL") {
    startOAuthPollInBackground(msg);
    sendResponse({ ok: true });
  }
  if (msg.type === "STOP_OAUTH_POLL") {
    stopOAuthPoll();
    sendResponse({ ok: true });
  }
  if (msg.type === "GET_STATUS") {
    sendResponse({ ok: true });
  }
  return true; // Keep message channel open for async
});

function stopOAuthPoll() {
  if (oauthPollTimer) {
    clearInterval(oauthPollTimer);
    oauthPollTimer = null;
    logDebug("OAuth polling stopped.");
  }
}

async function startOAuthPollInBackground({
  clientId, deviceCode, interval = 5000,
  ghOwner, ghRepo, ghBranch
}) {
  stopOAuthPoll(); // Clear any existing poll
  logDebug(`Starting OAuth Device Flow polling (interval: ${interval}ms)...`);

  let currentInterval = interval;

  const doPoll = async () => {
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

      if (!res.ok) {
        logDebug(`OAuth poll HTTP error: ${res.status}`, LOG_LEVEL.WARN);
        return;
      }

      const data = await res.json();

      if (data.error) {
        switch (data.error) {
          case "authorization_pending":
            // Normal — user hasn't authorized yet
            return;
          case "slow_down":
            // GitHub asked us to slow down — increase interval
            stopOAuthPoll();
            currentInterval += 5000;
            logDebug(`OAuth: slow_down received. New interval: ${currentInterval}ms`, LOG_LEVEL.WARN);
            oauthPollTimer = setInterval(doPoll, currentInterval);
            return;
          case "expired_token":
            logDebug("OAuth device code expired.", LOG_LEVEL.WARN);
            stopOAuthPoll();
            await chrome.storage.local.set({ oauthStatus: "expired" });
            return;
          default:
            logDebug(`OAuth error: ${data.error_description || data.error}`, LOG_LEVEL.ERROR);
            stopOAuthPoll();
            await chrome.storage.local.set({ oauthStatus: `error: ${data.error}` });
            return;
        }
      }

      if (data.access_token) {
        stopOAuthPoll();
        await chrome.storage.local.set({
          ghToken: data.access_token,
          ghOwner,
          ghRepo,
          ghBranch: ghBranch || "main",
          clientId,
          connMethod: "oauth",
          oauthStatus: "connected"
        });
        logDebug("OAuth Device Flow: Access token received and saved. ✓", LOG_LEVEL.SUCCESS);
      }

    } catch (err) {
      logDebug(`OAuth poll fetch error: ${err.message}`, LOG_LEVEL.ERROR);
    }
  };

  oauthPollTimer = setInterval(doPoll, currentInterval);
}

// ─── Startup Handler ───────────────────────────────────────────────────────
// Restore badge count on browser startup (SW is fresh but storage persists)
chrome.runtime.onStartup.addListener(async () => {
  logDebug("Browser started. Restoring state...");
  try {
    const { syncedCount = 0 } = await chrome.storage.local.get(["syncedCount"]);
    if (syncedCount > 0) {
      chrome.action.setBadgeText({ text: String(syncedCount) });
      chrome.action.setBadgeBackgroundColor({ color: "#3fb950" });
    }
  } catch (_) {}
});

logDebug("Background script fully initialized. Listening for submissions.");
