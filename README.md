# ChatGPT Token Counter

A Firefox browser extension for `chatgpt.com` that records prompts, ChatGPT outputs, and token counts in a local popup table.

The extension can also run a prompt queue automatically: it inserts prompts into ChatGPT, sends them one by one, waits for ChatGPT to finish, then stores the prompt, response, input token count, and output token count.

## What It Does

- Detects visible prompt-response pairs on `chatgpt.com`.
- Counts input tokens from the user prompt.
- Counts output tokens from the ChatGPT response.
- Saves each row locally in Firefox storage.
- Shows the saved rows in the extension popup table.
- Exports table data to CSV.
- Automates sending prompts from a saved queue.
- Backfills missing outputs from open ChatGPT conversation tabs.
- Clears saved table rows when needed.

## How It Works

The extension has two main parts:

- `content.js` runs inside `chatgpt.com`.
- `popup.js` runs inside the extension popup.

The content script watches the ChatGPT page with a `MutationObserver`. When new messages appear or change, it reads visible messages marked as user or assistant messages, pairs each user prompt with the next ChatGPT response, counts tokens, and saves the result to `browser.storage.local`.

The popup reads the saved rows from local storage and renders them in the table.

## How Token Counting Works

Token counting is done locally in the browser using the bundled `js-tiktoken` tokenizer with the `o200k_base` encoding.

For each completed prompt-response pair:

- `Input Tokens` is calculated from the visible user prompt text.
- `Output Tokens` is calculated from the visible ChatGPT response text.

The extension does not call any external API for token counting.

Important limitation: the extension can only count visible text available in the browser page. It cannot access ChatGPT's hidden system prompts, internal server-side tokens, tool calls, uploaded file contents, or private backend accounting. Because of that, the token counts are useful local estimates, not exact server billing numbers.

## How Data Gets Added To The Table

When you use ChatGPT normally, the extension scans the visible conversation and saves completed prompt-response pairs.

Each table row contains:

- `S.No`
- `Prompt`
- `ChatGPT Output`
- `Input Tokens`
- `Output Tokens`

For automated prompts, the extension first saves a prompt-only row when the prompt is sent. When ChatGPT finishes responding, the same row is updated with the ChatGPT output and output token count.

Duplicate prompt-response pairs are skipped using a local signature of the prompt and response text.

## Load In Firefox

1. Open Firefox.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on...`.
4. Select `manifest.json` from this folder.
5. Open `https://chatgpt.com/`.
6. Refresh any already-open ChatGPT tabs after reloading the extension.
7. Click the extension icon to view the saved table.

## Manual Prompt Queue

Use this when you want to control sending each prompt yourself.

1. Open `https://chatgpt.com/` in the active tab.
2. Open the extension popup.
3. Import a `.txt` or `.csv` prompt file, or paste prompts into the Prompt Queue box.
4. For text input, use one prompt per line. For long multi-line prompts, separate prompts with a line containing only `---`.
5. Click `Save Queue`.
6. Click `Insert Next Prompt`.
7. Review the prompt in ChatGPT.
8. Press Enter or click Send in ChatGPT.
9. Repeat `Insert Next Prompt` for the remaining prompts.

After ChatGPT responds, the extension records the prompt, output, and token counts in the table.

## Automatic Prompt Sending

Use this when you want the extension to send prompts one after another.

1. Open `https://chatgpt.com/` in the active tab.
2. Save or import a prompt queue.
3. Click `Start Auto`.
4. Keep the ChatGPT tab open.
5. The extension inserts the current prompt, clicks Send, waits while ChatGPT is generating, then sends the next prompt.
6. Click `Stop` to pause automation.
7. Click `Reset` if you want to start the queue from the first prompt again.

Auto-run depends on ChatGPT's page controls. It can be interrupted by rate limits, captchas, network issues, model limit messages, page refreshes, or ChatGPT UI changes.

## Backfill Missing Outputs

If older rows have blank `ChatGPT Output` values, open the matching ChatGPT conversations in browser tabs and click `Backfill Open Chats`.

The extension will scan every open `chatgpt.com` tab one by one and try to match visible prompt-response pairs to blank rows in the saved table.

Backfill can only recover outputs that are still visible in loaded ChatGPT conversation pages. If the response is not available in an open tab and was never saved earlier, the extension cannot recover it.

## Clear Saved Table Data

Click `Clear Table` to delete saved table rows from local Firefox storage.

This clears:

- saved prompt-response rows
- saved duplicate-detection signatures
- any pending prompt waiting for an output

It does not delete the saved prompt queue.

## Export CSV

Click `Export CSV` to download `chatgpt_tokens.csv`.

The CSV contains:

- `S.No`
- `Prompt`
- `ChatGPT Output`
- `Input Tokens`
- `Output Tokens`

## Files

- `manifest.json` - Firefox extension manifest.
- `tokenizer.js` - Bundled tokenizer generated from `js-tiktoken`.
- `tokenizer-entry.js` - Source entry used to build `tokenizer.js`.
- `content.js` - Watches ChatGPT messages, pairs prompts and outputs, counts tokens, saves rows, and handles automation/backfill messages.
- `popup.html` - Popup markup.
- `popup.js` - Popup table rendering, prompt queue controls, automation buttons, backfill, clear table, and CSV export.
- `popup.css` - Popup styling.
- `package.json` and `package-lock.json` - JavaScript dependencies used to build the tokenizer bundle.

## Notes

- Data is stored locally in Firefox using `browser.storage.local`.
- The extension is limited to `https://chatgpt.com/*`.
- The extension reads visible page text only.
- Reload the temporary extension and refresh ChatGPT tabs after code changes.
