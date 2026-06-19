// content.js
// Injected into https://leetcode.com/problems/* pages.
// Listens for SYNC_RESULT messages from background.js and shows a toast notification.

// ── Guard against double-injection (e.g. if scripting.executeScript is called after natural injection) ──
if (window.__lcGhSyncContentLoaded) {
  // Already loaded — do nothing
} else {
  window.__lcGhSyncContentLoaded = true;

  // ── Message Listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "SYNC_RESULT") return;
    showToast(msg);
    sendResponse({ received: true });
  });

  // ── SPA Navigation Cleanup ────────────────────────────────────────────────
  // LeetCode is a React SPA. Clean up stale toasts when the user navigates
  // between problems without a full page reload.
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      const stale = document.getElementById("lc-gh-sync-toast");
      if (stale) stale.remove();
    }
  }).observe(document.body, { subtree: true, childList: true });

  // ── Toast Renderer ────────────────────────────────────────────────────────
  function showToast({ ok, title, message, difficulty, lang }) {
    // Remove any existing toast
    const existing = document.getElementById("lc-gh-sync-toast");
    if (existing) existing.remove();

    // Inject keyframe animation style once
    if (!document.getElementById("lc-gh-sync-style")) {
      const style = document.createElement("style");
      style.id = "lc-gh-sync-style";
      style.textContent = `
        @keyframes lcGhSlideIn {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes lcGhFadeOut {
          from { opacity: 1; }
          to   { opacity: 0; transform: translateY(8px); }
        }
        @keyframes lcGhProgress {
          from { width: 100%; }
          to   { width: 0%; }
        }
        #lc-gh-sync-toast {
          animation: lcGhSlideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        #lc-gh-sync-toast.dismissing {
          animation: lcGhFadeOut 0.4s ease forwards;
        }
        #lc-gh-sync-progress {
          animation: lcGhProgress 4s linear forwards;
        }
      `;
      document.head.appendChild(style);
    }

    const githubSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;margin-top:1px"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>`;

    const errorSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;margin-top:1px"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;

    // Build difficulty badge
    const diffColor = { Easy: "#00b8a3", Medium: "#ffa116", Hard: "#ff375f" };
    const diffBadge = difficulty
      ? `<span style="background:${diffColor[difficulty] || "#555"};color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:0.04em">${difficulty}</span>`
      : "";

    const langBadge = lang
      ? `<span style="background:rgba(255,255,255,0.12);color:#fff;font-size:9px;font-weight:600;padding:1px 6px;border-radius:3px">${lang}</span>`
      : "";

    const toast = document.createElement("div");
    toast.id = "lc-gh-sync-toast";
    toast.style.cssText = `
      position: fixed;
      bottom: 28px;
      right: 28px;
      z-index: 2147483647;
      background: ${ok
        ? "linear-gradient(135deg, #1a3a2a 0%, #0f2318 100%)"
        : "linear-gradient(135deg, #3a1a1a 0%, #230f0f 100%)"};
      color: #fff;
      padding: 14px 16px 10px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px ${ok ? "rgba(63,185,80,0.25)" : "rgba(248,81,73,0.25)"};
      max-width: 320px;
      min-width: 240px;
      line-height: 1.4;
      overflow: hidden;
      cursor: pointer;
      user-select: none;
    `;

    toast.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="color:${ok ? "#3fb950" : "#f85149"};margin-top:1px">${ok ? githubSVG : errorSVG}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;color:${ok ? "#3fb950" : "#f85149"};margin-bottom:3px">
            ${ok ? "✓ Synced to GitHub" : "✗ Sync Failed"}
          </div>
          ${title ? `<div style="font-weight:600;font-size:12px;color:#e6e6e6;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>` : ""}
          ${(diffBadge || langBadge) ? `<div style="display:flex;gap:4px;margin-bottom:4px;flex-wrap:wrap">${diffBadge}${langBadge}</div>` : ""}
          ${message ? `<div style="font-size:11px;color:rgba(255,255,255,0.55);word-break:break-all">${message}</div>` : ""}
        </div>
        <div id="lc-gh-sync-close" style="color:rgba(255,255,255,0.4);font-size:16px;line-height:1;cursor:pointer;flex-shrink:0;margin-top:-2px" title="Dismiss">×</div>
      </div>
      <div style="margin-top:10px;height:2px;background:rgba(255,255,255,0.08);border-radius:1px;overflow:hidden">
        <div id="lc-gh-sync-progress" style="height:100%;background:${ok ? "#3fb950" : "#f85149"};border-radius:1px"></div>
      </div>
    `;

    document.body.appendChild(toast);

    // Dismiss on click (anywhere on toast or close button)
    const dismiss = () => {
      toast.classList.add("dismissing");
      clearTimeout(autoTimer);
      setTimeout(() => toast.remove(), 400);
    };
    toast.addEventListener("click", dismiss);

    // Auto-dismiss after 5 seconds
    const autoTimer = setTimeout(dismiss, 5000);
  }
}
