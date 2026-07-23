# ChatGPT Token Counter

A simple Firefox extension that works only on `chatgpt.com`. It detects completed prompt-response pairs in ChatGPT conversations, counts visible prompt and response text with a local `js-tiktoken` tokenizer bundle, stores the results locally, and shows them in a popup table.

## Files

- `manifest.json` - Firefox extension manifest.
- `tokenizer.js` - Bundled local tokenizer code generated from `js-tiktoken` with `o200k_base`.
- `tokenizer-entry.js` - Source entry used to build `tokenizer.js`.
- `content.js` - Watches ChatGPT conversation changes with `MutationObserver`, extracts prompt-response pairs, counts visible text tokens, and saves rows to `browser.storage.local`.
- `popup.html` - Popup markup.
- `popup.js` - Popup rendering and CSV export logic.
- `popup.css` - Lightweight popup styling.

## How token counting works

The extension uses a local bundled `js-tiktoken` tokenizer with the `o200k_base` encoding. This is much closer to ChatGPT tokenization than word counting and works without external APIs.

It counts only the visible user prompt and visible assistant response text extracted from the ChatGPT page. ChatGPT's internal/system tokens, hidden tool messages, attachments, and any server-side accounting are not exposed to browser extensions, so the extension cannot report the exact private server-side total.

## Load in Firefox

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on...`.
4. Select `manifest.json` from this folder.
5. Open `https://chatgpt.com/` and use ChatGPT normally.
6. Click the extension icon to view stored rows.

## Using a prompt queue

To avoid pasting a large dataset prompt by prompt:

1. Open `https://chatgpt.com/` in the active Firefox tab.
2. Open the extension popup.
3. Import a `.txt` or `.csv` prompt file, or paste all prompts into the Prompt Queue box.
4. For text input, use one prompt per line, or separate longer multi-line prompts with a line containing only `---`.
5. Click `Save Queue`.
6. Click `Insert Next Prompt`.
7. Review the inserted prompt in ChatGPT, then press Enter or click Send.
8. Repeat `Insert Next Prompt` for the next prompt.

For automatic sending, click `Start Auto`. The extension sends one prompt, waits until ChatGPT appears idle, then sends the next prompt. Click `Stop` to pause automation.

Auto-run depends on ChatGPT's page controls and can be interrupted by rate limits, captchas, network errors, model limit messages, or UI changes. Keep the ChatGPT tab visible and check progress periodically.

## Export CSV

Click `Export CSV` in the popup to download `chatgpt_tokens.csv`.

If older rows have blank outputs, open the matching ChatGPT conversations in browser tabs and click `Backfill Open Chats`.
The extension will rescan visible prompt-response pairs in every open `chatgpt.com` tab and fill matching blank output rows.
Rows can only be recovered this way when the matching ChatGPT response is still available in a loaded conversation page.

The CSV contains exactly these columns:

- `S.No`
- `Prompt`
- `ChatGPT Output`
- `Input Tokens`
- `Output Tokens`

## Notes

- Data is stored locally in Firefox using `browser.storage.local`.
- Duplicate prompt-response pairs are skipped using a local signature of the prompt and response text.
- The extension is limited to `https://chatgpt.com/*` by the manifest.
