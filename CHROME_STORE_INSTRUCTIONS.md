# Chrome Web Store Publishing Guide

This guide provides a detailed, step-by-step procedure to package and publish the **Code2Git** Chrome Extension to the Chrome Web Store, ensuring safety, privacy compliance, and proper configuration.

---

## 1. Preparing the Extension Package

Before uploading, make sure you compile only the necessary files. The Chrome Web Store zip package should only contain files required to run the extension.

### Included Files & Folder Structure
Your zip package must contain:
```text
├── icons/
│   ├── icon16.png          # Small toolbar icon
│   ├── icon48.png          # Extension management page icon
│   ├── icon128.png         # Chrome Web Store detail page icon
│   └── logo.png            # Main logo used in UI
├── background.js           # Background service worker
├── content.js              # LeetCode parser script
├── content_cf.js           # Codeforces parser script
├── content_gfg.js          # GeeksforGeeks main parser script
├── content_gfg_main.js     # GeeksforGeeks page-world execution script
├── dashboard.html          # Custom options dashboard page
├── dashboard.js            # Dashboard logic & leaderboard rendering
├── manifest.json           # Extension configuration metadata
├── popup.html              # Connection popup UI
└── popup.js                # Connection popup logic (OAuth/PAT)
```

### Excluded Files
Do **NOT** include development, repository, or debug files in the zip:
- `.git/` (git history)
- `.gitignore` (git settings)
- `firebase-debug.log` (cli logs containing temporary credentials/session data)
- `PROJECT_DOCUMENTATION.md` (internal documentation)
- `CHROME_STORE_INSTRUCTIONS.md` (this guide)
- Existing `.zip` archives (recursive zipping)

---

## 2. Setting Up a Google Chrome Developer Account

If you do not have an active developer account:
1. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in with the Google Account that will own and manage the extension.
3. Accept the **Developer Agreement and Privacy Policy**.
4. Pay the **one-time $5 USD registration fee** (Google uses this fee to authenticate identity and prevent spam submissions).

---

## 3. Uploading the Extension

1. Access the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Click the **+ New Item** button located at the top-right corner.
3. Upload the clean ZIP package containing only the required files (e.g. `Code2Git-extension.zip`).
4. The dashboard will automatically extract your `manifest.json` and verify configurations, permissions, and extension name.

---

## 4. Fill in the Store Listing Details

Provide public-facing details for users:
* **Product Description:** Explain what the extension does, supported sites (LeetCode, Codeforces, GeeksforGeeks), and key features (automatic sync, client-side encryption, custom leaderboards).
* **Category:** Set to **Developer Tools** or **Productivity**.
* **Language:** Select your default display language (e.g., English).
* **Screenshots:** Upload at least one (up to five) screenshots showing the extension popup or dashboard. Screenshots must be exactly:
  - **1280x800** pixels OR
  - **640x400** pixels
* **Icon:** The store uses `icons/icon128.png` included in your ZIP.

---

## 5. Completing the Privacy & Justification Review (Critical for Manifest V3)

Because your extension requests powerful permissions to operate (accessing cookies and web requests on third-party sites like LeetCode and GitHub), you must complete the **Privacy Practices** tab:

1. **Single Purpose:**
   - Define your extension's primary purpose. 
   - *Example:* "Allows developers to automatically sync solved coding challenges from LeetCode, GeeksforGeeks, and Codeforces to their personal GitHub repositories."

2. **Permissions Justifications:**
   Explain why you need each permission declared in your `manifest.json`:
   * **`storage`**: Used to save the user's encrypted configurations, synchronization counts, last sync times, and preferred connection methods locally.
   * **`cookies`**: Required to read the active session context/cookies from `leetcode.com` to validate GraphQL requests.
   * **`scripting`**: Required to run injection scripts on target web pages (like GeeksforGeeks) in the appropriate execution context to extract user solutions.
   * **`activeTab` / Host Permissions (`https://leetcode.com/*`, `https://api.github.com/*`, etc.)**: Allows the extension to securely perform API requests to LeetCode, Codeforces, and GeeksforGeeks to extract solutions, and make HTTP POST/PUT requests to the GitHub API to update your repository.

3. **Data Usage Certification:**
   - Certify that you will not sell user data.
   - Certify that you do not use/transfer data for purposes unrelated to the extension's core functionality.
   - Certify that the extension runs **client-side only**; user credentials, Personal Access Tokens (PAT), and OAuth details are stored strictly in local Chrome storage and are never sent to external servers (except directly to the GitHub API for pushing code).

---

## 6. Submission and Subsequent Updates

1. Review all sections to ensure they display a green checkmark.
2. Click **Submit for Review**.
3. **Manual Review Period:** First-time submissions with broad host permissions typically undergo a manual review, taking **2 to 7 business days**.
4. **Publishing Options:** You can choose to publish the extension immediately after approval, or schedule a manual release.

---

## 7. Releasing Updates
When updating the extension:
1. Increment the `"version"` string inside [manifest.json](file:///c:/project/code2git/Code2Git/manifest.json) (e.g., from `1.0.0` to `1.0.1`).
2. Package the files again in a clean ZIP archive.
3. Upload it to the Chrome Developer Dashboard on the existing item page, and click **Submit for Review**.
4. Minor updates/bug fixes without permission changes are typically approved much faster (usually under **24 hours**).
