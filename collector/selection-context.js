(() => {
  const SEMANTIC_BLOCK_SELECTOR =
    "p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, [role='paragraph']";
  const FALLBACK_BLOCK_SELECTOR = "section, div";

  const cleanText = (value, limit) =>
    String(value || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim()
      .slice(0, limit);

  const elementFromNode = (node) =>
    node?.nodeType === 1 ? node : node?.parentElement;

  function readableText(block) {
    if (!block?.cloneNode) return cleanText(block?.innerText || block?.textContent, 4000);
    const clone = block.cloneNode(true);
    clone.querySelectorAll?.("[data-shudu-translation], [data-shudu-translation-toast], [data-shudu-translation-anchor], [data-adhd-reader-ui='true']")
      .forEach((node) => node.remove());
    return cleanText(clone.innerText || clone.textContent, 4000);
  }

  function contextBlockFor(node, selectionLength) {
    const element = elementFromNode(node);
    const semanticBlock = element?.closest?.(SEMANTIC_BLOCK_SELECTOR);
    if (semanticBlock) return semanticBlock;

    const body = element?.ownerDocument?.body;
    const maxLength = Math.max(1200, Math.min(4000, selectionLength * 6));
    for (let current = element; current && current !== body; current = current.parentElement) {
      if (!current.matches?.(FALLBACK_BLOCK_SELECTOR)) continue;
      const text = readableText(current).slice(0, 4001);
      if (text && text.length <= maxLength) return current;
    }
    return null;
  }

  function selectionDataFrom(selection) {
    const text = cleanText(selection?.toString(), 40000);
    if (!text || !selection?.rangeCount) {
      return { selection: text, selectionContext: "" };
    }

    const range = selection.getRangeAt(0);
    const blocks = [
      contextBlockFor(range.startContainer, text.length),
      contextBlockFor(range.endContainer, text.length)
    ].filter(Boolean);
    const seenText = new Set();
    const context = cleanText(
      blocks
        .map((block) => readableText(block))
        .filter((blockText) => {
          if (!blockText || seenText.has(blockText)) return false;
          seenText.add(blockText);
          return true;
        })
        .join("\n\n"),
      4000
    );
    return { selection: text, selectionContext: context };
  }

  globalThis.ShuduSelectionContext = { selectionDataFrom };
})();
