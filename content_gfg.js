// content_gfg.js — GeeksforGeeks Content Script
"use strict";

if (!window.__gfgSyncContentLoaded) {
  window.__gfgSyncContentLoaded = true;

  // Listen for the code extraction event from page context
  document.addEventListener("GFG_CODE_EXTRACTED", (e) => {
    const code = e.detail;
    if (code) {
      handleGFGSolved(code);
    }
  });

  // Watch the DOM for success indicators
  const observer = new MutationObserver(() => {
    // Look for success messages like "Problem Solved Successfully" or success modals
    const successHeader = document.querySelector(".congratulations-modal") || 
                          document.querySelector(".success_message") ||
                          document.querySelector(".solved-status") ||
                          Array.from(document.querySelectorAll("h3, h4, div")).find(el => 
                            el.textContent.includes("Problem Solved Successfully") || 
                            el.textContent.includes("Correct Answer")
                          );

    if (successHeader && !window.__gfgProcessed) {
      window.__gfgProcessed = true;
      extractCodeFromPage();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Reset flag when user changes code or clicks reset/submits again
  document.addEventListener("click", (e) => {
    if (e.target.closest("button") && 
       (e.target.textContent.includes("Submit") || e.target.textContent.includes("Compile"))) {
      window.__gfgProcessed = false;
    }
  });

  // Receive notifications from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SYNC_RESULT") {
      showToast(msg);
      sendResponse({ received: true });
    }
  });
}

function extractCodeFromPage() {
  // Inject script to access page-level Monaco or CodeMirror instances
  const script = document.createElement("script");
  script.textContent = `
    (function() {
      try {
        let code = "";
        if (window.monaco && window.monaco.editor) {
          const models = window.monaco.editor.getModels();
          if (models.length > 0) code = models[0].getValue();
        } else if (window.ace) {
          const aceEl = document.querySelector('.ace_editor');
          if (aceEl && aceEl.env && aceEl.env.editor) {
            code = aceEl.env.editor.getValue();
          }
        }
        if (!code) {
          const cm = document.querySelector('.CodeMirror');
          if (cm && cm.CodeMirror) {
            code = cm.CodeMirror.getValue();
          }
        }
        if (!code) {
          // Fallback to text lines in GFG editor DOM
          const lines = Array.from(document.querySelectorAll(".view-line"));
          if (lines.length > 0) {
            code = lines.map(l => l.textContent).join("\\n");
          }
        }
        document.dispatchEvent(new CustomEvent('GFG_CODE_EXTRACTED', { detail: code }));
      } catch (e) {}
    })();
  `;
  document.documentElement.appendChild(script);
  script.remove();
}

function handleGFGSolved(code) {
  // Scrape problem details
  const titleEl = document.querySelector(".problem-tab_title") || 
                  document.querySelector("[class*='problem-title']") ||
                  document.querySelector("h3") ||
                  document.querySelector("h1");
  const title = titleEl ? titleEl.textContent.replace(/[\n\r]/g, "").trim() : document.title;

  const diffEl = document.querySelector(".problem-tab_difficulty") || 
                 document.querySelector("[class*='difficulty']") ||
                 document.querySelector(".badge");
  const difficulty = diffEl ? diffEl.textContent.trim() : "Medium";

  // Language check
  let lang = "cpp";
  const langEl = document.querySelector(".divider") || 
                 document.querySelector("[class*='language']") ||
                 document.querySelector(".select-lang");
  if (langEl) {
    const text = langEl.textContent.trim().toLowerCase();
    if (text.includes("python")) lang = "python3";
    else if (text.includes("java")) lang = "java";
    else if (text.includes("javascript") || text.includes("js")) lang = "javascript";
    else if (text.includes("c++") || text.includes("cpp")) lang = "cpp";
    else if (text.includes("golang") || text.includes("go")) lang = "go";
    else lang = text.replace(/[^a-z0-9]/g, "");
  }

  // Get problem slug
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const slug = pathParts[pathParts.length - 1] || "gfg-problem";

  chrome.runtime.sendMessage({
    type: "GFG_ACCEPTED",
    data: {
      code,
      title,
      difficulty,
      lang,
      slug,
      url: window.location.href
    }
  });
}

// Toast helper (similar to LeetCode toast, customized for GFG)
function showToast(msg) {
  let container = document.getElementById("gfg-sync-toast");
  if (container) container.remove();

  container = document.createElement("div");
  container.id = "gfg-sync-toast";
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
    animation: gfgSlideIn 0.3s ease-out;
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
    @keyframes gfgSlideIn {
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
