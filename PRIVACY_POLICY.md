# Privacy Policy for Code2Git

**Effective Date:** July 22, 2026

**Code2Git** ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy outlines how your data is handled when you use the Code2Git Chrome extension.

---

## 1. 100% Client-Side Architecture
Code2Git operates **100% client-side** inside your browser. We do not own, operate, or maintain any external middleman servers to collect, store, or process your personal data or code submissions.

---

## 2. Information We Collect and Process
To fulfill its core single purpose (automatically syncing accepted DSA solutions from coding platforms to GitHub), Code2Git processes the following data locally on your device:

* **Authentication Information:**
  - **GitHub Personal Access Tokens (PAT) & OAuth Tokens:** Stored securely using Chrome's local storage API (`chrome.storage.local`). These tokens are used solely to authenticate direct HTTP requests to the official GitHub API (`api.github.com`).
* **Website Content:**
  - **Code Submissions & Problem Statements:** Source code and problem descriptions from supported platforms (LeetCode, Codeforces, GeeksforGeeks) are extracted locally from your active browser session to construct repository commit files.

---

## 3. Data Transfers and Third Parties
* **No Third-Party Data Transfer:** We **never** sell, trade, rent, or transfer your personal data, tokens, or code submissions to third-party advertisers, data brokers, or external servers.
* **Direct API Connections:** All data requests are sent directly between your browser and official services (GitHub API, LeetCode GraphQL API, Codeforces API, GeeksforGeeks API, and optional Firebase Realtime Database for custom group leaderboards).

---

## 4. Security
Your credentials and access tokens are stored strictly within Chrome's isolated extension storage environment. They never leave your browser except to perform authorized GitHub repository commits.

---

## 5. Contact
If you have any questions or concerns regarding this Privacy Policy, please open an issue on our official GitHub repository:
[https://github.com/krishnasahoo11156/Code2Git](https://github.com/krishnasahoo11156/Code2Git)
