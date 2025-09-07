function qs(sel) { return document.querySelector(sel); }

async function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]));
  });
}

function isRestrictedUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith('chrome://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('about:') ||
    lower.startsWith('devtools://') ||
    lower.startsWith('view-source:') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('moz-extension://') ||
    lower.startsWith('opera://') ||
    lower.startsWith('brave://') ||
    lower.startsWith('vivaldi://') ||
    lower.includes('chrome.google.com/webstore')
  );
}

function setLastSummary(url, payload) {
  if (!url || !payload) return;
  chrome.storage.local.get(['lastSummaries'], res => {
    const map = res.lastSummaries || {};
    map[url] = { ...payload, ts: Date.now() };
    // cap to 25 entries by dropping oldest
    const keys = Object.keys(map);
    if (keys.length > 25) {
      const sorted = keys.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
      for (const k of sorted.slice(0, keys.length - 25)) delete map[k];
    }
    chrome.storage.local.set({ lastSummaries: map });
  });
}

async function summarize() {
  const out = qs('#output');
  const err = qs('#error');
  const meta = qs('#meta');
  out.textContent = 'Summarizing…';
  err.hidden = true; err.textContent = '';
  meta.textContent = '';

  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    out.textContent = '';
    err.textContent = 'No active tab found.';
    err.hidden = false;
    return;
  }

  const useMax = !!qs('#useMax')?.checked;
  const maxChars = useMax ? Number(qs('#maxChars').value || 1400) : undefined;
  const engine = (qs('#engine').value || 'chatgpt');
  // persist last engine
  try { chrome.storage?.local?.set?.({ lastEngine: engine }); } catch (_) {}

  async function ensureContentScriptInjected(tabId) {
    return new Promise(resolve => {
      try {
        if (chrome.scripting && chrome.scripting.executeScript) {
          chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] }, () => resolve());
        } else if (chrome.tabs && chrome.tabs.executeScript) {
          chrome.tabs.executeScript(tabId, { file: 'content-script.js' }, () => resolve());
        } else {
          resolve();
        }
      } catch (_) { resolve(); }
    });
  }

  // Local engine removed; always use LLM flow

  // LLM engine (ChatGPT/Gemini): send raw content and have the model extract
  chrome.tabs.sendMessage(tab.id, { type: 'PRSUM_RAW' }, async resp => {
      if (!resp || resp.ok !== true) {
        const lastErr = chrome.runtime.lastError;
        if (lastErr && /Receiving end does not exist/i.test(lastErr.message || '')) {
          await ensureContentScriptInjected(tab.id);
          chrome.tabs.sendMessage(tab.id, { type: 'PRSUM_RAW' }, resp2 => {
            const retryErr = chrome.runtime.lastError;
            if (!resp2 || resp2.ok !== true) {
              out.textContent = '';
              const restrictedMsg = isRestrictedUrl(tab.url) ? 'This appears to be a browser/system page (e.g., chrome:// or Web Store), which extensions cannot access for content. Try summarizing a normal webpage.' : '';
              err.textContent = restrictedMsg || ((resp2 && resp2.error) ? String(resp2.error) : (retryErr?.message ? `Content access error: ${retryErr.message}` : 'Unable to read raw content from this page.'));
              err.hidden = false;
              return;
            }
            const payload = { type: 'PRSUM_SUMMARIZE_WITH_LLM', engine, raw: resp2.raw };
            if (useMax) payload.maxChars = maxChars;
            chrome.runtime.sendMessage(payload, llm => {
              if (!llm || llm.ok !== true) {
                out.textContent = '';
                err.textContent = (llm && llm.error) ? String(llm.error) : 'LLM call failed. Check your API key in Options.';
                err.hidden = false;
                return;
              }
              out.textContent = llm.summary;
              const raw = resp2.raw || {};
              meta.textContent = `Title: ${raw.title || '(untitled)'}  •  Mode: ${raw.hint || 'generic'}  •  Source size: text ${raw.rawText?.length || 0} / html ${raw.rawHTML?.length || 0}`;
              setLastSummary(tab.url, { summary: out.textContent, meta: meta.textContent, engine });
            });
          });
          return;
        }
        out.textContent = '';
        const restrictedMsg = isRestrictedUrl(tab.url) ? 'This appears to be a browser/system page (e.g., chrome:// or Web Store), which extensions cannot access for content. Try summarizing a normal webpage.' : '';
        err.textContent = restrictedMsg || ((resp && resp.error) ? String(resp.error) : (lastErr?.message ? `Content access error: ${lastErr.message}` : 'Unable to read raw content from this page.'));
        err.hidden = false;
        return;
      }
      const payload = { type: 'PRSUM_SUMMARIZE_WITH_LLM', engine, raw: resp.raw };
      if (useMax) payload.maxChars = maxChars;
      chrome.runtime.sendMessage(payload, llm => {
        if (!llm || llm.ok !== true) {
          out.textContent = '';
          err.textContent = (llm && llm.error) ? String(llm.error) : 'LLM call failed. Check your API key in Options.';
          err.hidden = false;
          return;
        }
        out.textContent = llm.summary;
        const raw = resp.raw || {};
        meta.textContent = `Title: ${raw.title || '(untitled)'}  •  Mode: ${raw.hint || 'generic'}  •  Source size: text ${raw.rawText?.length || 0} / html ${raw.rawHTML?.length || 0}`;
        setLastSummary(tab.url, { summary: out.textContent, meta: meta.textContent, engine });
      });
    });
}

