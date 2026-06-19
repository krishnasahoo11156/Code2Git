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
// Watches ALL completed requests to match LeetCode and HackerRank submissions.
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.url.includes("leetcode.com")) {
      const match = details.url.match(/\/submissions\/detail\/(\d+)\/(?:v2\/)?check\/?/);
      if (match) {
        const submissionId = match[1];
        logDebug(`LeetCode Submission check matched! ID: ${submissionId}, TabId: ${details.tabId}`);
        handleSubmissionSeen(submissionId, details.tabId);
      }
    } else if (details.url.includes("hackerrank.com/rest/contests/master/challenges/")) {
      // Intercept HackerRank submissions checks:
      // Pattern: https://www.hackerrank.com/rest/contests/master/challenges/<slug>/submissions/<subId>
      const match = details.url.match(/\/challenges\/([^\/]+)\/submissions\/(\d+)/);
      if (match) {
        const slug = match[1];
        const submissionId = match[2];
        logDebug(`HackerRank Submission matched! Slug: ${slug}, ID: ${submissionId}, TabId: ${details.tabId}`);
        handleHackerRankSubmission(slug, submissionId, details.tabId);
      }
    }
  },
  { urls: ["https://leetcode.com/*", "https://www.hackerrank.com/*"] }
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
      const newCount = syncedCount + 1;
      await chrome.storage.local.set({
        syncedIds: updatedIds,
        syncedCount: newCount,
        lastSync: Date.now()
      });

      // ⑤.1 Auto-generate README.md
      const ext = LANG_EXT[details.lang?.name?.toLowerCase()] || "txt";
      await pushReadmeToGithub(
        details,
        details.question?.titleSlug,
        details.question?.difficulty || "Unknown",
        details.question?.questionId,
        ext,
        "LeetCode"
      );

      // ⑥ Update streak
      const newStreak = await updateStreak();

      // ⑦ Update extension badge
      chrome.action.setBadgeText({ text: String(newCount) });
      chrome.action.setBadgeBackgroundColor({ color: "#3fb950" });

      // Sync to Leaderboard
      await syncToLeaderboard(newCount, newStreak);

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
          content
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
    const todayObj = new Date();
    const today = todayObj.toDateString();
    
    const yesterdayObj = new Date(todayObj);
    yesterdayObj.setDate(todayObj.getDate() - 1);
    const yesterday = yesterdayObj.toDateString();

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
    return newStreak;
  } catch (err) {
    logDebug(`Streak update error: ${err.message}`, LOG_LEVEL.WARN);
    return 0;
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_OAUTH_POLL") {
    startOAuthPollInBackground(msg);
    sendResponse({ ok: true });
  } else if (msg.type === "STOP_OAUTH_POLL") {
    stopOAuthPoll();
    sendResponse({ ok: true });
  } else if (msg.type === "GET_STATUS") {
    sendResponse({ ok: true });
  } else if (msg.type === "CODEFORCES_SUBMITTED") {
    startCodeforcesPolling(sender.tab?.id);
    sendResponse({ ok: true });
  } else if (msg.type === "GFG_ACCEPTED") {
    handleGfgAccepted(msg.data, sender.tab?.id);
    sendResponse({ ok: true });
  } else if (msg.type === "FORCE_LEADERBOARD_SYNC") {
    forceLeaderboardSync();
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

// ─── HTML to Markdown Converter ──────────────────────────────────────────
function htmlToMarkdown(html) {
  if (!html) return "";
  let md = html;

  // Replace block elements and line breaks
  md = md.replace(/<pre>([\s\S]*?)<\/pre>/gi, (match, code) => {
    const cleanCode = code.replace(/<[^>]+>/g, "");
    return `\n\`\`\`\n${cleanCode}\n\`\`\`\n`;
  });
  
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  
  // Lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, "\n$1\n");
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, "\n$1\n");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");

  // Inline formatting
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  const entities = {
    "&nbsp;": " ",
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&deg;": "°",
  };
  for (const [entity, value] of Object.entries(entities)) {
    md = md.replace(new RegExp(entity, "g"), value);
  }

  // Clean up whitespace/newlines
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim();
}

