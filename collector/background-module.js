(() => {
"use strict";

const API_ROOT = "http://127.0.0.1:8765";
const WEREAD_UPLOAD_URL = "https://weread.qq.com/web/upload";
const WEREAD_SYNC_ALARM = "shudu-weread-epub-sync";
const VIDEO_EXPORT_HISTORY_KEY = "shudu_video_export_imports";
let wereadSyncPromise = null;
const videoExportsInFlight = new Set();

async function api(path, body) {
  await globalThis.ShuduCollectionMode.requireEnabled();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("收藏服务响应超时；保存结果未确认，请先检查知识库再重试");
    if (error instanceof TypeError) throw new Error("无法连接本机收藏服务，请启动服务后重试；尚未确认同步到 Obsidian");
    throw error;
  } finally { clearTimeout(timer); }
}

function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2600);
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message
  });
}

async function importedVideoExportKeys() {
  const stored = await chrome.storage.local.get(VIDEO_EXPORT_HISTORY_KEY);
  return Array.isArray(stored[VIDEO_EXPORT_HISTORY_KEY])
    ? stored[VIDEO_EXPORT_HISTORY_KEY]
    : [];
}

async function rememberVideoExport(key) {
  const previous = await importedVideoExportKeys();
  const next = [key, ...previous.filter((item) => item !== key)].slice(0, 100);
  await chrome.storage.local.set({ [VIDEO_EXPORT_HISTORY_KEY]: next });
}

async function importCompletedVideoExport(downloadId) {
  if (!await globalThis.ShuduCollectionMode.isEnabled()) return;
  const [downloadItem] = await chrome.downloads.search({ id: downloadId });
  if (!downloadItem || downloadItem.state !== "complete") return;
  const request = globalThis.SHUDU_VIDEO_EXPORT.matchingVideoExport(downloadItem);
  if (!request) return;

  const key = globalThis.SHUDU_VIDEO_EXPORT.videoExportKey(downloadItem);
  if (videoExportsInFlight.has(key)) return;
  videoExportsInFlight.add(key);
  try {
    const imported = await importedVideoExportKeys();
    if (imported.includes(key)) return;
    const result = await api("/import-video-export", request);
    await rememberVideoExport(key);
    setBadge("✓", "#16877a");
    notify(
      "视频内容已收藏",
      `${result.collection.title} · ${result.videoExport.hasTranscript ? "完整字幕" : "学习稿"}`
    );
  } catch (error) {
    setBadge("!", "#c74732");
    notify("视频收藏失败", `${error.message}；下载文件仍保留在原位置`);
  } finally {
    videoExportsInFlight.delete(key);
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有可收藏的页面");
  return tab;
}

async function scheduleWereadSync() {
  if (!await globalThis.ShuduCollectionMode.isEnabled()) {
    await chrome.alarms.clear(WEREAD_SYNC_ALARM);
    return;
  }
  chrome.alarms.create(WEREAD_SYNC_ALARM, {
    when: Date.now() + 60 * 1000,
    periodInMinutes: 15
  });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let timeoutId;
    const cleanup = () => {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
    const finish = (error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    timeoutId = setTimeout(() => finish(new Error("微信读书上传页加载超时")), timeoutMs);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish(new Error(chrome.runtime.lastError.message));
      } else if (tab?.status === "complete") {
        finish();
      }
    });
  });
}

async function sendWereadSyncCommand(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "SHUDU_WEREAD_SYNC" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "collector/collection-mode.js",
        "collector/content-blocks.js",
        "collector/selection-context.js",
        "collector/selection-toolbar.js",
        "collector/annotations.js",
        "collector/feed-item.js",
        "collector/tencent-meeting.js",
        "collector/content.js"
      ]
    });
    return chrome.tabs.sendMessage(tabId, { type: "SHUDU_WEREAD_SYNC" });
  }
}