async function copyOutput() {
  const out = qs('#output');
  const text = out.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    const btn = qs('#copy');
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = old), 1200);
  } catch (e) {
    // fallback select
    const range = document.createRange();
    range.selectNodeContents(out);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
  }
}

function openOptions() {
  try {
    if (typeof chrome.runtime.openOptionsPage === 'function') {
      chrome.runtime.openOptionsPage(() => {
        const err = chrome.runtime.lastError;
        if (err) {
          const url = chrome.runtime.getURL('options.html');
          if (chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url });
          } else {
            window.open(url, '_blank');
          }
        }
      });
      return;
    }
  } catch (_) {}
  const url = chrome.runtime.getURL('options.html');
  if (chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}

  document.addEventListener('DOMContentLoaded', () => {
    qs('#summarize').addEventListener('click', summarize);
    qs('#copy').addEventListener('click', copyOutput);
    const settingsBtn = qs('#settings');
    if (settingsBtn) settingsBtn.addEventListener('click', openOptions);
    // toggle readonly on max chars
    const useMaxEl = qs('#useMax');
    const maxEl = qs('#maxChars');
    if (useMaxEl && maxEl) {
      const applyDisabled = () => { maxEl.disabled = !useMaxEl.checked; };
      applyDisabled();
      useMaxEl.addEventListener('change', applyDisabled);
    }
  // default engine & auto summarize
  (async () => {
    const tab = await getActiveTab();
    chrome.storage.local.get(['lastEngine','defaultEngine','openaiKey','geminiKey','autoSummarize','lastSummaries'], res => {
      let def = res.lastEngine || res.defaultEngine;
      if (def !== 'chatgpt' && def !== 'gemini') {
        def = res.openaiKey ? 'chatgpt' : (res.geminiKey ? 'gemini' : 'chatgpt');
      }
      qs('#engine').value = def;

      const saved = (res.lastSummaries || {})[tab?.url || ''];
      const auto = (typeof res.autoSummarize === 'boolean') ? res.autoSummarize : true;
      if (!auto && saved) {
        // show last known content but do not fetch
        qs('#output').textContent = saved.summary || '';
        qs('#meta').textContent = saved.meta || '';
        return;
      }
      if (auto) {
        // If we already have content for this URL, prefer showing it without re-fetching
        if (saved && saved.summary) {
          qs('#output').textContent = saved.summary;
          qs('#meta').textContent = saved.meta || '';
          return;
        }
        summarize();
      } else if (saved && saved.summary) {
        qs('#output').textContent = saved.summary;
        qs('#meta').textContent = saved.meta || '';
      }
    });
  })();
});