// ─── README.md Sync ────────────────────────────────────────────────────────
async function pushReadmeToGithub(details, slug, difficulty, questionId, ext, platform = "LeetCode") {
  const cfg = await chrome.storage.local.get([
    "ghToken", "ghOwner", "ghRepo", "ghBranch"
  ]);
  if (!cfg.ghToken || !cfg.ghOwner || !cfg.ghRepo) return;

  const branch = cfg.ghBranch || "main";
  
  let filePath = "";
  let title = "";
  let problemUrl = "";
  let descriptionHtml = "";
  let langVerbose = "";

  if (platform === "LeetCode") {
    const paddedQId = String(questionId || "0").padStart(4, "0");
    filePath = `${difficulty}/${paddedQId}-${slug}/README.md`;
    title = details.question?.title || slug;
    problemUrl = `https://leetcode.com/problems/${slug}/`;
    descriptionHtml = details.question?.content || "";
    langVerbose = details.lang?.verboseName || "";
  } else if (platform === "Codeforces") {
    filePath = `Codeforces/${difficulty}/${slug}/README.md`;
    title = details.title || slug;
    problemUrl = details.url || "";
    descriptionHtml = details.descriptionHtml || "";
    langVerbose = details.lang || "";
  } else if (platform === "HackerRank") {
    filePath = `HackerRank/${difficulty}/${slug}/README.md`;
    title = details.title || slug;
    problemUrl = details.url || "";
    descriptionHtml = details.descriptionHtml || "";
    langVerbose = details.lang || "";
  } else if (platform === "GeeksforGeeks") {
    filePath = `GeeksforGeeks/${difficulty}/${slug}/README.md`;
    title = details.title || slug;
    problemUrl = details.url || "";
    descriptionHtml = details.descriptionHtml || "";
    langVerbose = details.lang || "";
  }

  const apiBase = `https://api.github.com/repos/${cfg.ghOwner}/${cfg.ghRepo}`;
  const readmeApiUrl = `${apiBase}/contents/${encodeURI(filePath)}`;
  const headers = {
    Authorization: `Bearer ${cfg.ghToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  let existingSha;
  try {
    const getRes = await fetch(`${readmeApiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    if (getRes.status === 200) {
      const getJson = await getRes.json();
      existingSha = getJson.sha;
    }
  } catch (_) {}

  const markdownDescription = htmlToMarkdown(descriptionHtml);
  const runtimeDisplay = details.runtimeDisplay || details.runtime || "";
  const memoryDisplay = details.memoryDisplay || details.memory || "";
  
  const readmeContent = `# [${platform}] ${title}

**Difficulty:** ${difficulty}  
**Language:** ${langVerbose}  
${runtimeDisplay ? `**Runtime:** ${runtimeDisplay}  \n` : ""}${memoryDisplay ? `**Memory:** ${memoryDisplay}  \n` : ""}**Link:** [Problem Link](${problemUrl})

## Problem Description

${markdownDescription || "No description available."}

---
*README auto-generated by [Code2Git](https://github.com/krishnasahoo11156/Code2Git)*
`;

  const commitMessage = `📝 Add README: [${platform}] ${title}`;
  const base64Content = codeToBase64(readmeContent);

  try {
    await fetch(readmeApiUrl, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        content: base64Content,
        branch,
        ...(existingSha ? { sha: existingSha } : {})
      })
    });
    logDebug(`README.md successfully synced for ${title} (${platform}).`);
  } catch (err) {
    logDebug(`Failed to push README.md: ${err.message}`, LOG_LEVEL.WARN);
  }
}

