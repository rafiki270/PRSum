PRSum — LLM-Friendly Summarizer
================================

Summarize webpages and GitHub PRs into clean, LLM-ready briefs. Supports OpenAI (ChatGPT) and Google (Gemini) with customizable instruction templates.

Features
- Summarizes arbitrary webpages into concise, structured bullets.
- PR-aware mode: extracts title, files changed, and essential added/removed code lines.
- Customizable instruction templates for PRs and regular pages (Options → Instruction Templates).
- Engine switcher (ChatGPT/Gemini), copy-to-clipboard, optional max-length hint.
- Friendly errors on system pages (e.g., chrome://) where extensions can’t read content.

Project Layout
- `manifest.json` (MV2 for Safari converter) and `manifest.chrome.json` (MV3 for Chrome)
- `content-script.js` — raw extraction helper (PR detection + page text capture)
- `background.js` — calls OpenAI/Gemini; builds prompts from templates
- `popup.html` / `popup.js` / `popup.css` — UI to summarize/copy
- `options.html` / `options.js` — API keys, defaults, and instruction templates

Install in Chrome (step by step)
1) Get the code
- Clone: `git clone https://github.com/your-org/PRSum.git`
- `cd PRSum`

2) Build the Chrome bundle
- Run: `make chrome`
- Output: `dist/chrome/` with the unpacked extension files.

3) Load in Chrome
- Open `chrome://extensions`
- Enable “Developer mode” (top right)
- Click “Load unpacked”
- Select the `dist/chrome` folder

4) Configure & use
- Click the extension icon on a webpage or GitHub PR
- Open “Settings” in the popup to add OpenAI/Gemini API keys, choose default engine, and edit instruction templates
- Optionally enable/disable auto-summarize in Settings

Convert to Safari (macOS)
Prereqs
- Xcode 14+ with command-line tools

Steps
1. In this folder, run:

   ```bash
   xcrun safari-web-extension-converter . \
     --project-location ../PRSum-Safari \
     --app-name "PRSum" \
     --bundle-identifier com.example.PRSum \
     --macos-only \
     --no-open \
     --force
   ```

2. Open `../PRSum-Safari/PRSum.xcodeproj`
3. Set your Team for signing on both app and extension targets
4. Build & run the host app
5. In Safari: Settings → Extensions → enable “PRSum”
6. If API calls fail on macOS, enable App Sandbox → Outgoing Connections (Client) on the host app target and rebuild

Using LLM Modes
- ChatGPT (OpenAI): enter API key + model (e.g., `gpt-4o`, `gpt-4.1`, `gpt-4o-mini`) and select Engine = ChatGPT.
- Gemini (Google): enter API key + model (e.g., `gemini-2.0-flash`, `gemini-1.5-pro`) and select Engine = Gemini.

LLM-First Extraction
- For both engines, the model receives raw page/PR text and performs the extraction itself.
- On GitHub PRs, the extension sends the “Files changed” content (when available) so the model can output files and code snippets.

Templates (customizable in Settings)
- PR Instructions (default):
  - Human-readable sections only; no JSON/YAML.
  - Sections: Summary; Files Changed; Added Code; Removed Code.
  - Include exact lines from diffs in fenced code blocks; preserve identifiers and constants.
  - Goal: Make it easy for another LLM (e.g., to replicate the work or add similar functionality).
- Page Instructions (default):
  - Concise headings/bullets; no JSON/YAML; keep key facts and steps only.

Privacy
- ChatGPT mode: sends extracted text/metadata to OpenAI’s API; keys stored in `chrome.storage.local`.
- Gemini mode: sends extracted text/metadata to Google’s Generative Language API; keys stored in `chrome.storage.local`.

Tips
- For PRs, prefer the “Files changed” tab to ensure the diff is available.
- You can adjust the optional max-length hint from the popup (checkbox next to the numeric field).

License
- Provided as-is for your project; adapt as needed.
