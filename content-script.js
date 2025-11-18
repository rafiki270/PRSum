/*
  PRSum content script
  - Extracts main content from the page
  - Scores and selects key sentences for a concise, LLM-ready summary
  - Returns structured text suitable for copy-paste into prompts
*/

(function () {
  const STOPWORDS = new Set([
    // basic English stopwords list (trimmed)
    "a","an","the","and","or","but","if","while","of","at","by","for","with","about","against","between","into","through","during","before","after","above","below","to","from","up","down","in","out","on","off","over","under","again","further","then","once","here","there","when","where","why","how","all","any","both","each","few","more","most","other","some","such","no","nor","not","only","own","same","so","than","too","very","can","will","just","don","should","now","is","am","are","was","were","be","been","being","do","does","did","having","have","has"
  ]);

  const BOILERPLATE_HINTS = [
    'cookie', 'consent', 'subscribe', 'newsletter', 'advert', 'promotion',
    'terms', 'privacy', 'sign up', 'sign in', 'login', 'share', 'related',
    'read more', 'comments', 'footer', 'header', 'nav', 'banner', 'policy'
  ];

  function isProbablyVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  function textLen(s) {
    return (s || '').replace(/\s+/g, ' ').trim().length;
  }

  function cleanText(s) {
    return (s || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  function elementText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    // remove non-content nodes
    clone.querySelectorAll('script,style,noscript,svg,canvas,iframe,button,input,select,textarea,form,aside,nav,footer,header').forEach(n => n.remove());
    return cleanText(clone.textContent || '');
  }

  function scoreElement(el) {
    const txt = elementText(el);
    const len = txt.length;
    if (len < 200) return 0;
    const pCount = el.querySelectorAll('p').length;
    const hCount = el.querySelectorAll('h1,h2,h3').length;
    const listCount = el.querySelectorAll('ul,ol').length;
    // heuristic: paragraphs dominate, headings add signal, lists help
    return len * (1 + 0.02 * pCount + 0.01 * hCount + 0.005 * listCount);
  }

  function selectMainContainer() {
    const candidates = new Set();
    const seedSelectors = [
      'article', 'main', '[role="main"]', '#content', '.content', '.post', '.article', '.entry-content', '.post-content', '.article-body'
    ];
    seedSelectors.forEach(sel => document.querySelectorAll(sel).forEach(el => candidates.add(el)));
    // add large visible blocks
    document.querySelectorAll('div,section,article,main').forEach(el => {
      if (!candidates.has(el) && isProbablyVisible(el) && elementText(el).length > 400) {
        candidates.add(el);
      }
    });
    let best = null;
    let bestScore = 0;
    candidates.forEach(el => {
      const s = scoreElement(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    });
    // fallback to body
    return best || document.body;
  }

  function extractStructured(main) {
    const title = cleanText(document.title || '');
    const url = location.href;

    const headings = Array.from(main.querySelectorAll('h1,h2,h3')).map(h => cleanText(h.textContent || ''))
      .filter(Boolean);

    const paragraphs = Array.from(main.querySelectorAll('p'))
      .map(p => cleanText(p.textContent || ''))
      .filter(t => t && t.length > 40 && !BOILERPLATE_HINTS.some(k => t.toLowerCase().includes(k)));

    const lists = Array.from(main.querySelectorAll('ul,ol')).map(list => {
      const items = Array.from(list.querySelectorAll('li')).map(li => cleanText(li.textContent || '')).filter(Boolean);
      return items.slice(0, 12);
    }).filter(arr => arr.length > 0).slice(0, 5);

    const codeBlocks = Array.from(main.querySelectorAll('pre,code'))
      .map(n => cleanText(n.textContent || ''))
      .filter(t => t && t.length > 0)
      .slice(0, 3)
      .map(t => t.length > 1200 ? t.slice(0, 1200) + '…' : t);

    const fullText = elementText(main);

    return { title, url, headings, paragraphs, lists, codeBlocks, fullText };
  }

  function tokenizeWords(text) {
    return text.toLowerCase().match(/[a-zA-Z][a-zA-Z'\-]+/g) || [];
  }

  function sentenceSplit(text) {
    // basic sentence tokenizer
    const split = text
      .replace(/([.!?])\s+(?=[A-Z\[])/g, '$1|')
      .split('|')
      .map(s => cleanText(s))
      .filter(s => s.length > 0);
    return split;
  }

  function buildFrequencies(text) {
    const words = tokenizeWords(text);
    const freq = new Map();
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    // normalize
    let max = 1;
    for (const v of freq.values()) max = Math.max(max, v);
    for (const [k, v] of freq.entries()) freq.set(k, v / max);
    return freq;
  }

  function scoreSentence(sent, freq) {
    const words = tokenizeWords(sent);
    if (words.length < 6) return 0;
    let score = 0;
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      score += freq.get(w) || 0;
    }
    // slightly reward presence of numbers and proper nouns
    const numbers = (sent.match(/\d+/g) || []).length;
    score += numbers * 0.1;
    return score / Math.log2(8 + words.length);
  }

  function summarize(structured, opts = {}) {
    const { maxChars = 1400 } = opts;
    const baseText = [
      structured.headings.slice(0, 3).join('. '),
      structured.paragraphs.join(' ')
    ].filter(Boolean).join('. ');

    const freq = buildFrequencies(baseText);
    const sentences = sentenceSplit(baseText);
    const scored = sentences.map((s, i) => ({ i, s, score: scoreSentence(s, freq) }))
      .filter(x => x.score > 0);
    scored.sort((a, b) => b.score - a.score);

    // pick top sentences until budget, then restore original order
    const picked = [];
    let used = 0;
    for (const cand of scored) {
      if (cand.s.length < 40) continue;
      if (picked.length >= 24) break;
      if (used + cand.s.length + 1 > maxChars) continue;
      picked.push(cand);
      used += cand.s.length + 1;
    }
    picked.sort((a, b) => a.i - b.i);

    const bullets = picked.map(x => `- ${x.s}`);

    // include up to 2 lists flattened
    const listBullets = [];
    for (const list of structured.lists.slice(0, 2)) {
      for (const item of list.slice(0, 6)) {
        if (listBullets.join(' ').length + item.length + 2 > 600) break;
        listBullets.push(`- ${item}`);
      }
    }

    let codeSection = '';
    if (structured.codeBlocks.length) {
      const first = structured.codeBlocks[0];
      codeSection = `\nCode snippet:\n"""\n${first}\n"""`;
    }

    const titleLine = structured.title ? `${structured.title}\n` : '';
    const header = `${titleLine}${structured.url}`;

    const summary = [
      header,
      '',
      'Summary:',
      ...bullets,
      listBullets.length ? '' : null,
      listBullets.length ? 'Key items:' : null,
      ...listBullets,
      codeSection
    ].filter(x => x !== null).join('\n');

    return summary.trim();
  }

  function runExtraction(options) {
    const gh = maybeExtractGitHubPR();
    if (gh) {
      const prSummary = summarizePR(gh, options || {});
      return { structured: { title: gh.title, url: location.href, fullText: gh.description || '' }, summary: prSummary, pr: gh };
    }
    const main = selectMainContainer();
    const structured = extractStructured(main);
    const summary = summarize(structured, options || {});
    return { structured, summary };
  }

  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (!req) return;
    if (req.type === 'PRSUM_SUMMARIZE') {
      try {
        const result = runExtraction(req.options || {});
        const structured = result.structured || {};
        const safeLen = v => (v && typeof v.length === 'number') ? v.length : 0;
        const stats = {
          headings: safeLen(structured.headings),
          paragraphs: safeLen(structured.paragraphs),
          lists: safeLen(structured.lists),
          codeBlocks: safeLen(structured.codeBlocks),
          fullTextLen: (structured.fullText || '').length
        };
        sendResponse({ ok: true, title: structured.title, url: structured.url, summary: result.summary, stats });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    if (req.type === 'PRSUM_EXTRACT') {
      try {
        const gh = maybeExtractGitHubPR();
        if (gh) {
          // Cap code to keep payload manageable
          const prCapped = {
            ...gh,
            files: gh.files.map(f => ({
              path: f.path,
              additions: f.additions,
              deletions: f.deletions,
              addedLines: f.addedLines.slice(0, 400),
              removedLines: f.removedLines.slice(0, 80)
            })).slice(0, 80),
            properties: Array.from(new Set(gh.properties)).slice(0, 200)
          };
          sendResponse({ ok: true, structured: { title: gh.title, url: location.href }, pr: prCapped });
          return true;
        }
        const main = selectMainContainer();
        const structured = extractStructured(main);
        // cap large fields to keep payload reasonable
        const structuredCapped = {
          ...structured,
          paragraphs: structured.paragraphs.slice(0, 40),
          lists: structured.lists.slice(0, 3).map(l => l.slice(0, 10)),
          codeBlocks: structured.codeBlocks.slice(0, 2),
          fullText: structured.fullText.length > 12000 ? structured.fullText.slice(0, 12000) + '…' : structured.fullText
        };
        sendResponse({ ok: true, structured: structuredCapped });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }

    if (req.type === 'PRSUM_RAW') {
      try {
        const raw = getRawPayload();
        sendResponse({ ok: true, raw });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
  });

  // ----------------------
  // GitHub PR extraction
  // ----------------------

  function isGitHubPRPage() {
  try {
    const { hostname, pathname } = location;
    if (!hostname.endsWith('github.com')) return false;
    const parts = pathname.split('/').filter(Boolean);
    // /owner/repo/pull/123
    return parts.length >= 4 && parts[2] === 'pull' && /^\d+$/.test(parts[3]);
  } catch (_) {
    return false;
  }
  }

  function maybeExtractGitHubPR() {
  if (!isGitHubPRPage()) return null;
  const title = cleanText(
    (document.querySelector('[data-test-selector="pull-request-title"]') || document.querySelector('.js-issue-title') || {}).textContent || ''
  );
  const description = cleanText(
    (document.querySelector('.comment-body') || {}).textContent || ''
  );
  const author = cleanText(
    (document.querySelector('.author') || {}).textContent || ''
  );

  // branches (base <- head)
  let baseBranch = '', headBranch = '';
  const branchEls = Array.from(document.querySelectorAll('.commit-ref, .base-ref, .head-ref'));
  if (branchEls.length >= 2) {
    headBranch = cleanText(branchEls[0].textContent || '').replace(/^\s*\w+:\s*/, '');
    baseBranch = cleanText(branchEls[1].textContent || '').replace(/^\s*\w+:\s*/, '');
  }

  // files changed
  const files = extractGitHubFiles();

  const totals = files.reduce((acc, f) => {
    acc.add += f.additions;
    acc.del += f.deletions;
    return acc;
  }, { add: 0, del: 0 });

  const properties = extractPropertyNamesFromAdded(files);

  return {
    title, description, author, baseBranch, headBranch,
    repoPath: location.pathname.split('/').slice(0, 3).join('/'),
    files, totals, properties
  };
  }

  function extractGitHubFiles() {
  const res = [];
  const fileNodes = document.querySelectorAll('.file, .js-diff-progressive-container .file');
  fileNodes.forEach(fileEl => {
    // path
    let path = '';
    const info = fileEl.querySelector('.file-info a, .file-info');
    if (info) path = cleanText(info.textContent || '') || info.getAttribute('title') || '';
    if (!path) path = fileEl.getAttribute('data-path') || '';

    // additions/deletions and lines
    const addLines = Array.from(fileEl.querySelectorAll('.blob-code.blob-code-addition .blob-code-inner'))
      .map(n => n.textContent || '').map(cleanText);
    const delLines = Array.from(fileEl.querySelectorAll('.blob-code.blob-code-deletion .blob-code-inner'))
      .map(n => n.textContent || '').map(cleanText);
    const additions = addLines.length;
    const deletions = delLines.length;

    if (path) {
      res.push({ path, additions, deletions, addedLines: addLines, removedLines: delLines });
    }
  });
  return res;
  }

  function extractPropertyNamesFromAdded(files) {
  const props = new Set();
  const patterns = [
    /["']([A-Za-z_][A-Za-z0-9_\-]*)["']\s*:/g,              // JSON/objects: "prop": or 'prop':
    /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^:]/g,               // TS/flow types or object prop: prop: type/value
    /(?:public|private|protected)?\s*(?:readonly\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/g, // class/interface properties
    /self\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g,                   // Python instance attrs
    /\b([A-Z][A-Z0-9_]+)\s*=/g                               // ENV-like constants
  ];
  for (const f of files) {
    for (const line of f.addedLines.slice(0, 800)) {
      for (const re of patterns) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(line)) !== null) {
          const name = m[1];
          if (name && name.length <= 80) props.add(name);
        }
      }
    }
  }
  return Array.from(props).sort();
  }

  function summarizePR(pr, opts = {}) {
  const maxChars = Math.max(800, Math.min(8000, (opts.maxChars || 2400)));
  const header = [
    pr.title || '(PR)',
    location.href,
    pr.author ? `Author: ${pr.author}` : null,
    (pr.headBranch || pr.baseBranch) ? `Branches: ${pr.headBranch || '?'} -> ${pr.baseBranch || '?'}` : null,
    `Files changed: ${pr.files.length}, +${pr.totals.add} -${pr.totals.del}`
  ].filter(Boolean).join('\n');

  const filesList = pr.files.slice(0, 60).map(f => `- ${f.path} (+${f.additions}/-${f.deletions})`).join('\n');

  const props = pr.properties.slice(0, 80).map(p => `- ${p}`).join('\n');

  // code sections: only additions, per file budget
  const codeParts = [];
  let budget = maxChars - (header.length + filesList.length + props.length + 200);
  for (const f of pr.files) {
    if (budget <= 0) break;
    const joined = f.addedLines.join('\n');
    const slice = joined.slice(0, Math.min(1200, budget));
    if (!slice.trim()) continue;
    const block = [`File: ${f.path}`, '"""', slice, '"""'].join('\n');
    codeParts.push(block);
    budget -= slice.length + f.path.length + 10;
    if (codeParts.length >= 12) break;
  }

  return [
    header,
    '',
    'Files:',
    filesList,
    pr.properties.length ? '\nProperties:' : '',
    pr.properties.length ? props : '',
    codeParts.length ? '\nAdded code:' : '',
    codeParts.join('\n\n')
  ].filter(Boolean).join('\n');
  }
  
  // Raw payload for LLM-first extraction
  function isGitLabMRPage() {
    try {
      const { hostname, pathname } = location;
      // Support gitlab.com and self-hosted GitLab
      const parts = pathname.split('/').filter(Boolean);
      // Common patterns:
      // /group/project/-/merge_requests/123[/diffs]
      // /group/project/merge_requests/123[/diffs]
      const idx = parts.findIndex(p => p === 'merge_requests');
      const idxDash = parts.findIndex(p => p === '-' && parts[parts.indexOf(p)+1] === 'merge_requests');
      const mrIdx = idx >= 0 ? idx : (idxDash >= 0 ? idxDash + 1 : -1);
      const idIdx = mrIdx >= 0 ? mrIdx + 1 : -1;
      const hasId = idIdx > 0 && /^\d+$/.test(parts[idIdx]);
      return hasId;
    } catch (_) { return false; }
  }

  function getRawPayload() {
    const title = cleanText(document.title || '');
    const url = location.href;
    const isGH = isGitHubPRPage();
    const isGL = isGitLabMRPage();
    const hint = (isGH || isGL) ? 'pr' : 'generic';

    const cap = (s, n) => (s && s.length > n ? s.slice(0, n) + '\n…[truncated]' : (s || ''));

    let prRawText = '';
    if (hint === 'pr') {
      if (isGH) {
      const filesEl = document.querySelector('#files_bucket') || document.querySelector('.js-diff-progressive-container') || document.querySelector('[data-pjax="#files_bucket"]');
      const convoEl = document.querySelector('.discussion-timeline, .Layout-main');
      const metaEl = document.querySelector('.gh-header-show, .gh-header-meta');
      const blocks = [];
      if (metaEl) blocks.push(metaEl.innerText || '');
      if (convoEl) blocks.push(convoEl.innerText || '');
      if (filesEl) blocks.push(filesEl.innerText || '');
      prRawText = blocks.filter(Boolean).join('\n\n');
      } else if (isGL) {
        // GitLab: try diff and metadata areas
        const diffsEl = document.querySelector('#diffs, .diffs');
        const metaEl = document.querySelector('.merge-request, .mr-title, .detail-page-description, header');
        const discussionEl = document.querySelector('#notes, .mr-notes, .discussion');
        const blocks = [];
        if (metaEl) blocks.push(metaEl.innerText || '');
        if (discussionEl) blocks.push(discussionEl.innerText || '');
        if (diffsEl) blocks.push(diffsEl.innerText || '');
        prRawText = blocks.filter(Boolean).join('\n\n');
      }
    }

    const rawText = document.body ? cleanText(document.body.innerText || '') : '';
    const rawHTML = document.documentElement ? document.documentElement.outerHTML : '';

    return {
      title,
      url,
      hint,
      prRawText: cap(prRawText, 220000),
      rawText: cap(rawText, 120000),
      rawHTML: cap(rawHTML, 100000)
    };
  }
})();
