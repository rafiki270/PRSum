const el = id => document.getElementById(id);
const els = {
  defaultEngine: null,
  openaiKey: null,
  openaiModel: null,
  geminiKey: null,
  geminiModel: null,
  status: null,
};

function initOptions() {
  els.defaultEngine = el('defaultEngine');
  els.openaiKey = el('openaiKey');
  els.openaiModel = el('openaiModel');
  els.geminiKey = el('geminiKey');
  els.geminiModel = el('geminiModel');
  els.status = el('status');
  els.autoSummarize = el('autoSummarize');
  els.prInstructions = el('prInstructions');
  els.pageInstructions = el('pageInstructions');

  el('save').addEventListener('click', () => {
    chrome.storage.local.set({
      defaultEngine: els.defaultEngine.value,
      openaiKey: (els.openaiKey.value || '').trim(),
      openaiModel: (els.openaiModel.value || '').trim(),
      geminiKey: (els.geminiKey.value || '').trim(),
      geminiModel: (els.geminiModel.value || '').trim(),
      autoSummarize: !!els.autoSummarize.checked,
      prInstructions: (els.prInstructions.value || '').trim(),
      pageInstructions: (els.pageInstructions.value || '').trim(),
    }, () => {
      if (els.status) {
        els.status.textContent = 'Saved.';
        setTimeout(() => { if (els.status) els.status.textContent = ''; }, 1200);
      }
    });
  });

  chrome.storage.local.get(['defaultEngine','openaiKey','openaiModel','geminiKey','geminiModel','autoSummarize','prInstructions','pageInstructions'], res => {
    if (res.defaultEngine === 'chatgpt' || res.defaultEngine === 'gemini') {
      els.defaultEngine.value = res.defaultEngine;
    } else {
      // sanitize legacy values (e.g., 'local')
      els.defaultEngine.value = 'chatgpt';
    }
    if (res.openaiKey) els.openaiKey.value = res.openaiKey;
    if (res.openaiModel) els.openaiModel.value = res.openaiModel;
    if (res.geminiKey) els.geminiKey.value = res.geminiKey;
    if (res.geminiModel) {
      els.geminiModel.value = res.geminiModel;
    } else if (!els.geminiModel.value) {
      // Set a sensible default when nothing is configured yet
      els.geminiModel.value = 'gemini-2.0-flash';
    }
    els.autoSummarize.checked = (typeof res.autoSummarize === 'boolean') ? res.autoSummarize : true;

    const DEFAULT_PR = [
      'Summarize this GitHub Pull Request for replication by another LLM. Do not output JSON or YAML.',
      'Use only human-readable sections with headings and bullet points.',
      'Sections (in order):',
      '1) Summary: high-level what changed and why; note feature flags or config additions.',
      '2) Files Changed: list each file path with a one-line purpose.',
      '3) Added Code: for each file, include essential added lines in fenced code blocks.',
      '4) Removed Code: include only removed lines that are important to understand the change.',
      'Rules: Do not invent code; copy exact lines from the diff. Preserve identifiers, endpoints, constants, versions.',
      'Important! keep line numbers for the first line of each code block in a format "// line {n}"!!!',
      'Keep it concise but sufficient for another LLM to reproduce the change elsewhere.'
    ].join('\n');
    const DEFAULT_PAGE = [
      'Extract the main content and provide a precise, LLM-ready brief. Use headings and bullet points.',
      'Keep only important facts, entities, numbers, definitions, and steps.',
      'Do not output JSON or YAML. Use plain text and bullets.'
    ].join('\n');

    els.prInstructions.value = res.prInstructions || DEFAULT_PR;
    els.pageInstructions.value = res.pageInstructions || DEFAULT_PAGE;
  });
}

document.addEventListener('DOMContentLoaded', initOptions);
