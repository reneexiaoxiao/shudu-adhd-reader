(() => {
  "use strict";

  const TRANSLATION_VERSION = "0.4.3";
  if (globalThis.__SHUDU_TRANSLATION_VERSION__ === TRANSLATION_VERSION) return;
  try { globalThis.__SHUDU_TRANSLATION_CLEANUP__?.(); } catch {}
  globalThis.__SHUDU_TRANSLATION_VERSION__ = TRANSLATION_VERSION;

  const core = globalThis.ShuduTranslationCore;
  if (!core) return;
  const SETTINGS_KEY = "shuduTranslationSettings";
  const CANDIDATE_SELECTOR = "h1, h2, h3, h4, p, li, blockquote, figcaption, td, th, dt, dd";
  const LOOSE_CONTAINER_SELECTOR = "div, section";
  const LOOSE_INLINE_SELECTOR = "a, span, strong, b, em, i, small, mark";
  const MAX_BLOCKS = 24;
  const MAX_CHARACTERS = 32000;
  const VIEWPORT_BUFFER = 420;
  const AUTO_DELAY = 560;
  const nodesById = new Map();
  const seenTerms = new Set();
  let sequence = 0;
  let busy = false;
  let autoEnabled = false;
  let translationsHidden = false;
  let autoTimer = 0;
  let autoPending = false;
  let mutationObserver = null;
  let contextActive = true;
  let lastAction = "idle";
  let lastError = "";

  function contextAlive() {
    try { return Boolean(chrome?.runtime?.id); } catch { return false; }
  }

  function isInvalidated(error) {
    return /Extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function deactivate() {
    if (!contextActive) return;
    contextActive = false;
    stopAuto();
    try { chrome.runtime.onMessage.removeListener(runtimeListener); } catch {}
  }

  async function runtimeMessage(message) {
    if (!contextAlive()) {
      deactivate();
      return null;
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (isInvalidated(error) || !contextAlive()) {
        deactivate();
        return null;
      }
      throw error;
    }
  }

  function toast(message, kind = "normal", persistent = false) {
    let element = document.querySelector("[data-shudu-translation-toast]");
    if (!element) {
      element = document.createElement("div");
      element.dataset.shuduTranslationToast = "true";
      element.dataset.adhdReaderUi = "true";
      element.setAttribute("role", "status");
      element.setAttribute("aria-live", "polite");
      document.documentElement.append(element);
    }
    element.className = `shudu-translation-toast shudu-translation-toast--${kind}`;
    element.textContent = message;
    element.hidden = false;
    clearTimeout(toast.timer);
    if (!persistent) toast.timer = setTimeout(() => { element.hidden = true; }, 3400);
  }

  function readingRoots() {
    const readerRoots = [...document.querySelectorAll(".adhd-reader-content")]
      .filter((root) => !root.closest("aside, nav, footer"));
    if (readerRoots.length) return readerRoots;
    const fallbacks = [...document.querySelectorAll("article, [itemprop='articleBody'], .entry-content, .post-content, .post-body, .article-content, .article-body, .blog-content, .story-content, .story-body, .prose, .markdown-body, main, [role='main']")]
      .filter((root) => !root.closest("aside, nav, footer"));
    return fallbacks.length ? fallbacks.slice(0, 3) : [document.body];
  }

  function sourceText(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("[data-shudu-translation], [data-shudu-translation-toast]").forEach((node) => node.remove());
    return core.normalizeText(clone.innerText || clone.textContent || "");
  }

  function visible(element) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 8) return false;
    return rect.bottom >= -VIEWPORT_BUFFER && rect.top <= innerHeight + VIEWPORT_BUFFER && rect.right >= 0 && rect.left <= innerWidth;
  }

  function isChrome(element) {
    return Boolean(element.closest([
      "nav", "footer", "aside", "form", "button", "input", "textarea", "select", "option",
      "pre", "code", "kbd", "samp", "script", "style", "noscript", "svg", "canvas",
      "[role='navigation']", "[role='menu']", "[role='dialog']", "[aria-modal='true']",
      "[contenteditable='true']", "[data-shudu-translation]", "[data-shudu-translation-anchor]", "[data-adhd-reader-ui='true']",
      ".not-prose"
    ].join(",")));
  }

  function hasSubstantiveChild(element, text) {
    return [...element.querySelectorAll(CANDIDATE_SELECTOR)].some((child) => {
      if (child === element || isChrome(child)) return false;
      const childText = sourceText(child);
      return childText.length >= text.length * 0.62 && core.isTranslatableText(childText, child.tagName);
    });
  }

  function translationFor(id) {
    const remembered = nodesById.get(id);
    if (remembered?.isConnected) return remembered;
    const node = document.querySelector(`[data-shudu-translation-for="${CSS.escape(id)}"]`);
    if (node) nodesById.set(id, node);
    return node;
  }

  function rectVisible(rect) {
    return rect.width >= 80 && rect.height >= 8 && rect.bottom >= -VIEWPORT_BUFFER &&
      rect.top <= innerHeight + VIEWPORT_BUFFER && rect.right >= 0 && rect.left <= innerWidth;
  }

  function collectLooseTextBlocks(roots) {
    const output = [];
    roots.forEach((root, rootIndex) => {
      const containers = [root, ...root.querySelectorAll(LOOSE_CONTAINER_SELECTOR)]
        .filter((container) => !isChrome(container) && !container.closest(CANDIDATE_SELECTOR));
      containers.forEach((container, containerIndex) => {
        let run = [];
        let runIndex = 0;
        const flush = () => {
          const nodes = run;
          run = [];
          if (!nodes.length) return;
          const text = core.normalizeText(nodes.map((node) => node.textContent || "").join(" "));
          if (!core.isTranslatableText(text, "P")) return;
          const range = document.createRange();
          range.setStartBefore(nodes[0]);
          range.setEndAfter(nodes.at(-1));
          const rect = range.getBoundingClientRect();
          if (!rectVisible(rect)) return;
          const id = core.sourceId(text, `loose-${rootIndex}-${containerIndex}-${runIndex++}`);
          let anchor = [...container.children].find((element) => element.dataset.shuduLooseSource === id);
          if (!anchor) {
            anchor = document.createElement("span");
            anchor.className = "shudu-translation-anchor";
            anchor.dataset.shuduTranslationAnchor = "true";
            anchor.dataset.shuduLooseSource = id;
            anchor.dataset.shuduTranslationSource = id;
            anchor.dataset.adhdReaderUi = "true";
            container.insertBefore(anchor, nodes.at(-1).nextSibling);
          }
          output.push({
            id,
            text,
            tag: "p",
            element: anchor,
            translation: translationFor(id),
            top: rect.top
          });
        };

        [...container.childNodes].forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            if ((node.nodeValue || "").trim()) run.push(node);
            return;
          }
          if (node.nodeType === Node.COMMENT_NODE) return;
          if (node.nodeType === Node.ELEMENT_NODE && node.matches(LOOSE_INLINE_SELECTOR) && !isChrome(node)) {
            run.push(node);
            return;
          }
          flush();
        });
        flush();
      });
    });
    return output;
  }

  function collectVisibleBlocks() {
    const roots = readingRoots();
    const candidates = [];
    roots.forEach((root) => {
      if (root.matches?.(CANDIDATE_SELECTOR)) candidates.push(root);
      candidates.push(...root.querySelectorAll(CANDIDATE_SELECTOR));
    });
    const ordered = [...new Set(candidates)]
      .filter(visible)
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
    const entries = [];
    for (const element of ordered) {
      if (isChrome(element) || element.getAttribute("aria-hidden") === "true") continue;
      const text = sourceText(element);
      if (!core.isTranslatableText(text, element.tagName) || hasSubstantiveChild(element, text)) continue;
      const id = element.dataset.shuduTranslationSource || core.sourceId(text, sequence++);
      element.dataset.shuduTranslationSource = id;
      const translation = translationFor(id);
      entries.push({ id, text, tag: element.tagName.toLowerCase(), element, translation, top: element.getBoundingClientRect().top });
    }
    entries.push(...collectLooseTextBlocks(roots));
    const limited = [];
    let characterCount = 0;
    [...new Map(entries.map((entry) => [entry.id, entry])).values()]
      .sort((left, right) => left.top - right.top)
      .some((entry) => {
        if (limited.length >= MAX_BLOCKS || characterCount + entry.text.length > MAX_CHARACTERS) return true;
        limited.push(entry);
        characterCount += entry.text.length;
        return false;
      });
    return limited;
  }

  function renderBody(element, text, terms) {
    const usable = core.cleanLearningTerms(terms, "", 8)
      .filter((item) => text.toLocaleLowerCase("en-US").includes(item.term.toLocaleLowerCase("en-US")))
      .sort((left, right) => right.term.length - left.term.length);
    if (!usable.length) {
      element.textContent = text;
      return;
    }
    const byTerm = new Map(usable.map((item) => [item.term.toLocaleLowerCase("en-US"), item]));
    const expression = new RegExp(usable.map((item) => item.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "giu");
    let cursor = 0;
    for (const match of text.matchAll(expression)) {
      const index = match.index ?? 0;
      if (index > cursor) element.append(document.createTextNode(text.slice(cursor, index)));
      const term = document.createElement("span");
      const item = byTerm.get(match[0].toLocaleLowerCase("en-US"));
      term.className = "shudu-translation-term";
      term.textContent = match[0];
      term.title = item?.gloss || "学习表达";
      term.tabIndex = 0;
      element.append(term);
      cursor = index + match[0].length;
    }
    if (cursor < text.length) element.append(document.createTextNode(text.slice(cursor)));
  }

  function insertTranslation(entry, item, retention) {
    translationFor(entry.id)?.remove();
    const wrapper = document.createElement("span");
    wrapper.className = "shudu-translation";
    wrapper.dataset.shuduTranslation = "true";
    wrapper.dataset.shuduTranslationFor = entry.id;
    wrapper.dataset.shuduTranslationRetention = retention;
    wrapper.dataset.adhdReaderUi = "true";
    wrapper.lang = "zh-CN";

    const label = document.createElement("span");
    label.className = "shudu-translation__label";
    label.textContent = "译";
    label.setAttribute("aria-hidden", "true");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "shudu-translation__close";
    close.textContent = "×";
    close.title = "移除这段译文";
    close.setAttribute("aria-label", "移除这段译文");
    close.addEventListener("click", () => {
      wrapper.remove();
      nodesById.delete(entry.id);
    });
    const body = document.createElement("span");
    body.className = "shudu-translation__text";
    renderBody(body, item.translation, item.learningTerms || []);
    wrapper.append(label, close, body);

    const terms = core.cleanLearningTerms(item.learningTerms, entry.text, 8);
    if (terms.length) {
      const learning = document.createElement("span");
      learning.className = "shudu-translation__learning";
      const prefix = document.createElement("span");
      prefix.className = "shudu-translation__learning-label";
      prefix.textContent = "学习词";
      learning.append(prefix);
      terms.forEach((item, index) => {
        const term = document.createElement("span");
        term.className = "shudu-learning-term";
        term.textContent = `${item.term}（${item.gloss}）`;
        term.title = item.gloss;
        learning.append(term);
        if (index < terms.length - 1) learning.append(document.createTextNode(" · "));
        seenTerms.add(item.term);
      });
      wrapper.append(learning);
    }
    if (/^h[1-4]$/.test(entry.tag)) entry.element.insertAdjacentElement("afterend", wrapper);
    else entry.element.append(wrapper);
    nodesById.set(entry.id, wrapper);
  }

  async function settings() {
    if (!contextAlive()) return null;
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      return { retention: "cet6", model: "glm-5.2", ...(stored[SETTINGS_KEY] || {}) };
    } catch (error) {
      if (isInvalidated(error)) deactivate();
      return null;
    }
  }

  function schedule(delay = AUTO_DELAY) {
    if (!autoEnabled || !contextActive || document.visibilityState === "hidden") return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      autoTimer = 0;
      if (busy) {
        autoPending = true;
        return;
      }
      translateVisible({ toggleIfComplete: false, quiet: true }).catch(() => {});
    }, delay);
  }

  function viewportChanged() { schedule(); }

  function startAuto() {
    document.addEventListener("scroll", viewportChanged, { capture: true, passive: true });
    window.addEventListener("resize", viewportChanged, { passive: true });
    mutationObserver = new MutationObserver((records) => {
      const externalAddition = records.some((record) => [...record.addedNodes].some((node) => {
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        return !element?.closest?.("[data-shudu-translation], [data-shudu-translation-toast], [data-shudu-translation-anchor]");
      }));
      if (externalAddition) schedule();
    });
    mutationObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function stopAuto() {
    autoEnabled = false;
    autoPending = false;
    clearTimeout(autoTimer);
    autoTimer = 0;
    mutationObserver?.disconnect();
    mutationObserver = null;
    document.removeEventListener("scroll", viewportChanged, { capture: true });
    window.removeEventListener("resize", viewportChanged);
  }

  async function translateVisible({ toggleIfComplete = true, quiet = false } = {}) {
    if (!contextAlive()) return { action: "context-stopped", count: 0 };
    if (busy) {
      if (autoEnabled) autoPending = true;
      if (!quiet) toast("上一批还在翻译，请稍候");
      lastAction = "busy";
      return { action: "busy", count: 0 };
    }
    const entries = collectVisibleBlocks();
    if (!entries.length) {
      if (!quiet) toast("当前屏幕没有找到可翻译的英文段落", "error");
      lastAction = "empty";
      return { action: "empty", count: 0 };
    }
    const preferences = await settings();
    if (!preferences) return { action: "context-stopped", count: 0 };
    entries.forEach((entry) => {
      if (!entry.translation || entry.translation.dataset.shuduTranslationRetention === preferences.retention) return;
      entry.translation.remove();
      nodesById.delete(entry.id);
      entry.translation = null;
    });
    const translated = entries.filter((entry) => entry.translation);
    if (translated.length === entries.length) {
      if (!toggleIfComplete) return { action: "unchanged", count: 0, autoEnabled };
      translationsHidden = !translationsHidden;
      document.querySelectorAll("[data-shudu-translation]").forEach((node) => { node.hidden = translationsHidden; });
      toast(translationsHidden ? "已收起本页译文" : "已显示本页译文");
      return { action: translationsHidden ? "hidden" : "shown", count: translated.length, autoEnabled };
    }
    translationsHidden = false;
    translated.forEach((entry) => { entry.translation.hidden = false; });
    const pending = entries.filter((entry) => !entry.translation);
    busy = true;
    toast(`正在翻译新进入阅读区的 ${pending.length} 段…`, "working", true);
    try {
      const response = await runtimeMessage({
        type: "SHUDU_TRANSLATE",
        payload: {
          page: { title: document.title, language: document.documentElement.lang || "" },
          retention: preferences.retention,
          seenConcepts: [...seenTerms].slice(-80),
          blocks: pending.map(({ id, text, tag }) => ({ id, text, tag }))
        }
      });
      if (!response) return { action: "context-stopped", count: 0 };
      if (!response.ok) throw new Error(response.error || "翻译失败");
      const checked = core.normalizeTranslationBatch(pending, response, preferences.retention);
      const byId = new Map(checked.translations.map((item) => [item.id, item]));
      pending.forEach((entry) => {
        const item = byId.get(entry.id);
        if (item) insertTranslation(entry, item, preferences.retention);
      });
      const missingCount = new Set([...(response.missing || []), ...checked.missing]).size;
      const done = pending.length - missingCount;
      const cached = Number(response.cachedCount || 0);
      toast(missingCount
        ? `已补译 ${done} 段，仍有 ${missingCount} 段未返回；继续滚动时会再补`
        : `已翻译 ${pending.length} 段${cached ? ` · ${cached} 段来自本地缓存` : ""}`,
      missingCount ? "error" : "normal", missingCount > 0);
      lastAction = missingCount ? "incomplete" : "translated";
      lastError = missingCount ? `${missingCount} 段未返回` : "";
      return { action: "translated", count: done, missingCount, cachedCount: cached, autoEnabled };
    } catch (error) {
      toast(error.message || "翻译失败", "error", true);
      lastAction = "error";
      lastError = error.message || "翻译失败";
      return { action: "error", error: error.message, count: 0, autoEnabled };
    } finally {
      busy = false;
      if (autoEnabled && autoPending) {
        autoPending = false;
        schedule(180);
      }
    }
  }

  async function toggleAuto() {
    if (autoEnabled) {
      stopAuto();
      toast("滚动译读已暂停");
      return { action: "auto-stopped", autoEnabled: false, count: document.querySelectorAll("[data-shudu-translation]").length };
    }
    autoEnabled = true;
    translationsHidden = false;
    startAuto();
    toast("滚动译读已开启；继续往下读即可", "working");
    const result = await translateVisible({ toggleIfComplete: false, quiet: true });
    if (["error", "context-stopped"].includes(result.action)) {
      stopAuto();
      return { ...result, autoEnabled: false };
    }
    if (result.action === "empty") {
      toast("滚动译读已开启，但当前屏未识别到英文正文；请向下滚动或重新分析页面", "error", true);
      return { action: "auto-started-empty", outcome: "empty", autoEnabled: true, count: 0, candidateCount: 0 };
    }
    return {
      action: "auto-started",
      outcome: result.action,
      autoEnabled: true,
      count: Number(result.count || 0),
      missingCount: Number(result.missingCount || 0),
      cachedCount: Number(result.cachedCount || 0)
    };
  }

  function clearTranslations() {
    stopAuto();
    const nodes = [...document.querySelectorAll("[data-shudu-translation]")];
    nodes.forEach((node) => node.remove());
    nodesById.clear();
    translationsHidden = false;
    toast(nodes.length ? `已移除本页 ${nodes.length} 段译文` : "本页还没有译文");
    return { action: "cleared", count: nodes.length, autoEnabled: false };
  }

  function status() {
    const candidateCount = busy ? 0 : collectVisibleBlocks().length;
    return {
      action: "status",
      count: document.querySelectorAll("[data-shudu-translation]").length,
      candidateCount,
      rootCount: readingRoots().length,
      busy,
      autoEnabled,
      lastAction,
      lastError
    };
  }

  function runtimeListener(message, _sender, sendResponse) {
    if (message?.type !== "SHUDU_TRANSLATION_ACTION") return false;
    const task = message.action === "toggle-auto"
      ? toggleAuto()
      : message.action === "translate-visible"
        ? translateVisible()
        : message.action === "clear"
          ? Promise.resolve(clearTranslations())
          : message.action === "status"
            ? Promise.resolve(status())
            : Promise.reject(new Error("未知的译读操作"));
    task.then(
      (result) => sendResponse({ ok: !["error", "context-stopped"].includes(result.action), ...result }),
      (error) => sendResponse({ ok: false, action: "error", error: error.message || "译读操作失败" })
    );
    return true;
  }

  try { chrome.runtime.onMessage.addListener(runtimeListener); } catch (error) { if (isInvalidated(error)) deactivate(); }
  globalThis.__SHUDU_TRANSLATION_CLEANUP__ = deactivate;
})();