async function runWereadSync() {
  if (!await globalThis.ShuduCollectionMode.isEnabled()) return { ok: true, skipped: true };
  const queueResult = await api("/weread-upload-queue");
  const pending = Array.isArray(queueResult.items) ? queueResult.items : [];
  if (!pending.length) return { ok: true, skipped: true, pending: 0 };

  const existingTabs = await chrome.tabs.query({ url: [`${WEREAD_UPLOAD_URL}*`] });
  let tab = existingTabs.find((item) => Number.isInteger(item.id));
  if (!tab) {
    tab = await chrome.tabs.create({ url: WEREAD_UPLOAD_URL, active: false });
  }
  if (!Number.isInteger(tab?.id)) throw new Error("无法打开微信读书上传页");
  await waitForTabComplete(tab.id);

  const response = await sendWereadSyncCommand(tab.id);
  if (!response?.ok) throw new Error(response?.error || "微信读书同步未完成");
  const summary = response.summary || {};
  const uploaded = Number(summary.uploaded || 0);
  const alreadyPresent = Number(summary.alreadyPresent || 0);
  if (uploaded || alreadyPresent) {
    setBadge(String(uploaded + alreadyPresent), "#16877a");
    notify(
      "AI 内参已同步到微信读书",
      `新上传 ${uploaded} 期，书架已有 ${alreadyPresent} 期`
    );
  }
  if (summary.blocked) {
    setBadge("!", "#c74732");
    notify("微信读书同步待处理", summary.reason || "请确认微信读书登录状态");
  }
  return { ok: true, pending: pending.length, summary };
}

function triggerWereadSync() {
  if (wereadSyncPromise) return wereadSyncPromise;
  wereadSyncPromise = runWereadSync()
    .catch((error) => {
      console.warn("Shudu WeRead sync:", error.message);
      return { ok: false, error: error.message };
    })
    .finally(() => {
      wereadSyncPromise = null;
    });
  return wereadSyncPromise;
}

