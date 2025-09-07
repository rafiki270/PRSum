PRSum — Safari Web Extension (LLM-Friendly Summarizer)

Overview
- Extracts the main content from any webpage and generates a concise, LLM-ready summary.
- Filters boilerplate (nav, cookie prompts, promos) and keeps key sentences, lists, and a code snippet when present.
- Provides a popup UI with a copy button and adjustable target length.

Project Layout
- `manifest.json`: WebExtension manifest (MV2; Safari-compatible via converter)
- `content-script.js`: Page extraction + local summarization logic
- `background.js`: Calls OpenAI or Gemini to summarize extracted content
- `popup.html` / `popup.js` / `popup.css`: Simple UI to run and copy the summary
- `options.html`: Configure OpenAI API key and model

Local Load (Chrome/Edge/Firefox)
1. Chrome/Edge: open `chrome://extensions` or `edge://extensions`, enable Developer Mode, Load Unpacked, select this folder.
2. Firefox (Developer Edition recommended): open `about:debugging`, This Firefox, Load Temporary Add-on…, pick any file in this folder.

Install in Chrome (step by step)
1) Get the code
- Clone: `git clone https://github.com/your-org/PRSum.git` (or download ZIP and extract)
- `cd PRSum`

2) Build the Chrome bundle
- Run: `make chrome`
- This creates `dist/chrome/` with the unpacked extension files (`manifest.json`, scripts, HTML, etc.).

3) Load in Chrome
- Open `chrome://extensions`
- Toggle ON “Developer mode” (top right)
- Click “Load unpacked”
- Select the `dist/chrome` folder

4) Use it
- Pin the extension icon if desired
- Click the icon on any page (or a GitHub PR) to summarize
- Open “Settings” in the popup to add your OpenAI/Gemini API keys and adjust defaults

Convert to Safari (macOS)
Prereqs:
- Xcode 14+ with command-line tools installed

Steps:
1. Open Terminal in this folder.
2. Run Apple’s converter (adjust bundle ID and app name as desired):

   xcrun safari-web-extension-converter . \
     --project-location ../PRSum-Safari \
     --app-name "PRSum" \
     --bundle-identifier com.example.PRSum \
     --macos-only \
     --no-open \
     --force

3. Open the generated Xcode project at `../PRSum-Safari/PRSum.xcodeproj`.
4. In Xcode, set your Team for signing on both the app target and the extension target.
5. Build and run. This launches a host app that installs the extension to Safari.
6. In Safari, enable the extension: Safari > Settings > Extensions > PRSum.
7. If API calls fail on macOS builds, open the Xcode project target settings and ensure App Sandbox → Outgoing Connections (Client) is enabled for the host app target. Rebuild and try again.

Notes & Tips
- The converter targets Safari Web Extensions; MV2 in this project is supported by Safari’s converter and runtime.
- If you want a smaller popup, edit the width/height in `popup.css`.
- You can tweak the `maxChars` default in `popup.html` or the `summarize()` call.
- To use ChatGPT (OpenAI) mode in Safari, set your API key in the extension’s Options page after installing the converted app.

Using LLM Modes
- ChatGPT (OpenAI): Open Options, paste your OpenAI API key, set model (e.g., `gpt-4o`, `gpt-4.1`, `gpt-4o-mini`). In popup, choose Engine = ChatGPT.
- Gemini (Google): Open Options, paste your Gemini API key (Generative Language API), set model (e.g., `gemini-2.0-flash`, `gemini-1.5-pro`). In popup, choose Engine = Gemini.

LLM-First Extraction
- When Engine = ChatGPT or Gemini, the extension sends raw page text to the model to perform the extraction itself, rather than relying on local heuristics.
- For GitHub PRs, it captures the PR page text (including Files changed, when available) so the model can extract changed files, properties, and added code.

How It Works (Summary)
- The content script heuristically selects a main container (prefers `<article>`, `main`, and other content-heavy nodes), strips non-content nodes, and builds a text representation.
- It filters boilerplate phrases and short/low-signal paragraphs.
- Sentences are scored by normalized word frequencies with stopwords removed; the top sentences are selected under a character budget and presented as bullets.
- Up to two lists (flattened) and the first code block are appended to preserve high-value details.

 Privacy
- ChatGPT mode: sends extracted text/metadata to OpenAI’s API. Key stored in `chrome.storage.local`.
- Gemini mode: sends extracted text/metadata to Google Generative Language API. Key stored in `chrome.storage.local`.

License
- Provided as-is for your project; adapt as needed.

GitHub PR Mode
- Automatically detects GitHub PR pages (`github.com/<owner>/<repo>/pull/<number>`).
- Extracts: title, author, branches, changed files, +/− line counts, added/removed lines.
- Infers property names from added lines (JSON/object keys, TS/JS/Python props, env constants).
- Popup shows a PR-focused summary and, in LLM mode, the background builds a PR-specific prompt for ChatGPT/Gemini to produce a changelog/reviewer-friendly brief.
- Tip: Use the “Files changed” tab for the most complete extraction (GitHub sometimes lazy-loads diffs).
