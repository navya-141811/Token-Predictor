(() => {
  const STORAGE_KEY = "chatgptTokenRows";
  const SIGNATURE_KEY = "chatgptTokenSignatures";
  const PENDING_PROMPT_KEY = "chatgptPendingPrompt";
  const QUEUE_KEY = "chatgptPromptQueue";
  const QUEUE_INDEX_KEY = "chatgptPromptQueueIndex";
  const AUTO_RUNNING_KEY = "chatgptPromptQueueAutoRunning";
  const AUTO_STATUS_KEY = "chatgptPromptQueueAutoStatus";
  const OBSERVER_DELAY_MS = 1200;
  const AUTO_DELAY_MS = 3000;

  let saveTimer = null;
  let autoTimer = null;
  let autoRunning = false;
  let isSaving = false;
  let pendingSave = false;

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function countTokens(text) {
    if (!window.ChatGPTTokenCounterTokenizer) {
      throw new Error("Tokenizer is not loaded.");
    }
    return window.ChatGPTTokenCounterTokenizer.count(text);
  }

  function getReadableText(messageNode) {
    const clone = messageNode.cloneNode(true);
    clone.querySelectorAll("button, nav, menu, svg, style, script, textarea").forEach((node) => {
      node.remove();
    });
    return normalizeText(clone.innerText || clone.textContent || "");
  }

  function getMessages() {
    return Array.from(document.querySelectorAll("[data-message-author-role]"))
      .map((node, index) => ({
        index,
        role: node.getAttribute("data-message-author-role"),
        text: getReadableText(node)
      }))
      .filter((message) => {
        return (message.role === "user" || message.role === "assistant") && message.text.length > 0;
      });
  }

  function buildPairs(messages) {
    const pairs = [];
    let activePrompt = null;

    for (const message of messages) {
      if (message.role === "user") {
        activePrompt = message;
        continue;
      }

      if (message.role === "assistant" && activePrompt) {
        pairs.push({
          prompt: activePrompt.text,
          response: message.text,
          inputTokens: countTokens(activePrompt.text),
          outputTokens: countTokens(message.text)
        });
        activePrompt = null;
      }
    }

    return pairs;
  }

  function hashString(value) {
    let hash = 5381;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
    }
    return (hash >>> 0).toString(36);
  }

  function pairSignature(pair) {
    return hashString(`${pair.prompt}\n---\n${pair.response}`);
  }

  function promptSignature(prompt) {
    return hashString(`prompt-only\n---\n${prompt}`);
  }

  function responseCanBeReplaced(currentResponse, nextResponse) {
    if (!currentResponse) {
      return true;
    }

    return nextResponse.length >= currentResponse.length
      && nextResponse.startsWith(currentResponse);
  }

  function findRowForPair(rows, pair, signature) {
    const pendingSignature = promptSignature(pair.prompt);
    return rows.find((row) => row.signature === signature)
      || rows.find((row) => row.signature === pendingSignature)
      || rows.find((row) => row.prompt === pair.prompt && (row.pending || !row.response))
      || rows.find((row) => {
        return row.prompt === pair.prompt
          && responseCanBeReplaced(normalizeText(row.response), pair.response);
      });
  }

  function applyPairToRow(row, pair, signature) {
    row.inputTokens = pair.inputTokens;
    row.response = pair.response;
    row.outputTokens = pair.outputTokens;
    row.tokenizerEncoding = window.ChatGPTTokenCounterTokenizer.encoding;
    row.signature = signature;
    row.pending = false;
  }

  async function upsertPromptOnly(prompt) {
    const normalizedPrompt = normalizeText(prompt);
    if (!normalizedPrompt) {
      return;
    }

    const signature = promptSignature(normalizedPrompt);
    const stored = await browser.storage.local.get({ [STORAGE_KEY]: [] });
    const rows = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    const existingRow = rows.find((row) => row.signature === signature);

    if (existingRow) {
      existingRow.inputTokens = countTokens(normalizedPrompt);
      existingRow.tokenizerEncoding = window.ChatGPTTokenCounterTokenizer.encoding;
    } else {
      rows.push({
        prompt: normalizedPrompt,
        inputTokens: countTokens(normalizedPrompt),
        outputTokens: 0,
        createdAt: new Date().toISOString(),
        tokenizerEncoding: window.ChatGPTTokenCounterTokenizer.encoding,
        signature,
        pending: true
      });
    }

    await browser.storage.local.set({
      [STORAGE_KEY]: rows,
      [PENDING_PROMPT_KEY]: normalizedPrompt
    });
  }

  async function completePendingPrompt(responseText) {
    const normalizedResponse = normalizeText(responseText);
    if (!normalizedResponse) {
      return false;
    }

    const stored = await browser.storage.local.get({
      [STORAGE_KEY]: [],
      [SIGNATURE_KEY]: [],
      [PENDING_PROMPT_KEY]: ""
    });
    const prompt = normalizeText(stored[PENDING_PROMPT_KEY]);
    if (!prompt) {
      return false;
    }

    const rows = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    const signatures = new Set(Array.isArray(stored[SIGNATURE_KEY]) ? stored[SIGNATURE_KEY] : []);
    const pair = {
      prompt,
      response: normalizedResponse,
      inputTokens: countTokens(prompt),
      outputTokens: countTokens(normalizedResponse)
    };
    const newSignature = pairSignature(pair);
    const row = findRowForPair(rows, pair, newSignature);

    if (!row) {
      return false;
    }

    applyPairToRow(row, pair, newSignature);
    signatures.add(newSignature);

    await browser.storage.local.set({
      [STORAGE_KEY]: rows,
      [SIGNATURE_KEY]: Array.from(signatures),
      [PENDING_PROMPT_KEY]: ""
    });
    return true;
  }

  function getLastAssistantMessageText() {
    const assistantMessages = getMessages().filter((message) => message.role === "assistant");
    const last = assistantMessages[assistantMessages.length - 1];
    return last ? last.text : "";
  }

  async function storePairs() {
    if (isSaving) {
      pendingSave = true;
      return { ok: true, pairs: 0, changed: 0, busy: true };
    }

    isSaving = true;
    try {
      const pairs = buildPairs(getMessages());
      if (!pairs.length) {
        return { ok: true, pairs: 0, changed: 0 };
      }

      const stored = await browser.storage.local.get({
        [STORAGE_KEY]: [],
        [SIGNATURE_KEY]: []
      });

      const rows = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
      const signatures = new Set(Array.isArray(stored[SIGNATURE_KEY]) ? stored[SIGNATURE_KEY] : []);
      let changed = false;
      let changedCount = 0;

      for (const pair of pairs) {
        const signature = pairSignature(pair);
        const row = findRowForPair(rows, pair, signature);

        if (row) {
          const shouldUpdate = row.signature !== signature
            || row.response !== pair.response
            || row.tokenizerEncoding !== window.ChatGPTTokenCounterTokenizer.encoding;

          if (shouldUpdate) {
            applyPairToRow(row, pair, signature);
            signatures.add(signature);
            changed = true;
            changedCount += 1;
          }

          continue;
        }

        if (signatures.has(signature)) {
          continue;
        }

        signatures.add(signature);
        rows.push({
          prompt: pair.prompt,
          response: pair.response,
          inputTokens: pair.inputTokens,
          outputTokens: pair.outputTokens,
          createdAt: new Date().toISOString(),
          tokenizerEncoding: window.ChatGPTTokenCounterTokenizer.encoding,
          signature
        });
        changed = true;
        changedCount += 1;
      }

      if (changed) {
        await browser.storage.local.set({
          [STORAGE_KEY]: rows,
          [SIGNATURE_KEY]: Array.from(signatures)
        });
      }

      return { ok: true, pairs: pairs.length, changed: changedCount };
    } catch (error) {
      console.error("ChatGPT Token Counter failed to store conversation data:", error);
      return {
        ok: false,
        error: error && error.message ? error.message : "Could not scan ChatGPT messages."
      };
    } finally {
      isSaving = false;
      if (pendingSave) {
        pendingSave = false;
        scheduleSave();
      }
    }
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(storePairs, OBSERVER_DELAY_MS);
  }

  function getPromptEditor() {
    return document.querySelector("#prompt-textarea")
      || document.querySelector("textarea")
      || document.querySelector("[contenteditable='true']");
  }

  function getPromptText() {
    const editor = getPromptEditor();
    if (!editor) {
      return "";
    }

    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      return normalizeText(editor.value);
    }

    return normalizeText(editor.innerText || editor.textContent || "");
  }

  function insertPrompt(prompt) {
    const editor = getPromptEditor();
    if (!editor) {
      return { ok: false, error: "Could not find the ChatGPT prompt box." };
    }

    editor.focus();

    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      editor.value = prompt;
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: prompt,
        inputType: "insertText"
      }));
      return { ok: true };
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand("insertText", false, prompt);
    if (!inserted) {
      editor.textContent = prompt;
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: prompt,
        inputType: "insertText"
      }));
    }

    return { ok: true };
  }

  function getSendButton() {
    return document.querySelector("button[data-testid='send-button']")
      || Array.from(document.querySelectorAll("button")).find((button) => {
        const label = button.getAttribute("aria-label") || "";
        return /send/i.test(label);
      });
  }

  function isGenerating() {
    return Array.from(document.querySelectorAll("button")).some((button) => {
      const testId = button.getAttribute("data-testid") || "";
      const label = button.getAttribute("aria-label") || "";
      return /stop/i.test(testId) || /stop/i.test(label);
    });
  }

  async function setAutoStatus(status) {
    await browser.storage.local.set({ [AUTO_STATUS_KEY]: status });
  }

  function scheduleAutoStep(delay = AUTO_DELAY_MS) {
    window.clearTimeout(autoTimer);
    if (autoRunning) {
      autoTimer = window.setTimeout(runAutoStep, delay);
    }
  }

  async function stopAuto(status) {
    autoRunning = false;
    window.clearTimeout(autoTimer);
    await browser.storage.local.set({
      [AUTO_RUNNING_KEY]: false,
      [AUTO_STATUS_KEY]: status
    });
  }

  async function clickSendButton() {
    const sendButton = getSendButton();
    if (!sendButton || sendButton.disabled || sendButton.getAttribute("aria-disabled") === "true") {
      return false;
    }

    sendButton.click();
    return true;
  }

  async function runAutoStep() {
    if (!autoRunning) {
      return;
    }

    if (isGenerating()) {
      await setAutoStatus("Waiting for the current response to finish.");
      scheduleAutoStep();
      return;
    }

    if (getPromptText()) {
      await setAutoStatus("Prompt box is not empty. Send or clear it to continue.");
      scheduleAutoStep();
      return;
    }

    const stored = await browser.storage.local.get({
      [QUEUE_KEY]: [],
      [QUEUE_INDEX_KEY]: 0
    });
    const queue = Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [];
    const index = Number.isInteger(stored[QUEUE_INDEX_KEY]) ? stored[QUEUE_INDEX_KEY] : 0;

    if (!queue.length) {
      await stopAuto("No prompt queue saved.");
      return;
    }

    if (index >= queue.length) {
      await stopAuto("Auto-run complete.");
      return;
    }

    const currentPrompt = queue[index];
    const insertResult = insertPrompt(currentPrompt);
    if (!insertResult.ok) {
      await setAutoStatus(insertResult.error);
      scheduleAutoStep();
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const didSend = await clickSendButton();
    if (!didSend) {
      await setAutoStatus("Could not click Send. Send manually or retry.");
      scheduleAutoStep();
      return;
    }

    await upsertPromptOnly(currentPrompt);

    await browser.storage.local.set({
      [QUEUE_INDEX_KEY]: index + 1,
      [AUTO_STATUS_KEY]: `Sent prompt ${index + 1} of ${queue.length}.`
    });
    scheduleAutoStep(6000);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message) {
      return undefined;
    }

    if (message.type === "INSERT_PROMPT") {
      return Promise.resolve(insertPrompt(String(message.prompt || "")));
    }

    if (message.type === "START_AUTO_QUEUE") {
      autoRunning = true;
      scheduleAutoStep(250);
      return Promise.resolve({ ok: true });
    }

    if (message.type === "STOP_AUTO_QUEUE") {
      autoRunning = false;
      window.clearTimeout(autoTimer);
      return Promise.resolve({ ok: true });
    }

    if (message.type === "BACKFILL_OUTPUTS") {
      return storePairs().then(async (result) => {
        if (!isGenerating()) {
          await completePendingPrompt(getLastAssistantMessageText());
        }
        return result;
      });
    }

    return undefined;
  });

  browser.storage.local.get({ [AUTO_RUNNING_KEY]: false }).then((stored) => {
    autoRunning = Boolean(stored[AUTO_RUNNING_KEY]);
    if (autoRunning) {
      scheduleAutoStep(1000);
    }
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[AUTO_RUNNING_KEY]) {
      return;
    }

    autoRunning = Boolean(changes[AUTO_RUNNING_KEY].newValue);
    if (autoRunning) {
      scheduleAutoStep(250);
    } else {
      window.clearTimeout(autoTimer);
    }
  });

  const observer = new MutationObserver((mutations) => {
    const hasRelevantChange = mutations.some((mutation) => {
      return mutation.type === "childList" || mutation.type === "characterData";
    });

    if (hasRelevantChange) {
      scheduleSave();
      window.setTimeout(() => {
        if (!isGenerating()) {
          completePendingPrompt(getLastAssistantMessageText()).catch((error) => {
            console.error("ChatGPT Token Counter failed to complete pending prompt:", error);
          });
        }
      }, OBSERVER_DELAY_MS);
      scheduleAutoStep();
    }
  });

  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true
  });

  scheduleSave();
})();