async function extractFromTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "SHUDU_EXTRACT_PAGE" });
    if (!response?.ok) throw new Error(response?.error || "无法读取页面");
    return response.data;
  } catch (error) {
    throw new Error(`当前页面无法读取：${error.message}`);
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function hydrateImages(images) {
  const output = [];
  let total = 0;
  for (const image of (images || []).slice(0, 6)) {
    const item = { url: image.url, alt: image.alt || "" };
    try {
      const response = await fetch(image.url, { credentials: "include", redirect: "follow" });
      const size = Number(response.headers.get("content-length") || 0);
      if (!response.ok || size > 5 * 1024 * 1024) {
        output.push(item);
        continue;
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 5 * 1024 * 1024 || total + buffer.byteLength > 12 * 1024 * 1024) {
        output.push(item);
        continue;
      }
      total += buffer.byteLength;
      const mime = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      item.dataUrl = `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
    } catch {
      // The local service makes a second public-URL attempt.
    }
    output.push(item);
  }
  return output;
}

function transcriptTimestamp(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function captionPriority(track) {
  const language = String(track.languageCode || "").toLowerCase();
  const languageScore = language.startsWith("zh") ? 30 : language.startsWith("en") ? 20 : 10;
  return languageScore + (track.kind === "asr" ? 0 : 5);
}

async function fetchYoutubeTranscript(track) {
  const url = new URL(track.url);
  if (!(url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com"))) {
    throw new Error("字幕地址不是 YouTube 官方域名");
  }
  url.searchParams.set("fmt", "json3");
  const response = await fetch(url.toString(), { credentials: "include", redirect: "follow" });
  if (!response.ok) throw new Error(`字幕读取失败：HTTP ${response.status}`);
  const data = await response.json();
  const lines = (data.events || [])
    .map((event) => {
      const text = (event.segs || []).map((segment) => segment.utf8 || "").join("")
        .replace(/\s+/g, " ")
        .trim();
      return text ? `${transcriptTimestamp(event.tStartMs)} ${text}` : "";
    })
    .filter(Boolean);
  if (!lines.length) throw new Error("字幕轨道没有可用文本");
  return {
    language: track.name || track.languageCode || "原始字幕",
    text: lines.join("\n").slice(0, 100000)
  };
}

async function hydrateYoutubeData(data) {
  if (data.siteType !== "youtube" || /(^|\n)视频字幕：/m.test(data.text || "")) return data;
  const tracks = [...(data.youtubeCaptionTracks || [])]
    .filter((track) => /^https?:/i.test(track.url || ""))
    .sort((a, b) => captionPriority(b) - captionPriority(a));
  for (const track of tracks.slice(0, 4)) {
    try {
      const transcript = await fetchYoutubeTranscript(track);
      return {
        ...data,
        text: [data.text, `视频字幕（${transcript.language}）：\n${transcript.text}`].filter(Boolean).join("\n\n"),
        youtubeTranscriptSaved: true,
        youtubeTranscriptLanguage: transcript.language
      };
    } catch {
      // Try the next available language or auto-generated track.
    }
  }
  return { ...data, youtubeTranscriptSaved: false };
}

async function savePayload(data, options = {}) {
  await globalThis.ShuduCollectionMode.requireEnabled();
  const hydrated = await hydrateYoutubeData(data);
  const mode = options.mode || (hydrated.selection ? "selection" : "page");
  if (mode === "selection" && !hydrated.selection) throw new Error("请先划选需要收藏的文字");
  const images = options.saveImages === false ? [] : await hydrateImages(hydrated.images);
  return api("/collect", {
    ...hydrated,
    ...options,
    images,
    selection: mode === "selection" ? hydrated.selection : "",
    selectionContext: mode === "selection" ? hydrated.selectionContext : "",
    acquisitionChannel: "浏览器收藏",
    submittedVia: "shudu-collector-extension"
  });
}

async function quickSave(tab, mode, options = {}) {
  try {
    await globalThis.ShuduCollectionMode.requireEnabled();
    const data = await extractFromTab(tab.id);
    const result = await savePayload(data, {
      mode,
      enrich: true,
      saveImages: true,
      conceptMap: options.conceptMap === true,
      personalize: options.personalize === true
    });
    setBadge("✓", "#16877a");
    notify(
      mode === "selection" ? "划线已收藏" : "网页已收藏",
      `${result.collection.category} · ${result.collection.imageCount} 张图 · AI 辅助消化已排队${result.collection.personalized ? " · 正在分析和你的关系" : ""}${result.collection.conceptMapQueued ? " · 概念地图同步中" : ""}`
    );
    return result;
  } catch (error) {
    setBadge("!", "#c74732");
    notify("收藏失败", error.message);
    throw error;
  }
}

async function refreshCollectionMenus() {
  const enabled = await globalThis.ShuduCollectionMode.isEnabled();
  chrome.contextMenus.removeAll(() => {
    if (!enabled) return;
    chrome.contextMenus.create({
      id: "shudu-save-page",
      title: "收藏网页到本地知识库",
      contexts: ["page", "link", "image"]
    });
    chrome.contextMenus.create({
      id: "shudu-save-selection",
      title: "收藏划线到本地知识库",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "shudu-save-personal",
      title: "收藏并分析和我的关系",
      contexts: ["page", "selection", "link"]
    });
    chrome.contextMenus.create({
      id: "shudu-save-concept",
      title: "收藏并丰富 Shudu 概念地图",
      contexts: ["page", "selection", "link"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  refreshCollectionMenus().catch(() => {});

});

chrome.runtime.onStartup.addListener(() => {
  refreshCollectionMenus().catch(() => {});

});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WEREAD_SYNC_ALARM) triggerWereadSync().catch(() => {});
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "complete") {
    importCompletedVideoExport(delta.id).catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const mode = info.menuItemId === "shudu-save-selection" ||
    (
      ["shudu-save-concept", "shudu-save-personal"].includes(info.menuItemId) &&
      Boolean(info.selectionText)
    )
    ? "selection"
    : "page";
  quickSave(tab, mode, {
    conceptMap: info.menuItemId === "shudu-save-concept",
    personalize: info.menuItemId === "shudu-save-personal"
  }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (!["quick-save-page", "quick-save-selection"].includes(command)) return;
  if (!await globalThis.ShuduCollectionMode.isEnabled()) return;
  const tab = await activeTab();
  const mode = command === "quick-save-selection" ? "selection" : "page";
  quickSave(tab, mode).catch(() => {});
});

const COLLECTOR_MESSAGE_TYPES = new Set([
  "POPUP_EXTRACT",
  "POPUP_PREVIEW",
  "POPUP_DESTINATIONS",
  "CREATE_DESTINATION",
  "POPUP_SAVE",
  "INLINE_SAVE_SELECTION",
  "SYNC_ANNOTATION_NOTE",
  "INLINE_SAVE_FEED_ITEM",
  "OPEN_OBSIDIAN_DASHBOARD",
  "WEREAD_SYNC_NOW",
  "WEREAD_SYNC_PROGRESS"
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // 与译读后台共存时，只处理收藏模块自己的消息。
  if (!COLLECTOR_MESSAGE_TYPES.has(message?.type)) return false;
  (async () => {
    await globalThis.ShuduCollectionMode.requireEnabled();
    if (message?.type === "POPUP_EXTRACT") {
      const tab = await activeTab();
      return { ok: true, data: await extractFromTab(tab.id) };
    }
    if (message?.type === "POPUP_PREVIEW") {
      return api("/collection-preview", message.data);
    }
    if (message?.type === "POPUP_DESTINATIONS") {
      return api("/collection-destinations");
    }
    if (message?.type === "CREATE_DESTINATION") {
      return api("/collection-destinations", message.data);
    }
    if (message?.type === "POPUP_SAVE") {
      return savePayload(message.data, message.options);
    }
    if (message?.type === "SYNC_ANNOTATION_NOTE") {
      return api("/annotation-note", message.data);
    }
    if (message?.type === "INLINE_SAVE_SELECTION") {
      const result = await savePayload(message.data, {
        mode: "selection",
        note: message.note || "",
        enrich: true,
        saveImages: true,
        conceptMap: Boolean(message.conceptMap),
        personalize: Boolean(message.personalize)
      });
      setBadge("✓", "#16877a");
      notify(
        "划线已收藏",
        `${result.collection.category} · ${result.collection.imageCount} 张图 · AI 辅助消化已排队${result.collection.personalized ? " · 正在分析和你的关系" : ""}${result.collection.conceptMapQueued ? " · 概念地图同步中" : ""}`
      );
      return result;
    }
    if (message?.type === "INLINE_SAVE_FEED_ITEM") {
      const result = await savePayload(message.data, {
        mode: "page",
        enrich: true,
        saveImages: true,
        conceptMap: Boolean(message.conceptMap),
        personalize: Boolean(message.personalize)
      });
      const collection = result?.collection;
      if (!collection) throw new Error("收藏服务没有返回有效的写入结果，请重试");
      setBadge("✓", "#16877a");
      notify(
        "单条内容已收藏",
        `${collection.category} · ${collection.imageCount} 张图 · AI 辅助消化已排队${collection.personalized ? " · 正在分析和你的关系" : ""}${collection.conceptMapQueued ? " · 概念地图同步中" : ""}`
      );
      return result;
    }
    if (message?.type === "OPEN_OBSIDIAN_DASHBOARD") {
      await chrome.tabs.create({
        url: "obsidian://open"
      });
      return { ok: true };
    }
    if (message?.type === "WEREAD_SYNC_NOW") {
      return triggerWereadSync();
    }
    if (message?.type === "WEREAD_SYNC_PROGRESS") {
      const completed = Number(message.uploaded || 0) + Number(message.alreadyPresent || 0);
      if (completed > 0) setBadge(String(completed), "#16877a");
      return { ok: true };
    }
    throw new Error("收藏后台请求没有对应处理器");
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[globalThis.ShuduCollectionMode.KEY]) return;
  refreshCollectionMenus().catch(() => {});

});
refreshCollectionMenus().catch(() => {});

})();
