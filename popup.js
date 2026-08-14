(() => {
  "use strict";

  if (chrome.runtime.getManifest().version !== "0.3.4") {
    chrome.runtime.reload();
    return;
  }

  const SETTINGS_KEY = "adhdReaderSettings";
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
    "m.okjike.com",
    "web.okjike.com",
    "okjike.com",
    "x.com",
    "twitter.com"
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
      const automatic = AUTO_HOSTS.has(url.hostname) || url.hostname.endsWith(".x.com") || url.hostname.endsWith(".twitter.com");
      return { automatic, injectable: url.protocol === "http:" || url.protocol === "https:" };
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
      const countText = response?.contentCount > 1 ? `，识别到 ${response.contentCount} 条正文` : "";
      setStatus(response?.articleFound ? `已应用：${activePageState.siteLabel}${countText}` : `${activePageState.siteLabel}：暂未识别到正文`, response?.articleFound ? "ok" : "warn");
    } catch (_error) {
      activePageState.connected = false;
      setStatus(activePageState.automatic ? "请刷新页面，或点击「重新分析」。" : "可点击「应用当前页面」临时启用舒读。", "warn");
    }
    renderPageAction();
  }

  async function injectIntoTab(tab) {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["reader.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
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
        siteLabel: response?.siteLabel || "普通文章页"
      };
      const countText = response?.contentCount > 1 ? `，识别到 ${response.contentCount} 条正文` : "";
      setStatus(response?.ok ? `已应用：${activePageState.siteLabel}${countText}` : "没有识别到适合重排的正文", response?.ok ? "ok" : "warn");
    } catch (_error) {
      setStatus("应用失败：该页面可能限制扩展脚本。", "warn");
    } finally {
      renderPageAction();
    }
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
})();
