/**
 * Code2Git Website - Main Interactive Scripts
 */

document.addEventListener('DOMContentLoaded', () => {
  initDownloadAndModal();
  initCopyButtons();
  initDemoSimulator();
  initFaqAccordion();
  initMobileNav();
});

/* ==========================================================================
   1. Download & Installation Modal Controller
   ========================================================================== */
function initDownloadAndModal() {
  const backdrop = document.getElementById('installModalBackdrop');
  const openModalBtn = document.getElementById('openInstallModalBtn');
  const closeModalBtn = document.getElementById('closeInstallModalBtn');
  const closeModalBtn2 = document.getElementById('closeInstallModalBtn2');

  const downloadBtns = [
    document.getElementById('navDownloadBtn'),
    document.getElementById('heroDownloadBtn')
  ];

  function openModal() {
    if (backdrop) backdrop.classList.add('open');
  }

  function closeModal() {
    if (backdrop) backdrop.classList.remove('open');
  }

  // Open modal manually
  if (openModalBtn) openModalBtn.addEventListener('click', openModal);

  // Close modal
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  if (closeModalBtn2) closeModalBtn2.addEventListener('click', closeModal);

  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop && backdrop.classList.contains('open')) {
      closeModal();
    }
  });

  // When clicking download buttons, trigger download and show modal
  downloadBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        // If it's a button, trigger direct download programmatically
        if (btn.tagName !== 'A') {
          const a = document.createElement('a');
          a.href = 'Code2Git-extension.zip';
          a.download = 'Code2Git-extension.zip';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        
        showToast('<i class="fa-solid fa-file-arrow-down"></i> Download started! Follow the installation steps below.');
        
        // Slightly delay modal popup so user sees download starting
        setTimeout(() => {
          openModal();
        }, 400);
      });
    }
  });
}

/* ==========================================================================
   2. Copy to Clipboard & Toast Helpers
   ========================================================================== */
function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');
      if (!textToCopy) return;

      try {
        await navigator.clipboard.writeText(textToCopy);
        showToast(`<i class="fa-solid fa-check text-success"></i> Copied <code>${textToCopy}</code> to clipboard!`);
      } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(`<i class="fa-solid fa-check text-success"></i> Copied to clipboard!`);
      }
    });
  });
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3500);
}

/* ==========================================================================
   3. Interactive Demo Simulator Logic
   ========================================================================== */
const PLATFORM_DATA = {
  leetcode: {
    tag: 'LeetCode #0001',
    title: 'Two Sum',
    difficulty: 'Easy',
    diffClass: 'diff-easy',
    lang: 'C++',
    runtime: '32 ms',
    memory: '10.4 MB',
    folder: 'LeetCode/0001-Two-Sum/',
    filename: 'Solution.cpp',
    code: `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> mp;
        for (int i = 0; i < nums.size(); ++i) {
            int diff = target - nums[i];
            if (mp.count(diff)) return {mp[diff], i};
            mp[nums[i]] = i;
        }
        return {};
    }
};`
  },
  codeforces: {
    tag: 'Codeforces 1800A',
    title: 'Is It a Cat?',
    difficulty: 'Medium',
    diffClass: 'diff-medium',
    lang: 'GNU C++17',
    runtime: '15 ms',
    memory: '2.1 MB',
    folder: 'Codeforces/1800A-Is-It-a-Cat/',
    filename: 'Solution.cpp',
    code: `#include <iostream>
#include <string>
#include <algorithm>
using namespace std;

void solve() {
    int n; cin >> n;
    string s; cin >> s;
    for (char &c : s) c = tolower(c);
    s.erase(unique(s.begin(), s.end()), s.end());
    cout << (s == "meow" ? "YES\\n" : "NO\\n");
}

int main() {
    int t; cin >> t;
    while (t--) solve();
    return 0;
}`
  },
  gfg: {
    tag: 'GFG Practice',
    title: 'Parenthesis Checker',
    difficulty: 'Medium',
    diffClass: 'diff-medium',
    lang: 'Java',
    runtime: '0.12 sec',
    memory: '24.8 MB',
    folder: 'GeeksforGeeks/Parenthesis-Checker/',
    filename: 'Solution.java',
    code: `class Solution {
    static boolean ispar(String x) {
        Stack<Character> st = new Stack<>();
        for (char c : x.toCharArray()) {
            if (c == '(' || c == '{' || c == '[') {
                st.push(c);
            } else {
                if (st.isEmpty()) return false;
                char top = st.pop();
                if ((c == ')' && top != '(') || 
                    (c == '}' && top != '{') || 
                    (c == ']' && top != '[')) return false;
            }
        }
        return st.isEmpty();
    }
}`
  }
};

