(() => {
  const SITE_SELECTORS = {
    twitter: ["article[data-testid='tweet']", "article"],
    jike: [
      "article",
      "[data-testid*='post']",
      "[class*='postItem']",
      "[class*='post-item']",
      "[class*='postCard']",
      "[class*='post-card']"
    ],
    zsxq: [
      "article",
      "[data-topic-id]",
      "[data-testid*='topic']",
      ".topic-container",
      ".topic-item",
      "[class*='topicCard']",
      "[class*='topic-card']",
      "[class*='topicItem']",
      "[class*='topic-item']",
      "[class*='topicContainer']",
      "[class*='topic-container']",
      "[class*='dynamicItem']",
      "[class*='dynamic-item']",
      "[class*='feedItem']",
      "[class*='feed-item']",
      "[class*='postItem']",
      "[class*='post-item']"
    ]
  };

  const ZSXQ_DATE_PATTERN = /20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?/g;

  const cleanText = (value, limit = 120000) =>
    String(value || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, limit);

  function siteTypeForLocation(locationLike) {
    const host = String(locationLike?.hostname || "").toLowerCase();
    if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) {
      return "twitter";
    }
    if (host.includes("okjike.com") || host.includes("jike.city")) return "jike";
    if (host.includes("zsxq.com")) return "zsxq";
    return "";
  }

  function matchesAny(element, selectors) {
    return Boolean(element?.matches && selectors.some((selector) => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    }));
  }

  function itemPermalink(root, siteType, baseUrl) {
    const anchors = [...(root?.querySelectorAll?.("a[href]") || [])];
    const patterns = siteType === "twitter"
      ? [/\/(?:[^/]+)\/status\/\d+(?:[/?#]|$)/i]
      : siteType === "jike"
        ? [/\/(?:originalPosts|posts?)\/[^/?#]+/i]
        : [/(?:topic_detail|topics?|topic)[/_-]?\d+/i];
    for (const anchor of anchors) {
      const raw = anchor.href || anchor.getAttribute?.("href") || "";
      if (!patterns.some((pattern) => pattern.test(raw))) continue;
      try {
        const url = new URL(raw, baseUrl);
        url.hash = "";
        return url.toString();
      } catch {
        return raw;
      }
    }
    return "";
  }

  function candidateLooksLikeItem(element, siteType, viewportHeight) {
    const text = cleanText(element?.innerText || element?.textContent, 50000);
    if (text.length < 2 || text.length >= 50000) return false;
    const rect = element?.getBoundingClientRect?.();
    if (rect) {
      const minWidth = siteType === "twitter" ? 260 : siteType === "zsxq" ? 160 : 180;
      const minHeight = siteType === "twitter" ? 52 : 28;
      if (Number(rect.width) > 0 && rect.width < minWidth) return false;
      if (Number(rect.height) > 0 && rect.height < minHeight) return false;
      if (viewportHeight && rect.height > viewportHeight * 0.92) return false;
    }
    if (siteType === "twitter") {
      return Boolean(
        element.querySelector?.('[data-testid="tweetText"]') ||
        itemPermalink(element, siteType, "https://x.com")
      );
    }
    return true;
  }

  function looksLikeZsxqCard(element, viewportHeight) {
    const text = cleanText(element?.innerText || element?.textContent, 50000);
    const dates = text.match(ZSXQ_DATE_PATTERN) || [];
    if (dates.length !== 1) return false;
    return candidateLooksLikeItem(element, "zsxq", viewportHeight);
  }

  function candidateScore(element, siteType, viewportHeight) {
    const text = cleanText(element?.innerText || element?.textContent, 50000);
    const rect = element?.getBoundingClientRect?.();
    let score = 0;
    if (itemPermalink(element, siteType, "https://example.com")) score += 50;
    if (element?.querySelector?.("time[datetime]")) score += 12;
    if (siteType === "zsxq" && ZSXQ_DATE_PATTERN.test(text)) score += 14;
    ZSXQ_DATE_PATTERN.lastIndex = 0;
    if (/查看详情|展开全文|转发|评论|分享/.test(text)) score += 8;
    if (text.length >= 20 && text.length <= 12000) score += 18;
    if (rect && rect.height >= 72 && (!viewportHeight || rect.height < viewportHeight * 0.85)) score += 16;
    if (matchesAny(element, SITE_SELECTORS[siteType].slice(0, 3))) score += 12;
    return score;
  }

  function findItemRoot(node, siteType, viewportHeight = 0) {
    const selectors = SITE_SELECTORS[siteType];
    if (!selectors) return null;
    let current = node?.nodeType === 1 ? node : node?.parentElement;
    const candidates = [];
    while (current && current !== current.ownerDocument?.body && current !== current.ownerDocument?.documentElement) {
      const explicitMatch = matchesAny(current, selectors);
      const zsxqDetailFallback = siteType === "zsxq" &&
        /查看详情/.test(cleanText(current.innerText || current.textContent, 50000)) &&
        (cleanText(current.innerText || current.textContent, 50000).match(/查看详情/g) || []).length === 1;
      const zsxqSemanticFallback = siteType === "zsxq" && looksLikeZsxqCard(current, viewportHeight);
      if ((explicitMatch || zsxqDetailFallback || zsxqSemanticFallback) && candidateLooksLikeItem(current, siteType, viewportHeight)) {
        candidates.push(current);
      }
      current = current.parentElement;
    }
    return candidates
      .map((element, index) => ({ element, index, score: candidateScore(element, siteType, viewportHeight) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.element || null;
  }

  function firstText(root, selectors, limit = 120000) {
    for (const selector of selectors) {
      const element = root?.querySelector?.(selector);
      const text = cleanText(element?.innerText || element?.textContent, limit);
      if (text) return text;
    }
    return "";
  }

  function cleanFallbackText(value, author, publishedAt) {
    const ignored = /^(查看详情|展开全文|收起|赞|评论|收藏|分享|转发|回复|举报|更多|\d+\s*(?:条评论|人赞))$/;
    return cleanText(value)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== author && line !== publishedAt && !ignored.test(line))
      .join("\n")
      .trim();
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function extractItem(root, siteType, locationLike) {
    if (!root || !SITE_SELECTORS[siteType]) return null;
    const wholeText = cleanText(root.innerText || root.textContent);
    const lines = wholeText.split("\n").map((line) => line.trim()).filter(Boolean);
    const authorSelectors = siteType === "twitter"
      ? ['[data-testid="User-Name"]']
      : ["[data-testid*='author']", "[class*='author']", "[class*='nickname']", "[class*='user-name']"];
    const author = cleanText(firstText(root, authorSelectors, 160).split("\n")[0] || lines[0], 160);
    const timeElement = root.querySelector?.("time[datetime]");
    const dateMatch = wholeText.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?/);
    const publishedAt = cleanText(timeElement?.dateTime || timeElement?.getAttribute?.("datetime") || dateMatch?.[0], 100);
    const contentSelectors = siteType === "twitter"
      ? ['[data-testid="tweetText"]']
      : siteType === "jike"
        ? ["[data-testid='post-content']", "[class*='postContent']", "[class*='post-content']", "[class*='PostContent']"]
        : ["[class*='topicContent']", "[class*='topic-content']", "[class*='TopicContent']"];
    const focusedText = firstText(root, contentSelectors);
    const text = focusedText || cleanFallbackText(wholeText, author, publishedAt);
    if (!text) return null;
    const baseUrl = String(locationLike?.href || "");
    const permalink = itemPermalink(root, siteType, baseUrl);
    const source = siteType === "twitter" ? "X / Twitter" : siteType === "jike" ? "即刻" : "知识星球";
    const firstLine = text.split("\n").find(Boolean) || "";
    const title = cleanText(firstLine, 140) || `${author || source}的动态`;
    const identitySeed = [siteType, permalink || baseUrl, author, publishedAt, text].join("|");
    return {
      title,
      text,
      author,
      publishedAt,
      url: permalink || baseUrl,
      pageUrl: baseUrl,
      source,
      siteName: source,
      siteType,
      collectionId: permalink ? "" : `feed:${siteType}:${shortHash(identitySeed)}`,
      dedupeByUrl: Boolean(permalink)
    };
  }

  function computeLauncherPosition(rect, size, viewport) {
    const margin = 8;
    const width = Math.max(32, Number(size?.width) || 32);
    const height = Math.max(32, Number(size?.height) || 32);
    const viewportWidth = Math.max(width + margin * 2, Number(viewport?.width) || width + margin * 2);
    const viewportHeight = Math.max(height + margin * 2, Number(viewport?.height) || height + margin * 2);
    const left = Number(rect?.right || viewportWidth) - width - 10;
    const cardHeight = Math.max(0, Number(rect?.height) || Number(rect?.bottom || 0) - Number(rect?.top || 0));
    const verticalOffset = Math.min(52, Math.max(10, (cardHeight - height) / 2));
    const top = Number(rect?.top || 0) + verticalOffset;
    return {
      left: Math.round(Math.max(margin, Math.min(viewportWidth - width - margin, left))),
      top: Math.round(Math.max(margin, Math.min(viewportHeight - height - margin, top))),
      placement: "inside-right"
    };
  }

  globalThis.ShuduFeedItem = {
    siteTypeForLocation,
    findItemRoot,
    itemPermalink,
    extractItem,
    computeLauncherPosition
  };
})();
