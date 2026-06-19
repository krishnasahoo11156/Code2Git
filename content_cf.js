// content_cf.js — Codeforces Content Script
"use strict";

if (!window.__cfSyncContentLoaded) {
  window.__cfSyncContentLoaded = true;

  // Listen for the "Submit" form submission
  document.addEventListener("submit", (e) => {
    if (e.target.action && (e.target.action.includes("submit") || e.target.action.includes("problem"))) {
      chrome.runtime.sendMessage({ type: "CODEFORCES_SUBMITTED" });
    }
  });

  // Also listen for button clicks in the sidebar submit area
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("input[type='submit']");
    if (btn && btn.value === "Submit") {
      chrome.runtime.sendMessage({ type: "CODEFORCES_SUBMITTED" });
    }
  });

  // Receive notifications from background script
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SYNC_RESULT") {
      showToast(msg);
      sendResponse({ received: true });
    }
  });
}

// Toast rendering helper (similar to LeetCode toast, customized for Codeforces)
function showToast(msg) {
  let container = document.getElementById("cf-sync-toast");
  if (container) container.remove();

  container = document.createElement("div");
  container.id = "cf-sync-toast";
  container.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 99999;
    width: 320px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    color: #e6edf3;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    animation: cfSlideIn 0.3s ease-out;
  `;

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";

  const title = document.createElement("span");
  title.style.cssText = "font-weight:700;display:flex;align-items:center;gap:6px;";
  title.innerHTML = msg.ok ? "⚡ Code2Git Synced" : "❌ Code2Git Failed";
  title.style.color = msg.ok ? "#3fb950" : "#f85149";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.cssText = "background:none;border:none;color:#8b949e;font-size:16px;cursor:pointer;line-height:1;";
  closeBtn.onclick = () => container.remove();

  header.appendChild(title);
  header.appendChild(closeBtn);
  container.appendChild(header);

  const body = document.createElement("div");
  body.style.cssText = "color:#c9d1d9;margin-bottom:8px;word-break:break-word;";
  body.textContent = msg.message;
  container.appendChild(body);

  if (msg.ok) {
    const footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:6px;align-items:center;font-size:11px;color:#8b949e;";
    
    if (msg.difficulty) {
      const diffBadge = document.createElement("span");
      diffBadge.textContent = msg.difficulty;
      diffBadge.style.cssText = "background:rgba(255,161,22,0.15);color:#ffa116;padding:1px 6px;border-radius:3px;font-weight:700;";
      footer.appendChild(diffBadge);
    }
    
    if (msg.lang) {
      const langBadge = document.createElement("span");
      langBadge.textContent = msg.lang;
      langBadge.style.cssText = "background:#30363d;color:#8b949e;padding:1px 6px;border-radius:3px;border:1px solid #21262d;";
      footer.appendChild(langBadge);
    }
    container.appendChild(footer);
  }

  // Animation CSS
  const style = document.createElement("style");
  style.textContent = `
    @keyframes cfSlideIn {
      from { transform: translateY(100px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(container);

  // Auto dismiss in 5s
  setTimeout(() => {
    if (container.parentNode) {
      container.style.opacity = "0";
      container.style.transition = "opacity 0.5s ease";
      setTimeout(() => container.remove(), 500);
    }
  }, 5000);
}