function initDemoSimulator() {
  const tabs = document.querySelectorAll('.demo-tab');
  const runBtn = document.getElementById('runSimulateBtn');
  const logBox = document.getElementById('simLogBox');

  const problemTag = document.getElementById('demoProblemTag');
  const problemTitle = document.getElementById('demoProblemTitle');
  const difficulty = document.getElementById('demoDifficulty');
  const langTag = document.getElementById('demoLangTag');
  const runtime = document.getElementById('demoRuntime');
  const memory = document.getElementById('demoMemory');
  const codeSnippet = document.getElementById('demoCodeSnippet');
  const folder = document.getElementById('demoFolder');
  const fileName = document.getElementById('demoFileName');

  let activePlatform = 'leetcode';

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activePlatform = tab.getAttribute('data-platform');
      updateDemoUI(activePlatform);
    });
  });

  function updateDemoUI(key) {
    const data = PLATFORM_DATA[key];
    if (!data) return;

    if (problemTag) problemTag.textContent = data.tag;
    if (problemTitle) problemTitle.textContent = data.title;
    if (difficulty) {
      difficulty.textContent = data.difficulty;
      difficulty.className = `diff-tag ${data.diffClass}`;
    }
    if (langTag) langTag.innerHTML = `<i class="fa-solid fa-code"></i> ${data.lang}`;
    if (runtime) runtime.textContent = data.runtime;
    if (memory) memory.textContent = data.memory;
    if (codeSnippet) codeSnippet.textContent = data.code;
    if (folder) folder.textContent = data.folder;
    if (fileName) fileName.textContent = data.filename;

    if (logBox) {
      logBox.innerHTML = `<div class="log-line text-muted">[System] Ready for simulation (${data.title}). Click button to test sync.</div>`;
    }
  }

  if (runBtn) {
    runBtn.addEventListener('click', () => {
      runSimulation(activePlatform);
    });
  }

  function runSimulation(platformKey) {
    const data = PLATFORM_DATA[platformKey];
    if (!data || !logBox || !runBtn) return;

    runBtn.disabled = true;
    runBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing Submission...`;

    logBox.innerHTML = '';
    const now = () => new Date().toLocaleTimeString();

    const logs = [
      { text: `[${now()}] Detecting submission on ${data.tag}...`, delay: 200 },
      { text: `[${now()}] Status: Accepted! (Runtime: ${data.runtime}, Memory: ${data.memory})`, delay: 700, class: 'text-success' },
      { text: `[${now()}] Code2Git Engine: Extracting code & generating README.md...`, delay: 1200 },
      { text: `[${now()}] Connecting to GitHub REST API (Direct SSL Connection)...`, delay: 1700 },
      { text: `[${now()}] Pushing to branch 'main': ${data.folder}${data.filename}`, delay: 2200, class: 'text-accent' },
      { text: `[${now()}] SUCCESS! Commit #7f8a92b pushed successfully. Repository updated!`, delay: 2700, class: 'text-success' }
    ];

    logs.forEach(item => {
      setTimeout(() => {
        const line = document.createElement('div');
        line.className = `log-line ${item.class || ''}`;
        line.textContent = item.text;
        logBox.appendChild(line);
        logBox.scrollTop = logBox.scrollHeight;
      }, item.delay);
    });

    setTimeout(() => {
      runBtn.disabled = false;
      runBtn.innerHTML = `<i class="fa-solid fa-check"></i> Simulation Complete! Run Again`;
    }, 3000);
  }
}

/* ==========================================================================
   4. FAQ Accordion Toggle
   ========================================================================== */
function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    if (question) {
      question.addEventListener('click', () => {
        const isOpen = item.classList.contains('active');

        // Close all other FAQs
        faqItems.forEach(i => i.classList.remove('active'));

        if (!isOpen) {
          item.classList.add('active');
        }
      });
    }
  });
}

/* ==========================================================================
   5. Mobile Navigation Drawer
   ========================================================================== */
function initMobileNav() {
  const toggle = document.getElementById('mobileToggle');
  const menu = document.getElementById('navMenu');

  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      menu.classList.toggle('open');
      const icon = toggle.querySelector('i');
      if (icon) {
        if (menu.classList.contains('open')) {
          icon.className = 'fa-solid fa-xmark';
        } else {
          icon.className = 'fa-solid fa-bars';
        }
      }
    });

    // Close menu when clicking nav link
    menu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        menu.classList.remove('open');
        const icon = toggle.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-bars';
      });
    });
  }
}