// ─── Multi-Platform Sync Core ────────────────────────────────────────────────
async function pushMultiplatformToGithub(code, filePath, commitMessage, branch) {
  const cfg = await chrome.storage.local.get(["ghToken", "ghOwner", "ghRepo"]);
  const apiBase = `https://api.github.com/repos/${cfg.ghOwner}/${cfg.ghRepo}`;
  const fileApiUrl = `${apiBase}/contents/${encodeURI(filePath)}`;
  const headers = {
    Authorization: `Bearer ${cfg.ghToken}`,
    Accept: "application/vnd.github+json"
  };

  await ensureBranchExists(headers, apiBase, branch);

  let existingSha;
  try {
    const getRes = await fetch(`${fileApiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    if (getRes.status === 200) {
      const getJson = await getRes.json();
      existingSha = getJson.sha;
    }
  } catch (_) {}

  const content = codeToBase64(code);

  const putRes = await fetch(fileApiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMessage,
      content,
      branch,
      ...(existingSha ? { sha: existingSha } : {})
    })
  });

  return putRes.ok;
}

// ─── HackerRank Handler ──────────────────────────────────────────────────────
async function handleHackerRankSubmission(slug, submissionId, tabId) {
  try {
    if (await isProcessing(submissionId)) return;
    const { syncedIds = [] } = await chrome.storage.local.get(["syncedIds"]);
    if (syncedIds.includes(submissionId)) return;

    await markProcessing(submissionId);

    // Fetch submission detail JSON from HackerRank REST
    const subRes = await fetch(`https://www.hackerrank.com/rest/contests/master/challenges/${slug}/submissions/${submissionId}`);
    if (!subRes.ok) throw new Error("Could not fetch HackerRank submission details.");
    const subJson = await subRes.json();
    const sub = subJson.model;

    if (sub.status !== "Accepted" && sub.score !== 1.0) {
      logDebug(`HackerRank submission ${submissionId} not accepted. Skip.`);
      await unmarkProcessing(submissionId);
      return;
    }

    // Fetch challenge details
    const challRes = await fetch(`https://www.hackerrank.com/rest/contests/master/challenges/${slug}`);
    if (!challRes.ok) throw new Error("Could not fetch HackerRank challenge details.");
    const challJson = await challRes.json();
    const chall = challJson.model;

    const title = chall.name || slug;
    const difficulty = chall.difficulty_name || "Medium";
    const code = sub.code;
    const language = sub.language;
    const ext = LANG_EXT[language.toLowerCase()] || "txt";
    const filePath = `HackerRank/${difficulty}/${slug}/Solution.${ext}`;
    const branch = (await chrome.storage.local.get(["ghBranch"])).ghBranch || "main";

    const commitMessage = `✅ [HackerRank] ${title} | ${language}`;

    logDebug(`Pushing HackerRank solution for ${title} to GitHub...`);
    const ok = await pushMultiplatformToGithub(code, filePath, commitMessage, branch);

    if (ok) {
      const updatedIds = [...syncedIds, submissionId].slice(-500);
      const { syncedCount = 0 } = await chrome.storage.local.get(["syncedCount"]);
      const newCount = syncedCount + 1;
      await chrome.storage.local.set({
        syncedIds: updatedIds,
        syncedCount: newCount,
        lastSync: Date.now()
      });

      const newStreak = await updateStreak();
      chrome.action.setBadgeText({ text: String(newCount) });
      chrome.action.setBadgeBackgroundColor({ color: "#3fb950" });

      await syncToLeaderboard(newCount, newStreak);

      await appendToSyncHistory({
        submissionId,
        questionId: String(sub.challenge_id || "0"),
        title,
        titleSlug: slug,
        difficulty,
        lang: language,
        runtime: "100% Score",
        memory: "N/A",
        githubPath: filePath,
        timestamp: Date.now()
      });

      // Secondary README push
      const details = {
        title,
        url: `https://www.hackerrank.com/challenges/${slug}/problem`,
        descriptionHtml: chall.body_html || "",
        lang: language,
        runtime: "100% Score",
        memory: "N/A"
      };
      await pushReadmeToGithub(details, slug, difficulty, null, ext, "HackerRank");

      chrome.notifications.create(`sync-hr-${submissionId}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "✅ HackerRank → GitHub Synced!",
        message: `${title} pushed successfully.`,
      });

      await notifyTab(tabId, { type: "SYNC_RESULT", ok: true, title, difficulty, lang: language, message: "Pushed to GitHub!" });
    } else {
      throw new Error("GitHub push failed.");
    }
  } catch (err) {
    logDebug(`HackerRank Sync error: ${err.message}`, LOG_LEVEL.ERROR);
    await notifyTab(tabId, { type: "SYNC_RESULT", ok: false, message: err.message });
  } finally {
    await unmarkProcessing(submissionId);
  }
}

// ─── Codeforces Poller ───────────────────────────────────────────────────────
async function startCodeforcesPolling(tabId) {
  const cfg = await chrome.storage.local.get(["cfHandle"]);
  if (!cfg.cfHandle) {
    logDebug("Codeforces handle not configured in settings. Skipping polling.", LOG_LEVEL.WARN);
    return;
  }

  logDebug(`CF Triggered: polling for handle '${cfg.cfHandle}'...`);
  
  let attempts = 0;
  const maxAttempts = 12; // 1 minute total (5s * 12)
  
  const poll = async () => {
    try {
      const res = await fetch(`https://codeforces.com/api/user.status?handle=${cfg.cfHandle}&from=1&count=5`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status !== "OK" || !data.result?.length) return;

      const latest = data.result[0];
      const submissionId = String(latest.id);

      // Check if it's Accepted (OK)
      if (latest.verdict !== "OK") {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000);
        } else {
          logDebug("Codeforces polling finished: no new accepted submissions.");
        }
        return;
      }

      const { syncedIds = [] } = await chrome.storage.local.get(["syncedIds"]);
      if (syncedIds.includes(submissionId)) {
        return;
      }

      logDebug(`Found new Codeforces submission: ${submissionId}. Syncing...`);
      await markProcessing(submissionId);

      // Fetch code HTML and parse
      const subUrl = `https://codeforces.com/contest/${latest.contestId}/submission/${submissionId}`;
      const subPageRes = await fetch(subUrl);
      if (!subPageRes.ok) throw new Error("Could not fetch Codeforces submission page HTML.");
      const subHtml = await subPageRes.text();
      
      const codeMatch = subHtml.match(/<pre[^>]*id="program-source-text"[^>]*>([\s\S]*?)<\/pre>/);
      if (!codeMatch) throw new Error("Failed to parse Codeforces code from page HTML.");
      
      let code = codeMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'");

      if (code.includes("<![CDATA[")) {
        code = code.replace("<![CDATA[", "").replace("]]>", "");
      }

      const title = latest.problem.name;
      const rating = latest.problem.rating || 0;
      const difficulty = rating < 1200 ? "Easy" : rating < 1900 ? "Medium" : "Hard";
      const slug = `${latest.problem.index}`;
      const lang = latest.programmingLanguage;
      const ext = LANG_EXT[lang.toLowerCase().replace(/[^a-z0-9]/g, "")] || "cpp";
      const filePath = `Codeforces/${difficulty}/${latest.contestId}${slug}-${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}/Solution.${ext}`;
      const branch = (await chrome.storage.local.get(["ghBranch"])).ghBranch || "main";
      
      const commitMessage = `✅ [Codeforces] ${title} | ${lang} | ${latest.timeConsumedMillis}ms | ${Math.round(latest.memoryConsumedBytes/1024)}KB`;

      const ok = await pushMultiplatformToGithub(code, filePath, commitMessage, branch);

      if (ok) {
        const updatedIds = [...syncedIds, submissionId].slice(-500);
        const { syncedCount = 0 } = await chrome.storage.local.get(["syncedCount"]);
        const newCount = syncedCount + 1;
        await chrome.storage.local.set({
          syncedIds: updatedIds,
          syncedCount: newCount,
          lastSync: Date.now()
        });

        const newStreak = await updateStreak();
        chrome.action.setBadgeText({ text: String(newCount) });
        chrome.action.setBadgeBackgroundColor({ color: "#3fb950" });

        await syncToLeaderboard(newCount, newStreak);

        await appendToSyncHistory({
          submissionId,
          questionId: `${latest.contestId}${slug}`,
          title,
          titleSlug: slug,
          difficulty,
          lang,
          runtime: `${latest.timeConsumedMillis}ms`,
          memory: `${Math.round(latest.memoryConsumedBytes/1024)}KB`,
          githubPath: filePath,
          timestamp: Date.now()
        });

        // Fetch description
        let problemDescHtml = "";
        try {
          const probUrl = `https://codeforces.com/contest/${latest.contestId}/problem/${slug}`;
          const probRes = await fetch(probUrl);
          if (probRes.ok) {
            const probHtml = await probRes.text();
            const descMatch = probHtml.match(/<div class="problem-statement">([\s\S]*?)<\/div>\s*<div class="input-specification">/);
            if (descMatch) {
              problemDescHtml = descMatch[1];
            }
          }
        } catch (_) {}

        const details = {
          title,
          url: `https://codeforces.com/contest/${latest.contestId}/problem/${slug}`,
          descriptionHtml: problemDescHtml,
          lang,
          runtime: `${latest.timeConsumedMillis}ms`,
          memory: `${Math.round(latest.memoryConsumedBytes/1024)}KB`
        };
        await pushReadmeToGithub(details, `${latest.contestId}${slug}`, difficulty, null, ext, "Codeforces");

        chrome.notifications.create(`sync-cf-${submissionId}`, {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "✅ Codeforces → GitHub Synced!",
          message: `${title} pushed successfully.`,
        });

        await notifyTab(tabId, { type: "SYNC_RESULT", ok: true, title, difficulty, lang, message: "Pushed to GitHub!" });
      }
    } catch (e) {
      logDebug(`Codeforces polling error: ${e.message}`, LOG_LEVEL.WARN);
    } finally {
      await unmarkProcessing(submissionId);
    }
  };

  setTimeout(poll, 3000);
}

