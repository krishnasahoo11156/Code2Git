// dashboard.js — Code2Git Dashboard Logic
// Reads from chrome.storage.local and renders:
//  • Stats cards (total, streak, languages, last sync)
//  • Activity heatmap (last 26 weeks)
//  • Difficulty donut chart (SVG, no external libs)
//  • Language horizontal bar chart
//  • Filterable submissions history table

"use strict";

// ─── Colour constants (must match CSS vars) ────────────────────────────────
const DIFF_COLOR = { Easy: "#00b8a3", Medium: "#ffa116", Hard: "#ff375f", Unknown: "#8b949e" };
const LANG_COLORS = [
  "#58a6ff","#3fb950","#d29922","#bc8cff",
  "#f85149","#00b8a3","#ffa116","#ff7b72",
  "#79c0ff","#56d364"
];

// ─── Entry Point ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const data = await chrome.storage.local.get([
    "syncedCount", "streakCount", "lastSync",
    "syncHistory", "ghOwner", "ghRepo", "ghBranch"
  ]);

  const history  = data.syncHistory || [];
  const ghOwner  = data.ghOwner  || "";
  const ghRepo   = data.ghRepo   || "";
  const ghBranch = data.ghBranch || "main";

  // Wire up the "View Repo" button
  if (ghOwner && ghRepo) {
    const link = document.getElementById("ghRepoLink");
    link.href = `https://github.com/${ghOwner}/${ghRepo}`;
  }

  renderStatCards(data, history);
  renderHeatmap(history);
  renderDonutChart(history);
  renderLangBarChart(history);
  renderHistoryTable(history, ghOwner, ghRepo, ghBranch);
  setupDiffFilter(history, ghOwner, ghRepo, ghBranch);

  // Tabs Navigation
  const btnShowStats = document.getElementById("btnShowStats");
  const btnShowLeaderboard = document.getElementById("btnShowLeaderboard");
  const statsContainer = document.getElementById("statsContainer");
  const leaderboardContainer = document.getElementById("leaderboardContainer");

  btnShowStats.addEventListener("click", () => {
    btnShowStats.classList.add("active");
    btnShowLeaderboard.classList.remove("active");
    statsContainer.style.display = "block";
    leaderboardContainer.style.display = "none";
  });

  btnShowLeaderboard.addEventListener("click", () => {
    btnShowLeaderboard.classList.add("active");
    btnShowStats.classList.remove("active");
    statsContainer.style.display = "none";
    leaderboardContainer.style.display = "block";
    fetchAndRenderLeaderboard();
  });

  // Leaderboard toggles setup (Global vs Club)
  const dbConfig = await chrome.storage.local.get(["leaderboardUrl"]);
  const hasCustomDb = dbConfig.leaderboardUrl && 
                      dbConfig.leaderboardUrl.trim() !== "" && 
                      dbConfig.leaderboardUrl.trim() !== "https://code2git-leaderboard-default-rtdb.firebaseio.com";
  
  const toggleContainer = document.getElementById("leaderboardToggleContainer");
  const btnGlobal = document.getElementById("btnLeaderboardGlobal");
  const btnClub = document.getElementById("btnLeaderboardClub");

  if (hasCustomDb && toggleContainer && btnGlobal && btnClub) {
    toggleContainer.style.display = "flex";
    btnGlobal.addEventListener("click", () => {
      btnGlobal.classList.add("active");
      btnClub.classList.remove("active");
      fetchAndRenderLeaderboard();
    });
    btnClub.addEventListener("click", () => {
      btnClub.classList.add("active");
      btnGlobal.classList.remove("active");
      fetchAndRenderLeaderboard();
    });
  }

  // Open Popup button handler (to comply with CSP)
  const btnOpenPopup = document.getElementById("btnOpenPopup");
  if (btnOpenPopup) {
    btnOpenPopup.addEventListener("click", () => {
      if (chrome.action && typeof chrome.action.openPopup === "function") {
        chrome.action.openPopup().catch(() => {
          alert("Click the Code2Git icon in the Chrome toolbar to open the popup.");
        });
      } else {
        alert("Click the Code2Git icon in the Chrome toolbar to open the popup.");
      }
    });
  }
});

