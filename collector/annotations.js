(() => {
  const STORAGE_KEY = "shuduAnnotationsV1";
  const STYLE_IDS = ["marker-yellow", "underline-blue", "marker-green", "wavy-red"];
  const STYLE_LABELS = {
    "marker-yellow": "黄色马克笔",
    "underline-blue": "蓝色下划线",
    "marker-green": "绿色马克笔",
    "wavy-red": "红色波浪线"
  };
  const HIGHLIGHT_NAMES = Object.fromEntries(
    STYLE_IDS.map((style) => [style, `shudu-annotation-${style}`])
  );

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizePageUrl(value, base) {
    try {
      const url = new URL(value, base || value);
      url.hash = "";
      const removable = [];
      for (const key of url.searchParams.keys()) {
        if (/^(utm_|spm$|from$|source$|ref$|referrer$|fbclid$|gclid$|share_|timestamp$)/i.test(key)) {
          removable.push(key);
        }
      }
      removable.forEach((key) => url.searchParams.delete(key));
      url.searchParams.sort();
      return url.toString();
    } catch {
      return String(value || "").split("#")[0];
    }
  }

  function suffixMatchLength(left, right) {
    const limit = Math.min(left.length, right.length);
    let length = 0;
    while (length < limit && left[left.length - length - 1] === right[right.length - length - 1]) {
      length += 1;
    }
    return length;
  }

  function prefixMatchLength(left, right) {
    const limit = Math.min(left.length, right.length);
    let length = 0;
    while (length < limit && left[length] === right[length]) length += 1;
    return length;
  }

  function findQuoteMatch(textValue, quoteValue, prefixValue = "", suffixValue = "", hintIndex = -1) {
    const text = normalizeWhitespace(textValue);
    const quote = normalizeWhitespace(quoteValue);
    const prefix = normalizeWhitespace(prefixValue);
    const suffix = normalizeWhitespace(suffixValue);
    if (!text || !quote) return null;

    const candidates = [];
    let index = text.indexOf(quote);
    while (index >= 0) {
      const before = text.slice(Math.max(0, index - prefix.length), index);
      const after = text.slice(index + quote.length, index + quote.length + suffix.length);
      const contextScore = suffixMatchLength(before, prefix) + prefixMatchLength(after, suffix);
      const distanceScore = hintIndex >= 0 ? Math.max(0, 24 - Math.abs(index - hintIndex) / 80) : 0;
      candidates.push({ start: index, end: index + quote.length, score: contextScore * 10 + distanceScore });
      index = text.indexOf(quote, index + Math.max(1, quote.length));
    }
    if (!candidates.length) return null;
    candidates.sort((left, right) => right.score - left.score || left.start - right.start);
    return candidates[0];
  }

  function safeClosest(element, selector) {
    try {
      return element?.closest?.(selector) || null;
    } catch {
      return null;
    }
  }

  function textNodeAllowed(node) {
    const parent = node?.parentElement;
    if (!parent || !normalizeWhitespace(node.data)) return false;
    return !safeClosest(
      parent,
      "script, style, noscript, textarea, input, select, option, svg, canvas, [aria-hidden='true'], #shudu-selection-toolbar-host, #shudu-feed-toolbar-host, #shudu-annotation-layer-host, [data-shudu-translation], [data-shudu-translation-toast], [data-shudu-translation-anchor], [data-adhd-reader-ui='true']"
    );
  }

  function blockAncestor(node, root) {
    const blockSelector = "p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, td, th, article, section, div";
    const element = node?.parentElement;
    const block = safeClosest(element, blockSelector);
    return block && root.contains(block) ? block : root;
  }

  function buildTextIndex(root, documentRef) {
    if (!root || !documentRef?.createTreeWalker) return { text: "", positions: [] };
    const walker = documentRef.createTreeWalker(root, 4);
    let text = "";
    const positions = [];
    let previousBlock = null;
    let node = walker.nextNode();

    while (node) {
      if (textNodeAllowed(node)) {
        const currentBlock = blockAncestor(node, root);
        let pendingSpace = Boolean(text && previousBlock && currentBlock !== previousBlock && !text.endsWith(" "));
        const value = String(node.data || "");
        for (let offset = 0; offset < value.length; offset += 1) {
          const character = value[offset];
          if (/\s/.test(character)) {
            if (text && !text.endsWith(" ")) pendingSpace = true;
            continue;
          }
          if (pendingSpace && text && !text.endsWith(" ")) {
            text += " ";
            positions.push({ node, offset });
          }
          pendingSpace = false;
          text += character;
          positions.push({ node, offset });
        }
        previousBlock = currentBlock;
      }
      node = walker.nextNode();
    }
    return { text: text.trim(), positions };
  }

  function rangeFromMatch(index, match, documentRef) {
    const start = index.positions[match.start];
    const end = index.positions[match.end - 1];
    if (!start || !end) return null;
    const range = documentRef.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, Math.min(end.node.data.length, end.offset + 1));
    return range;
  }

  function elementSelector(element) {
    if (!element || element.nodeType !== 1) return "";
    if (element.id && !/\s/.test(element.id)) {
      const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(element.id) : element.id.replace(/[^\w-]/g, "");
      if (escaped) return `#${escaped}`;
    }
    const tag = String(element.tagName || "").toLowerCase();
    return /^(article|main|section)$/.test(tag) ? tag : "";
  }

  class AnnotationManager {
    constructor(options = {}) {
      this.window = options.window || globalThis.window;
      this.document = options.document || globalThis.document;
      this.storage = options.storage || globalThis.chrome?.storage?.local;
      this.onUpdate = options.onUpdate;
      this.canonicalUrl = options.canonicalUrl || (() => this.window?.location?.href || "");
      this.findArticleRoot = options.findArticleRoot || (() => this.document?.querySelector("article, main") || this.document?.body);
      this.pageKey = "";
      this.annotations = [];
      this.ranges = new Map();
      this.overlayHost = null;
      this.overlayShadow = null;
      this.editorId = "";
      this.mutationObserver = null;
      this.retryTimer = 0;
      this.positionFrame = 0;
      this.routeTimer = 0;
      this.unresolved = new Set();
      this.started = false;
      this.readyPromise = null;
      this.onViewportChange = () => this.scheduleDotPositions();
    }

    supportsHighlights() {
      return Boolean(this.window?.CSS?.highlights && this.window?.Highlight);
    }

    async init() {
      if (this.readyPromise) return this.readyPromise;
      this.readyPromise = this.initialize();
      return this.readyPromise;
    }

    async initialize() {
      if (this.started || !this.document?.body) return this;
      this.started = true;
      this.injectHighlightStyles();
      this.createOverlay();
      await this.loadCurrentPage();
      this.window.addEventListener("scroll", this.onViewportChange, true);
      this.window.addEventListener("resize", this.onViewportChange);
      this.mutationObserver = new this.window.MutationObserver((mutations) => {
        const meaningful = mutations.some((mutation) =>
          [...mutation.addedNodes].some((node) => node.nodeType === 1 || node.nodeType === 3)
        );
        if (!meaningful) return;
        const detached = [...this.ranges.values()].some((range) => !range.commonAncestorContainer?.isConnected);
        if (detached || this.unresolved.size) this.scheduleRestore();
      });
      this.mutationObserver.observe(this.document.body, { childList: true, subtree: true });
      this.routeTimer = this.window.setInterval(() => this.checkRoute(), 900);
      return this;
    }

    cleanup() {
      if (!this.started) return;
      this.started = false;
      this.window.removeEventListener("scroll", this.onViewportChange, true);
      this.window.removeEventListener("resize", this.onViewportChange);
      this.mutationObserver?.disconnect();
      this.mutationObserver = null;
      this.window.clearTimeout(this.retryTimer);
      this.window.clearInterval(this.routeTimer);
      if (this.positionFrame) this.window.cancelAnimationFrame(this.positionFrame);
      this.clearHighlights();
      this.overlayHost?.remove();
      this.overlayHost = null;
      this.overlayShadow = null;
      this.document.getElementById("shudu-annotation-styles")?.remove();
    }

    async checkRoute() {
      const nextKey = normalizePageUrl(this.canonicalUrl(), this.window.location.href);
      if (nextKey && nextKey !== this.pageKey) await this.loadCurrentPage();
    }

    async getStore() {
      if (!this.storage?.get) return {};
      const result = await this.storage.get(STORAGE_KEY);
      return result?.[STORAGE_KEY] && typeof result[STORAGE_KEY] === "object" ? result[STORAGE_KEY] : {};
    }

    async saveCurrentPage() {
      if (!this.storage?.set || !this.pageKey) return;
      const store = await this.getStore();
      if (this.annotations.length) {
        store[this.pageKey] = {
          title: String(this.document.title || "").slice(0, 300),
          updatedAt: new Date().toISOString(),
          annotations: this.annotations.slice(-300)
        };
      } else {
        delete store[this.pageKey];
      }

      const entries = Object.entries(store);
      if (entries.length > 500) {
        entries
          .sort((left, right) => String(right[1]?.updatedAt || "").localeCompare(String(left[1]?.updatedAt || "")))
          .slice(500)
          .forEach(([key]) => delete store[key]);
      }
      await this.storage.set({ [STORAGE_KEY]: store });
    }

    async loadCurrentPage() {
      this.pageKey = normalizePageUrl(this.canonicalUrl(), this.window.location.href);
      const store = await this.getStore();
      const page = store[this.pageKey];
      this.annotations = Array.isArray(page?.annotations) ? page.annotations.filter((item) => item?.id && item?.quote) : [];
      this.editorId = "";
      this.renderAll();
    }

    rootCandidates(rootHint = "") {
      const candidates = [];
      const add = (element) => {
        if (!element || candidates.includes(element)) return;
        if (candidates.some((candidate) => candidate.contains(element))) return;
        candidates.push(element);
      };
      if (rootHint) {
        try { add(this.document.querySelector(rootHint)); } catch { /* ignore stale selectors */ }
      }
      add(this.findArticleRoot());
      add(this.document.querySelector("#js_content"));
      add(this.document.querySelector("article"));
      add(this.document.querySelector("main"));
      add(this.document.body);
      return candidates;
    }

    locate(annotation) {
      for (const root of this.rootCandidates(annotation.rootHint)) {
        const index = buildTextIndex(root, this.document);
        const match = findQuoteMatch(index.text, annotation.quote, annotation.prefix, annotation.suffix, annotation.hintIndex);
        if (!match) continue;
        const range = rangeFromMatch(index, match, this.document);
        if (range) return range;
      }
      return null;
    }

    annotationAnchor(range) {
      const root = this.rootCandidates().find((candidate) => candidate.contains(range.commonAncestorContainer)) || this.document.body;
      const index = buildTextIndex(root, this.document);
      const quote = normalizeWhitespace(range.toString());
      let hintIndex = -1;
      try {
        const before = this.document.createRange();
        before.selectNodeContents(root);
        before.setEnd(range.startContainer, range.startOffset);
        hintIndex = normalizeWhitespace(before.toString()).length;
      } catch {
        hintIndex = -1;
      }
      const match = findQuoteMatch(index.text, quote, "", "", hintIndex);
      const start = match?.start ?? Math.max(0, hintIndex);
      const end = match?.end ?? start + quote.length;
      return {
        quote,
        prefix: index.text.slice(Math.max(0, start - 90), start),
        suffix: index.text.slice(end, end + 90),
        hintIndex: start,
        rootHint: elementSelector(root)
      };
    }

    async create({ range, style = "marker-yellow", note = "", selectionContext = "" } = {}) {
      if (!range || range.collapsed) throw new Error("没有可标记的文字");
      if (!this.supportsHighlights()) throw new Error("当前页面暂不支持持续划线");
      await this.init();
      const anchor = this.annotationAnchor(range);
      if (!anchor.quote) throw new Error("没有可标记的文字");
      const now = new Date().toISOString();
      const annotation = {
        id: globalThis.crypto?.randomUUID?.() || `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ...anchor,
        style: STYLE_IDS.includes(style) ? style : "marker-yellow",
        note: String(note || "").trim().slice(0, 2000),
        context: normalizeWhitespace(selectionContext).slice(0, 1000),
        createdAt: now,
        updatedAt: now
      };
      this.annotations.push(annotation);
      this.ranges.set(annotation.id, range.cloneRange());
      await this.saveCurrentPage();
      this.renderHighlights();
      this.renderDots();
      return annotation;
    }

    async update(id, patch = {}) {
      const annotation = this.annotations.find((item) => item.id === id);
      if (!annotation) return;
      if (STYLE_IDS.includes(patch.style)) annotation.style = patch.style;
      if (typeof patch.note === "string") annotation.note = patch.note.trim().slice(0, 2000);
      annotation.updatedAt = new Date().toISOString();
      await this.saveCurrentPage();
      if (this.onUpdate) {
        try {
          await this.onUpdate({ ...annotation });
        } catch (error) {
          error.localAnnotationSaved = true;
          throw error;
        }
      }
      this.renderHighlights();
      this.renderDots();
    }

    async remove(id) {
      this.annotations = this.annotations.filter((item) => item.id !== id);
      this.ranges.delete(id);
      this.editorId = "";
      await this.saveCurrentPage();
      this.renderHighlights();
      this.renderDots();
    }

    renderAll() {
      this.clearHighlights();
      this.ranges.clear();
      this.unresolved.clear();
      for (const annotation of this.annotations) {
        const range = this.locate(annotation);
        if (range) this.ranges.set(annotation.id, range);
        else this.unresolved.add(annotation.id);
      }
      this.renderHighlights();
      this.renderDots();
    }

    renderHighlights() {
      if (!this.supportsHighlights()) return;
      for (const style of STYLE_IDS) {
        const ranges = this.annotations
          .filter((annotation) => annotation.style === style)
          .map((annotation) => this.ranges.get(annotation.id))
          .filter(Boolean);
        const name = HIGHLIGHT_NAMES[style];
        if (ranges.length) this.window.CSS.highlights.set(name, new this.window.Highlight(...ranges));
        else this.window.CSS.highlights.delete(name);
      }
    }

    clearHighlights() {
      if (!this.window?.CSS?.highlights) return;
      STYLE_IDS.forEach((style) => this.window.CSS.highlights.delete(HIGHLIGHT_NAMES[style]));
    }

    scheduleRestore() {
      this.window.clearTimeout(this.retryTimer);
      this.retryTimer = this.window.setTimeout(() => this.renderAll(), 500);
    }

    injectHighlightStyles() {
      if (this.document.getElementById("shudu-annotation-styles")) return;
      const style = this.document.createElement("style");
      style.id = "shudu-annotation-styles";
      style.textContent = `
        ::highlight(shudu-annotation-marker-yellow) { background-color: rgba(242, 195, 66, .22); color: inherit; }
        ::highlight(shudu-annotation-underline-blue) { text-decoration: underline 1.5px rgba(61, 131, 213, .52); text-underline-offset: .18em; text-decoration-skip-ink: auto; }
        ::highlight(shudu-annotation-marker-green) { background-color: rgba(78, 172, 136, .18); color: inherit; }
        ::highlight(shudu-annotation-wavy-red) { text-decoration: underline wavy 1px rgba(217, 91, 79, .5); text-underline-offset: .18em; }
      `;
      (this.document.head || this.document.documentElement).append(style);
    }

    createOverlay() {
      this.document.getElementById("shudu-annotation-layer-host")?.remove();
      this.overlayHost = this.document.createElement("div");
      this.overlayHost.id = "shudu-annotation-layer-host";
      this.overlayHost.dataset.adhdReaderUi = "true";
      this.overlayHost.style.cssText = "position:fixed;inset:0;z-index:2147483645;pointer-events:none;font-family:Inter,'PingFang SC','Microsoft YaHei',sans-serif;";
      this.overlayShadow = this.overlayHost.attachShadow({ mode: "open" });
      const style = this.document.createElement("style");
      style.textContent = `
        * { box-sizing: border-box; }
        button, textarea { font: inherit; }
        .dot { position: fixed; width: 12px; height: 12px; padding: 0; border: 2px solid white; border-radius: 50%; background: #f2c84b; box-shadow: 0 1px 5px rgba(24, 46, 42, .28); cursor: pointer; pointer-events: auto; opacity: .58; transition: transform .12s ease, opacity .12s ease; }
        .dot:hover, .dot:focus-visible, .dot[data-note="true"] { opacity: 1; transform: scale(1.2); }
        .dot:focus-visible { outline: 2px solid #16877a; outline-offset: 2px; }
        .dot[data-style="underline-blue"] { background: #3d83d5; }
        .dot[data-style="marker-green"] { background: #4fae86; }
        .dot[data-style="wavy-red"] { background: #d95b4f; }
        .editor { position: fixed; width: min(320px, calc(100vw - 24px)); padding: 12px; border: 1px solid rgba(21, 57, 50, .16); border-radius: 12px; background: rgba(255, 255, 255, .98); box-shadow: 0 16px 44px rgba(24, 46, 42, .22), 0 3px 10px rgba(24, 46, 42, .11); pointer-events: auto; color: #18342f; backdrop-filter: blur(16px); }
        .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
        .title { font-size: 13px; font-weight: 750; }
        .close { width: 26px; height: 26px; border: 0; border-radius: 7px; color: #5d6f6b; background: transparent; cursor: pointer; }
        .close:hover { background: #edf5f2; }
        .styles { display: flex; gap: 7px; margin-bottom: 9px; }
        .style { width: 34px; height: 28px; border: 1px solid rgba(21, 57, 50, .12); border-radius: 7px; background: white; cursor: pointer; }
        .style[aria-pressed="true"] { border-color: #16877a; box-shadow: 0 0 0 2px rgba(22, 135, 122, .14); }
        .swatch { display: block; width: 19px; height: 8px; margin: auto; border-radius: 2px; background: rgba(255, 219, 88, .68); }
        .style[data-style="underline-blue"] .swatch { height: 10px; border-bottom: 2px solid #3d83d5; border-radius: 0; background: transparent; }
        .style[data-style="marker-green"] .swatch { background: rgba(92, 191, 151, .55); }
        .style[data-style="wavy-red"] .swatch { height: 7px; border-radius: 0; background: #d95b4f; clip-path: polygon(0 55%, 14% 10%, 28% 55%, 42% 100%, 56% 55%, 70% 10%, 84% 55%, 100% 100%, 100% 72%, 84% 28%, 70% 72%, 56% 100%, 42% 72%, 28% 28%, 14% 72%, 0 100%); }
        textarea { display: block; width: 100%; min-height: 76px; resize: vertical; border: 1px solid rgba(21, 57, 50, .18); border-radius: 8px; padding: 8px 9px; color: #18342f; background: white; outline: none; font-size: 13px; line-height: 1.5; }
        textarea:focus { border-color: #16877a; box-shadow: 0 0 0 2px rgba(22, 135, 122, .11); }
        .actions { display: flex; align-items: center; justify-content: space-between; margin-top: 9px; }
        .save, .delete { height: 30px; border: 0; border-radius: 7px; padding: 0 11px; cursor: pointer; font-size: 12px; font-weight: 700; }
        .save { color: white; background: #16877a; }
        .save:hover { background: #10756a; }
        .delete { color: #a64235; background: transparent; }
        .delete:hover { background: #fff0ed; }
        .editor { border: 0; border-radius: 16px; padding: 16px; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 8px 28px rgba(0,0,0,.14); }
        .dot { opacity: .38; }
        button:focus-visible, textarea:focus-visible { outline: 2px solid #398a71; outline-offset: 2px; }
        @media (prefers-color-scheme: dark) {
          .editor { color: #e6ebef; background: rgba(36,42,48,.98); box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 8px 28px rgba(0,0,0,.24); }
          .style, textarea { background: #242a30; color: #e6ebef; border-color: #53606a; }
          .close { color: #a8b3bd; }
          .close:hover { background: #33473f; }
          .delete { color: #f2a798; }
          .delete:hover { background: #482e2e; }
          .dot { border-color: #242a30; }
        }
        @media (prefers-reduced-motion: reduce) { .dot { transition: none; } }
      `;
      this.overlayShadow.append(style);
      this.document.documentElement.append(this.overlayHost);
    }

    renderDots() {
      if (!this.overlayShadow) return;
      this.overlayShadow.querySelectorAll(".dot, .editor").forEach((element) => element.remove());
      for (const annotation of this.annotations) {
        const range = this.ranges.get(annotation.id);
        if (!range) continue;
        const dot = this.document.createElement("button");
        dot.type = "button";
        dot.className = "dot";
        dot.dataset.annotationId = annotation.id;
        dot.dataset.style = annotation.style;
        dot.dataset.note = String(Boolean(annotation.note));
        dot.setAttribute("aria-label", annotation.note ? `编辑批注：${annotation.note.slice(0, 60)}` : `编辑${STYLE_LABELS[annotation.style] || "划线"}`);
        dot.title = annotation.note || `编辑${STYLE_LABELS[annotation.style] || "划线"}`;
        dot.addEventListener("click", () => this.openEditor(annotation.id));
        this.overlayShadow.append(dot);
      }
      if (this.editorId) this.openEditor(this.editorId);
      this.scheduleDotPositions();
    }

    scheduleDotPositions() {
      if (this.positionFrame) return;
      this.positionFrame = this.window.requestAnimationFrame(() => {
        this.positionFrame = 0;
        this.positionDots();
      });
    }

    positionDots() {
      if (!this.overlayShadow) return;
      const occupied = [];
      this.overlayShadow.querySelectorAll(".dot").forEach((dot) => {
        const range = this.ranges.get(dot.dataset.annotationId);
        const rects = range ? [...range.getClientRects()].filter((rect) => rect.width || rect.height) : [];
        const rect = rects.at(-1) || range?.getBoundingClientRect();
        if (!rect || rect.bottom < 0 || rect.top > this.window.innerHeight) {
          dot.hidden = true;
          return;
        }
        dot.hidden = false;
        let top = Math.max(6, Math.min(this.window.innerHeight - 18, rect.top + rect.height / 2 - 6));
        const left = Math.max(6, Math.min(this.window.innerWidth - 18, rect.right + 7));
        while (occupied.some((item) => Math.abs(item.left - left) < 14 && Math.abs(item.top - top) < 14)) top += 14;
        occupied.push({ left, top });
        dot.style.left = `${left}px`;
        dot.style.top = `${Math.min(this.window.innerHeight - 18, top)}px`;
      });
      this.positionEditor();
    }

    openEditor(id) {
      const annotation = this.annotations.find((item) => item.id === id);
      if (!annotation || !this.overlayShadow) return;
      this.editorId = id;
      this.overlayShadow.querySelector(".editor")?.remove();
      const editor = this.document.createElement("div");
      editor.className = "editor";
      editor.dataset.annotationId = id;
      const head = this.document.createElement("div");
      head.className = "head";
      const title = this.document.createElement("div");
      title.className = "title";
      title.textContent = "划线批注";
      const close = this.document.createElement("button");
      close.type = "button";
      close.className = "close";
      close.textContent = "×";
      close.setAttribute("aria-label", "关闭批注");
      close.addEventListener("click", () => {
        this.editorId = "";
        editor.remove();
      });
      head.append(title, close);

      const styles = this.document.createElement("div");
      styles.className = "styles";
      styles.setAttribute("role", "group");
      styles.setAttribute("aria-label", "划线样式");
      for (const style of STYLE_IDS) {
        const button = this.document.createElement("button");
        button.type = "button";
        button.className = "style";
        button.dataset.style = style;
        button.title = STYLE_LABELS[style];
        button.setAttribute("aria-label", STYLE_LABELS[style]);
        button.setAttribute("aria-pressed", String(annotation.style === style));
        const swatch = this.document.createElement("span");
        swatch.className = "swatch";
        button.append(swatch);
        button.addEventListener("click", () => {
          styles.querySelectorAll(".style").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        });
        styles.append(button);
      }

      const textarea = this.document.createElement("textarea");
      textarea.maxLength = 2000;
      textarea.placeholder = "写下你的想法（可留空）";
      textarea.setAttribute("aria-label", "批注内容");
      textarea.value = annotation.note || "";

      const actions = this.document.createElement("div");
      actions.className = "actions";
      const remove = this.document.createElement("button");
      remove.type = "button";
      remove.className = "delete";
      remove.textContent = "删除划线";
      remove.addEventListener("click", async () => {
        if (this.window.confirm("删除这条划线和批注？")) await this.remove(id);
      });
      const save = this.document.createElement("button");
      save.type = "button";
      save.className = "save";
      save.textContent = "保存";
      const status = this.document.createElement("div");
      status.setAttribute("role", "status");
      status.style.cssText = "font-size:12px;line-height:1.5;color:#a73a27;";
      save.addEventListener("click", async () => {
        if (save.disabled) return;
        const selectedStyle = styles.querySelector('.style[aria-pressed="true"]')?.dataset.style || annotation.style;
        save.disabled = true;
        remove.disabled = true;
        textarea.disabled = true;
        save.textContent = "保存中…";
        status.textContent = "";
        try {
          await this.update(id, { style: selectedStyle, note: textarea.value });
          this.editorId = "";
          this.overlayShadow.querySelector(".editor")?.remove();
        } catch (error) {
          status.textContent = error?.localAnnotationSaved
            ? `想法已存到浏览器，Obsidian 未同步：${error?.message || "连接失败"}。请再点保存重试。`
            : `想法保存失败：${error?.message || "请重试"}`;
          save.disabled = false;
          remove.disabled = false;
          textarea.disabled = false;
          save.textContent = "重试同步";
        }
      });
      actions.append(remove, save);
      editor.append(head, styles, textarea, status, actions);
      this.overlayShadow.append(editor);
      this.positionEditor();
      this.window.requestAnimationFrame(() => textarea.focus());
    }

    positionEditor() {
      const editor = this.overlayShadow?.querySelector(".editor");
      if (!editor) return;
      const dot = this.overlayShadow.querySelector(`.dot[data-annotation-id="${this.editorId}"]`);
      const dotRect = dot?.getBoundingClientRect();
      const width = editor.offsetWidth || 320;
      const height = editor.offsetHeight || 210;
      const left = dotRect
        ? Math.max(12, Math.min(this.window.innerWidth - width - 12, dotRect.right + 8))
        : Math.max(12, this.window.innerWidth - width - 20);
      const top = dotRect
        ? Math.max(12, Math.min(this.window.innerHeight - height - 12, dotRect.top - 18))
        : 20;
      editor.style.left = `${left}px`;
      editor.style.top = `${top}px`;
    }
  }

  let activeManager = null;
  const api = {
    STORAGE_KEY,
    STYLE_IDS,
    STYLE_LABELS,
    normalizeWhitespace,
    normalizePageUrl,
    findQuoteMatch,
    buildTextIndex,
    rangeFromMatch,
    AnnotationManager,
    start(options = {}) {
      activeManager?.cleanup();
      activeManager = new AnnotationManager(options);
      activeManager.init().catch(() => {});
      return activeManager;
    },
    get activeManager() {
      return activeManager;
    }
  };

  globalThis.ShuduAnnotations = api;
})();