// ─── GeeksforGeeks Handler ──────────────────────────────────────────────────
async function handleGfgAccepted(data, tabId) {
  const submissionId = `gfg-${Date.now()}`;
  try {
    if (await isProcessing(submissionId)) return;
    const { syncedIds = [] } = await chrome.storage.local.get(["syncedIds"]);

    await markProcessing(submissionId);

    const { code, title, difficulty, lang, slug, url, descriptionHtml = "" } = data;

    const ext = LANG_EXT[lang.toLowerCase().replace(/[^a-z0-9]/g, "")] || "cpp";
    const filePath = `GeeksforGeeks/${difficulty}/${slug}/Solution.${ext}`;
    const branch = (await chrome.storage.local.get(["ghBranch"])).ghBranch || "main";

    const commitMessage = `✅ [GeeksforGeeks] ${title} | ${lang}`;

    logDebug(`Pushing GeeksforGeeks solution for ${title} to GitHub...`);
    const ok = await pushMultiplatformToGithub(code, filePath, commitMessage, branch);

    if (ok) {
      const updatedIds = [...syncedIds, submissionId].slice(-500);
      const { syncedCount = 0 } = await chrome.storage.local.get(["syncedCount"]);
      const newCount = syncedCount + 1;
      await chrome.storage.local.set({
        syncedIds: updatedIds,
        syncedCount: newCount,
        lastSync: Date.now()
      });

      const newStreak = await updateStreak();
      chrome.action.setBadgeText({ text: String(newCount) });
      chrome.action.setBadgeBackgroundColor({ color: "#3fb950" });

      await syncToLeaderboard(newCount, newStreak);

      await appendToSyncHistory({
        submissionId,
        questionId: slug,
        title,
        titleSlug: slug,
        difficulty,
        lang,
        runtime: "Accepted",
        memory: "N/A",
        githubPath: filePath,
        timestamp: Date.now()
      });

      const details = {
        title,
        url,
        descriptionHtml,
        lang,
        runtime: "Accepted",
        memory: "N/A"
      };
      await pushReadmeToGithub(details, slug, difficulty, null, ext, "GeeksforGeeks");

      chrome.notifications.create(`sync-gfg-${submissionId}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "✅ GeeksforGeeks → GitHub Synced!",
        message: `${title} pushed successfully.`,
      });

      await notifyTab(tabId, { type: "SYNC_RESULT", ok: true, title, difficulty, lang, message: "Pushed to GitHub!" });
    } else {
      throw new Error("GitHub push failed.");
    }
  } catch (err) {
    logDebug(`GeeksforGeeks sync error: ${err.message}`, LOG_LEVEL.ERROR);
    await notifyTab(tabId, { type: "SYNC_RESULT", ok: false, message: err.message });
  } finally {
    await unmarkProcessing(submissionId);
  }
}

// ─── Leaderboard Database REST client ───────────────────────────────────────
async function syncToLeaderboard(syncedCount, streakCount) {
  try {
    const cfg = await chrome.storage.local.get([
      "ghOwner", "displayName", "leaderboardUrl", "optInLeaderboard"
    ]);
    if (cfg.optInLeaderboard === false) {
      logDebug("Leaderboard opt-in is disabled. Skipping leaderboard sync.");
      return;
    }

    const username = cfg.ghOwner;
    if (!username) return;

    const displayName = cfg.displayName || username;
    const userPayload = {
      username,
      displayName,
      syncedCount: Number(syncedCount || 0),
      streakCount: Number(streakCount || 0),
      lastSync: Date.now(),
      avatarUrl: `https://github.com/${username}.png`
    };

    // 1. Sync to default Global Leaderboard database
    const globalDbUrl = "https://code2git-leaderboard-default-rtdb.firebaseio.com";
    try {
      const res = await fetch(`${globalDbUrl}/leaderboard/${username}.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userPayload)
      });
      if (res.ok) {
        logDebug(`Sync to Global Leaderboard successful for user ${username}.`);
      } else {
        logDebug(`Sync to Global Leaderboard failed for user ${username}: HTTP ${res.status}`, LOG_LEVEL.WARN);
      }
    } catch (globalErr) {
      logDebug(`Global Leaderboard sync error: ${globalErr.message}`, LOG_LEVEL.WARN);
    }

    // 2. Sync to custom Club Leaderboard database (if configured)
    const customDbUrl = cfg.leaderboardUrl ? cfg.leaderboardUrl.trim().replace(/\/$/, "") : "";
    if (customDbUrl && customDbUrl !== globalDbUrl) {
      try {
        const res = await fetch(`${customDbUrl}/leaderboard/${username}.json`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(userPayload)
        });
        if (res.ok) {
          logDebug(`Sync to Club Leaderboard (${customDbUrl}) successful for user ${username}.`);
        } else {
          logDebug(`Sync to Club Leaderboard (${customDbUrl}) failed for user ${username}: HTTP ${res.status}`, LOG_LEVEL.WARN);
        }
      } catch (customErr) {
        logDebug(`Club Leaderboard sync error: ${customErr.message}`, LOG_LEVEL.WARN);
      }
    }
  } catch (err) {
    logDebug(`Leaderboard sync error: ${err.message}`, LOG_LEVEL.WARN);
  }
}

async function forceLeaderboardSync() {
  try {
    const data = await chrome.storage.local.get(["syncedCount", "streakCount"]);
    const syncedCount = data.syncedCount || 0;
    const streakCount = data.streakCount || 0;
    await syncToLeaderboard(syncedCount, streakCount);
    logDebug("Forced leaderboard sync triggered.");
  } catch (err) {
    logDebug(`Forced leaderboard sync error: ${err.message}`, LOG_LEVEL.WARN);
  }
}

logDebug("Background script fully initialized. Listening for submissions.");
