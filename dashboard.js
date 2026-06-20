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

// ─── Language Normalization Helper ──────────────────────────────────────────
function normalizeLanguage(lang) {
  if (!lang) return "";
  const name = lang.trim();
  const lower = name.toLowerCase();
  if (lower === "unknown" || lower === "n/a" || lower === "none") return "";

  if (lower.startsWith("java")) return "Java";
  if (lower.includes("c++") || lower.includes("cpp") || lower.includes("g++")) return "C++";
  if (lower.startsWith("python") || lower.includes("pypy")) return "Python";
  if (lower === "c" || lower.startsWith("gnu c") || lower.includes("gcc")) {
    if (lower.includes("c++") || lower.includes("cpp")) return "C++";
    return "C";
  }
  if (lower.includes("c#") || lower.includes("csharp")) return "C#";
  if (lower.includes("javascript") || lower === "js" || lower.includes("node")) return "JavaScript";
  if (lower.includes("typescript") || lower === "ts") return "TypeScript";
  if (lower.includes("golang") || lower === "go") return "Go";
  if (lower.includes("rust")) return "Rust";
  if (lower.includes("kotlin")) return "Kotlin";
  if (lower.includes("swift")) return "Swift";
  if (lower.includes("ruby")) return "Ruby";
  if (lower.includes("scala")) return "Scala";
  if (lower.includes("php")) return "PHP";

  // Capitalize first letter as fallback
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ─── Entry Point ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const data = await chrome.storage.local.get([
    "syncedCount", "streakCount", "lastSync",
    "syncHistory", "ghOwner", "ghRepo", "ghBranch", "displayName"
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
  renderShareCard(data, history);
  setupShareButton(data, history);

  // Tabs Navigation
  const btnShowStats = document.getElementById("btnShowStats");
  const btnShowLeaderboard = document.getElementById("btnShowLeaderboard");
  const btnShowPlatforms = document.getElementById("btnShowPlatforms");
  const statsContainer = document.getElementById("statsContainer");
  const leaderboardContainer = document.getElementById("leaderboardContainer");
  const platformsContainer = document.getElementById("platformsContainer");

  btnShowStats.addEventListener("click", () => {
    btnShowStats.classList.add("active");
    btnShowLeaderboard.classList.remove("active");
    btnShowPlatforms.classList.remove("active");
    statsContainer.style.display = "block";
    leaderboardContainer.style.display = "none";
    platformsContainer.style.display = "none";
  });

  btnShowLeaderboard.addEventListener("click", () => {
    btnShowLeaderboard.classList.add("active");
    btnShowStats.classList.remove("active");
    btnShowPlatforms.classList.remove("active");
    statsContainer.style.display = "none";
    leaderboardContainer.style.display = "block";
    platformsContainer.style.display = "none";
    fetchAndRenderLeaderboard();
  });

  btnShowPlatforms.addEventListener("click", () => {
    btnShowPlatforms.classList.add("active");
    btnShowStats.classList.remove("active");
    btnShowLeaderboard.classList.remove("active");
    statsContainer.style.display = "none";
    leaderboardContainer.style.display = "none";
    platformsContainer.style.display = "block";
    renderPlatformsSection();
  });

  // Platforms timeline filter
  const platformTimelineFilter = document.getElementById("platformTimelineFilter");
  if (platformTimelineFilter) {
    platformTimelineFilter.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;
      platformTimelineFilter.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderPlatformsSection(btn.dataset.platform);
    });
  }

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
    btnGlobal.classList.remove("active");
    btnClub.classList.add("active");
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
  const langs  = new Set(history.map(e => normalizeLanguage(e.lang)).filter(Boolean)).size;

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
    if (e.lang) {
      const norm = normalizeLanguage(e.lang);
      langCount[norm] = (langCount[norm] || 0) + 1;
    }
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
        <td><span class="badge badge-lang">${normalizeLanguage(entry.lang) || "—"}</span></td>
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

  if (changes.syncHistory || changes.syncedCount || changes.streakCount || changes.lastSync || changes.leaderboardUrl || changes.displayName || changes.ghOwner) {
    const data = await chrome.storage.local.get([
      "syncedCount", "streakCount", "lastSync",
      "syncHistory", "ghOwner", "ghRepo", "ghBranch", "displayName"
    ]);
    const history = data.syncHistory || [];
    renderStatCards(data, history);
    renderHeatmap(history);
    renderDonutChart(history);
    renderLangBarChart(history);
    const activeFilter = document.querySelector(".filter-btn.active")?.dataset.diff || "all";
    renderHistoryTable(history, data.ghOwner || "", data.ghRepo || "", data.ghBranch || "main", activeFilter);
    renderShareCard(data, history);
    setupShareButton(data, history);
    
    // Also refresh leaderboard if it is currently visible
    const leaderboardContainer = document.getElementById("leaderboardContainer");
    if (leaderboardContainer && leaderboardContainer.style.display !== "none") {
      fetchAndRenderLeaderboard();
    }

    // Also refresh platforms if it is currently visible
    const platformsContainer = document.getElementById("platformsContainer");
    if (platformsContainer && platformsContainer.style.display !== "none") {
      const activePlatformFilter = document.querySelector("#platformTimelineFilter .filter-btn.active")?.dataset.platform || "all";
      renderPlatformsSection(activePlatformFilter);
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

// ─── Platforms Section Render ─────────────────────────────────────────────
async function renderPlatformsSection(filterPlatform = "all") {
  const grid = document.getElementById("platformStatsGrid");
  const body = document.getElementById("platformsBody");
  if (!grid || !body) return;

  grid.innerHTML = `<div style="text-align:center;width:100%;grid-column:1/-1;padding:20px;color:var(--text-muted);"><span class="spinner"></span> Loading stats…</div>`;
  body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);"><span class="spinner"></span> Loading timeline…</div>`;

  try {
    const data = await chrome.storage.local.get([
      "syncHistory", "ghOwner", "ghRepo", "ghBranch"
    ]);

    const history = data.syncHistory || [];
    const ghOwner = data.ghOwner || "";
    const ghRepo = data.ghRepo || "";
    const ghBranch = data.ghBranch || "main";

    // Helper to identify platform
    const getPlatform = (entry) => {
      if (entry.platform) return entry.platform;
      const path = entry.githubPath || "";
      if (path.startsWith("Codeforces/")) return "Codeforces";
      if (path.startsWith("GeeksforGeeks/")) return "GeeksforGeeks";
      if (path.startsWith("HackerRank/")) return "HackerRank";
      return "LeetCode";
    };

    // Calculate platform counts
    const counts = { LeetCode: 0, Codeforces: 0, GeeksforGeeks: 0, HackerRank: 0 };
    history.forEach(entry => {
      const plat = getPlatform(entry);
      if (counts[plat] !== undefined) counts[plat]++;
    });

    // Render Stats Cards
    grid.innerHTML = `
      <div class="stat-card animate delay-1" style="--card-accent: #ffa116;">
        <span class="icon">🧡</span>
        <div class="num">${counts.LeetCode}</div>
        <div class="lbl">LeetCode</div>
        <div class="sub">Solved problems</div>
      </div>
      <div class="stat-card animate delay-2" style="--card-accent: #58a6ff;">
        <span class="icon">💙</span>
        <div class="num">${counts.Codeforces}</div>
        <div class="lbl">Codeforces</div>
        <div class="sub">Solved problems</div>
      </div>
      <div class="stat-card animate delay-3" style="--card-accent: #2ea44f;">
        <span class="icon">💚</span>
        <div class="num">${counts.GeeksforGeeks}</div>
        <div class="lbl">GeeksforGeeks</div>
        <div class="sub">Solved problems</div>
      </div>
      <div class="stat-card animate delay-4" style="--card-accent: #bc8cff;">
        <span class="icon">💜</span>
        <div class="num">${counts.HackerRank}</div>
        <div class="lbl">HackerRank</div>
        <div class="sub">Solved problems</div>
      </div>
    `;

    // Filter timeline entries
    const filteredHistory = filterPlatform === "all"
      ? history
      : history.filter(entry => getPlatform(entry) === filterPlatform);

    if (filteredHistory.length === 0) {
      body.innerHTML = `
        <div class="empty">
          <div class="empty-icon">📅</div>
          <div class="empty-title">No problems found</div>
          <div class="empty-sub">No solved problems recorded for <strong>${filterPlatform === "all" ? "any platform" : filterPlatform}</strong> yet.</div>
        </div>`;
      return;
    }

    // Group chronologically
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

    const groups = {
      today: [],
      yesterday: [],
      thisWeek: [],
      older: []
    };

    filteredHistory.forEach(entry => {
      const ts = entry.timestamp;
      if (!ts) {
        groups.older.push(entry);
        return;
      }
      if (ts >= todayStart) {
        groups.today.push(entry);
      } else if (ts >= yesterdayStart) {
        groups.yesterday.push(entry);
      } else if (ts >= weekStart) {
        groups.thisWeek.push(entry);
      } else {
        groups.older.push(entry);
      }
    });

    let html = "";
    const groupDefs = [
      { key: "today", title: "Today" },
      { key: "yesterday", title: "Yesterday" },
      { key: "thisWeek", title: "This Week" },
      { key: "older", title: "Older" }
    ];

    groupDefs.forEach(g => {
      const items = groups[g.key];
      if (items.length === 0) return;

      const itemsHtml = items.map(entry => {
        const plat = getPlatform(entry);
        const badgeCls = `badge-${plat.toLowerCase()}`;
        const diff = entry.difficulty || "Unknown";
        const diffCls = `badge-${diff.toLowerCase()}`;
        const ghPath = entry.githubPath || "";
        const ghUrl = ghOwner && ghRepo && ghPath
          ? `https://github.com/${ghOwner}/${ghRepo}/blob/${ghBranch}/${ghPath}`
          : "";
        
        let platIcon = "💻";
        if (plat === "LeetCode") platIcon = "🧡";
        else if (plat === "Codeforces") platIcon = "💙";
        else if (plat === "GeeksforGeeks") platIcon = "💚";
        else if (plat === "HackerRank") platIcon = "💜";

        const titleHtml = ghUrl
          ? `<a href="${ghUrl}" target="_blank" title="View on GitHub">${entry.title || "—"}</a>`
          : (entry.title || "—");

        const qId = entry.questionId ? `#${entry.questionId}` : "";
        const qIdHtml = qId ? `<span style="color:var(--text-dim);font-size:11px;margin-right:6px;">${qId}</span>` : "";

        const ghLinkHtml = ghUrl
          ? `<a class="gh-link" href="${ghUrl}" target="_blank">
               <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                 <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
               </svg> View code
             </a>`
          : "";

        let timeStr = "";
        if (entry.timestamp) {
          const d = new Date(entry.timestamp);
          if (entry.timestamp >= yesterdayStart) {
            timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          } else {
            timeStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }
        } else {
          timeStr = "—";
        }

        return `
          <div class="timeline-item">
            <div class="timeline-item-left">
              <span class="platform-badge ${badgeCls}">${platIcon} ${plat}</span>
              <div style="min-width:0;flex:1;">
                <div class="timeline-item-title">${qIdHtml}${titleHtml}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                  <span class="badge ${diffCls}" style="font-size:9px;padding:1px 5px;">${diff}</span>
                  <span class="badge badge-lang" style="font-size:9px;padding:1px 5px;">${normalizeLanguage(entry.lang) || "—"}</span>
                  <span class="timeline-item-time">${timeStr}</span>
                </div>
              </div>
            </div>
            <div class="timeline-item-right">
              ${ghLinkHtml}
            </div>
          </div>
        `;
      }).join("");

      html += `
        <div class="timeline-group">
          <div class="timeline-group-title">${g.title}</div>
          <div class="timeline-items">
            ${itemsHtml}
          </div>
        </div>
      `;
    });

    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Failed to load timeline</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

// ─── Share Achievements Card Rendering & Logic ─────────────────────────────
function renderShareCard(data, history) {
  const totalSolvedEl = document.getElementById("shareTotalSolved");
  const currentStreakEl = document.getElementById("shareCurrentStreak");
  const longestStreakEl = document.getElementById("shareLongestStreak");
  const questionsListEl = document.getElementById("shareQuestionsList");

  if (!totalSolvedEl || !currentStreakEl || !longestStreakEl || !questionsListEl) return;

  const total = data.syncedCount || 0;
  const streak = data.streakCount || 0;
  const longest = computeLongestStreak(history);

  const userName = data.displayName || data.ghOwner || "";
  const userBadgeEl = document.getElementById("shareUserBadge");
  if (userBadgeEl) {
    if (userName) {
      userBadgeEl.textContent = `👤 ${userName}`;
      userBadgeEl.style.display = "inline-flex";
    } else {
      userBadgeEl.style.display = "none";
    }
  }

  totalSolvedEl.textContent = total;
  currentStreakEl.textContent = streak;
  longestStreakEl.textContent = longest;

  // Platform Counts
  const platformCounts = { LeetCode: 0, Codeforces: 0, GeeksforGeeks: 0, HackerRank: 0 };
  
  // Helper to identify platform
  const getPlatform = (entry) => {
    if (entry.platform) return entry.platform;
    const path = entry.githubPath || "";
    if (path.startsWith("Codeforces/")) return "Codeforces";
    if (path.startsWith("GeeksforGeeks/")) return "GeeksforGeeks";
    if (path.startsWith("HackerRank/")) return "HackerRank";
    return "LeetCode";
  };

  history.forEach(entry => {
    const plat = getPlatform(entry);
    if (platformCounts[plat] !== undefined) platformCounts[plat]++;
  });

  document.getElementById("shareCountLeetCode").textContent = platformCounts.LeetCode;
  document.getElementById("shareCountCodeforces").textContent = platformCounts.Codeforces;
  document.getElementById("shareCountGeeksforGeeks").textContent = platformCounts.GeeksforGeeks;
  document.getElementById("shareCountHackerRank").textContent = platformCounts.HackerRank;

  // Calculate & set Platform Progress Bars
  const platformTotal = platformCounts.LeetCode + platformCounts.Codeforces + platformCounts.GeeksforGeeks + platformCounts.HackerRank;
  const setBarWidth = (fillId, count, totalVal) => {
    const el = document.getElementById(fillId);
    if (el) {
      const pct = totalVal > 0 ? (count / totalVal) * 100 : 0;
      el.style.width = `${pct}%`;
    }
  };
  setBarWidth("sharePlatformBarLeetCode", platformCounts.LeetCode, platformTotal);
  setBarWidth("sharePlatformBarCodeforces", platformCounts.Codeforces, platformTotal);
  setBarWidth("sharePlatformBarGeeksforGeeks", platformCounts.GeeksforGeeks, platformTotal);
  setBarWidth("sharePlatformBarHackerRank", platformCounts.HackerRank, platformTotal);

  // Difficulty Counts
  const diffCounts = { Easy: 0, Medium: 0, Hard: 0 };
  history.forEach(entry => {
    if (entry.difficulty && diffCounts[entry.difficulty] !== undefined) {
      diffCounts[entry.difficulty]++;
    }
  });

  document.getElementById("shareCountEasy").textContent = diffCounts.Easy;
  document.getElementById("shareCountMedium").textContent = diffCounts.Medium;
  document.getElementById("shareCountHard").textContent = diffCounts.Hard;

  // Calculate & set Difficulty Progress Bars
  const diffTotal = diffCounts.Easy + diffCounts.Medium + diffCounts.Hard;
  setBarWidth("shareDiffBarEasy", diffCounts.Easy, diffTotal);
  setBarWidth("shareDiffBarMedium", diffCounts.Medium, diffTotal);
  setBarWidth("shareDiffBarHard", diffCounts.Hard, diffTotal);

  // Render Scrollable Questions List
  if (history.length === 0) {
    questionsListEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-dim);font-size:12px;">No questions synced yet</div>`;
  } else {
    questionsListEl.innerHTML = history.map(entry => {
      const plat = getPlatform(entry);
      let platIcon = "💻";
      if (plat === "LeetCode") platIcon = "🧡";
      else if (plat === "Codeforces") platIcon = "💙";
      else if (plat === "GeeksforGeeks") platIcon = "💚";
      else if (plat === "HackerRank") platIcon = "💜";

      const diff = entry.difficulty || "Unknown";
      const diffClass = `badge-${diff.toLowerCase()}`;
      const qId = entry.questionId ? `#${entry.questionId} ` : "";

      return `
        <div class="share-question-item">
          <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1;">
            <span style="font-size:14px; flex-shrink:0;">${platIcon}</span>
            <span class="share-question-name" title="${entry.title || ""}">${qId}${entry.title || "—"}</span>
          </div>
          <span class="badge ${diffClass}" style="font-size:9px; padding:1px 5px; flex-shrink:0;">${diff}</span>
        </div>
      `;
    }).join("");
  }
}

function generateShareText(data, history) {
  const total = data.syncedCount || 0;
  const streak = data.streakCount || 0;
  const longest = computeLongestStreak(history);
  
  // Platform counts
  const platformCounts = { LeetCode: 0, Codeforces: 0, GeeksforGeeks: 0, HackerRank: 0 };
  const diffCounts = { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 };
  const langCounts = {};

  const getPlatform = (entry) => {
    if (entry.platform) return entry.platform;
    const path = entry.githubPath || "";
    if (path.startsWith("Codeforces/")) return "Codeforces";
    if (path.startsWith("GeeksforGeeks/")) return "GeeksforGeeks";
    if (path.startsWith("HackerRank/")) return "HackerRank";
    return "LeetCode";
  };
  
  history.forEach(item => {
    const plat = getPlatform(item);
    if (platformCounts[plat] !== undefined) {
      platformCounts[plat]++;
    }
    if (item.difficulty && diffCounts[item.difficulty] !== undefined) {
      diffCounts[item.difficulty]++;
    } else if (item.difficulty) {
      diffCounts.Unknown++;
    }
    if (item.lang) {
      const norm = normalizeLanguage(item.lang);
      if (norm) langCounts[norm] = (langCounts[norm] || 0) + 1;
    }
  });

  const sortedLangs = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lang, count]) => `${lang} (${count})`)
    .join(", ");

  let text = `🚀 *My Code2Git Achievements* 🚀\n\n`;
  text += `📊 *Summary Stats*:\n`;
  text += `• Total Solved: ${total} problem${total !== 1 ? 's' : ''}\n`;
  text += `• Current Streak: 🔥 ${streak} day${streak !== 1 ? 's' : ''}\n`;
  text += `• Longest Streak: 👑 ${longest} day${longest !== 1 ? 's' : ''}\n\n`;
  
  text += `🖥️ *Platform Breakdown*:\n`;
  text += `• LeetCode: ${platformCounts.LeetCode}\n`;
  text += `• Codeforces: ${platformCounts.Codeforces}\n`;
  text += `• GeeksforGeeks: ${platformCounts.GeeksforGeeks}\n`;
  text += `• HackerRank: ${platformCounts.HackerRank}\n\n`;
  
  text += `📈 *Difficulty Levels*:\n`;
  text += `• Easy: ${diffCounts.Easy}\n`;
  text += `• Medium: ${diffCounts.Medium}\n`;
  text += `• Hard: ${diffCounts.Hard}\n\n`;

  if (sortedLangs) {
    text += `🔤 *Top Languages*: ${sortedLangs}\n\n`;
  }

  // Solved questions (limit to top 5)
  if (history.length > 0) {
    text += `📝 *Latest Solved Problems*:\n`;
    const items = history.slice(0, 5);
    items.forEach((item, idx) => {
      const qId = item.questionId ? `#${item.questionId} ` : "";
      text += `${idx + 1}. [${getPlatform(item)}] ${qId}${item.title || "Unknown"} (${item.difficulty || "Medium"})\n`;
    });
    if (history.length > 5) {
      text += `...and ${history.length - 5} more!\n`;
    }
    text += `\n`;
  }
  
  const repoOwner = data.ghOwner || "krishnasahoo11156";
  const repoName = data.ghRepo || "Code2Git";
  text += `Check out my GitHub Solutions Repo: https://github.com/${repoOwner}/${repoName}\n`;
  text += `Shared via Code2Git 🚀`;
  
  return text;
}

