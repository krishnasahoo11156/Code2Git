// content_gfg_main.js — GeeksforGeeks Main World Content Script
// Runs directly in the page's window context to safely access Monaco/editor globals.
// Bypasses CSP restrictions on inline script injection.
"use strict";

if (!window.__gfgMainContentLoaded) {
  window.__gfgMainContentLoaded = true;

  document.addEventListener("GFG_REQUEST_CODE", () => {
    try {
      let code = "";
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          code = models[0].getValue();
        }
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
        // Fallback: scrape editor lines directly from Monaco DOM representation
        const lines = Array.from(document.querySelectorAll(".view-line"));
        if (lines.length > 0) {
          code = lines.map(l => l.textContent).join("\n");
        }
      }

      document.dispatchEvent(new CustomEvent("GFG_CODE_EXTRACTED", { detail: code }));
    } catch (err) {
      console.error("Code2Git GFG Main Script Error:", err);
    }
  });
}