// ─── Utility: Relative time ────────────────────────────────────────────────
function relativeTime(ts) {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 60)  return "just now";
  if (m < 60)  return `${m}m ago`;
  if (h < 24)  return `${h}h ago`;
  if (d < 30)  return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Stat Cards ───────────────────────────────────────────────────────────
function renderStatCards(data, history) {
  const total  = data.syncedCount || 0;
  const streak = data.streakCount || 0;
  const langs  = new Set(history.map(e => e.lang).filter(Boolean)).size;

  document.getElementById("cardTotal").textContent   = total;
  document.getElementById("cardStreak").textContent  = streak;
  document.getElementById("cardLangs").textContent   = langs || "—";
  document.getElementById("cardLangsSub").textContent =
    langs ? `${langs} language${langs !== 1 ? "s" : ""}` : "No syncs yet";
  document.getElementById("cardLastSync").textContent  = relativeTime(data.lastSync);
  document.getElementById("cardLastSyncSub").textContent = data.lastSync
    ? new Date(data.lastSync).toLocaleDateString()
    : "No syncs yet";
  document.getElementById("cardTotalSub").textContent =
    total ? `${total} problem${total !== 1 ? "s" : ""}` : "No syncs yet";
  document.getElementById("cardStreakSub").textContent =
    streak >= 7 ? "🔥 On fire!" :
    streak >= 3 ? "Great momentum!" :
    streak >= 1 ? "Keep going!" : "Start solving!";

  // Longest streak calculation
  const longestStreak = computeLongestStreak(history);
  document.getElementById("longestStreak").textContent = longestStreak || "—";
}

function computeLongestStreak(history) {
  if (!history.length) return 0;
  const days = new Set();
  history.forEach(e => {
    const ts = e.timestamp || e.date || e.time;
    if (ts) {
      const dStr = new Date(ts).toDateString();
      if (dStr !== "Invalid Date") days.add(dStr);
    }
  });
  const sorted = [...days].map(d => new Date(d)).sort((a, b) => a - b);
  let max = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    // Use Math.round to protect against DST 23-hour or 25-hour day variations
    const diff = Math.round((sorted[i] - sorted[i-1]) / 86400000);
    cur = diff === 1 ? cur + 1 : 1;
    if (cur > max) max = cur;
  }
  return max;
}

// ─── Activity Heatmap (26 weeks × 7 days) ────────────────────────────────
function renderHeatmap(history) {
  const grid    = document.getElementById("heatmapGrid");
  const months  = document.getElementById("heatmapMonths");
  grid.innerHTML = "";
  months.innerHTML = "";
  const WEEKS   = 26;
  const tooltip = document.getElementById("tooltip");

  // Build day → count map
  const dayMap = {};
  history.forEach(e => {
    const ts = e.timestamp || e.date || e.time;
    if (!ts) return;
    const key = new Date(ts).toDateString();
    if (key !== "Invalid Date") {
      dayMap[key] = (dayMap[key] || 0) + 1;
    }
  });

  const now     = new Date();
  const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Align to Saturday of the current week at noon to avoid DST boundary crossings
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  endDate.setDate(endDate.getDate() + (6 - today.getDay()));

  const maxCount = Math.max(1, ...Object.values(dayMap));

  let prevMonth = -1;
  const monthLabels = [];
  const colEls = [];

  for (let w = 0; w < WEEKS; w++) {
    const col = document.createElement("div");
    col.className = "heatmap-col";

    for (let d = 0; d < 7; d++) {
      // Calculate date for this cell: go back from endDate
      const date = new Date(endDate);
      date.setDate(endDate.getDate() - ((WEEKS - 1 - w) * 7 + (6 - d)));

      // Compare dates at midnight to avoid DST/time-of-day offsets
      const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const isFuture = dateMidnight > todayMidnight;

      const key      = dateMidnight.toDateString();
      const count    = dayMap[key] || 0;

      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      
      // If a cell has activity (even if marked future due to clock skews), show it as active/green.
      if (count > 0) {
        const ratio = count / maxCount;
        cell.className += ratio > 0.75 ? " lvl-4" :
                          ratio > 0.5  ? " lvl-3" :
                          ratio > 0.25 ? " lvl-2" : " lvl-1";
      } else if (isFuture) {
        cell.style.opacity = "0.3";
      }

      // Tooltip on hover
      cell.addEventListener("mouseenter", (e) => {
        tooltip.style.display = "block";
        tooltip.textContent   = count
          ? `${count} sync${count > 1 ? "s" : ""} on ${date.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}`
          : `No syncs on ${date.toLocaleDateString("en-US", { month:"short", day:"numeric" })}`;
      });
      cell.addEventListener("mousemove", (e) => {
        tooltip.style.left = `${e.clientX + 12}px`;
        tooltip.style.top  = `${e.clientY - 30}px`;
      });
      cell.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });

      col.appendChild(cell);

      // Track month label position
      if (d === 0 && date.getMonth() !== prevMonth) {
        monthLabels.push({ week: w, month: date.toLocaleDateString("en-US", { month: "short" }) });
        prevMonth = date.getMonth();
      }
    }
    colEls.push(col);
    grid.appendChild(col);
  }

  // Render month labels (positioned over correct columns)
  monthLabels.forEach(({ week, month }) => {
    const lbl = document.createElement("div");
    lbl.className   = "heatmap-month-label";
    lbl.textContent = month;
    lbl.style.left = `${week * 15}px`;
    months.appendChild(lbl);
  });
}