function showShareToast(message) {
  const existing = document.querySelector(".share-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "share-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.4s ease";
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

function setupShareButton(data, history) {
  const btnShare = document.getElementById("btnShareAchievements");
  const dropdown = document.getElementById("shareDropdown");

  if (!btnShare || !dropdown) return;

  // Toggle dropdown on button click
  btnShare.onclick = (e) => {
    e.stopPropagation();
    const isVisible = dropdown.style.display === "flex";
    dropdown.style.display = isVisible ? "none" : "flex";
  };

  // Close dropdown on click outside
  document.addEventListener("click", () => {
    dropdown.style.display = "none";
  });

  // Handle WhatsApp Share
  const btnWhatsApp = document.getElementById("btnShareWhatsApp");
  if (btnWhatsApp) {
    btnWhatsApp.onclick = (e) => {
      e.stopPropagation();
      dropdown.style.display = "none";
      const text = generateShareText(data, history);
      const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank");
    };
  }

  // Handle Native Share
  const btnNative = document.getElementById("btnShareNative");
  if (btnNative) {
    btnNative.onclick = (e) => {
      e.stopPropagation();
      dropdown.style.display = "none";
      const text = generateShareText(data, history);
      if (navigator.share) {
        navigator.share({
          title: "My Code2Git Achievements",
          text: text
        }).catch(err => {
          console.log("Error sharing natively:", err);
        });
      } else {
        // Fallback to Clipboard copy if not supported
        navigator.clipboard.writeText(text).then(() => {
          showShareToast("📋 Native share not supported. Stats copied to clipboard!");
        });
      }
    };
  }

  // Handle Clipboard Copy
  const btnCopy = document.getElementById("btnShareCopy");
  if (btnCopy) {
    btnCopy.onclick = (e) => {
      e.stopPropagation();
      dropdown.style.display = "none";
      const text = generateShareText(data, history);
      navigator.clipboard.writeText(text).then(() => {
        showShareToast("📋 Stats copied to clipboard!");
      }).catch(err => {
        showShareToast("❌ Failed to copy stats to clipboard");
      });
    };
  }

  // Handle Download Image Card (PNG)
  const btnDownloadImage = document.getElementById("btnShareDownloadImage");
  if (btnDownloadImage) {
    btnDownloadImage.onclick = (e) => {
      e.stopPropagation();
      dropdown.style.display = "none";
      try {
        const canvas = generateShareCardCanvas(data, history);
        const dataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.download = `code2git-achievements-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
        showShareToast("🖼️ Achievements card PNG downloaded!");
      } catch (err) {
        console.error("Error downloading image:", err);
        showShareToast("❌ Failed to generate achievements card image");
      }
    };
  }

  // Handle Share Image Card (Native)
  const btnShareImageNative = document.getElementById("btnShareImageNative");
  if (btnShareImageNative) {
    btnShareImageNative.onclick = (e) => {
      e.stopPropagation();
      dropdown.style.display = "none";
      try {
        const canvas = generateShareCardCanvas(data, history);
        canvas.toBlob((blob) => {
          if (!blob) {
            showShareToast("❌ Failed to generate image blob");
            return;
          }
          const file = new File([blob], `code2git-achievements-${Date.now()}.png`, { type: "image/png" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
              files: [file],
              title: "My Code2Git Achievements",
              text: "Check out my coding stats synced via Code2Git!"
            }).catch(err => {
              console.log("Error sharing natively:", err);
            });
          } else {
            // Fallback to Download PNG if native sharing isn't supported for files
            const dataUrl = canvas.toDataURL("image/png");
            const link = document.createElement("a");
            link.download = `code2git-achievements-${Date.now()}.png`;
            link.href = dataUrl;
            link.click();
            showShareToast("⚠️ Native image sharing not supported. Image downloaded instead!");
          }
        }, "image/png");
      } catch (err) {
        console.error("Error sharing image:", err);
        showShareToast("❌ Failed to share achievements card image");
      }
    };
  }
}

// ─── Offscreen Canvas Image Generator ──────────────────────────────────────
function generateShareCardCanvas(data, history) {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 450;
  const ctx = canvas.getContext("2d");

  // Helper to draw rounded rectangles
  const drawRoundRect = (x, y, w, h, r, fillColor, strokeColor, strokeWidth = 1) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  };

  // Helper to draw clean status bullets
  const drawBullet = (bx, by, bcolor) => {
    ctx.beginPath();
    ctx.fillStyle = bcolor;
    ctx.arc(bx, by - 4, 4, 0, 2 * Math.PI);
    ctx.fill();
  };

  // Helper to draw progress bars
  const drawProgressBar = (x, y, w, h, pct, color) => {
    // Draw background track
    drawRoundRect(x, y, w, h, h / 2, "#21262d", null);
    // Draw fill
    if (pct > 0) {
      const fillWidth = Math.max(h, (pct / 100) * w);
      drawRoundRect(x, y, fillWidth, h, h / 2, color, null);
    }
  };

  // Helper to truncate text
  const truncateText = (txt, maxWidth) => {
    if (ctx.measureText(txt).width <= maxWidth) return txt;
    let temp = txt;
    while (temp.length > 0 && ctx.measureText(temp + "...").width > maxWidth) {
      temp = temp.slice(0, -1);
    }
    return temp + "...";
  };

  // 1. Background gradient
  const grad = ctx.createLinearGradient(0, 0, 800, 450);
  grad.addColorStop(0, "#0d1117");
  grad.addColorStop(1, "#161b22");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 450);

  // 2. Glowing glassmorphism circles
  ctx.beginPath();
  const glow1 = ctx.createRadialGradient(720, 90, 10, 720, 90, 250);
  glow1.addColorStop(0, "rgba(188, 140, 255, 0.12)");
  glow1.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow1;
  ctx.arc(720, 90, 250, 0, 2 * Math.PI);
  ctx.fill();

  ctx.beginPath();
  const glow2 = ctx.createRadialGradient(80, 360, 10, 80, 360, 250);
  glow2.addColorStop(0, "rgba(88, 166, 255, 0.12)");
  glow2.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow2;
  ctx.arc(80, 360, 250, 0, 2 * Math.PI);
  ctx.fill();

  // 3. Card border (Professional Gradient)
  const borderGrad = ctx.createLinearGradient(0, 0, 800, 450);
  borderGrad.addColorStop(0, "#58a6ff"); // Blue
  borderGrad.addColorStop(1, "#bc8cff"); // Purple
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 796, 446);

  // 4. Header title, verified badge & subtitle
  ctx.fillStyle = "#e6edf3";
  ctx.font = "bold 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("Code2Git Achievements", 40, 60);
  
  const titleWidth = ctx.measureText("Code2Git Achievements").width;
  const badgeX = 40 + titleWidth + 12;
  const badgeY = 41;

  // Draw verified pill badge
  const badgeText = "Verified Coder";
  ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const badgeTextWidth = ctx.measureText(badgeText).width;
  const badgeWidth = badgeTextWidth + 28;
  const badgeHeight = 22;

  // Fill verified pill background and border
  drawRoundRect(badgeX, badgeY - 2, badgeWidth, badgeHeight, 11, "rgba(63, 185, 80, 0.12)", "rgba(63, 185, 80, 0.3)", 1);

  // Draw green checkmark circle
  ctx.beginPath();
  ctx.fillStyle = "#3fb950";
  ctx.arc(badgeX + 11, badgeY + 9, 6, 0, 2 * Math.PI);
  ctx.fill();

  // Draw white checkmark inside circle
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(badgeX + 8.5, badgeY + 9);
  ctx.lineTo(badgeX + 10.5, badgeY + 11);
  ctx.lineTo(badgeX + 13.5, badgeY + 7);
  ctx.stroke();

  // Draw text "Verified Coder"
  ctx.fillStyle = "#3fb950";
  ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(badgeText, badgeX + 22, badgeY + 13);

  ctx.fillStyle = "#8b949e";
  ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("Auto-syncing LeetCode, Codeforces & more to GitHub", 40, 85);

  const total = data.syncedCount || 0;
  const streak = data.streakCount || 0;
  const longest = computeLongestStreak(history);

  // 5. Draw rounded rectangles for the 3 main cards
  // Card 1: Total Solved
  drawRoundRect(40, 110, 220, 100, 8, "#161b22", "#30363d");
  ctx.fillStyle = "#3fb950";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(String(total), 60, 160);
  ctx.fillStyle = "#8b949e";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText("TOTAL PROBLEMS SOLVED", 60, 188);

  // Card 2: Current Streak
  drawRoundRect(280, 110, 220, 100, 8, "#161b22", "#30363d");
  ctx.fillStyle = "#ffa116";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(String(streak) + " 🔥", 300, 160);
  ctx.fillStyle = "#8b949e";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText("CURRENT STREAK", 300, 188);

  // Card 3: Longest Streak
  drawRoundRect(520, 110, 240, 100, 8, "#161b22", "#30363d");
  ctx.fillStyle = "#bc8cff";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(String(longest) + " 👑", 540, 160);
  ctx.fillStyle = "#8b949e";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText("LONGEST STREAK", 540, 188);

  // Platform breakdown counts
  const platformCounts = { LeetCode: 0, Codeforces: 0, GeeksforGeeks: 0, HackerRank: 0 };
  const getPlatform = (entry) => {
    if (entry.platform) return entry.platform;
    const path = entry.githubPath || "";
    if (path.startsWith("Codeforces/")) return "Codeforces";
    if (path.startsWith("GeeksforGeeks/")) return "GeeksforGeeks";
    if (path.startsWith("HackerRank/")) return "HackerRank";
    return "LeetCode";
  };
  history.forEach(entry => {
    const plat = getPlatform(entry);
    if (platformCounts[plat] !== undefined) platformCounts[plat]++;
  });

  const platformTotal = platformCounts.LeetCode + platformCounts.Codeforces + platformCounts.GeeksforGeeks + platformCounts.HackerRank;

  // 6. Draw Platform Activity section (Column 1: x: 40 to 260)
  ctx.fillStyle = "#8b949e";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText("PLATFORMS", 40, 252);

  ctx.font = "12px sans-serif";
  const platData = [
    { name: "LeetCode", count: platformCounts.LeetCode, color: "#ffa116", bullet: "#ffa116" },
    { name: "Codeforces", count: platformCounts.Codeforces, color: "#58a6ff", bullet: "#58a6ff" },
    { name: "GFG", count: platformCounts.GeeksforGeeks, color: "#2ea44f", bullet: "#2ea44f" },
    { name: "HackerRank", count: platformCounts.HackerRank, color: "#bc8cff", bullet: "#bc8cff" }
  ];

  platData.forEach((plat, i) => {
    const py = 280 + i * 32;
    drawBullet(45, py, plat.bullet);
    
    // Draw Name
    ctx.fillStyle = "#e6edf3";
    ctx.fillText(plat.name, 56, py);

    // Draw Count
    ctx.fillStyle = "#8b949e";
    ctx.fillText(String(plat.count), 136, py);

    // Draw progress bar
    const pct = platformTotal > 0 ? (plat.count / platformTotal) * 100 : 0;
    drawProgressBar(160, py - 10, 100, 5, pct, plat.color);
  });

  // 7. Draw Difficulty Segregation (Column 2: x: 320 to 520)
  const diffCounts = { Easy: 0, Medium: 0, Hard: 0 };
  history.forEach(entry => {
    if (entry.difficulty && diffCounts[entry.difficulty] !== undefined) {
      diffCounts[entry.difficulty]++;
    }
  });

  const diffTotal = diffCounts.Easy + diffCounts.Medium + diffCounts.Hard;

  ctx.fillStyle = "#8b949e";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText("DIFFICULTY SEGREGATION", 320, 252);

  ctx.font = "12px sans-serif";
  const diffData = [
    { name: "Easy", count: diffCounts.Easy, color: "#00b8a3", bullet: "#00b8a3" },
    { name: "Medium", count: diffCounts.Medium, color: "#ffa116", bullet: "#ffa116" },
    { name: "Hard", count: diffCounts.Hard, color: "#ff375f", bullet: "#ff375f" }
  ];

  diffData.forEach((diff, i) => {
    const dy = 280 + i * 32;
    drawBullet(325, dy, diff.bullet);

    // Draw Name
    ctx.fillStyle = "#e6edf3";
    ctx.fillText(diff.name, 336, dy);

    // Draw Count
    ctx.fillStyle = "#8b949e";
    ctx.fillText(String(diff.count), 406, dy);

    // Draw progress bar
    const pct = diffTotal > 0 ? (diff.count / diffTotal) * 100 : 0;
    drawProgressBar(430, dy - 10, 90, 5, pct, diff.color);
  });

  // 8. Draw Recent Problems (Column 3: x: 560 to 760)
  ctx.fillStyle = "#8b949e";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText("RECENTLY SYNCED PROBLEMS", 560, 252);

  const recentItems = history.slice(0, 4);
  if (recentItems.length === 0) {
    ctx.fillStyle = "#484f58";
    ctx.font = "italic 12px sans-serif";
    ctx.fillText("No problems synced yet", 560, 280);
  } else {
    ctx.font = "12px sans-serif";
    recentItems.forEach((entry, i) => {
      const ry = 280 + i * 32;
      const plat = getPlatform(entry);

      // Icon & platform identification
      let platIcon = "🧡";
      let platColor = "#ffa116";
      if (plat === "Codeforces") { platIcon = "💙"; platColor = "#58a6ff"; }
      else if (plat === "GeeksforGeeks") { platIcon = "💚"; platColor = "#2ea44f"; }
      else if (plat === "HackerRank") { platIcon = "💜"; platColor = "#bc8cff"; }

      // Draw platform icon indicator
      ctx.fillStyle = platColor;
      ctx.fillText(platIcon, 560, ry);

      // Truncate and draw title
      ctx.fillStyle = "#e6edf3";
      const qId = entry.questionId ? `#${entry.questionId} ` : "";
      const fullTitle = `${qId}${entry.title || "—"}`;
      const truncTitle = truncateText(fullTitle, 135);
      ctx.fillText(truncTitle, 578, ry);

      // Draw mini difficulty badge
      const diff = entry.difficulty || "Easy";
      let diffColor = "#00b8a3";
      if (diff === "Medium") diffColor = "#ffa116";
      else if (diff === "Hard") diffColor = "#ff375f";

      drawRoundRect(725, ry - 11, 35, 14, 3, "rgba(0, 0, 0, 0.3)", diffColor, 1);
      ctx.fillStyle = diffColor;
      ctx.font = "bold 9px sans-serif";
      ctx.fillText(diff.slice(0, 3).toUpperCase(), 733, ry - 1);
      
      // Reset font back for the next line
      ctx.font = "12px sans-serif";
    });
  }

  // 8b. Draw User Name Tag Pill (aligned nicely in top right)
  const userName = data.displayName || data.ghOwner || "Coder";
  ctx.font = "bold 13px sans-serif";
  const nameWidth = ctx.measureText(userName).width;
  const pillWidth = nameWidth + 24;
  const pillHeight = 26;
  const pillX = 760 - pillWidth;
  const pillY = 38;
  drawRoundRect(pillX, pillY, pillWidth, pillHeight, 6, "#161b22", "#30363d");

  ctx.fillStyle = "#58a6ff";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText(userName, pillX + 12, pillY + 17);

  // 9. Draw Footer
  ctx.fillStyle = "#484f58";
  ctx.font = "11px sans-serif";
  const repoOwner = data.ghOwner || "krishnasahoo11156";
  const repoName = data.ghRepo || "Code2Git";
  ctx.fillText(`github.com/${repoOwner}/${repoName}`, 40, 425);
  ctx.fillText("Generated by Code2Git Chrome Extension", 560, 425);

  return canvas;
}

