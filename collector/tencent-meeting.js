(() => {
  const TIMESTAMP_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;

  const cleanText = (value, limit = 120000) =>
    String(value || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, limit);

  function timestampSeconds(value) {
    const match = TIMESTAMP_RE.exec(String(value || "").trim());
    if (!match) return null;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  function isRecordingPage(locationLike) {
    const hostname = String(locationLike?.hostname || "").toLowerCase();
    const pathname = String(locationLike?.pathname || "");
    return hostname === "meeting.tencent.com" &&
      (pathname.startsWith("/cw/") || /^\/meeting-record\/shares(?:\/|$)/.test(pathname));
  }

  function timestampLines(value) {
    return cleanText(value, 10000)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => timestampSeconds(line) !== null);
  }

  function normalizeSegments(segments) {
    const seen = new Set();
    return (segments || [])
      .map((segment, order) => {
        const text = cleanText(segment?.text, 10000);
        const timestamp = cleanText(segment?.timestamp, 20) || timestampLines(text)[0] || "";
        return {
          text,
          timestamp,
          seconds: timestampSeconds(timestamp),
          order: Number.isFinite(segment?.order) ? segment.order : order
        };
      })
      .filter((segment) => {
        if (!segment.text || segment.seconds === null) return false;
        const key = `${segment.timestamp}|${segment.text.replace(/\s+/g, " ")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => left.seconds - right.seconds || left.order - right.order);
  }

  function isTimestampElement(element) {
    if (!element || element.children?.length) return false;
    return timestampSeconds(cleanText(element.innerText || element.textContent, 20)) !== null;
  }

  function segmentElementFromTimestamp(element, boundary) {
    let current = element;
    let best = null;
    for (let depth = 0; current && depth < 8; depth += 1) {
      if (current === boundary) break;
      const text = cleanText(current.innerText || current.textContent, 10000);
      const timestamps = timestampLines(text);
      if (timestamps.length > 1) break;
      if (timestamps.length === 1 && text.length > timestamps[0].length + 2) best = current;
      current = current.parentElement;
    }
    return best;
  }

  function collectVisibleSegments(container, orderStart = 0) {
    if (!container?.querySelectorAll) return [];
    const elements = [container, ...container.querySelectorAll("*")];
    const segmentElements = new Set();
    for (const element of elements) {
      if (!isTimestampElement(element)) continue;
      const segment = segmentElementFromTimestamp(element, container);
      if (segment) segmentElements.add(segment);
    }
    return [...segmentElements].map((element, index) => {
      const text = cleanText(element.innerText || element.textContent, 10000);
      return {
        text,
        timestamp: timestampLines(text)[0] || "",
        order: orderStart + index
      };
    });
  }

  function scrollableTranscriptContainer(documentRef) {
    const keywordInput = documentRef?.querySelector?.(
      'input[placeholder*="关键词"], textarea[placeholder*="关键词"], [role="textbox"][placeholder*="关键词"]'
    );
    const scopes = [];
    let current = keywordInput?.parentElement;
    for (let depth = 0; current && depth < 7; depth += 1) {
      scopes.push(current);
      current = current.parentElement;
    }
    if (!scopes.length && documentRef?.body) scopes.push(documentRef.body);

    const candidates = new Set();
    for (const scope of scopes) {
      candidates.add(scope);
      for (const element of scope.querySelectorAll?.("*") || []) candidates.add(element);
    }

    let best = null;
    let bestScore = -1;
    for (const element of candidates) {
      const clientHeight = Number(element.clientHeight || 0);
      const scrollHeight = Number(element.scrollHeight || 0);
      if (clientHeight < 120 || scrollHeight <= clientHeight + 40) continue;
      const text = cleanText(element.innerText || element.textContent, 30000);
      const timestampCount = timestampLines(text).length;
      if (!timestampCount) continue;
      const style = globalThis.getComputedStyle?.(element);
      const overflowScore = /auto|scroll/i.test(style?.overflowY || "") ? 80 : 0;
      const inputScore = keywordInput && element.contains?.(keywordInput) ? 15 : 0;
      const score = overflowScore + inputScore + Math.min(timestampCount, 30) - Math.log10(scrollHeight + 1);
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    return best;
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function collectFullTranscript(documentRef, options = {}) {
    const container = scrollableTranscriptContainer(documentRef);
    if (!container) {
      return { text: "", segments: [], complete: false, reason: "没有找到逐字稿滚动区域" };
    }

    const originalTop = Number(container.scrollTop || 0);
    const delayMs = Math.max(40, Number(options.delayMs || 90));
    const maxIterations = Math.max(20, Number(options.maxIterations || 360));
    const collected = [];
    let order = 0;
    let reachedStart = false;
    let reachedEnd = false;
    let unchanged = 0;

    container.scrollTop = 0;
    container.dispatchEvent?.(new Event("scroll", { bubbles: true }));
    await wait(delayMs * 2);
    reachedStart = Number(container.scrollTop || 0) <= 2;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const visible = collectVisibleSegments(container, order);
      collected.push(...visible);
      order += visible.length;

      const currentTop = Number(container.scrollTop || 0);
      const maximumTop = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
      if (currentTop >= maximumTop - 2) {
        reachedEnd = true;
        await wait(delayMs * 2);
        collected.push(...collectVisibleSegments(container, order));
        break;
      }

      const step = Math.max(240, Number(container.clientHeight || 0) * 0.78);
      container.scrollTop = Math.min(maximumTop, currentTop + step);
      container.dispatchEvent?.(new Event("scroll", { bubbles: true }));
      await wait(delayMs);

      const nextTop = Number(container.scrollTop || 0);
      unchanged = nextTop <= currentTop + 1 ? unchanged + 1 : 0;
      if (unchanged >= 3) break;
    }

    container.scrollTop = originalTop;
    container.dispatchEvent?.(new Event("scroll", { bubbles: true }));

    const segments = normalizeSegments(collected);
    const firstTimestamp = segments[0]?.timestamp || "";
    const lastTimestamp = segments.at(-1)?.timestamp || "";
    return {
      text: segments.map((segment) => segment.text).join("\n\n"),
      segments,
      complete: reachedStart && reachedEnd && segments.length > 1,
      reachedStart,
      reachedEnd,
      firstTimestamp,
      lastTimestamp,
      reason: reachedEnd ? "" : "逐字稿滚动区域没有到达末尾"
    };
  }

  globalThis.ShuduTencentMeeting = {
    cleanText,
    collectFullTranscript,
    collectVisibleSegments,
    isRecordingPage,
    normalizeSegments,
    scrollableTranscriptContainer,
    timestampSeconds
  };
})();