// ─── Donut Chart (pure SVG) ───────────────────────────────────────────────
function renderDonutChart(history) {
  const svg    = document.getElementById("donutSvg");
  const legend = document.getElementById("donutLegend");
  svg.innerHTML = "";

  const counts = { Easy: 0, Medium: 0, Hard: 0 };
  history.forEach(e => {
    if (e.difficulty && counts[e.difficulty] !== undefined) {
      counts[e.difficulty]++;
    }
  });

  const total  = counts.Easy + counts.Medium + counts.Hard;
  const cx = 60, cy = 60, r = 46, innerR = 28;
  const stroke = r - innerR;
  const circumference = 2 * Math.PI * (r - stroke / 2);

  if (total === 0) {
    // Empty state ring
    const circle = createSVGEl("circle", {
      cx, cy, r: r - stroke / 2,
      fill: "none",
      stroke: "#21262d",
      "stroke-width": stroke
    });
    svg.appendChild(circle);

    // Center text
    const text = createSVGEl("text", {
      x: cx, y: cy + 5,
      "text-anchor": "middle",
      fill: "#484f58",
      "font-size": "11",
      "font-family": "inherit"
    });
    text.textContent = "No data";
    svg.appendChild(text);

    legend.innerHTML = `<div style="color:var(--text-dim);font-size:12px">Solve problems to see data here</div>`;
    return;
  }

  const order  = ["Easy", "Medium", "Hard"];
  let offset   = 0; // Start from top (-90deg = -circumference/4)
  const startOffset = circumference / 4;

  // Background track
  const track = createSVGEl("circle", {
    cx, cy, r: r - stroke / 2,
    fill: "none",
    stroke: "#21262d",
    "stroke-width": stroke
  });
  svg.appendChild(track);

  order.forEach(diff => {
    const count = counts[diff];
    if (count === 0) return;

    const arc     = (count / total) * circumference;
    const dashArr = `${arc} ${circumference - arc}`;
    const dashOff = startOffset - offset;

    const seg = createSVGEl("circle", {
      cx, cy, r: r - stroke / 2,
      fill: "none",
      stroke: DIFF_COLOR[diff],
      "stroke-width": stroke,
      "stroke-dasharray": dashArr,
      "stroke-dashoffset": dashOff,
      "stroke-linecap": "butt",
      style: `transition: stroke-dasharray 0.8s cubic-bezier(0.34,1.2,0.64,1);`
    });
    svg.appendChild(seg);
    offset += arc;
  });

  // Center label: total count
  const textEl = createSVGEl("text", {
    x: cx, y: cy - 4,
    "text-anchor": "middle",
    fill: "#e6edf3",
    "font-size": "20",
    "font-weight": "800",
    "font-family": "inherit"
  });
  textEl.textContent = total;
  svg.appendChild(textEl);

  const subEl = createSVGEl("text", {
    x: cx, y: cy + 12,
    "text-anchor": "middle",
    fill: "#8b949e",
    "font-size": "9",
    "font-family": "inherit"
  });
  subEl.textContent = "SOLVED";
  svg.appendChild(subEl);

  // Legend
  legend.innerHTML = "";
  order.forEach(diff => {
    const count = counts[diff];
    const pct   = total ? Math.round((count / total) * 100) : 0;
    const row   = document.createElement("div");
    row.className = "legend-item";
    row.innerHTML = `
      <div class="legend-dot" style="background:${DIFF_COLOR[diff]}"></div>
      <span class="legend-label">${diff}</span>
      <span class="legend-val">${count}</span>
      <span class="legend-pct">${pct}%</span>
    `;
    legend.appendChild(row);
  });
}

function createSVGEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v);
  });
  return el;
}

// ─── Language Bar Chart ────────────────────────────────────────────────────
function renderLangBarChart(history) {
  const container = document.getElementById("langBarChart");

  // Count by language
  const langCount = {};
  history.forEach(e => {
    if (e.lang) langCount[e.lang] = (langCount[e.lang] || 0) + 1;
  });

  const sorted = Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxVal = sorted[0]?.[1] || 1;

  if (sorted.length === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:12px;padding:20px 0">Solve problems to see language data</div>`;
    return;
  }

  container.innerHTML = "";
  sorted.forEach(([lang, count], i) => {
    const pct  = Math.round((count / maxVal) * 100);
    const color = LANG_COLORS[i % LANG_COLORS.length];
    const row  = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <span class="bar-label" title="${lang}">${lang}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:0%;background:${color}"
             data-target="${pct}"></div>
      </div>
      <span class="bar-count">${count}</span>
    `;
    container.appendChild(row);
  });

  // Animate bars after a short delay
  requestAnimationFrame(() => {
    setTimeout(() => {
      container.querySelectorAll(".bar-fill").forEach(el => {
        el.style.width = el.dataset.target + "%";
      });
    }, 100);
  });
}

// ─── History Table ─────────────────────────────────────────────────────────
function renderHistoryTable(history, ghOwner, ghRepo, ghBranch, diffFilter = "all") {
  const container = document.getElementById("historyBody");

  const filtered = diffFilter === "all"
    ? history
    : history.filter(e => e.difficulty === diffFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${history.length === 0 ? "🚀" : "🔍"}</div>
        <div class="empty-title">${history.length === 0 ? "No syncs yet" : "No results"}</div>
        <div class="empty-sub">${history.length === 0
          ? "Solve and accept a LeetCode problem to see it here"
          : "Try a different difficulty filter"
        }</div>
      </div>`;
    return;
  }

  const rows = filtered.slice(0, 50).map(entry => {
    const diff     = entry.difficulty || "Unknown";
    const diffCls  = `badge-${diff.toLowerCase()}`;
    const ghPath   = entry.githubPath || "";
    const ghUrl    = ghOwner && ghRepo && ghPath
      ? `https://github.com/${ghOwner}/${ghRepo}/blob/${ghBranch}/${ghPath}`
      : "";
    const timeStr  = entry.timestamp
      ? relativeTime(entry.timestamp)
      : "—";
    const dateStr  = entry.timestamp
      ? new Date(entry.timestamp).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })
      : "—";

    const titleHtml = ghUrl
      ? `<a href="${ghUrl}" target="_blank" title="${entry.title || ""}">${entry.title || "—"}</a>`
      : (entry.title || "—");

    const ghLinkHtml = ghUrl
      ? `<a class="gh-link" href="${ghUrl}" target="_blank">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
             <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
           </svg> View
         </a>`
      : `<span style="color:var(--text-dim);font-size:11px">—</span>`;

    const qId = entry.questionId ? String(entry.questionId).padStart(4, "0") : "—";

    return `
      <tr>
        <td class="td-dim">#${qId}</td>
        <td class="td-title">${titleHtml}</td>
        <td><span class="badge ${diffCls}">${diff}</span></td>
        <td><span class="badge badge-lang">${entry.lang || "—"}</span></td>
        <td class="td-muted">${entry.runtime || "—"}</td>
        <td class="td-muted">${entry.memory  || "—"}</td>
        <td class="td-dim" title="${dateStr}">${timeStr}</td>
        <td>${ghLinkHtml}</td>
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Problem</th>
          <th>Difficulty</th>
          <th>Language</th>
          <th>Runtime</th>
          <th>Memory</th>
          <th>Synced</th>
          <th>GitHub</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Show "showing X of Y" note if truncated
  if (filtered.length > 50) {
    const note = document.createElement("div");
    note.style.cssText = "text-align:center;padding:10px;font-size:11px;color:var(--text-dim)";
    note.textContent = `Showing 50 of ${filtered.length} entries`;
    container.appendChild(note);
  }
}

// ─── Difficulty Filter Buttons ────────────────────────────────────────────
function setupDiffFilter(history, ghOwner, ghRepo, ghBranch) {
  const filterBar = document.getElementById("diffFilter");
  filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    filterBar.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderHistoryTable(history, ghOwner, ghRepo, ghBranch, btn.dataset.diff);
  });
}

// ─── Live Storage Listener ────────────────────────────────────────────────
// Refresh the entire dashboard if new syncs happen while the page is open
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  const shouldRefreshLeaderboardToggles = changes.leaderboardUrl;
  if (shouldRefreshLeaderboardToggles) {
    const dbConfig = await chrome.storage.local.get(["leaderboardUrl"]);
    const hasCustomDb = dbConfig.leaderboardUrl && 
                        dbConfig.leaderboardUrl.trim() !== "" && 
                        dbConfig.leaderboardUrl.trim() !== "https://code2git-leaderboard-default-rtdb.firebaseio.com";
    
    const toggleContainer = document.getElementById("leaderboardToggleContainer");
    const btnGlobal = document.getElementById("btnLeaderboardGlobal");
    const btnClub = document.getElementById("btnLeaderboardClub");

    if (toggleContainer && btnGlobal && btnClub) {
      if (hasCustomDb) {
        toggleContainer.style.display = "flex";
      } else {
        toggleContainer.style.display = "none";
        btnGlobal.classList.add("active");
        btnClub.classList.remove("active");
      }
    }
  }

  if (changes.syncHistory || changes.syncedCount || changes.streakCount || changes.lastSync || changes.leaderboardUrl) {
    const data = await chrome.storage.local.get([
      "syncedCount", "streakCount", "lastSync",
      "syncHistory", "ghOwner", "ghRepo", "ghBranch"
    ]);
    const history = data.syncHistory || [];
    renderStatCards(data, history);
    renderHeatmap(history);
    renderDonutChart(history);
    renderLangBarChart(history);
    const activeFilter = document.querySelector(".filter-btn.active")?.dataset.diff || "all";
    renderHistoryTable(history, data.ghOwner || "", data.ghRepo || "", data.ghBranch || "main", activeFilter);
    
    // Also refresh leaderboard if it is currently visible
    const leaderboardContainer = document.getElementById("leaderboardContainer");
    if (leaderboardContainer && leaderboardContainer.style.display !== "none") {
      fetchAndRenderLeaderboard();
    }
  }
});

// ─── Leaderboard Fetch & Render ───────────────────────────────────────────
async function fetchAndRenderLeaderboard() {
  const container = document.getElementById("leaderboardBody");
  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);"><span class="spinner"></span> Loading leaderboard rankings…</div>`;

  try {
    const data = await chrome.storage.local.get(["leaderboardUrl"]);
    const btnClub = document.getElementById("btnLeaderboardClub");
    const isClubActive = btnClub && btnClub.classList.contains("active");

    const defaultUrl = "https://code2git-leaderboard-default-rtdb.firebaseio.com";
    let dbUrl = defaultUrl;
    
    if (isClubActive && data.leaderboardUrl) {
      dbUrl = data.leaderboardUrl.trim().replace(/\/$/, "");
    }
    
    const res = await fetch(`${dbUrl}/leaderboard.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const users = await res.json();
    if (!users) {
      container.innerHTML = `<div class="empty"><div class="empty-icon">🏆</div><div class="empty-title">Leaderboard is empty</div><div class="empty-sub">Be the first to sync a solution!</div></div>`;
      return;
    }

    const sortedUsers = Object.values(users).sort((a, b) => {
      if (b.syncedCount !== a.syncedCount) return b.syncedCount - a.syncedCount;
      return b.streakCount - a.streakCount;
    });

    const rows = sortedUsers.map((user, i) => {
      const rank = i + 1;
      let rankBadge = `${rank}`;
      if (rank === 1) rankBadge = "🥇";
      else if (rank === 2) rankBadge = "🥈";
      else if (rank === 3) rankBadge = "🥉";

      const relativeSync = user.lastSync ? relativeTime(user.lastSync) : "—";
      const userRepoUrl = `https://github.com/${user.username}`;
      const avatarUrl = user.avatarUrl || `https://github.com/${user.username}.png`;

      return `
        <tr>
          <td class="td-dim" style="font-weight:bold;font-size:14px;text-align:center;width:40px;">${rankBadge}</td>
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              <img src="${avatarUrl}" width="26" height="26" style="border-radius:50%;border:1px solid var(--border);" onerror="this.src='icons/icon128.png'" />
              <div style="font-weight:600;color:var(--text)">${user.displayName || user.username}</div>
            </div>
          </td>
          <td style="font-weight:700;color:var(--green);font-size:14px;">${user.syncedCount}</td>
          <td style="color:var(--orange);font-weight:600;">🔥 ${user.streakCount} day${user.streakCount !== 1 ? 's' : ''}</td>
          <td class="td-dim">${relativeSync}</td>
          <td>
            <a class="gh-link" href="${userRepoUrl}" target="_blank">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
              </svg> Profile
            </a>
          </td>
        </tr>
      `;
    }).join("");

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th style="text-align:center;">Rank</th>
            <th>Coder</th>
            <th>Solved</th>
            <th>Streak</th>
            <th>Last Active</th>
            <th>GitHub</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    try {
      const localData = await chrome.storage.local.get([
        "ghOwner", "displayName", "syncedCount", "streakCount", "lastSync"
      ]);

      if (localData.ghOwner || localData.displayName) {
        const username = localData.ghOwner || "local_user";
        const displayName = localData.displayName || username;
        const syncedCount = Number(localData.syncedCount || 0);
        const streakCount = Number(localData.streakCount || 0);
        const relativeSync = localData.lastSync ? relativeTime(localData.lastSync) : "Never";
        const userRepoUrl = localData.ghOwner ? `https://github.com/${localData.ghOwner}` : "#";
        const avatarUrl = localData.ghOwner ? `https://github.com/${localData.ghOwner}.png` : "icons/icon128.png";

        const rowHtml = `
          <tr>
            <td class="td-dim" style="font-weight:bold;font-size:14px;text-align:center;width:40px;">🥇</td>
            <td>
              <div style="display:flex;align-items:center;gap:10px;">
                <img src="${avatarUrl}" width="26" height="26" style="border-radius:50%;border:1px solid var(--border);" onerror="this.src='icons/icon128.png'" />
                <div style="font-weight:600;color:var(--text)">${displayName} <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(You - Local fallback)</span></div>
              </div>
            </td>
            <td style="font-weight:700;color:var(--green);font-size:14px;">${syncedCount}</td>
            <td style="color:var(--orange);font-weight:600;">🔥 ${streakCount} day${streakCount !== 1 ? 's' : ''}</td>
            <td class="td-dim">${relativeSync}</td>
            <td>
              <a class="gh-link" href="${userRepoUrl}" target="_blank">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
                </svg> Profile
              </a>
            </td>
          </tr>
        `;

        container.innerHTML = `
          <div style="background:rgba(210,153,34,0.1); border:1px solid rgba(210,153,34,0.25); border-radius:var(--radius-sm); padding:14px; margin-bottom:20px; font-size:13px; line-height:1.5; color:var(--text);">
            <div style="font-weight:700; color:var(--orange); display:flex; align-items:center; gap:6px; margin-bottom:4px;">
              ⚠️ Leaderboard database not reachable
            </div>
            We could not fetch the online leaderboard rankings (Database returned: ${err.message}).
            To see online rankings, make sure your Firebase Realtime Database is created, allows public reads, and matches the URL in extension settings. Showing your local stats as a fallback:
          </div>
          <table>
            <thead>
              <tr>
                <th style="text-align:center;">Rank</th>
                <th>Coder</th>
                <th>Solved</th>
                <th>Streak</th>
                <th>Last Active</th>
                <th>GitHub</th>
              </tr>
            </thead>
            <tbody>${rowHtml}</tbody>
          </table>
        `;
      } else {
        container.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Failed to load leaderboard</div><div class="empty-sub">${err.message}</div></div>`;
      }
    } catch (fallbackErr) {
      container.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Failed to load leaderboard</div><div class="empty-sub">${err.message}</div></div>`;
    }
  }
}

