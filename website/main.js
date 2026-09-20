/**
 * Code2Git Website - Strict Monochrome Scripts & Interactions
 */

document.addEventListener('DOMContentLoaded', () => {
  initScrollReveal();
  initSubtleTilt();
  initNavbarScroll();
  initSmoothScroll();
  initDownloadAndModal();
  initCopyButtons();
  initDemoSimulator();
  initFaqAccordion();
  initMobileNav();
});

/* ==========================================================================
   1. Scroll Reveal Animations (IntersectionObserver - Lightweight 60fps)
   ========================================================================== */
function initScrollReveal() {
  const revealElements = document.querySelectorAll('.reveal-on-scroll');
  if (!revealElements.length) return;

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -20px 0px',
    threshold: 0.05
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  revealElements.forEach(el => revealObserver.observe(el));
}

/* ==========================================================================
   2. Micro Cursor Parallax / Lightweight Hardware-Accelerated Hover
   ========================================================================== */
function initSubtleTilt() {
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches === false) return;

  const tiltCards = document.querySelectorAll('.tilt-card');

  tiltCards.forEach(card => {
    let rect = null;
    let ticking = false;

    card.addEventListener('mouseenter', () => {
      rect = card.getBoundingClientRect();
    }, { passive: true });

    card.addEventListener('mousemove', (e) => {
      if (!rect || ticking) return;
      
      ticking = true;
      requestAnimationFrame(() => {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotateX = ((y - centerY) / centerY) * -1.5;
        const rotateY = ((x - centerX) / centerX) * 1.5;

        card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-2px)`;
        ticking = false;
      });
    }, { passive: true });

    card.addEventListener('mouseleave', () => {
      rect = null;
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)';
    });
  });
}

/* ==========================================================================
   3. Navbar Scroll Observer (Throttled via requestAnimationFrame)
   ========================================================================== */
function initNavbarScroll() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        if (window.scrollY > 10) {
          navbar.classList.add('scrolled');
        } else {
          navbar.classList.remove('scrolled');
        }
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

/* ==========================================================================
   4. Smooth Scroll for Anchor Links
   ========================================================================== */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || !targetId.startsWith('#')) return;

      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        const headerOffset = 70;
        const elementPosition = targetEl.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

/* ==========================================================================
   5. Download & Modal Controller
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

  if (openModalBtn) openModalBtn.addEventListener('click', openModal);
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

  downloadBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        if (btn.tagName !== 'A') {
          const a = document.createElement('a');
          a.href = 'Code2Git-extension.zip';
          a.download = 'Code2Git-extension.zip';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        
        showToast('<i class="fa-solid fa-circle-check"></i> Download started! Follow the steps below.');
        
        setTimeout(() => {
          openModal();
        }, 300);
      });
    }
  });
}

/* ==========================================================================
   6. Copy to Clipboard
   ========================================================================== */
function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');
      if (!textToCopy) return;

      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = 'fa-solid fa-check text-primary';
        setTimeout(() => {
          icon.className = 'fa-regular fa-copy';
        }, 2000);
      }

      try {
        await navigator.clipboard.writeText(textToCopy);
        showToast(`<i class="fa-solid fa-circle-check"></i> Copied <code>${textToCopy}</code> to clipboard!`);
      } catch (err) {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(`<i class="fa-solid fa-circle-check"></i> Copied to clipboard!`);
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
    toast.style.transform = 'translateY(10%)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 200);
  }, 3000);
}

/* ==========================================================================
   7. Interactive Demo Simulator (Strict Black & Grayish Logging)
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
    return 0;}`
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
      logBox.innerHTML = `<div class="log-line text-muted">[System] Ready for simulation (${data.title}).</div>`;
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
    runBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Syncing Solution...`;

    logBox.innerHTML = '';
    const now = () => new Date().toLocaleTimeString();

    const logs = [
      { text: `[${now()}] Submission detected on ${data.tag}...`, delay: 150 },
      { text: `[${now()}] Status: Accepted (Runtime: ${data.runtime})`, delay: 500, class: 'text-primary' },
      { text: `[${now()}] Code2Git Engine: Parsing code & metadata...`, delay: 900 },
      { text: `[${now()}] Connecting to GitHub REST API...`, delay: 1300 },
      { text: `[${now()}] Pushing: ${data.folder}${data.filename}`, delay: 1700, class: 'text-secondary' },
      { text: `[${now()}] SUCCESS: Solution committed to 'main' branch.`, delay: 2100, class: 'text-primary' }
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
      runBtn.innerHTML = `<i class="fa-solid fa-check"></i> Simulation Complete`;
    }, 2400);
  }
}

/* ==========================================================================
   8. FAQ Accordion Toggle
   ========================================================================== */
function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    if (question) {
      question.addEventListener('click', () => {
        const isOpen = item.classList.contains('active');
        faqItems.forEach(i => i.classList.remove('active'));
        if (!isOpen) item.classList.add('active');
      });
    }
  });
}

/* ==========================================================================
   9. Mobile Navigation
   ========================================================================== */
function initMobileNav() {
  const toggle = document.getElementById('mobileToggle');
  const menu = document.getElementById('navMenu');

  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      menu.classList.toggle('open');
      const icon = toggle.querySelector('i');
      if (icon) {
        icon.className = menu.classList.contains('open') ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
      }
    });

    menu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        menu.classList.remove('open');
        const icon = toggle.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-bars';
      });
    });
  }
}
