(() => {
  "use strict";

  const SETTINGS_KEY = "adhdReaderSettings";
  const API_KEY_STORAGE = "shuduZhipuApiKey";
  const TRANSLATION_SETTINGS_KEY = "shuduTranslationSettings";
  const DEFAULTS = {
    enabled: true,
    preset: "balanced",
    contentWidth: 980,
    widthPreferenceVersion: 2,
    fontFamily: "torch",
    fontPreferenceVersion: 2,
    fontSize: 18,
    lineHeight: 1.75,
    paragraphGap: 0.68,
    boldEnabled: true,
    highlightEnabled: true,
    emphasisDensity: 75,
    emphasisPreferenceVersion: 2,
    multiColorEnabled: true,
    markerColor: "amber",
    focusEnabled: true
  };
  const PRESETS = {
    light: { preset: "light", contentWidth: 820, fontSize: 17, lineHeight: 1.65, paragraphGap: 0.5, emphasisDensity: 50 },
    balanced: { preset: "balanced", contentWidth: 980, fontSize: 18, lineHeight: 1.75, paragraphGap: 0.68, emphasisDensity: 75 },
    immersive: { preset: "immersive", contentWidth: 1200, fontSize: 21, lineHeight: 1.82, paragraphGap: 0.82, emphasisDensity: 95 }
  };
  const AUTO_HOSTS = new Set([
    "mp.weixin.qq.com",
    "ai.candobear.com",
    "m.okjike.com",
    "web.okjike.com",
    "okjike.com"
  ]);
  const ids = ["enabled", "contentWidth", "fontFamily", "fontSize", "lineHeight", "paragraphGap", "boldEnabled", "highlightEnabled", "multiColorEnabled", "emphasisDensity", "focusEnabled"];
  let settings = { ...DEFAULTS };
  let saveTimer = 0;
  let activePageState = { automatic: false, injectable: false, connected: false, siteLabel: "当前网页" };

  const byId = (id) => document.getElementById(id);

  function isFontAvailable(fontName) {
    if (!fontName) return true;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const sample = "mmmmmmmmmmWWWWW汉字阅读排版";
    const size = "72px";
    return ["monospace", "serif", "sans-serif"].some((fallback) => {
      context.font = `${size} ${fallback}`;
      const baseline = context.measureText(sample).width;
      context.font = `${size} "${fontName}", ${fallback}`;
      return Math.abs(context.measureText(sample).width - baseline) > 0.1;
    });
  }

  function renderFontStatus() {
    const option = byId("fontFamily").selectedOptions[0];
    const fontName = option?.dataset.fontName;
    const hint = byId("fontHint");
    if (!fontName) {
      hint.textContent = "使用网页原始字体。";
      hint.dataset.kind = "neutral";
      return;
    }
    const available = isFontAvailable(fontName);
    hint.textContent = available
      ? `本机已安装：${option.textContent}`
      : `本机未检测到：${option.textContent}，将自动回退到相近字体。`;
    hint.dataset.kind = available ? "ok" : "warn";
  }

  function renderPageAction() {
    const button = byId("applyPage");
    if (!activePageState.injectable) {
      button.textContent = "此页不可用";
      button.disabled = true;
      return;
    }
    button.disabled = false;
    button.textContent = activePageState.connected || activePageState.automatic ? "重新分析" : "应用当前页面";
  }

  function render() {
    ids.forEach((id) => {
      const element = byId(id);
      if (element.type === "checkbox") element.checked = Boolean(settings[id]);
      else element.value = String(settings[id]);
    });
    byId("widthOutput").textContent = `${settings.contentWidth} px`;
    byId("fontSizeOutput").textContent = `${settings.fontSize} px`;
    byId("lineHeightOutput").textContent = `${Number(settings.lineHeight).toFixed(2)}×`;
    byId("paragraphGapOutput").textContent = `${Number(settings.paragraphGap).toFixed(2)}×`;
    byId("densityOutput").textContent = `${settings.emphasisDensity}%`;
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.preset === settings.preset));
    });
    document.querySelectorAll("[data-color]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.color === settings.markerColor));
    });
    renderFontStatus();
    renderPageAction();
  }

  function save() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => chrome.storage.sync.set({ [SETTINGS_KEY]: settings }), 80);
  }

  function saveNow() {
    window.clearTimeout(saveTimer);
    chrome.storage.sync.set({ [SETTINGS_KEY]: { ...settings } });
  }

  async function applyToCurrentPage() {
    try {
      const tab = await activeTab();
      if (!tab?.id || !pageInfo(tab).injectable) return;
      await chrome.tabs.sendMessage(tab.id, { type: "ADHD_READER_REFRESH", settings: { ...settings } });
      activePageState.connected = true;
    } catch (_error) {
      // 非自动站点尚未注入时，设置仍会保存；用户可点击「应用当前页面」。
    }
  }

  function setStatus(text, kind = "warn") {
    const status = byId("status");
    status.textContent = text;
    status.dataset.kind = kind;
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function pageInfo(tab) {
    try {
      const url = new URL(tab?.url || "");
      const isX = url.hostname === "x.com" || url.hostname.endsWith(".x.com") || url.hostname === "twitter.com" || url.hostname.endsWith(".twitter.com");
      const automatic = AUTO_HOSTS.has(url.hostname);
      return { automatic, injectable: !isX && (url.protocol === "http:" || url.protocol === "https:") };
    } catch (_error) {
      return { automatic: false, injectable: false };
    }
  }

  async function sendStatus(tab) {
    return chrome.tabs.sendMessage(tab.id, { type: "ADHD_READER_STATUS" });
  }

  async function detectPage() {
    const tab = await activeTab();
    activePageState = { ...activePageState, ...pageInfo(tab) };
    if (!activePageState.injectable) {
      setStatus("此页面不允许扩展运行。", "warn");
      renderPageAction();
      return;
    }
    try {
      const response = await sendStatus(tab);
      activePageState.connected = true;
      activePageState.siteLabel = response?.siteLabel || "当前网页";
      activePageState.translationOnly = Boolean(response?.translationOnly);
      const countText = response?.contentCount > 1 ? `，识别到 ${response.contentCount} 条正文` : "";
      setStatus(
        activePageState.translationOnly
          ? "普通英文网页：仅译读，保留原网页排版"
          : response?.articleFound
            ? `已应用：${activePageState.siteLabel}${countText}`
            : `${activePageState.siteLabel}：暂未识别到正文`,
        activePageState.translationOnly || response?.articleFound ? "ok" : "warn"
      );
    } catch (_error) {
      activePageState.connected = false;
      setStatus(activePageState.automatic ? "请刷新页面，或点击「重新分析」。" : "普通网页可直接开启译读，原网页排版保持不变。", "warn");
    }
    renderPageAction();
  }

  async function injectIntoTab(tab) {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["reader.css", "translation.css"] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try { globalThis.__SHUDU_TRANSLATION_CLEANUP__?.(); } catch {}
        try { globalThis.__SHUDU_READER_CLEANUP__?.(); } catch {}
        delete globalThis.__SHUDU_TRANSLATION_CLEANUP__;
        delete globalThis.__SHUDU_TRANSLATION_VERSION__;
        delete globalThis.__SHUDU_READER_CLEANUP__;
        delete globalThis.__SHUDU_READER_CONTENT_VERSION__;
        delete globalThis.__SHUDU_READER_LOADED__;
      }
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["translation-core.js", "content.js", "translation.js"] });
  }

  function updateFromControl(id, target) {
    settings[id] = target.type === "checkbox" ? target.checked : target.type === "range" ? Number(target.value) : target.value;
    if (!["enabled", "boldEnabled", "highlightEnabled", "focusEnabled", "fontFamily"].includes(id)) settings.preset = "custom";
    settings.fontPreferenceVersion = 2;
    settings.widthPreferenceVersion = 2;
    settings.emphasisPreferenceVersion = 2;
    render();
  }

  ids.forEach((id) => {
    const element = byId(id);
    element.addEventListener("input", (event) => {
      const target = event.currentTarget;
      updateFromControl(id, target);
      if (id === "fontFamily" || target.type === "checkbox") saveNow();
      else save();
      void applyToCurrentPage();
    });
    element.addEventListener("change", (event) => {
      updateFromControl(id, event.currentTarget);
      saveNow();
      void applyToCurrentPage();
    });
  });

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      settings = { ...settings, ...PRESETS[button.dataset.preset] };
      render();
      saveNow();
      void applyToCurrentPage();
    });
  });

  document.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.markerColor = button.dataset.color;
      render();
      saveNow();
      void applyToCurrentPage();
    });
  });

  byId("applyPage").addEventListener("click", async () => {
    const tab = await activeTab();
    const info = pageInfo(tab);
    if (!tab?.id || !info.injectable) {
      setStatus("此页面不允许扩展运行。", "warn");
      return;
    }
    const button = byId("applyPage");
    button.disabled = true;
    button.textContent = "正在应用…";
    try {
      if (!activePageState.connected) await injectIntoTab(tab);
      const response = await chrome.tabs.sendMessage(tab.id, { type: "ADHD_READER_REFRESH", settings });
      activePageState = {
        ...activePageState,
        ...info,
        connected: true,
        siteLabel: response?.siteLabel || "普通文章页",
        translationOnly: Boolean(response?.translationOnly)
      };
      const countText = response?.contentCount > 1 ? `，识别到 ${response.contentCount} 条正文` : "";
      setStatus(
        activePageState.translationOnly
          ? "普通英文网页：仅译读，保留原网页排版"
          : response?.ok
            ? `已应用：${activePageState.siteLabel}${countText}`
            : "没有识别到适合重排的正文",
        activePageState.translationOnly || response?.ok ? "ok" : "warn"
      );
    } catch (_error) {
      setStatus("应用失败：该页面可能限制扩展脚本。", "warn");
    } finally {
      renderPageAction();
    }
  });

  const translationElements = {
    retention: byId("translationRetention"),
    toggle: byId("toggleTranslation"),
    clear: byId("clearTranslations"),
    status: byId("translationStatus"),
    apiState: byId("translationApiState"),
    apiKey: byId("zhipuApiKey"),
    model: byId("translationModel"),
    saveAndTest: byId("saveAndTestApi"),
    clearKey: byId("clearApiKey")
  };
  let translationAutoEnabled = false;
  let apiConfigured = false;

  function setTranslationStatus(text, kind = "normal") {
    translationElements.status.textContent = text;
    translationElements.status.dataset.kind = kind;
  }

  function renderTranslationApiState() {
    translationElements.apiState.textContent = apiConfigured ? "GLM API · 已配置" : "GLM API · 未配置";
    translationElements.apiState.dataset.kind = apiConfigured ? "ok" : "warn";
  }

  function setTranslationBusy(value, label = "正在处理…") {
    translationElements.toggle.disabled = value;
    translationElements.clear.disabled = value;
    translationElements.toggle.textContent = value
      ? label
      : translationAutoEnabled
        ? "暂停滚动译读"
        : "开启滚动译读";
  }

  async function popupTranslationAction(action) {
    try {
      return await chrome.runtime.sendMessage({ type: "SHUDU_TRANSLATION_POPUP_ACTION", action });
    } catch (error) {
      if (/Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error || ""))) {
        throw new Error("舒读后台尚未启动，请在扩展管理页重新加载舒读");
      }
      throw error;
    }
  }

  async function translationPageStatus() {
    const tab = await activeTab();
    if (!tab?.id || !pageInfo(tab).injectable) throw new Error("当前页面不支持译读");
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "SHUDU_TRANSLATION_ACTION", action: "status" });
    } catch (_error) {
      return null;
    }
  }

  async function loadTranslationPanel() {
    const stored = await chrome.storage.local.get([API_KEY_STORAGE, TRANSLATION_SETTINGS_KEY]);
    const translationSettings = { model: "glm-5.2", retention: "cet6", ...(stored[TRANSLATION_SETTINGS_KEY] || {}) };
    translationElements.retention.value = translationSettings.retention;
    translationElements.model.value = translationSettings.model;
    apiConfigured = Boolean(stored[API_KEY_STORAGE]);
    renderTranslationApiState();
    try {
      const page = await translationPageStatus();
      translationAutoEnabled = Boolean(page?.autoEnabled);
      setTranslationBusy(false);
      if (page?.lastAction === "error") {
        setTranslationStatus(page.lastError || "译读失败，请重试", "error");
      } else if (page?.count) {
        setTranslationStatus(`${translationAutoEnabled ? "滚动译读已开启" : "本页已有译文"} · ${page.count} 段`, "ok");
      } else if (translationAutoEnabled && page?.candidateCount === 0) {
        setTranslationStatus("滚动译读已开启，但当前屏未识别到英文正文；请向下滚动或重新分析页面", "error");
      } else if (page?.lastAction === "incomplete") {
        setTranslationStatus(page.lastError || "接口未完整返回译文；继续滚动时会重试", "error");
      } else if (apiConfigured) {
        setTranslationStatus(page?.candidateCount
          ? `已识别当前屏 ${page.candidateCount} 段英文；点击开启后开始译读`
          : "API 已保存；点击开启后只上传进入阅读区的英文段落", "ok");
      } else {
        setTranslationStatus("请展开 API 设置，保存通用开放平台 Key", "error");
      }
    } catch (error) {
      setTranslationStatus(error.message || "当前页面不支持译读", "error");
    }
  }

  translationElements.retention.addEventListener("change", async () => {
    const stored = await chrome.storage.local.get(TRANSLATION_SETTINGS_KEY);
    await chrome.storage.local.set({
      [TRANSLATION_SETTINGS_KEY]: {
        ...(stored[TRANSLATION_SETTINGS_KEY] || {}),
        model: translationElements.model.value.trim() || "glm-5.2",
        retention: translationElements.retention.value
      }
    });
    setTranslationStatus("保留程度已更新；新进入屏幕的段落按新标准翻译");
  });

  translationElements.toggle.addEventListener("click", async () => {
    setTranslationBusy(true, "正在读取当前屏…");
    setTranslationStatus("正在识别可翻译的英文段落…");
    try {
      const response = await popupTranslationAction("toggle-auto");
      if (!response?.ok || response.action === "error") throw new Error(response?.error || "译读失败");
      translationAutoEnabled = Boolean(response.autoEnabled);
      const started = response.action === "auto-started" || response.action === "auto-started-empty";
      setTranslationStatus(
        response.action === "auto-started-empty"
          ? "已开启，但当前屏未识别到英文正文；请向下滚动或重新分析页面"
          : response.action === "auto-started" && response.missingCount
            ? `已开启 · 新增 ${response.count || 0} 段，仍有 ${response.missingCount} 段未返回`
            : response.action === "auto-started" && response.processing
              ? `滚动译读已开启 · 正在翻译当前屏前 ${Math.min(response.candidateCount || 0, 3)} 段`
              : response.action === "auto-started"
                ? `滚动译读已开启${response.count ? ` · 新增 ${response.count} 段` : " · 当前屏无需重复翻译"}`
          : "滚动译读已暂停",
        response.action === "auto-started-empty" || response.missingCount ? "error" : started ? "ok" : "normal"
      );
      if (response.processing) window.setTimeout(() => { void loadTranslationPanel(); }, 1400);
    } catch (error) {
      setTranslationStatus(error.message || "译读失败", "error");
      if (/API Key|配置/.test(error.message || "")) document.querySelector(".api-settings").open = true;
    } finally {
      setTranslationBusy(false);
    }
  });

  translationElements.clear.addEventListener("click", async () => {
    setTranslationBusy(true, "正在清除…");
    try {
      const response = await popupTranslationAction("clear");
      if (!response?.ok) throw new Error(response?.error || "清除失败");
      translationAutoEnabled = false;
      setTranslationStatus(response.count ? `已移除 ${response.count} 段译文` : "本页还没有译文");
    } catch (error) {
      setTranslationStatus(error.message || "清除失败", "error");
    } finally {
      setTranslationBusy(false);
    }
  });

  translationElements.saveAndTest.addEventListener("click", async () => {
    const key = translationElements.apiKey.value.trim();
    const model = translationElements.model.value.trim() || "glm-5.2";
    translationElements.saveAndTest.disabled = true;
    translationElements.clearKey.disabled = true;
    setTranslationStatus("正在保存并测试智谱连接…");
    try {
      const update = {
        [TRANSLATION_SETTINGS_KEY]: { model, retention: translationElements.retention.value }
      };
      if (key) update[API_KEY_STORAGE] = key;
      await chrome.storage.local.set(update);
      translationElements.apiKey.value = "";
      const response = await chrome.runtime.sendMessage({ type: "SHUDU_TRANSLATION_TEST" });
      if (!response?.ok) throw new Error(response?.error || "连接测试失败");
      apiConfigured = true;
      renderTranslationApiState();
      setTranslationStatus(`连接成功 · ${response.model}`, "ok");
    } catch (error) {
      const stored = await chrome.storage.local.get(API_KEY_STORAGE);
      apiConfigured = Boolean(stored[API_KEY_STORAGE]);
      renderTranslationApiState();
      setTranslationStatus(error.message || "连接测试失败", "error");
    } finally {
      translationElements.saveAndTest.disabled = false;
      translationElements.clearKey.disabled = false;
    }
  });

  translationElements.clearKey.addEventListener("click", async () => {
    await chrome.storage.local.remove(API_KEY_STORAGE);
    translationElements.apiKey.value = "";
    apiConfigured = false;
    renderTranslationApiState();
    setTranslationStatus("本机 API Key 已删除");
  });

  chrome.storage.sync.get({ [SETTINGS_KEY]: DEFAULTS }, (result) => {
    settings = { ...DEFAULTS, ...result[SETTINGS_KEY] };
    let migrated = false;
    if (!settings.fontPreferenceVersion || settings.fontFamily === "heritage") {
      settings.fontFamily = "torch";
      settings.fontPreferenceVersion = 2;
      migrated = true;
    }
    if (!result[SETTINGS_KEY]?.widthPreferenceVersion && Number(settings.contentWidth) >= 1400) {
      settings.contentWidth = 2400;
      settings.widthPreferenceVersion = 2;
      settings.preset = "custom";
      migrated = true;
    }
    if (!result[SETTINGS_KEY]?.emphasisPreferenceVersion) {
      settings.emphasisDensity = Math.max(75, Number(settings.emphasisDensity) || 75);
      settings.emphasisPreferenceVersion = 2;
      settings.multiColorEnabled = true;
      settings.preset = "custom";
      migrated = true;
    }
    if (migrated) chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    render();
    detectPage();
  });
  loadTranslationPanel();
})();
