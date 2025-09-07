// Background script: calls OpenAI with extracted content to produce an LLM summary

const DEFAULT_MODEL = 'gpt-4o-mini'; // OpenAI default; change in options if desired
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

function fmtPromptFromRaw(raw, maxChars, templates) {
  const title = (raw && raw.title) || '(untitled)';
  const url = (raw && raw.url) || '';
  const bounded = typeof maxChars === 'number' && maxChars > 0;
  const budget = bounded ? Math.max(600, Math.min(6000, maxChars)) : undefined;

  if (raw && raw.hint === 'github_pr') {
    const prText = (raw.prRawText && raw.prRawText.length) ? raw.prRawText : (raw.rawText || '');
    const body = prText.slice(0, 240000);
    const userInstr = templates?.prInstructions;
    const instructions = [
      userInstr || [
        'Summarize this GitHub Pull Request for replication by another LLM. Do not output JSON or YAML.',
        'Use only human-readable sections with headings and bullet points.',
        'Sections (in order):',
        '1) Summary: high-level what changed and why; note feature flags or config additions.',
        '2) Files Changed: list each file path with a one-line purpose.',
        '3) Added Code: for each file, include essential added lines in fenced code blocks.',
        '4) Removed Code: include only removed lines that are important to understand the change.',
        'Rules: Do not invent code; copy exact lines from the diff. Preserve identifiers, endpoints, constants, versions.',
        'Keep it concise but sufficient for another LLM to reproduce the change elsewhere.'
      ].join('\n'),
      bounded ? `Target length: ~${budget} characters. Use bullet points and terse phrasing.` : ''
    ].filter(Boolean).join('\n');
    return [
      `PR Title: ${title}`,
      `URL: ${url}`,
      '',
      instructions,
      '',
      'RAW PR TEXT START',
      body,
      'RAW PR TEXT END'
    ].join('\n');
  }

  const pageText = (raw && raw.rawText) || '';
  const body = pageText.slice(0, 120000);
  const basePageInstr = templates?.pageInstructions || [
    'Extract the main content and provide a precise, LLM-ready brief. Use headings and bullet points.',
    'Keep only important facts, entities, numbers, definitions, and steps.',
    'Do not output JSON or YAML. Use plain text and bullets.'
  ].join('\n');
  const instructions = [
    basePageInstr,
    bounded ? `Target length: ~${Math.max(400, Math.min(5000, maxChars))} characters.` : ''
  ].filter(Boolean).join('\n');

  return [
    `Title: ${title}`,
    `URL: ${url}`,
    '',
    instructions,
    '',
    'RAW PAGE TEXT START',
    body,
    'RAW PAGE TEXT END'
  ].join('\n');
}

async function callOpenAI({ apiKey, model, prompt }) {
  const body = {
    model: model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: 'You are a precise summarizer for LLM context preparation.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
  };
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${txt}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  return content.trim();
}

async function callGemini({ apiKey, model, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      { role: 'user', parts: [{ text: prompt }] }
    ],
    generationConfig: { temperature: 0.2 }
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${txt}`);
  }
  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('').trim();
  return text;
}

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (!req || req.type !== 'PRSUM_SUMMARIZE_WITH_LLM') return;
  (async () => {
    try {
      const { raw, maxChars, engine } = req;
      const store = await new Promise(resolve => {
        chrome.storage.local.get(['openaiKey', 'openaiModel', 'geminiKey', 'geminiModel', 'defaultEngine', 'prInstructions', 'pageInstructions'], resolve);
      });
      const prompt = fmtPromptFromRaw(raw, maxChars, { prInstructions: store.prInstructions, pageInstructions: store.pageInstructions });

      const useEngine = engine || store.defaultEngine || (store.openaiKey ? 'chatgpt' : (store.geminiKey ? 'gemini' : 'chatgpt'));

      if (useEngine === 'gemini') {
        if (!store.geminiKey) throw new Error('Missing Gemini API key. Set it in Options.');
        const summary = await callGemini({ apiKey: store.geminiKey, model: store.geminiModel || DEFAULT_GEMINI_MODEL, prompt });
        sendResponse({ ok: true, summary, provider: 'gemini' });
        return;
      }

      // default to OpenAI
      if (!store.openaiKey) throw new Error('Missing OpenAI API key. Set it in Options.');
      const summary = await callOpenAI({ apiKey: store.openaiKey, model: store.openaiModel || DEFAULT_MODEL, prompt });
      sendResponse({ ok: true, summary, provider: 'openai' });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true;
});
