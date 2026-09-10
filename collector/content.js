(() => {
  const CONTENT_VERSION = "1.7.2";
  const LOCAL_API_ROOT = "http://127.0.0.1:8765";
  if (globalThis.__SHUDU_COLLECTOR_CONTENT_VERSION__ === CONTENT_VERSION) return;

  const previousCleanup = globalThis.__SHUDU_COLLECTOR_CLEANUP__;
  if (typeof previousCleanup === "function") {
    try {
      previousCleanup();
    } catch {
      // A stale extension context may already be unavailable; continue with a clean instance.
    }
  }

  globalThis.__SHUDU_COLLECTOR_CONTENT_VERSION__ = CONTENT_VERSION;

  const lifecycleController = new AbortController();
  const cleanupCallbacks = new Set();
  let lifecycleActive = true;

  const addManagedListener = (target, type, listener, options = {}) => {
    const normalizedOptions = typeof options === "boolean"
      ? { capture: options }
      : { ...(options || {}) };
    try {
      target.addEventListener(type, listener, {
        ...normalizedOptions,
        signal: lifecycleController.signal
      });
    } catch {
      target.addEventListener(type, listener, options);
      cleanupCallbacks.add(() => target.removeEventListener(type, listener, options));
    }
  };

  const registerCleanup = (callback) => cleanupCallbacks.add(callback);

  globalThis.__SHUDU_COLLECTOR_CLEANUP__ = () => {
    if (!lifecycleActive) return;
    lifecycleActive = false;
    lifecycleController.abort();
    cleanupCallbacks.forEach((callback) => {
      try {
        callback();
      } catch {
        // Cleanup should be best-effort when the extension is being reloaded.
      }
    });
    cleanupCallbacks.clear();
    document.getElementById("shudu-selection-toolbar-host")?.remove();
    document.getElementById("shudu-feed-toolbar-host")?.remove();
    document.getElementById("shudu-annotation-layer-host")?.remove();
  };

  const limitText = (value, limit = 120000) =>
    String(value || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim()
      .slice(0, limit);

  const meta = (...selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element?.content || element?.getAttribute?.("content") || element?.textContent;
      if (value?.trim()) return value.trim();
    }
    return "";
  };

  const canonicalUrl = () =>
    document.querySelector('link[rel="canonical"]')?.href || location.href;

  const selectionDataFrom = (selection) =>
    globalThis.ShuduSelectionContext?.selectionDataFrom(selection) || {
      selection: limitText(selection?.toString(), 40000),
      selectionContext: ""
    };

  const selectionData = () => selectionDataFrom(window.getSelection());

  const contentImageEntries = (container) => {
    const images = [...(container || document).querySelectorAll("img")];
    const seen = new Set();
    return images
      .map((image) => {
        const url = globalThis.ShuduContentBlocks?.imageUrlFromElement(image) ||
          image.currentSrc || image.dataset?.src || image.dataset?.original || image.src || "";
        return {
          element: image,
          image: {
            url,
            alt: limitText(image.alt, 180),
            width: image.naturalWidth || image.width || 0,
            height: image.naturalHeight || image.height || 0
          }
        };
      })
      .filter((entry) => {
        const image = entry.image;
        if (!/^https?:/i.test(image.url) || seen.has(image.url)) return false;
        seen.add(image.url);
        const likelyContent = image.width >= 240 || image.height >= 180 || /pbs\.twimg\.com\/media|mmbiz\.qpic\.cn|zsxq/i.test(image.url);
        return likelyContent && !/avatar|emoji|icon|logo/i.test(`${image.url} ${image.alt}`);
      })
      .slice(0, 120);
  };

  const imageInfo = (container) => contentImageEntries(container)
    .slice(0, 6)
    .map((entry) => entry.image);

  const findArticleRoot = () => {
    const host = location.hostname;
    if (host === "x.com" || host.endsWith("twitter.com")) {
      const statusId = location.pathname.match(/\/status\/(\d+)/)?.[1];
      return (
        [...document.querySelectorAll("article")].find((article) =>
          statusId ? article.querySelector(`a[href*="/status/${statusId}"]`) : false
        ) || document.querySelector("article")
      );
    }
    if (host === "mp.weixin.qq.com") return document.querySelector("#js_content");
    if (host.includes("readwise.io")) {
      return document.querySelector("article, [data-testid*='document'], main, .document-content");
    }
    if (host === "youtu.be" || host.endsWith("youtube.com")) {
      return document.querySelector("ytd-watch-flexy, #primary, main");
    }
    if (host.includes("zsxq.com")) return document.querySelector("article, main, [class*='topic']");
    if (host.includes("okjike.com") || host.includes("jike.city")) {
      return document.querySelector("article, main, [class*='post']");
    }
    const selectors = [
      "article",
      "[itemprop='articleBody']",
      ".blog-post-content",
      ".post-content",
      ".entry-content",
      ".article-content",
      "main"
    ];
    return globalThis.ShuduContentBlocks?.firstMatchingElement(document, selectors) ||
      document.querySelector("main");
  };

  const detectSiteType = () => {
    const host = location.hostname;
    if (globalThis.ShuduTencentMeeting?.isRecordingPage(location)) return "tencent-meeting";
    if (host === "x.com" || host.endsWith("twitter.com")) return "twitter";
    if (host.includes("okjike.com") || host.includes("jike.city")) return "jike";
    if (host === "mp.weixin.qq.com") return "wechat";
    if (host.includes("zsxq.com")) return "zsxq";
    if (host.includes("readwise.io")) return "readwise";
    if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
    if (
      /substack\.com|beehiiv\.com|mailchi\.mp|ghost\.io|buttondown\.email/i.test(host) ||
      meta('meta[property="og:type"]') === "article"
    ) {
      return "newsletter";
    }
    return "web";
  };

  const extractTwitter = (root) => ({
    title: limitText(root?.querySelector('[data-testid="tweetText"]')?.innerText, 220) || document.title,
    text: limitText(root?.querySelector('[data-testid="tweetText"]')?.innerText),
    author: limitText(root?.querySelector('[data-testid="User-Name"]')?.innerText?.split("\n")[0], 160),
    publishedAt: root?.querySelector("time")?.dateTime || ""
  });

  const extractWechat = (root) => ({
    title: limitText(document.querySelector("#activity-name")?.textContent || document.title, 300),
    text: limitText(root?.innerText),
    author: limitText(document.querySelector("#js_name")?.textContent, 160),
    publishedAt: limitText(document.querySelector("#publish_time")?.textContent, 100)
  });

  function parseAssignedJson(source, variableName) {
    const match = new RegExp(`${variableName}\\s*=\\s*`).exec(source || "");
    if (!match) return null;
    const start = source.indexOf("{", match.index + match[0].length);
    if (start < 0) return null;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, index + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  function youtubePlayerResponse() {
    for (const script of document.scripts) {
      if (!script.textContent?.includes("ytInitialPlayerResponse")) continue;
      const parsed = parseAssignedJson(script.textContent, "ytInitialPlayerResponse");
      if (parsed) return parsed;
    }
    return null;
  }

  function extractYoutube() {
    const player = youtubePlayerResponse();
    const details = player?.videoDetails || {};
    const microformat = player?.microformat?.playerMicroformatRenderer || {};
    const description = limitText(
      document.querySelector("#description-inline-expander, ytd-text-inline-expander#description-inline-expander, #description")?.innerText ||
        details.shortDescription ||
        meta('meta[name="description"]', 'meta[property="og:description"]'),
      12000
    );
    const title = limitText(
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string")?.textContent ||
        details.title ||
        meta('meta[property="og:title"]') ||
        document.title.replace(/\s*-\s*YouTube\s*$/i, ""),
      300
    );
    const author = limitText(
      document.querySelector("#channel-name a, ytd-channel-name a")?.textContent || details.author,
      160
    );
    const publishedAt = limitText(
      microformat.publishDate || microformat.uploadDate || meta('meta[itemprop="datePublished"]'),
      100
    );
    const duration = limitText(meta('meta[itemprop="duration"]') || details.lengthSeconds, 80);
    const views = limitText(meta('meta[itemprop="interactionCount"]') || details.viewCount, 80);
    const chapters = [...document.querySelectorAll("ytd-macro-markers-list-item-renderer")]
      .map((item) => {
        const time = limitText(item.querySelector("#time, .time")?.textContent, 40);
        const chapter = limitText(item.querySelector("#title, .title")?.textContent, 180);
        return chapter ? `${time ? `${time} ` : ""}${chapter}` : "";
      })
      .filter(Boolean)
      .slice(0, 80);
    const visibleTranscript = [...document.querySelectorAll("ytd-transcript-segment-renderer")]
      .map((segment) => {
        const time = limitText(segment.querySelector(".segment-timestamp")?.textContent, 40);
        const text = limitText(segment.querySelector(".segment-text")?.textContent, 1000);
        return text ? `${time ? `${time} ` : ""}${text}` : "";
      })
      .filter(Boolean)
      .slice(0, 5000);
    const captionTracks = (player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [])
      .map((track) => ({
        url: limitText(track.baseUrl, 8000),
        languageCode: limitText(track.languageCode, 40),
        name: limitText(
          track.name?.simpleText || track.name?.runs?.map((run) => run.text).join(""),
          120
        ),
        kind: limitText(track.kind, 40)
      }))
      .filter((track) => /^https?:/i.test(track.url))
      .slice(0, 12);
    const thumbnail = limitText(
      details.thumbnail?.thumbnails?.at(-1)?.url || meta('meta[property="og:image"]'),
      4000
    );
    const text = [
      description,
      duration ? `视频时长：${duration}` : "",
      views ? `播放量：${views}` : "",
      chapters.length ? `章节：\n${chapters.join("\n")}` : "",
      visibleTranscript.length ? `视频字幕：\n${visibleTranscript.join("\n")}` : ""
    ].filter(Boolean).join("\n\n");

    return {
      title,
      text,
      description,
      author,
      publishedAt,
      source: "YouTube",
      images: thumbnail ? [{ url: thumbnail, alt: `${title} · YouTube 封面`, width: 1280, height: 720 }] : [],
      youtubeCaptionTracks: captionTracks,
      youtubeTranscriptAvailable: visibleTranscript.length > 0 || captionTracks.length > 0
    };
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function leafTextCandidate(selectors, rejected = []) {
    const candidates = [...document.querySelectorAll(selectors)]
      .map((element) => limitText(element.innerText || element.textContent, 300))
      .filter((text) => text && !rejected.includes(text));
    return candidates[0] || "";
  }

  async function extractTencentMeeting() {
    let transcript = await globalThis.ShuduTencentMeeting?.collectFullTranscript(document);
    let openedTranscript = false;
    if (!transcript?.text) {
      const transcriptButton = [...document.querySelectorAll("button, [role='tab']")]
        .find((element) => limitText(element.innerText || element.textContent, 30) === "逐字稿");
      if (transcriptButton) {
        transcriptButton.click();
        openedTranscript = true;
        await wait(450);
        transcript = await globalThis.ShuduTencentMeeting?.collectFullTranscript(document);
      }
    }

    const bodyText = limitText(document.body?.innerText, 120000);
    const bodyLines = bodyText.split("\n").map((line) => line.trim()).filter(Boolean);
    const subjectAfterBack = bodyLines.find((line, index) =>
      index > 0 && bodyLines[index - 1] === "返回" && line.length > 3 && line !== "录制文件"
    );
    const subject = subjectAfterBack || leafTextCandidate(
      "h1, h2, [class*='subject'], [class*='title']",
      ["返回", "录制文件", "纪要", "时间轴", "逐字稿"]
    ).replace(/^返回\s*/u, "").replace(/\s*\n\s*/g, " ");
    const duration = bodyText.match(/时长\s*([0-9]{1,2}:[0-9]{2}:[0-9]{2})/)?.[1] || "";
    const meetingDate = bodyText.match(/20\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2}/)?.[0] || "";
    const transcriptLabel = transcript?.complete ? "完整抓取" : "抓取结果需核对";
    const text = [
      subject ? `会议主题：${subject}` : "",
      meetingDate ? `会议时间：${meetingDate}` : "",
      duration ? `录制时长：${duration}` : "",
      transcript?.firstTimestamp || transcript?.lastTimestamp
        ? `逐字稿范围：${transcript.firstTimestamp || "起点未知"}–${transcript.lastTimestamp || "终点未知"}`
        : "",
      `腾讯会议逐字稿（${transcriptLabel}）：`,
      transcript?.text || "当前页面没有提供可读取的逐字稿。"
    ].filter(Boolean).join("\n\n");

    return {
      title: subject || document.title,
      text: limitText(text),
      description: duration ? `腾讯会议录制，时长 ${duration}` : "腾讯会议录制",
      source: "腾讯会议",
      images: [],
      tencentMeetingTranscript: {
        complete: Boolean(transcript?.complete),
        firstTimestamp: transcript?.firstTimestamp || "",
        lastTimestamp: transcript?.lastTimestamp || "",
        segmentCount: transcript?.segments?.length || 0,
        reason: transcript?.reason || "",
        openedTranscript
      }
    };
  }

  async function extractPageData() {
    const siteType = detectSiteType();
    const root = findArticleRoot();
    const selected = selectionData();
    const siteSpecific = siteType === "twitter"
      ? extractTwitter(root)
      : siteType === "wechat"
        ? extractWechat(root)
        : siteType === "youtube"
          ? extractYoutube()
          : siteType === "tencent-meeting"
            ? await extractTencentMeeting()
            : {};
    const title = siteSpecific.title || meta('meta[property="og:title"]', 'meta[name="twitter:title"]') || document.title;
    const author = siteSpecific.author || meta('meta[name="author"]', 'meta[property="article:author"]', '[rel="author"]');
    const publishedAt = siteSpecific.publishedAt || meta('meta[property="article:published_time"]', 'time[datetime]');
    const images = siteSpecific.images || imageInfo(root);
    const inlineContentSite = ["wechat", "newsletter", "web", "readwise", "zsxq", "jike"]
      .includes(siteType);
    const contentBlocks = inlineContentSite
      ? globalThis.ShuduContentBlocks?.extractContentBlocks(root, images) || []
      : [];
    const blockText = limitText(
      contentBlocks
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n\n")
    );
    const articleText = blockText || siteSpecific.text || limitText(root?.innerText || document.body?.innerText);

    return {
      url: canonicalUrl(),
      pageUrl: location.href,
      title: limitText(title, 300),
      author: limitText(author, 160),
      publishedAt: limitText(publishedAt, 100),
      description: siteSpecific.description || limitText(
        meta('meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'),
        3000
      ),
      text: articleText,
      images,
      contentBlocks,
      source: siteSpecific.source || meta('meta[property="og:site_name"]', 'meta[name="application-name"]') || location.hostname,
      siteName: meta('meta[property="og:site_name"]') || location.hostname,
      siteType,
      youtubeCaptionTracks: siteSpecific.youtubeCaptionTracks || [],
      youtubeTranscriptAvailable: Boolean(siteSpecific.youtubeTranscriptAvailable),
      tencentMeetingTranscript: siteSpecific.tencentMeetingTranscript || null,
      ...selected
    };
  }

  function extractFeedItemData(root) {
    const siteType = globalThis.ShuduFeedItem?.siteTypeForLocation(location);
    const item = globalThis.ShuduFeedItem?.extractItem(root, siteType, location);
    if (!item) throw new Error("没有识别到可收藏的单条内容");
    let images = [];
    try {
      images = imageInfo(root);
    } catch {
      // 图片结构异常不应阻止正文收藏，后续仍可保存这条文字内容。
    }
    const contentBlocks = [
      { type: "text", text: item.text },
      ...images.map((image) => ({ type: "image", url: image.url, alt: image.alt }))
    ];
    return {
      ...item,
      description: "",
      images,
      contentBlocks,
      selection: "",
      selectionContext: "",
      youtubeCaptionTracks: [],
      youtubeTranscriptAvailable: false,
      tencentMeetingTranscript: null
    };
  }

  let toolbarHost = null;
  let selectionSnapshot = null;
  let selectionTimer = 0;
  let toolbarBusy = false;
  let collectionEnabled = false;
  const refreshCollectionMode = () => globalThis.ShuduCollectionMode.isEnabled()
    .then((enabled) => { collectionEnabled = enabled; })
    .catch(() => { collectionEnabled = false; });
  refreshCollectionMode();
  const onCollectionModeChanged = (changes, area) => {
    if (area !== "local" || !changes[globalThis.ShuduCollectionMode.KEY]) return;
    collectionEnabled = false;
    hideToolbar();
    hideFeedToolbar();
    refreshCollectionMode();
  };
  chrome.storage.onChanged.addListener(onCollectionModeChanged);
  registerCleanup(() => chrome.storage.onChanged.removeListener(onCollectionModeChanged));
  const annotationManager = globalThis.ShuduAnnotations?.start({
    window,
    document,
    storage: chrome.storage.local,
    canonicalUrl,
    findArticleRoot,
    onUpdate: async (annotation) => {
      if (!await globalThis.ShuduCollectionMode.isEnabled()) return;
      const response = await chrome.runtime.sendMessage({
        type: "SYNC_ANNOTATION_NOTE",
        data: {
          url: canonicalUrl(),
          title: document.title,
          selection: annotation.quote,
          selectionContext: annotation.context,
          note: annotation.note
        }
      });
      if (!response?.ok) throw new Error(response?.error || "Obsidian 同步失败");
    }
  });
  if (annotationManager) registerCleanup(() => annotationManager.cleanup());

  function editableSelection(selection) {
    if (!selection?.rangeCount) return true;
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element?.closest?.("input, textarea, [contenteditable='true'], [role='textbox'], [data-shudu-translation], [data-shudu-translation-toast], [data-shudu-translation-anchor], [data-adhd-reader-ui='true']"));
  }

  function nearbySelectionImages(range) {
    const root = findArticleRoot();
    if (!root || !range || !globalThis.ShuduSelectionToolbar?.nearbyImageIndexes) return [];
    const selectionRect = range.getBoundingClientRect();
    const entries = contentImageEntries(root);
    const candidates = entries
      .map((entry, index) => {
        const rect = entry.element.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 80) return null;
        return { index, top: rect.top, bottom: rect.bottom };
      })
      .filter(Boolean);
    const maxDistance = Math.max(1200, window.innerHeight * 1.75);
    return globalThis.ShuduSelectionToolbar
      .nearbyImageIndexes(candidates, selectionRect, maxDistance)
      .map((index) => entries[index]?.image)
      .filter(Boolean)
      .map((image) => ({ ...image, selected: true }));
  }

  function currentSelectionSnapshot() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || editableSelection(selection)) return null;
    const data = selectionDataFrom(selection);
    if (!data.selection || data.selection.length < 2) return null;
    const range = selection.getRangeAt(0);
    const rects = [...range.getClientRects()];
    const rect = range.getBoundingClientRect();
    const anchor = globalThis.ShuduSelectionToolbar?.selectionAnchor(rects, rect) || rects.at(-1) || rect;
    if (!anchor) return null;
    return {
      ...data,
      range: range.cloneRange(),
      selectionBounds: { top: rect.top, bottom: rect.bottom },
      nearbyImages: nearbySelectionImages(range),
      rect: {
        top: anchor.top,
        right: anchor.right,
        bottom: anchor.bottom,
        left: anchor.left,
        width: anchor.width,
        height: anchor.height
      }
    };
  }

  function hideToolbar(force = false) {
    if (toolbarBusy && !force) return;
    toolbarHost?.remove();
    toolbarHost = null;
    selectionSnapshot = null;
  }

  function positionToolbar(rect) {
    if (!toolbarHost) return;
    requestAnimationFrame(() => {
      if (!toolbarHost) return;
      const width = toolbarHost.offsetWidth || 32;
      const height = toolbarHost.offsetHeight || 32;
      const position = globalThis.ShuduSelectionToolbar?.computeSelectionPosition(
        rect,
        { width, height },
        { width: window.innerWidth, height: window.innerHeight }
      );
      const left = position?.left ?? Math.max(8, Math.min(window.innerWidth - width - 8, rect.right + 8));
      const top = position?.top ?? Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom + 8));
      toolbarHost.style.left = `${left}px`;
      toolbarHost.style.top = `${top}px`;
    });
  }

  function toolbarStatus(shadow, message, state = "") {
    const status = shadow.querySelector("[data-status]");
    status.textContent = message;
    status.dataset.state = state;
    status.hidden = !message;
  }

  async function saveInlineSelection(shadow, note = "", options = {}) {
    const conceptMap = options.conceptMap === true;
    const personalize = options.personalize === true;
    if (!selectionSnapshot || toolbarBusy) return;
    const annotationStyle = options.annotationStyle;
    const selection = selectionSnapshot;
    const annotationKey = JSON.stringify([annotationStyle, limitText(note, 2000)]);
    let annotationSaved = annotationStyle && selection.savedAnnotationKey === annotationKey;
    const snapshot = {
      selection: selectionSnapshot.selection,
      selectionContext: selectionSnapshot.selectionContext,
      selectedImageUrls: (selectionSnapshot.nearbyImages || [])
        .filter((image) => image.selected !== false)
        .map((image) => image.url)
    };
    clearTimeout(selectionTimer);
    toolbarBusy = true;
    const buttons = [...shadow.querySelectorAll("button")];
    buttons.forEach((button) => { button.disabled = true; });
    toolbarStatus(shadow, "保存中…", "loading");
    try {
      const collect = await globalThis.ShuduCollectionMode.isEnabled();
      if (!collect && !annotationStyle) throw new Error("收藏同步已关闭，请在舒读中开启后再收藏");
      if (annotationStyle && !annotationSaved) {
        if (!annotationManager || !selection.range) {
          throw new Error("划线功能尚未加载，请刷新页面后重试");
        }
        await annotationManager.create({
          range: selection.range,
          style: annotationStyle,
          note: limitText(note, 2000),
          selectionContext: snapshot.selectionContext
        });
        selection.savedAnnotationKey = annotationKey;
        annotationSaved = true;
      }
      if (collect) {
      const pageData = {
        ...await extractPageData(),
        selection: snapshot.selection,
        selectionContext: snapshot.selectionContext
      };
      const data = globalThis.ShuduContentBlocks?.filterSelectionImages
        ? globalThis.ShuduContentBlocks.filterSelectionImages(pageData, snapshot.selectedImageUrls)
        : { ...pageData, images: [] };
      const response = await chrome.runtime.sendMessage({
        type: "INLINE_SAVE_SELECTION",
        data,
        note: limitText(note, 5000),
        conceptMap,
        personalize
      });
      if (!response?.ok) throw new Error(response?.error || "保存失败");
      }
      const savedMessage = !collect
        ? (note ? "批注已保存到本机" : "划线已保存到本机")
        : personalize
        ? "已收藏，正在分析和你的关系"
        : conceptMap
          ? "已收藏，概念地图同步中"
          : annotationStyle
            ? (note ? "已批注并收藏" : "已划线并收藏")
            : "已收藏";
      toolbarStatus(shadow, savedMessage, "success");
      setTimeout(() => {
        toolbarBusy = false;
        hideToolbar(true);
        if (annotationStyle) window.getSelection()?.removeAllRanges();
      }, 1100);
    } catch (error) {
      toolbarBusy = false;
      const message = /Extension context invalidated/i.test(error?.message || "")
        ? "扩展已更新，请刷新页面后重试"
        : error?.message || "保存失败";
      toolbarStatus(shadow, annotationSaved ? `划线已保存，收藏失败：${message}。请再点一次重试` : message, "error");
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function saveInlineAnnotation(shadow, style = "marker-yellow", note = "") {
    return saveInlineSelection(shadow, note, { annotationStyle: style });
  }

  function showToolbar(snapshot) {
    if (toolbarBusy) return;
    hideFeedToolbar(true);
    hideToolbar(true);
    selectionSnapshot = snapshot;
    toolbarHost = document.createElement("div");
    toolbarHost.id = "shudu-selection-toolbar-host";
    toolbarHost.dataset.adhdReaderUi = "true";
    toolbarHost.style.cssText = "position:fixed;left:8px;top:8px;z-index:2147483647;width:max-content;max-width:calc(100vw - 16px);font-family:Inter,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:0;";
    const shadow = toolbarHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; }
      :host { color-scheme: light; }
      .shell { display: flex; flex-direction: row-reverse; align-items: center; gap: 6px; }
      .surface { display: flex; align-items: center; gap: 4px; min-height: 42px; max-width: calc(100vw - 56px); padding: 5px; overflow-x: auto; scrollbar-width: none; border: 1px solid rgba(21, 57, 50, .18); border-radius: 8px; background: rgba(255, 255, 255, .97); box-shadow: 0 10px 30px rgba(25, 52, 47, .18), 0 2px 8px rgba(25, 52, 47, .1); backdrop-filter: blur(14px); animation: reveal .12s ease-out; transform-origin: right center; }
      .surface::-webkit-scrollbar { display: none; }
      .surface[hidden] { display: none; }
      button, input { font: inherit; }
      button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; border: 0; border-radius: 6px; padding: 0 9px; color: #20463f; background: transparent; cursor: pointer; font-size: 12px; font-weight: 700; white-space: nowrap; }
      button:hover { background: #e7f5f0; color: #0e6f64; }
      button:disabled { cursor: wait; opacity: .55; }
      .launcher { width: 32px; min-width: 32px; padding: 0; border: 1px solid rgba(21, 57, 50, .2); border-radius: 50%; color: #16877a; background: rgba(255, 255, 255, .98); box-shadow: 0 5px 16px rgba(25, 52, 47, .18), 0 1px 4px rgba(25, 52, 47, .12); backdrop-filter: blur(10px); }
      .launcher:hover, .launcher[aria-expanded="true"] { color: white; background: #16877a; }
      .launcher:focus-visible { outline: 2px solid #16877a; outline-offset: 2px; }
      .save-icon { width: 16px; height: 16px; color: #16877a; }
      .launcher:hover .save-icon, .launcher[aria-expanded="true"] .save-icon { color: currentColor; }
      .divider { width: 1px; height: 22px; background: rgba(21, 57, 50, .13); }
      .image-toggle { color: #315d55; background: #eef7f4; }
      .image-toggle[aria-expanded="true"] { color: white; background: #16877a; }
      .image-picker { display: flex; align-items: center; gap: 5px; padding: 2px; }
      .image-picker[hidden] { display: none; }
      .image-thumb { position: relative; width: 46px; min-width: 46px; height: 32px; padding: 0; overflow: hidden; border-radius: 5px; background: #eef1ef; opacity: 1; transition-property: opacity, transform; transition-duration: 120ms; transition-timing-function: cubic-bezier(.2, 0, 0, 1); }
      .image-thumb:active { transform: scale(.96); }
      .image-thumb[aria-pressed="false"] { opacity: .38; }
      .image-thumb img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; outline: 1px solid oklch(0 0 0 / .1); outline-offset: -1px; }
      .image-check { position: absolute; top: 2px; right: 2px; display: grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; color: white; background: #16877a; box-shadow: 0 1px 4px rgba(9, 65, 58, .28); font-size: 10px; line-height: 1; }
      .image-thumb[aria-pressed="false"] .image-check { display: none; }
      .mark { width: 29px; min-width: 29px; padding: 0; }
      .swatch { display: block; width: 18px; height: 8px; border-radius: 2px; background: rgba(255, 211, 58, .72); }
      .mark[data-style="underline-blue"] .swatch { height: 10px; border-bottom: 2px solid #3d83d5; border-radius: 0; background: transparent; }
      .mark[data-style="marker-green"] .swatch { background: rgba(76, 181, 135, .58); }
      .mark[data-style="wavy-red"] .swatch { height: 7px; border-radius: 0; background: #d95b4f; clip-path: polygon(0 55%, 14% 10%, 28% 55%, 42% 100%, 56% 55%, 70% 10%, 84% 55%, 100% 100%, 100% 72%, 84% 28%, 70% 72%, 56% 100%, 42% 72%, 28% 28%, 14% 72%, 0 100%); }
      .annotate-icon { color: #16877a; font-size: 14px; line-height: 1; }
      .note-icon { font-size: 18px; line-height: 1; }
      .personal-icon { color: #7d54a6; font-size: 14px; font-weight: 800; line-height: 1; }
      .concept-icon { color: #c65a38; font-size: 15px; font-weight: 800; line-height: 1; }
      .status { max-width: 180px; padding: 0 7px; color: #59716c; font-size: 11px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .status[data-state="success"] { color: #0e766a; font-weight: 700; }
      .status[data-state="error"] { color: #a73a27; }
      .composer { display: flex; align-items: center; gap: 6px; padding-left: 2px; }
      .composer[hidden] { display: none; }
      input { width: min(230px, 42vw); height: 32px; border: 1px solid rgba(21, 57, 50, .2); border-radius: 6px; padding: 0 9px; color: #18342f; background: white; outline: none; font-size: 12px; }
      input:focus { border-color: #16877a; box-shadow: 0 0 0 2px rgba(22, 135, 122, .12); }
      .save-note { color: white; background: #16877a; }
      .save-note:hover { color: white; background: #10756a; }
      :host { color-scheme: light dark; --bar-bg: rgba(255,255,255,.97); --bar-ink: #2f3c43; --bar-hover: #edf3f2; --bar-accent: #286657; }
      .surface { padding: 6px; gap: 3px; border: 0; border-radius: 14px; background: var(--bar-bg); box-shadow: 0 0 0 1px rgba(0,0,0,.07), 0 6px 24px rgba(0,0,0,.12); animation: none; }
      button { min-width: 34px; height: 34px; border-radius: 8px; color: var(--bar-ink); font-weight: 550; }
      button:hover { background: var(--bar-hover); color: var(--bar-accent); }
      button:focus-visible { outline: 2px solid var(--bar-accent); outline-offset: -2px; }
      button[data-action="save"] { background: var(--bar-hover); color: var(--bar-accent); font-weight: 650; }
      .launcher { width: 34px; min-width: 34px; height: 34px; border: 0; background: var(--bar-bg); box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 3px 12px rgba(0,0,0,.1); }
      .launcher[aria-expanded="true"] { color: var(--bar-accent); background: var(--bar-bg); }
      .mark .swatch { width: 18px; height: 9px; border-radius: 3px; background: rgba(242,195,66,.45); }
      .mark[data-style="marker-green"] .swatch { background: rgba(78,172,136,.4); }
      .mark[data-style="underline-blue"] .swatch { border-bottom: 1.5px solid rgba(61,131,213,.6); }
      .mark[data-style="wavy-red"] .swatch { opacity: .65; }
      .divider { height: 18px; flex-shrink: 0; }
      .status { color: var(--bar-ink); }
      @media (prefers-color-scheme: dark) {
        :host { --bar-bg: rgba(36,42,48,.98); --bar-ink: #e6ebef; --bar-hover: #33473f; --bar-accent: #9bd4be; }
        .surface, .launcher { box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 6px 24px rgba(0,0,0,.24); }
        .save-icon, .annotate-icon { color: var(--bar-accent); }
        .image-toggle { background: var(--bar-hover); color: var(--bar-ink); }
        input { background: #242a30; color: #e6ebef; border-color: #53606a; }
        .status[data-state="success"] { color: #9bd4be; }
        .status[data-state="error"] { color: #f2a798; }
      }
      @media (prefers-reduced-motion: reduce) { .surface { animation: none; } }
    `;

    const textSpan = (text, className = "") => {
      const span = document.createElement("span");
      span.textContent = text;
      if (className) span.className = className;
      return span;
    };
    const actionButton = (action, title) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.title = title;
      return button;
    };

    const shell = document.createElement("div");
    shell.className = "shell";
    const surface = document.createElement("div");
    surface.className = "surface";
    surface.id = "shudu-selection-actions";
    surface.hidden = true;
    surface.setAttribute("role", "toolbar");
    surface.setAttribute("aria-label", "舒读划线、批注与收藏");

    const launcher = actionButton("toggle", "展开划线收藏菜单");
    launcher.className = "launcher";
    launcher.setAttribute("aria-label", "展开划线收藏菜单");
    launcher.setAttribute("aria-controls", surface.id);
    launcher.setAttribute("aria-expanded", "false");

    const saveButton = actionButton("save", "收藏这段划线并生成辅助消化建议");
    const saveIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    saveIcon.setAttribute("class", "save-icon");
    saveIcon.setAttribute("viewBox", "0 0 24 24");
    saveIcon.setAttribute("aria-hidden", "true");
    saveIcon.setAttribute("fill", "none");
    saveIcon.setAttribute("stroke", "currentColor");
    saveIcon.setAttribute("stroke-width", "2");
    saveIcon.setAttribute("stroke-linecap", "round");
    saveIcon.setAttribute("stroke-linejoin", "round");
    const savePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    savePath.setAttribute("d", "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z");
    saveIcon.append(savePath);
    launcher.append(saveIcon.cloneNode(true));
    saveButton.append(saveIcon, textSpan("收藏"));

    const personalButton = actionButton("personal", "收藏并分析它和我的关系、我可以怎么使用");
    const personalIcon = textSpan("◎", "personal-icon");
    personalIcon.setAttribute("aria-hidden", "true");
    personalButton.append(personalIcon, textSpan("关联"));

    const conceptButton = actionButton("concept", "收藏这段划线，并补充 Shudu 概念地图");
    const conceptIcon = textSpan("◇", "concept-icon");
    conceptIcon.setAttribute("aria-hidden", "true");
    conceptButton.append(conceptIcon, textSpan("概念"));

    const divider = textSpan("", "divider");
    divider.setAttribute("aria-hidden", "true");

    const markButtons = (globalThis.ShuduAnnotations?.STYLE_IDS || []).map((markStyle) => {
      const button = actionButton("mark", globalThis.ShuduAnnotations.STYLE_LABELS[markStyle]);
      button.className = "mark";
      button.dataset.style = markStyle;
      button.setAttribute("aria-label", globalThis.ShuduAnnotations.STYLE_LABELS[markStyle]);
      button.append(textSpan("", "swatch"));
      return button;
    });

    const annotateButton = actionButton("annotate", "添加划线批注");
    annotateButton.append(textSpan("✎", "annotate-icon"), textSpan("批注"));

    const noteButton = actionButton("note", "添加备注后收藏");
    noteButton.setAttribute("aria-label", "添加备注后收藏");
    const noteIcon = textSpan("＋", "note-icon");
    noteIcon.setAttribute("aria-hidden", "true");
    noteButton.append(noteIcon);

    const nearbyImages = selectionSnapshot.nearbyImages || [];
    const imageToggle = actionButton("images", "选择随划线一起收藏的附近图片");
    imageToggle.className = "image-toggle";
    imageToggle.setAttribute("aria-expanded", "false");
    imageToggle.hidden = nearbyImages.length === 0;
    const imagePicker = document.createElement("div");
    imagePicker.className = "image-picker";
    imagePicker.dataset.imagePicker = "";
    imagePicker.hidden = true;
    nearbyImages.forEach((image, index) => {
      const option = actionButton("image-option", image.alt || `附近图片 ${index + 1}`);
      option.className = "image-thumb";
      option.dataset.imageIndex = String(index);
      option.setAttribute("aria-pressed", String(image.selected !== false));
      const preview = document.createElement("img");
      preview.src = image.url;
      preview.alt = "";
      preview.loading = "lazy";
      preview.referrerPolicy = "no-referrer";
      const check = textSpan("✓", "image-check");
      check.setAttribute("aria-hidden", "true");
      option.append(preview, check);
      imagePicker.append(option);
    });

    const composer = document.createElement("div");
    composer.className = "composer";
    composer.dataset.composer = "";
    composer.hidden = true;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 500;
    input.placeholder = "写下为什么收藏，可留空";
    input.setAttribute("aria-label", "收藏备注");
    const saveNoteButton = actionButton("save-note", "保存收藏备注");
    saveNoteButton.className = "save-note";
    saveNoteButton.textContent = "保存";
    composer.append(input, saveNoteButton);

    const status = textSpan("", "status");
    status.dataset.status = "";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    surface.append(
      saveButton,
      ...markButtons,
      annotateButton,
      divider.cloneNode(true),
      imageToggle,
      imagePicker,
      personalButton,
      conceptButton,
      divider,
      noteButton,
      composer,
      status
    );
    shell.append(launcher, surface);
    if (!collectionEnabled) {
      surface.replaceChildren(...markButtons, annotateButton, composer, status);
      launcher.title = "展开划线批注菜单";
      launcher.setAttribute("aria-label", launcher.title);
    }
    shadow.append(style, shell);
    document.documentElement.append(toolbarHost);

    shadow.querySelectorAll("button").forEach((button) => {
      button.addEventListener("pointerdown", (event) => event.preventDefault());
    });
    const updateImageToggle = () => {
      const selectedCount = nearbyImages.filter((image) => image.selected !== false).length;
      imageToggle.textContent = `图片 ${selectedCount}/${nearbyImages.length}`;
      imageToggle.setAttribute(
        "aria-label",
        `已选择 ${selectedCount} 张附近图片，共 ${nearbyImages.length} 张；点击调整`
      );
    };
    updateImageToggle();
    const setExpanded = (expanded) => {
      surface.hidden = !expanded;
      launcher.setAttribute("aria-expanded", String(expanded));
      const menuName = collectionEnabled ? "划线收藏菜单" : "划线批注菜单";
      launcher.setAttribute("aria-label", `${expanded ? "收起" : "展开"}${menuName}`);
      launcher.title = launcher.getAttribute("aria-label");
      positionToolbar(snapshot.rect);
    };
    launcher.addEventListener("click", () => {
      setExpanded(launcher.getAttribute("aria-expanded") !== "true");
    });
    imageToggle.addEventListener("click", () => {
      const expanded = imageToggle.getAttribute("aria-expanded") !== "true";
      imageToggle.setAttribute("aria-expanded", String(expanded));
      imagePicker.hidden = !expanded;
      positionToolbar(snapshot.rect);
    });
    shadow.querySelectorAll('[data-action="image-option"]').forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.imageIndex);
        const image = nearbyImages[index];
        if (!image) return;
        image.selected = image.selected === false;
        button.setAttribute("aria-pressed", String(image.selected));
        updateImageToggle();
      });
    });
    saveButton.addEventListener("click", () => {
      saveInlineSelection(shadow);
    });
    personalButton.addEventListener("click", () => {
      saveInlineSelection(shadow, "", { personalize: true });
    });
    conceptButton.addEventListener("click", () => {
      saveInlineSelection(shadow, "", { conceptMap: true });
    });
    shadow.querySelectorAll('[data-action="mark"]').forEach((button) => {
      button.addEventListener("click", () => saveInlineAnnotation(shadow, button.dataset.style));
    });
    shadow.querySelector('[data-action="annotate"]').addEventListener("click", () => {
      const composer = shadow.querySelector("[data-composer]");
      composer.hidden = false;
      composer.dataset.mode = "annotation";
      input.maxLength = 2000;
      input.placeholder = "写下你的想法（可留空）";
      input.setAttribute("aria-label", "划线批注");
      saveNoteButton.textContent = "存批注";
      shadow.querySelector('[data-action="annotate"]').hidden = true;
      noteButton.hidden = false;
      toolbarStatus(shadow, "");
      requestAnimationFrame(() => {
        input.focus();
        positionToolbar(snapshot.rect);
      });
    });
    noteButton.addEventListener("click", () => {
      const composer = shadow.querySelector("[data-composer]");
      composer.hidden = false;
      composer.dataset.mode = "collection";
      input.maxLength = 500;
      input.placeholder = "写下为什么收藏，可留空";
      input.setAttribute("aria-label", "收藏备注");
      saveNoteButton.textContent = "保存";
      shadow.querySelector('[data-action="note"]').hidden = true;
      shadow.querySelector('[data-action="annotate"]').hidden = false;
      toolbarStatus(shadow, "");
      requestAnimationFrame(() => {
        shadow.querySelector("input").focus();
        positionToolbar(snapshot.rect);
      });
    });
    const noteInput = shadow.querySelector("input");
    const saveNote = () => composer.dataset.mode === "annotation"
      ? saveInlineAnnotation(shadow, "marker-yellow", noteInput.value)
      : saveInlineSelection(shadow, noteInput.value);
    shadow.querySelector('[data-action="save-note"]').addEventListener("click", saveNote);
    noteInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveNote();
      }
      if (event.key === "Escape") hideToolbar();
    });
    positionToolbar(snapshot.rect);
  }

  function scheduleToolbar() {
    if (toolbarBusy) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const snapshot = currentSelectionSnapshot();
      if (snapshot) showToolbar(snapshot);
      else hideToolbar();
    }, 80);
  }

  addManagedListener(document, "pointerup", (event) => {
    if (toolbarHost && event.composedPath().includes(toolbarHost)) return;
    scheduleToolbar();
  }, true);
  addManagedListener(document, "keyup", (event) => {
    if (event.key === "Escape") hideToolbar();
    else scheduleToolbar();
  }, true);
  addManagedListener(document, "pointerdown", (event) => {
    if (toolbarHost && !event.composedPath().includes(toolbarHost)) hideToolbar();
  }, true);
  addManagedListener(window, "scroll", hideToolbar, true);
  addManagedListener(window, "resize", hideToolbar);
  registerCleanup(() => {
    clearTimeout(selectionTimer);
    toolbarHost?.remove();
    toolbarHost = null;
    selectionSnapshot = null;
  });

  let feedToolbarHost = null;
  let feedItemRoot = null;
  let feedItemSnapshot = null;
  let feedItemSnapshotError = "";
  let feedToolbarBusy = false;
  let feedToolbarExpanded = false;
  let feedHideTimer = 0;

  function feedSiteType() {
    return globalThis.ShuduFeedItem?.siteTypeForLocation(location) || "";
  }

  function hideFeedToolbar(force = false) {
    if (feedToolbarBusy && !force) return;
    clearTimeout(feedHideTimer);
    feedHideTimer = 0;
    if (feedToolbarHost) {
      feedToolbarHost.hidden = true;
      const shadow = feedToolbarHost.shadowRoot;
      const launcher = shadow?.querySelector('[data-action="toggle"]');
      const surface = shadow?.querySelector(".surface");
      if (launcher) {
        launcher.setAttribute("aria-expanded", "false");
        launcher.setAttribute("aria-label", "展开单条收藏菜单");
        launcher.title = "展开单条收藏菜单";
      }
      if (surface) surface.hidden = true;
      if (shadow) feedToolbarStatus(shadow, "");
    }
    feedItemRoot = null;
    feedItemSnapshot = null;
    feedItemSnapshotError = "";
    feedToolbarExpanded = false;
  }

  function scheduleFeedToolbarHide(delay = 350) {
    if (feedToolbarBusy || feedToolbarExpanded) return;
    clearTimeout(feedHideTimer);
    feedHideTimer = setTimeout(() => hideFeedToolbar(), delay);
  }

  function keepFeedToolbarVisible() {
    clearTimeout(feedHideTimer);
    feedHideTimer = 0;
  }

  function positionFeedToolbar() {
    if (!feedToolbarHost || !feedItemRoot?.isConnected) return;
    requestAnimationFrame(() => {
      if (!feedToolbarHost || !feedItemRoot?.isConnected) return;
      const rect = feedItemRoot.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        hideFeedToolbar();
        return;
      }
      const position = globalThis.ShuduFeedItem?.computeLauncherPosition(
        rect,
        {
          width: feedToolbarHost.offsetWidth || 32,
          height: feedToolbarHost.offsetHeight || 32
        },
        { width: window.innerWidth, height: window.innerHeight }
      );
      feedToolbarHost.style.left = `${position?.left ?? Math.max(8, rect.right - 44)}px`;
      feedToolbarHost.style.top = `${position?.top ?? Math.max(8, rect.top + 12)}px`;
    });
  }

  function feedToolbarStatus(shadow, message, state = "") {
    const status = shadow.querySelector("[data-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
    status.hidden = !message;
  }

  function refreshFeedItemSnapshot() {
    if (!feedItemRoot?.isConnected) {
      feedItemSnapshot = null;
      feedItemSnapshotError = "这条内容已离开页面，请重新移到正文上";
      return false;
    }
    try {
      feedItemSnapshot = extractFeedItemData(feedItemRoot);
      feedItemSnapshotError = "";
      return true;
    } catch (error) {
      feedItemSnapshot = null;
      feedItemSnapshotError = error?.message || "没有识别到可收藏的单条内容";
      return false;
    }
  }

  async function saveInlineFeedItem(shadow, options = {}) {
    if (feedToolbarBusy) return;
    if (!feedItemSnapshot && !refreshFeedItemSnapshot()) {
      feedToolbarStatus(
        shadow,
        feedItemSnapshotError || "这条内容暂时读取不到，请把鼠标移到正文上重试",
        "error"
      );
      return;
    }
    const data = feedItemSnapshot;
    feedToolbarBusy = true;
    const buttons = [...shadow.querySelectorAll("button")];
    buttons.forEach((button) => { button.disabled = true; });
    feedToolbarStatus(shadow, "保存中…", "loading");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "INLINE_SAVE_FEED_ITEM",
        data,
        personalize: options.personalize === true,
        conceptMap: options.conceptMap === true
      });
      if (!response?.ok) throw new Error(response?.error || "保存失败");
      const message = options.personalize
        ? "已收藏，正在分析和你的关系"
        : options.conceptMap
          ? "已收藏，概念地图同步中"
          : "已收藏";
      feedToolbarStatus(shadow, message, "success");
      setTimeout(() => {
        feedToolbarBusy = false;
        buttons.forEach((button) => { button.disabled = false; });
        hideFeedToolbar(true);
      }, 1100);
    } catch (error) {
      feedToolbarBusy = false;
      const message = /Extension context invalidated/i.test(error?.message || "")
        ? "扩展已更新，请刷新页面后重试"
        : error?.message || "保存失败";
      feedToolbarStatus(shadow, message, "error");
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function showFeedToolbar(root) {
    if (!collectionEnabled || !root || feedToolbarBusy) return;
    keepFeedToolbarVisible();
    if (feedToolbarHost && !feedToolbarHost.hidden && feedItemRoot === root) {
      if (!feedItemSnapshot) refreshFeedItemSnapshot();
      positionFeedToolbar();
      return;
    }
    hideToolbar(true);
    hideFeedToolbar(true);
    feedItemRoot = root;
    refreshFeedItemSnapshot();
    if (feedToolbarHost) {
      feedToolbarHost.hidden = false;
      positionFeedToolbar();
      return;
    }
    feedToolbarHost = document.createElement("div");
    feedToolbarHost.id = "shudu-feed-toolbar-host";
    feedToolbarHost.dataset.adhdReaderUi = "true";
    feedToolbarHost.style.cssText = "position:fixed;left:8px;top:8px;z-index:2147483646;width:max-content;max-width:calc(100vw - 16px);font-family:Inter,'PingFang SC','Microsoft YaHei',sans-serif;letter-spacing:0;";
    const shadow = feedToolbarHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; }
      :host { color-scheme: light; }
      .shell { display: flex; align-items: center; gap: 6px; }
      .surface { display: flex; align-items: center; gap: 4px; min-height: 40px; padding: 4px; border: 1px solid rgba(21,57,50,.18); border-radius: 8px; background: rgba(255,255,255,.98); box-shadow: 0 8px 24px rgba(25,52,47,.16), 0 1px 5px rgba(25,52,47,.1); backdrop-filter: blur(12px); animation: reveal .12s ease-out; }
      .surface[hidden] { display: none; }
      button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; border: 0; border-radius: 6px; padding: 0 9px; color: #20463f; background: transparent; cursor: pointer; font: 700 12px/1 Inter,'PingFang SC','Microsoft YaHei',sans-serif; white-space: nowrap; }
      button:hover { color: #0e6f64; background: #e7f5f0; }
      button:focus-visible { outline: 2px solid #16877a; outline-offset: 2px; }
      button:disabled { cursor: wait; opacity: .55; }
      .launcher { width: 32px; min-width: 32px; padding: 0; border: 1px solid rgba(21,57,50,.2); border-radius: 50%; color: #16877a; background: rgba(255,255,255,.98); box-shadow: 0 5px 16px rgba(25,52,47,.18), 0 1px 4px rgba(25,52,47,.12); }
      .launcher:hover, .launcher[aria-expanded="true"] { color: #fff; background: #16877a; }
      svg { width: 16px; height: 16px; }
      .personal-icon { color: #7d54a6; font-size: 14px; font-weight: 800; }
      .concept-icon { color: #c65a38; font-size: 15px; font-weight: 800; }
      .status { max-width: 180px; padding: 0 7px; color: #59716c; font-size: 11px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .status[data-state="success"] { color: #0e766a; font-weight: 700; }
      .status[data-state="error"] { color: #a73a27; }
      @keyframes reveal { from { opacity: 0; transform: translateX(3px) scale(.98); } to { opacity: 1; transform: translateX(0) scale(1); } }
      @media (prefers-reduced-motion: reduce) { .surface { animation: none; } }
    `;
    const actionButton = (action, title) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.title = title;
      return button;
    };
    const textSpan = (text, className = "") => {
      const span = document.createElement("span");
      span.textContent = text;
      if (className) span.className = className;
      return span;
    };
    const bookmarkIcon = () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z");
      svg.append(path);
      return svg;
    };
    const shell = document.createElement("div");
    shell.className = "shell";
    const launcher = actionButton("toggle", "展开单条收藏菜单");
    launcher.className = "launcher";
    launcher.setAttribute("aria-label", "展开单条收藏菜单");
    launcher.setAttribute("aria-expanded", "false");
    launcher.append(bookmarkIcon());
    const surface = document.createElement("div");
    surface.className = "surface";
    surface.hidden = true;
    surface.setAttribute("role", "toolbar");
    surface.setAttribute("aria-label", "Shudu 单条内容收藏");
    const save = actionButton("save", "收藏这一条内容");
    save.append(bookmarkIcon(), textSpan("收藏"));
    const personal = actionButton("personal", "收藏并分析它和我的关系、我可以怎么使用");
    personal.append(textSpan("◎", "personal-icon"), textSpan("关联"));
    const concept = actionButton("concept", "收藏这一条并补充 Shudu 概念地图");
    concept.append(textSpan("◇", "concept-icon"), textSpan("概念"));
    const status = textSpan("", "status");
    status.dataset.status = "";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    surface.append(save, personal, concept, status);
    shell.append(launcher, surface);
    shadow.append(style, shell);
    document.documentElement.append(feedToolbarHost);
    feedToolbarHost.addEventListener("pointerenter", keepFeedToolbarVisible);
    feedToolbarHost.addEventListener("pointerleave", () => scheduleFeedToolbarHide());

    shadow.querySelectorAll("button").forEach((button) => {
      button.addEventListener("pointerdown", (event) => event.preventDefault());
    });
    launcher.addEventListener("click", () => {
      feedToolbarExpanded = launcher.getAttribute("aria-expanded") !== "true";
      launcher.setAttribute("aria-expanded", String(feedToolbarExpanded));
      launcher.setAttribute("aria-label", feedToolbarExpanded ? "收起单条收藏菜单" : "展开单条收藏菜单");
      launcher.title = feedToolbarExpanded ? "收起单条收藏菜单" : "展开单条收藏菜单";
      surface.hidden = !feedToolbarExpanded;
      if (feedToolbarExpanded && !feedItemSnapshot) {
        refreshFeedItemSnapshot();
        feedToolbarStatus(
          shadow,
          feedItemSnapshot ? "" : feedItemSnapshotError || "这条内容暂时读取不到，请把鼠标移到正文上重试",
          feedItemSnapshot ? "" : "error"
        );
      }
      positionFeedToolbar();
    });
    save.addEventListener("click", () => saveInlineFeedItem(shadow));
    personal.addEventListener("click", () => saveInlineFeedItem(shadow, { personalize: true }));
    concept.addEventListener("click", () => saveInlineFeedItem(shadow, { conceptMap: true }));
    positionFeedToolbar();
  }

  const activeFeedSiteType = feedSiteType();
  if (activeFeedSiteType) {
    addManagedListener(document, "pointerover", (event) => {
      if (!collectionEnabled) return;
      if (feedToolbarBusy || feedToolbarExpanded) return;
      if (feedToolbarHost && event.composedPath().includes(feedToolbarHost)) {
        keepFeedToolbarVisible();
        return;
      }
      if (!window.getSelection()?.isCollapsed) return;
      if (feedItemRoot?.isConnected && feedItemRoot.contains(event.target)) {
        keepFeedToolbarVisible();
        if (feedToolbarHost?.hidden) feedToolbarHost.hidden = false;
        positionFeedToolbar();
        return;
      }
      const root = globalThis.ShuduFeedItem?.findItemRoot(
        event.target,
        activeFeedSiteType,
        window.innerHeight
      );
      if (root) showFeedToolbar(root);
      else scheduleFeedToolbarHide();
    }, true);
    addManagedListener(document, "focusin", (event) => {
      if (feedToolbarBusy || feedToolbarExpanded) return;
      const root = globalThis.ShuduFeedItem?.findItemRoot(
        event.target,
        activeFeedSiteType,
        window.innerHeight
      );
      if (root) showFeedToolbar(root);
    }, true);
    addManagedListener(document, "pointerdown", (event) => {
      if (feedToolbarHost && !event.composedPath().includes(feedToolbarHost)) hideFeedToolbar();
    }, true);
    addManagedListener(document, "keyup", (event) => {
      if (event.key === "Escape") hideFeedToolbar();
    }, true);
    addManagedListener(window, "scroll", () => hideFeedToolbar(), true);
    addManagedListener(window, "resize", () => hideFeedToolbar());
  }
  registerCleanup(() => {
    clearTimeout(feedHideTimer);
    feedToolbarHost?.remove();
    feedToolbarHost = null;
    feedItemRoot = null;
    feedItemSnapshot = null;
    feedItemSnapshotError = "";
  });

  async function localApi(path, body) {
    await globalThis.ShuduCollectionMode.requireEnabled();
    const response = await fetch(`${LOCAL_API_ROOT}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `本地阅读服务错误：HTTP ${response.status}`);
    }
    return data;
  }

  function findShelfMatch(value, issueNo, depth = 0, seen = new Set()) {
    if (!value || depth > 9 || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    if (!Array.isArray(value)) {
      const book = value.book && typeof value.book === "object" ? value.book : {};
      const title = String(value.title || value.bookTitle || value.name || book.title || "");
      if (title.includes(issueNo)) {
        const bookId = String(value.bookId || book.bookId || "");
        return {
          title,
          url: bookId ? `https://weread.qq.com/web/reader/${bookId}` : ""
        };
      }
    }
    for (const nested of Object.values(value)) {
      const match = findShelfMatch(nested, issueNo, depth + 1, seen);
      if (match) return match;
    }
    return null;
  }

  async function findIssueOnShelf(issueNo) {
    try {
      const response = await fetch("/mp/shelf/shelfFull", {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) return null;
      return findShelfMatch(await response.json(), issueNo);
    } catch {
      return null;
    }
  }

  function pageText() {
    return String(document.body?.innerText || "").replace(/\s+/g, " ");
  }

  function uploadResultLink(issueNo) {
    const links = [...document.querySelectorAll('a[href*="/web/reader/"]')];
    return links.find((link) => {
      const nearby = `${link.textContent || ""} ${link.parentElement?.textContent || ""}`;
      return nearby.includes(issueNo) || /立即阅读/.test(nearby);
    })?.href || "";
  }

  function waitForUploadResult(item, timeoutMs = 150000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const text = pageText();
        const mentionsIssue = text.includes(item.issueNo) || text.includes(item.fileName);
        if (mentionsIssue && /导入完成|导入成功|上传成功/.test(text)) {
          clearInterval(timer);
          resolve({ status: "uploaded", wereadUrl: uploadResultLink(item.issueNo) });
          return;
        }
        if (mentionsIssue && /已存在|重复导入|书架中已有/.test(text)) {
          clearInterval(timer);
          resolve({ status: "already_present", wereadUrl: uploadResultLink(item.issueNo) });
          return;
        }
        if (mentionsIssue && /导入失败|上传失败|格式错误|文件损坏/.test(text)) {
          clearInterval(timer);
          resolve({ status: "failed", reason: "微信读书页面显示导入失败" });
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve({ status: "failed", reason: "等待微信读书导入结果超时" });
        }
      }, 700);
    });
  }

  async function reportWereadResult(item, result) {
    return localApi("/weread-upload-result", {
      issueNo: item.issueNo,
      status: result.status,
      wereadUrl: result.wereadUrl || "",
      reason: result.reason || ""
    });
  }

  async function uploadWereadItem(item) {
    const shelfMatch = await findIssueOnShelf(item.issueNo);
    if (shelfMatch) {
      const result = { status: "already_present", wereadUrl: shelfMatch.url };
      await reportWereadResult(item, result);
      return result;
    }

    const input = document.querySelector('input[type="file"]');
    if (!input) {
      const result = {
        status: "blocked",
        reason: "微信读书登录失效，或官方上传控件尚未加载"
      };
      await reportWereadResult(item, result);
      return result;
    }

    const response = await fetch(`${LOCAL_API_ROOT}${item.fileUrl}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`读取 ${item.issueNo} EPUB 失败：HTTP ${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], item.fileName, {
      type: "application/epub+zip",
      lastModified: Date.now()
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const result = await waitForUploadResult(item);
    await reportWereadResult(item, result);
    return result;
  }

  async function runWereadSync() {
    if (location.hostname !== "weread.qq.com" || !location.pathname.startsWith("/web/upload")) {
      throw new Error("请在微信读书官方上传页执行同步");
    }
    if (globalThis.__SHUDU_WEREAD_SYNC_RUNNING__) {
      return globalThis.__SHUDU_WEREAD_SYNC_RUNNING__;
    }

    globalThis.__SHUDU_WEREAD_SYNC_RUNNING__ = (async () => {
      const queue = await localApi("/weread-upload-queue");
      const items = Array.isArray(queue.items) ? queue.items.slice(0, 3) : [];
      const summary = {
        total: items.length,
        uploaded: 0,
        alreadyPresent: 0,
        failed: 0,
        blocked: false,
        reason: ""
      };
      for (const item of items) {
        try {
          const result = await uploadWereadItem(item);
          if (result.status === "uploaded") summary.uploaded += 1;
          else if (result.status === "already_present") summary.alreadyPresent += 1;
          else if (result.status === "blocked") {
            summary.blocked = true;
            summary.reason = result.reason;
            break;
          } else {
            summary.failed += 1;
          }
          await chrome.runtime.sendMessage({
            type: "WEREAD_SYNC_PROGRESS",
            uploaded: summary.uploaded,
            alreadyPresent: summary.alreadyPresent,
            failed: summary.failed
          }).catch(() => {});
        } catch (error) {
          summary.failed += 1;
          summary.reason = error.message;
          await reportWereadResult(item, {
            status: "failed",
            reason: error.message
          }).catch(() => {});
        }
      }
      return summary;
    })();

    try {
      return await globalThis.__SHUDU_WEREAD_SYNC_RUNNING__;
    } finally {
      globalThis.__SHUDU_WEREAD_SYNC_RUNNING__ = null;
    }
  }

  const runtimeMessageListener = (message, _sender, sendResponse) => {
    if (
      message?.type === "SHUDU_EXTRACT_PAGE" ||
      message?.type === "SHUDU_EXTRACT_PAGE_149" ||
      message?.type === "SHUDU_EXTRACT_PAGE_1410" ||
      message?.type === "SHUDU_EXTRACT_PAGE_1411" ||
      message?.type === "SHUDU_EXTRACT_PAGE_1412" ||
      message?.type === "SHUDU_EXTRACT_PAGE_1413" ||
      message?.type === "SHUDU_EXTRACT_PAGE_1414" ||
      message?.type === "SHUDU_EXTRACT_PAGE_1415" ||
      message?.type === "SHUDU_EXTRACT_PAGE_1416" ||
      message?.type === "SHUDU_EXTRACT_PAGE_150"
    ) {
      extractPageData()
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "SHUDU_WEREAD_SYNC") {
      runWereadSync()
        .then((summary) => sendResponse({ ok: true, summary }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    return undefined;
  };
  chrome.runtime.onMessage.addListener(runtimeMessageListener);
  registerCleanup(() => chrome.runtime.onMessage.removeListener(runtimeMessageListener));

  if (false /* Enable only with an explicitly configured companion */ && location.hostname === "weread.qq.com" && location.pathname.startsWith("/web/upload")) {
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "WEREAD_SYNC_NOW" }).catch(() => {});
    }, 1200);
  }
})();
