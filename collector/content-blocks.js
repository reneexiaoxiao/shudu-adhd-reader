(() => {
  const BLOCK_TAGS = new Set([
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DIV",
    "FIGCAPTION",
    "FIGURE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "MAIN",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TR"
  ]);
  const SKIP_TAGS = new Set([
    "BUTTON",
    "CANVAS",
    "FOOTER",
    "FORM",
    "IFRAME",
    "INPUT",
    "NAV",
    "NOSCRIPT",
    "SCRIPT",
    "STYLE",
    "SVG",
    "TEMPLATE",
    "TEXTAREA"
  ]);

  const cleanText = (value, limit = 120000) =>
    String(value || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim()
      .slice(0, limit);

  function imageUrlFromElement(image) {
    let url =
      image?.currentSrc ||
      image?.dataset?.src ||
      image?.dataset?.original ||
      image?.src ||
      "";
    if (url.includes("pbs.twimg.com/media")) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.set("name", "orig");
        url = parsed.toString();
      } catch {
        // Keep the page-provided URL.
      }
    }
    return url;
  }

  function firstMatchingElement(root, selectors) {
    for (const selector of selectors || []) {
      const element = root?.querySelector?.(selector);
      if (element) return element;
    }
    return null;
  }

  function hiddenElement(node) {
    if (node?.hidden || node?.getAttribute?.("aria-hidden") === "true") return true;
    if (node?.hasAttribute?.("data-immersive-translate-translation-element-mark")) return true;
    if (node?.matches?.("[data-shudu-translation], [data-shudu-translation-toast], [data-shudu-translation-anchor], [data-adhd-reader-ui='true']")) return true;
    const className = typeof node?.className === "string" ? node.className : "";
    return /(?:^|\s)w-form-(?:done|fail)(?:\s|$)/.test(className) ||
      /(?:^|\s)immersive-translate-(?:target-wrapper|target-inner|target-translation-[\w-]+)(?:\s|$)/.test(className);
  }

  function extractContentBlocks(root, images) {
    if (!root) return [];
    const accepted = new Map(
      (Array.isArray(images) ? images : [])
        .filter((image) => image?.url)
        .map((image) => [image.url, image])
    );
    const blocks = [];
    const seenImages = new Set();
    let buffer = "";
    let textLength = 0;
    const append = (value) => {
      if (textLength + buffer.length >= 120000) return;
      buffer += String(value || "");
    };
    const boundary = () => {
      if (buffer && !buffer.endsWith("\n\n")) buffer += "\n\n";
    };
    const flushText = () => {
      const remaining = Math.max(0, 120000 - textLength);
      const text = cleanText(buffer, remaining);
      buffer = "";
      if (!text) return;
      textLength += text.length;
      blocks.push({ type: "text", text });
    };

    const visit = (node) => {
      if (!node || textLength >= 120000) return;
      if (node.nodeType === 3) {
        append(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) return;
      const tagName = String(node.tagName || "").toUpperCase();
      if (SKIP_TAGS.has(tagName) || hiddenElement(node)) return;
      if (tagName === "IMG") {
        const url = imageUrlFromElement(node);
        const image = accepted.get(url);
        if (image && !seenImages.has(url)) {
          flushText();
          seenImages.add(url);
          blocks.push({
            type: "image",
            url,
            alt: cleanText(image.alt, 180)
          });
        }
        return;
      }
      if (tagName === "BR") {
        append("\n");
        return;
      }

      const isBlock = BLOCK_TAGS.has(tagName);
      if (isBlock) boundary();
      for (const child of node.childNodes || []) visit(child);
      if (isBlock) boundary();
    };

    visit(root);
    flushText();
    return blocks;
  }

  function filterSelectionImages(data, selectedUrls) {
    const selected = new Set(Array.from(selectedUrls || []).filter(Boolean));
    return {
      ...(data || {}),
      images: Array.from(data?.images || []).filter((image) => selected.has(image?.url)),
      contentBlocks: Array.from(data?.contentBlocks || []).filter((block) =>
        block?.type !== "image" || selected.has(block.url)
      )
    };
  }

  globalThis.ShuduContentBlocks = {
    extractContentBlocks,
    filterSelectionImages,
    firstMatchingElement,
    imageUrlFromElement
  };
})();
