const STORAGE_KEY = "chatgptTokenRows";
const QUEUE_KEY = "chatgptPromptQueue";
const QUEUE_INDEX_KEY = "chatgptPromptQueueIndex";
const AUTO_RUNNING_KEY = "chatgptPromptQueueAutoRunning";
const AUTO_STATUS_KEY = "chatgptPromptQueueAutoStatus";

function escapeCsvValue(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(rows) {
  const header = ["S.No", "Prompt", "Input Tokens", "Output Tokens"];
  const lines = [header.map(escapeCsvValue).join(",")];

  rows.forEach((row, index) => {
    lines.push([
      index + 1,
      row.prompt || "",
      row.inputTokens || 0,
      row.outputTokens || 0
    ].map(escapeCsvValue).join(","));
  });

  return lines.join("\r\n");
}

function downloadCsv(rows) {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "chatgpt_tokens.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function truncatePrompt(prompt) {
  const text = String(prompt || "");
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function renderRows(rows) {
  const tbody = document.getElementById("tokenRows");
  tbody.textContent = "";

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty";
    cell.textContent = "No completed prompt-response pairs found yet.";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  rows.forEach((item, index) => {
    const row = document.createElement("tr");
    const values = [
      index + 1,
      truncatePrompt(item.prompt),
      item.inputTokens || 0,
      item.outputTokens || 0
    ];

    values.forEach((value, valueIndex) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (valueIndex === 1) {
        cell.title = item.prompt || "";
        cell.className = "prompt";
      }
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });
}

async function getRows() {
  const stored = await browser.storage.local.get({ [STORAGE_KEY]: [] });
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

function parsePromptQueue(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  if (/^---$/m.test(normalized)) {
    return normalized
      .split(/^---$/m)
      .map((prompt) => prompt.trim())
      .filter(Boolean);
  }

  return normalized
    .split("\n")
    .map((prompt) => prompt.trim())
    .filter(Boolean);
}

function parseCsvPromptQueue(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  const input = String(text || "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  rows.push(row);

  const nonEmptyRows = rows.filter((item) => item.some((cell) => cell.trim()));
  if (!nonEmptyRows.length) {
    return [];
  }

  const header = nonEmptyRows[0].map((cell) => cell.trim().toLowerCase());
  const promptColumn = header.findIndex((cell) => ["prompt", "prompts", "question", "input"].includes(cell));
  const dataRows = promptColumn >= 0 ? nonEmptyRows.slice(1) : nonEmptyRows;
  const columnIndex = promptColumn >= 0 ? promptColumn : 0;

  return dataRows
    .map((item) => (item[columnIndex] || "").trim())
    .filter(Boolean);
}

function queueToText(queue) {
  return queue.join("\n---\n");
}

function renderQueueStatus(queue, index, message) {
  const status = document.getElementById("queueStatus");
  const total = queue.length;
  const current = Math.min(index, total);
  const prefix = total ? `${current} of ${total} prompts inserted.` : "No prompt queue saved.";
  status.textContent = message ? `${prefix} ${message}` : prefix;
}

async function getQueueState() {
  const stored = await browser.storage.local.get({
    [QUEUE_KEY]: [],
    [QUEUE_INDEX_KEY]: 0,
    [AUTO_RUNNING_KEY]: false,
    [AUTO_STATUS_KEY]: ""
  });
  const queue = Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [];
  const index = Number.isInteger(stored[QUEUE_INDEX_KEY]) ? stored[QUEUE_INDEX_KEY] : 0;
  return {
    queue,
    index: Math.max(0, Math.min(index, queue.length)),
    autoRunning: Boolean(stored[AUTO_RUNNING_KEY]),
    autoStatus: String(stored[AUTO_STATUS_KEY] || "")
  };
}

async function saveQueueFromInput() {
  const input = document.getElementById("promptQueueInput");
  const queue = parsePromptQueue(input.value);
  await browser.storage.local.set({
    [QUEUE_KEY]: queue,
    [QUEUE_INDEX_KEY]: 0,
    [AUTO_RUNNING_KEY]: false,
    [AUTO_STATUS_KEY]: ""
  });
  input.value = queueToText(queue);
  renderQueueStatus(queue, 0, queue.length ? "Queue saved." : "");
}

async function resetQueue() {
  const { queue } = await getQueueState();
  await browser.storage.local.set({ [QUEUE_INDEX_KEY]: 0 });
  renderQueueStatus(queue, 0, queue.length ? "Queue reset." : "");
}

async function getActiveChatGptTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id || !isChatGptUrl(tab.url)) {
    return null;
  }
  return tab;
}

function isChatGptUrl(url) {
  try {
    return new URL(url).hostname === "chatgpt.com";
  } catch (error) {
    return false;
  }
}

async function insertNextPrompt() {
  const { queue, index } = await getQueueState();
  if (!queue.length) {
    renderQueueStatus(queue, index, "Save prompts first.");
    return;
  }

  if (index >= queue.length) {
    renderQueueStatus(queue, index, "All prompts have been inserted.");
    return;
  }

  const tab = await getActiveChatGptTab();
  if (!tab) {
    renderQueueStatus(queue, index, "Open chatgpt.com in the active tab first.");
    return;
  }

  try {
    const response = await browser.tabs.sendMessage(tab.id, {
      type: "INSERT_PROMPT",
      prompt: queue[index]
    });

    if (!response || !response.ok) {
      renderQueueStatus(queue, index, response && response.error ? response.error : "Could not insert prompt.");
      return;
    }

    const nextIndex = index + 1;
    await browser.storage.local.set({ [QUEUE_INDEX_KEY]: nextIndex });
    renderQueueStatus(queue, nextIndex, "Prompt inserted. Review it, then press Enter or click Send in ChatGPT.");
  } catch (error) {
    renderQueueStatus(queue, index, "Refresh chatgpt.com and try again.");
  }
}

async function importPromptFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  const text = await file.text();
  const queue = file.name.toLowerCase().endsWith(".csv")
    ? parseCsvPromptQueue(text)
    : parsePromptQueue(text);
  const input = document.getElementById("promptQueueInput");

  await browser.storage.local.set({
    [QUEUE_KEY]: queue,
    [QUEUE_INDEX_KEY]: 0,
    [AUTO_RUNNING_KEY]: false,
    [AUTO_STATUS_KEY]: ""
  });
  input.value = queueToText(queue);
  renderQueueStatus(queue, 0, queue.length ? `Imported ${queue.length} prompts.` : "No prompts found in file.");
  event.target.value = "";
}

async function startAutoQueue() {
  const { queue, index } = await getQueueState();
  if (!queue.length) {
    renderQueueStatus(queue, index, "Save or import prompts first.");
    return;
  }

  if (index >= queue.length) {
    renderQueueStatus(queue, index, "Reset the queue before starting again.");
    return;
  }

  const tab = await getActiveChatGptTab();
  if (!tab) {
    renderQueueStatus(queue, index, "Open chatgpt.com in the active tab first.");
    return;
  }

  await browser.storage.local.set({
    [AUTO_RUNNING_KEY]: true,
    [AUTO_STATUS_KEY]: "Auto-run starting."
  });

  try {
    await browser.tabs.sendMessage(tab.id, { type: "START_AUTO_QUEUE" });
    renderQueueStatus(queue, index, "Auto-run started.");
  } catch (error) {
    await browser.storage.local.set({
      [AUTO_RUNNING_KEY]: false,
      [AUTO_STATUS_KEY]: "Refresh chatgpt.com and try again."
    });
    renderQueueStatus(queue, index, "Refresh chatgpt.com and try again.");
  }
}

async function stopAutoQueue() {
  const { queue, index } = await getQueueState();
  await browser.storage.local.set({
    [AUTO_RUNNING_KEY]: false,
    [AUTO_STATUS_KEY]: "Auto-run stopped."
  });

  const tab = await getActiveChatGptTab();
  if (tab) {
    try {
      await browser.tabs.sendMessage(tab.id, { type: "STOP_AUTO_QUEUE" });
    } catch (error) {
      // The storage flag is enough to keep auto-run stopped after refreshes.
    }
  }

  renderQueueStatus(queue, index, "Auto-run stopped.");
}

document.addEventListener("DOMContentLoaded", async () => {
  const rows = await getRows();
  const { queue, index, autoStatus } = await getQueueState();

  renderRows(rows);
  document.getElementById("promptQueueInput").value = queueToText(queue);
  renderQueueStatus(queue, index, autoStatus);

  document.getElementById("exportCsv").addEventListener("click", () => {
    downloadCsv(rows);
  });

  document.getElementById("promptFile").addEventListener("change", importPromptFile);
  document.getElementById("saveQueue").addEventListener("click", saveQueueFromInput);
  document.getElementById("insertNextPrompt").addEventListener("click", insertNextPrompt);
  document.getElementById("startAutoQueue").addEventListener("click", startAutoQueue);
  document.getElementById("stopAutoQueue").addEventListener("click", stopAutoQueue);
  document.getElementById("resetQueue").addEventListener("click", resetQueue);

  browser.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[QUEUE_INDEX_KEY] || changes[AUTO_STATUS_KEY] || changes[AUTO_RUNNING_KEY]) {
      const state = await getQueueState();
      renderQueueStatus(state.queue, state.index, state.autoStatus);
    }
  });
});
