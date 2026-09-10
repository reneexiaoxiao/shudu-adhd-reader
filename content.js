(() => {
  "use strict";

  const CONTENT_VERSION = "0.5.1";
  if (globalThis.__SHUDU_READER_CONTENT_VERSION__ === CONTENT_VERSION) return;
  if (globalThis.__SHUDU_READER_LOADED__ && !globalThis.__SHUDU_READER_CONTENT_VERSION__) return;
  const previousCleanup = globalThis.__SHUDU_READER_CLEANUP__;
  if (typeof previousCleanup === "function") {
    try {
      previousCleanup();
    } catch {
      // The previous extension context may already be invalidated.
    }
  }
  globalThis.__SHUDU_READER_CONTENT_VERSION__ = CONTENT_VERSION;
  globalThis.__SHUDU_READER_LOADED__ = true;

  const ROOT_CLASS = "adhd-reader-enabled";
  const SETTINGS_KEY = "adhdReaderSettings";
  const TARGET_ATTR = "data-adhd-reader-target";
  const DEFAULTS = Object.freeze({
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
  });

  const SITE_LABELS = {
    wechat: "微信公众号",
    jike: "即刻",
    x: "X / Twitter",
    neican: "AI 内参",
    generic: "普通文章页"
  };
  const SITE_WIDTH_CAPS = { wechat: 2400, jike: 1400, x: 960, neican: 1800, generic: 1100 };
  const GENERIC_ARTICLE_SELECTOR = [
    "article",
    "[itemprop='articleBody']",
    ".entry-content",
    ".post-content",
    ".post-body",
    ".article-content",
    ".article-body",
    ".blog-content",
    ".story-content",
    ".story-body",
    ".prose",
    ".markdown-body"
  ].join(", ");
  const GENERIC_DISCOVERY_SELECTOR = `${GENERIC_ARTICLE_SELECTOR}, main, [role='main']`;
  const FONT_TARGET_SELECTOR = "p, section, div, span, strong, em, blockquote, ul, ol, li, a, h1, h2, h3, h4, h5, h6";
  const MUTATION_IGNORE_SELECTOR = "#shudu-selection-toolbar-host, #shudu-feed-toolbar-host, #shudu-annotation-layer-host, [data-adhd-reader-ui='true'], [data-shudu-translation], [data-shudu-translation-toast], [data-shudu-translation-anchor]";
  const FONT_STACKS = Object.freeze({
    torch: '"Shudu Sino Torch", "Sino-Torch", "中华薪火体", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif',
    heritage: '"Shudu Sino Torch", "Sino-Torch", "中华薪火体", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif',
    xingkai: '"Xingkai SC", "行楷-简", "Kaiti SC", STKaiti, serif',
    hannotate: '"Hannotate SC", "手札体-简", "HanziPen SC", "Kaiti SC", cursive',
    hanzipen: '"HanziPen SC", "翩翩体-简", "Hannotate SC", "Kaiti SC", cursive',
    engraved: '"FZDiaoBanSongS", "方正雕版宋 简", "Songti SC", STSong, serif',
    fangsong: 'STFangsong, "华文仿宋", FangSong, "Songti SC", serif',
    kaiti: '"Kaiti SC", STKaiti, KaiTi, serif',
    sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    serif: '"Songti SC", STSong, "Noto Serif CJK SC", serif'
  });
  const BLOCK_SELECTOR = "p, blockquote, li, h1, h2, h3, h4, h5, h6";
  const TYPOGRAPHY_CANDIDATE_SELECTOR = "p, blockquote, li, h1, h2, h3, h4, h5, h6, section, div";
  const GENERATED_HEADING_ATTR = "data-adhd-reader-heading";
  const SKIP_SELECTOR = "script, style, noscript, svg, canvas, pre, code, textarea, input, button, [role='button'], .adhd-reader-mark";
  const NATIVE_HIGHLIGHT_NAMES = Object.freeze([
    "adhd-reader-priority",
    "adhd-reader-priority-strong",
    "adhd-reader-concept",
    "adhd-reader-concept-strong",
    "adhd-reader-action",
    "adhd-reader-action-strong",
    "adhd-reader-evidence",
    "adhd-reader-degree",
    "adhd-reader-marker",
    "adhd-reader-marker-strong",
    "adhd-reader-bold",
    "adhd-reader-latin-priority",
    "adhd-reader-latin-priority-strong",
    "adhd-reader-latin-concept",
    "adhd-reader-latin-concept-strong",
    "adhd-reader-latin-action",
    "adhd-reader-latin-action-strong",
    "adhd-reader-latin-evidence",
    "adhd-reader-latin-degree",
    "adhd-reader-latin-marker",
    "adhd-reader-latin-marker-strong",
    "adhd-reader-latin-bold"
  ]);
  const SEMANTIC_RULES = Object.freeze([
    {
      category: "priority",
      weight: 7,
      pattern: /(最重要|最核心|核心|关键|重点|结论|本质|根本|首要|主要矛盾|唯一|值得注意|请注意|真正|总之|归根结底|换句话说|意味着|the point|in short|important|key|essential|critical)/gi
    },
    {
      category: "concept",
      weight: 6,
      pattern: /(\b(?:AIGC|AGI|LLM|GPT|ADHD|AI|Agent|Skill|Prompt|Token|API)\b|智能体|提示词|模型|算法|框架|方法论|工作流|语义|概念|机制|系统|策略|能力|范式|认知负荷|注意力|大模型)/gi
    },
    {
      category: "concept",
      weight: 5.5,
      capture: 1,
      pattern: /([\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z0-9·+\-/]{1,12})(?=是指|指的是|定义为|称为|叫做)/gi
    },
    {
      category: "action",
      weight: 5,
      pattern: /(必须|务必|需要|应该|应当|建议|要求|确保|避免|禁止|不要|不能|可以|值得|优先|执行|完成|落地|行动|下一步|只有|才能|\b(?:must|need|should|avoid|ensure|recommend)\b)/gi
    },
    {
      category: "evidence",
      weight: 4.5,
      pattern: /(\d+(?:,\d{3})*(?:\.\d+)?(?:%|％|年|月|日|万|亿|元|人|个|项|次|倍|步|分钟|小时|天|GB|MB|px)?|数据显示|研究表明|调查显示|实验表明|结果显示|证据|案例|例如|比如|根据|data|evidence|research)/gi
    },
    {
      category: "degree",
      weight: 4,
      pattern: /(极其|极为|非常|尤其|特别|显著|明显|大幅|全面|彻底|完全|绝对|高度|深度|更高|更低|更强|更快|更好|更多|更少|最大|最小|最好|最坏|最快|最慢|最高|最低|最强|最弱|最多|最少|最新|最早|最晚|最优|最差|最关键|最核心|最重要|最主要|第[一二三四五六七八九十\d]+(?:级|层|阶段|步|类|档)|(?:初|中|高|顶)级|优先级|层级|等级|阶段|\b(?:extremely|significantly|fully|highest|lowest)\b)/gi
    },
    {
      category: "concept",
      weight: 3.5,
      pattern: /[“「『《][^”」』》\n]{2,16}[”」』》]/g
    },
    {
      category: "logic",
      weight: 3,
      boldOnly: true,
      pattern: /(首先|其次|再次|最后|第一|第二|第三|因此|所以|但是|然而|不过|同时|因为|由于|如果|那么|反之|相比之下|也就是说|换言之|一方面|另一方面|\b(?:first|second|third|finally|therefore|however|because|instead|but)\b)/gi
    }
  ]);

  let currentSettings = { ...DEFAULTS };
  let currentContext = { site: "generic", shells: [], surfaces: [], contents: [] };
  let mutationTimer = 0;
  const forcedFontElements = new Set();
  const originalFontStyles = new WeakMap();
  const pendingMediaLoads = new WeakSet();
  const originalMediaStyles = new WeakMap();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function normalizedSettings(value = {}) {
    let fontFamily = value.fontFamily || DEFAULTS.fontFamily;
    if (fontFamily === "heritage") fontFamily = "torch";
    if (!value.fontPreferenceVersion && fontFamily === "xingkai") fontFamily = "torch";
    let contentWidth = clamp(value.contentWidth ?? DEFAULTS.contentWidth, 640, 2400);
    if (!value.widthPreferenceVersion && contentWidth >= 1400) contentWidth = 2400;
    return {
      ...DEFAULTS,
      ...value,
      fontFamily,
      fontPreferenceVersion: 2,
      contentWidth,
      widthPreferenceVersion: 2,
      fontSize: clamp(value.fontSize ?? DEFAULTS.fontSize, 15, 30),
      lineHeight: clamp(value.lineHeight ?? DEFAULTS.lineHeight, 1.45, 2.2),
      paragraphGap: clamp(value.paragraphGap ?? DEFAULTS.paragraphGap, 0.3, 2),
      emphasisDensity: !value.emphasisPreferenceVersion
        ? Math.max(75, clamp(value.emphasisDensity ?? DEFAULTS.emphasisDensity, 0, 100))
        : clamp(value.emphasisDensity ?? DEFAULTS.emphasisDensity, 0, 100),
      emphasisPreferenceVersion: 2,
      multiColorEnabled: value.multiColorEnabled !== false
    };
  }

  function meaningfulText(element) {
    return (element?.textContent || "").replace(/[\s\u00a0\u200b\ufeff]/g, "");
  }

  function hasMeaningfulText(element) {
    return meaningfulText(element).length > 0;
  }

  function hasMedia(element) {
    return Boolean(element?.querySelector("img, video, audio, iframe, svg, canvas, table, hr"));
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(Boolean))];
  }

  function detectSite() {
    const hostname = location.hostname.toLowerCase();
    if (hostname === "mp.weixin.qq.com") return "wechat";
    if (hostname === "m.okjike.com" || hostname === "web.okjike.com" || hostname === "okjike.com") return "jike";
    if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com")) return "x";
    if (hostname === "ai.candobear.com") return "neican";
    return "generic";
  }

  function genericCandidateScore(element) {
    const textLength = meaningfulText(element).length;
    if (textLength < 100) return -Infinity;
    const paragraphCount = element.querySelectorAll("p, blockquote, li").length;
    const headingCount = element.querySelectorAll("h1, h2, h3").length;
    const semanticBoost = element.matches(GENERIC_ARTICLE_SELECTOR) ? 520 : 0;
    const linkTextLength = [...element.querySelectorAll("a")]
      .reduce((sum, link) => sum + meaningfulText(link).length, 0);
    const linkRatio = linkTextLength / Math.max(textLength, 1);
    const broadMainPenalty = element.matches("main, [role='main']") && element.querySelector(GENERIC_ARTICLE_SELECTOR)
      ? 1800
      : 0;
    return textLength + paragraphCount * 140 + headingCount * 80 + semanticBoost - linkRatio * textLength * 1.5 - broadMainPenalty;
  }

  function discoverWechat() {
    const content = document.querySelector("#js_content, .rich_media_content");
    const shell = content?.closest(".rich_media_area_primary_inner") ||
      content?.closest(".rich_media_area_primary") ||
      content?.closest("#page-content") ||
      content?.closest(".rich_media_wrp") ||
      content;
    return { site: "wechat", shells: uniqueElements([shell]), surfaces: uniqueElements([content]), contents: uniqueElements([content]) };
  }

  function isJikeDesktopPostRoute() {
    return /^\/u\/[^/]+\/(?:post|repost)\/[^/]+\/?$/.test(location.pathname);
  }

  function findJikeDesktopTextRoot(postCard) {
    const styledCandidates = [...postCard.querySelectorAll("div, p")]
      .filter((element) => {
        if (element.closest("aside, nav, footer, [role='dialog']")) return false;
        if (meaningfulText(element).length < 30) return false;
        return getComputedStyle(element).whiteSpace === "break-spaces";
      })
      .sort((left, right) => meaningfulText(right).length - meaningfulText(left).length);
    if (styledCandidates[0]) return styledCandidates[0];

    const moduleContent = [...postCard.querySelectorAll("[class*='_content_']")]
      .filter((element) => meaningfulText(element).length >= 30)
      .sort((left, right) => meaningfulText(right).length - meaningfulText(left).length)[0];
    if (moduleContent) return moduleContent;

    return [...postCard.querySelectorAll("div, p")]
      .filter((element) => {
        const ownText = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.nodeValue || "")
          .join("")
          .trim();
        return ownText.length >= 30;
      })
      .sort((left, right) => meaningfulText(right).length - meaningfulText(left).length)[0] || null;
  }

  function findJikeDesktopPage(detailContainer) {
    let candidate = detailContainer;
    while (candidate && candidate !== document.body) {
      const detailHeader = [...candidate.querySelectorAll("header")]
        .find((header) => meaningfulText(header).includes("动态详情"));
      if (detailHeader) return candidate;
      candidate = candidate.parentElement;
    }
    return detailContainer;
  }

  function discoverJike() {
    if (isJikeDesktopPostRoute()) {
      const postCard = [...document.querySelectorAll("[class*='_postCard_']")]
        .filter((element) => !element.closest("[role='dialog']") && meaningfulText(element).length >= 30)
        .sort((left, right) => meaningfulText(right).length - meaningfulText(left).length)[0] || null;
      const textRoot = postCard ? findJikeDesktopTextRoot(postCard) : null;
      const detailContainer = postCard?.parentElement || null;
      const page = detailContainer ? findJikeDesktopPage(detailContainer) : null;
      return {
        site: "jike",
        view: "desktop-detail",
        shells: uniqueElements([page]),
        surfaces: uniqueElements([postCard]),
        contents: uniqueElements([textRoot])
      };
    }

    const postPage = document.querySelector(".post-page");
    const postWrap = postPage?.querySelector(".post-wrap") || document.querySelector(".post-wrap");
    let textRoot = postWrap?.querySelector(".text .wrap") || postWrap?.querySelector(".text") || null;
    if (!textRoot && postWrap) {
      textRoot = [...postWrap.querySelectorAll("div, p")]
        .filter((element) => {
          const ownText = [...element.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.nodeValue || "")
            .join("")
            .trim();
          return ownText.length >= 30;
        })
        .sort((a, b) => meaningfulText(b).length - meaningfulText(a).length)[0] || null;
    }
    return {
      site: "jike",
      view: postPage || postWrap ? "mobile-detail" : "unknown",
      shells: uniqueElements([postPage || postWrap]),
      surfaces: uniqueElements([postWrap || textRoot]),
      contents: uniqueElements([textRoot])
    };
  }

  function isXPostDetailRoute() {
    return /(?:^|\/)status(?:\/|$)/.test(location.pathname) || /^\/i\/article(?:\/|$)/.test(location.pathname);
  }

  function discoverX() {
    const main = document.querySelector("main, [role='main']");
    document.querySelectorAll(".adhd-reader-x-detail-column, .adhd-reader-x-detail-sidebar").forEach((element) => {
      element.classList.remove("adhd-reader-x-detail-column", "adhd-reader-x-detail-sidebar");
    });
    const outerArticles = main
      ? [...main.querySelectorAll("article")].filter((article) => !article.parentElement?.closest("article"))
      : [];
    const contents = [];

    outerArticles.forEach((article) => {
      let candidates = [...article.querySelectorAll("[data-testid='tweetText'], [lang], .whitespace-pre-wrap.break-words")]
        .filter((element) => {
          if (element.closest("aside, nav, button, [role='button'], article article")) return false;
          if (element.closest("article a") && !element.matches("[data-testid='tweetText']")) return false;
          return meaningfulText(element).length >= 8;
        });
      candidates = candidates.filter((element) => !candidates.some((other) => other !== element && other.contains(element)));

      if (candidates.length === 0) {
        candidates = [...article.querySelectorAll("div")]
          .filter((element) => {
            if (element.closest("article article, article a, button, [role='button']")) return false;
            const ownText = [...element.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.nodeValue || "")
              .join("")
              .trim();
            return ownText.length >= 35;
          })
          .slice(0, 2);
      }
      contents.push(...candidates);
    });

    const postDetail = isXPostDetailRoute();
    if (postDetail) {
      main?.querySelector("[data-testid='primaryColumn']")?.classList.add("adhd-reader-x-detail-column");
      main?.querySelector("[data-testid='sidebarColumn']")?.classList.add("adhd-reader-x-detail-sidebar");
    }

    return {
      site: "x",
      view: postDetail ? "post-detail" : "feed",
      shells: [],
      surfaces: [],
      contents: uniqueElements(contents)
    };
  }

  function discoverNeican() {
    if (!/^\/neican\/(?:articles|share)\//.test(location.pathname)) {
      return { site: "neican", shells: [], surfaces: [], contents: [] };
    }
    const contents = [...document.querySelectorAll(".prose.entry, .prose")]
      .filter((element) => !element.closest("aside, nav, footer, [role='dialog']"))
      .map((element) => ({ element, score: genericCandidateScore(element) }))
      .filter(({ score }) => score > 100)
      .sort((left, right) => right.score - left.score);
    const content = contents[0]?.element || null;
    const shell = content?.closest("[class~='max-w-3xl']") || content?.closest("main, [role='main']") || content;
    return {
      site: "neican",
      shells: uniqueElements([shell]),
      surfaces: uniqueElements([content]),
      contents: uniqueElements([content])
    };
  }

  function discoverGeneric() {
    const candidates = uniqueElements([
      ...document.querySelectorAll(GENERIC_DISCOVERY_SELECTOR)
    ]).filter((element) => !element.closest("nav, aside, footer"));
    const preferred = candidates.filter((element) => element.matches(GENERIC_ARTICLE_SELECTOR));
    const ranked = preferred.some((element) => genericCandidateScore(element) > 100) ? preferred : candidates;
    const best = ranked
      .map((element) => ({ element, score: genericCandidateScore(element) }))
      .sort((a, b) => b.score - a.score)[0];
    const content = best?.score > 100 ? best.element : null;
    const shell = content?.closest("main, [role='main']") || content;
    return { site: "generic", shells: uniqueElements([shell]), surfaces: uniqueElements([content]), contents: uniqueElements([content]) };
  }

  function discoverContext() {
    const site = detectSite();
    if (site === "wechat") return discoverWechat();
    if (site === "jike") return discoverJike();
    if (site === "x") return discoverX();
    if (site === "neican") return discoverNeican();
    return discoverGeneric();
  }

  function syncTargetClasses(context) {
    const targetSets = {
      shell: new Set(context.shells),
      surface: new Set(context.surfaces),
      content: new Set(context.contents)
    };
    document.querySelectorAll(`[${TARGET_ATTR}]`).forEach((element) => {
      const roles = (element.getAttribute(TARGET_ATTR) || "").split(" ").filter(Boolean);
      roles.forEach((role) => {
        if (!targetSets[role]?.has(element)) element.classList.remove(`adhd-reader-${role}`);
      });
      const remaining = Object.entries(targetSets).filter(([, set]) => set.has(element)).map(([role]) => role);
      if (remaining.length) element.setAttribute(TARGET_ATTR, remaining.join(" "));
      else element.removeAttribute(TARGET_ATTR);
    });

    Object.entries(targetSets).forEach(([role, elements]) => {
      elements.forEach((element) => {
        element.classList.add(`adhd-reader-${role}`);
        const roles = new Set((element.getAttribute(TARGET_ATTR) || "").split(" ").filter(Boolean));
        roles.add(role);
        element.setAttribute(TARGET_ATTR, [...roles].join(" "));
      });
    });
  }

  function clearLegacyJikeDesktopColumns() {
    document.querySelectorAll(".adhd-reader-jike-columns").forEach((element) => {
      element.classList.remove("adhd-reader-jike-columns");
    });
  }

  function restoreOriginalFonts() {
    forcedFontElements.forEach((element) => {
      if (!element.isConnected) return;
      const original = originalFontStyles.get(element);
      if (!original?.value) element.style.removeProperty("font-family");
      else element.style.setProperty("font-family", original.value, original.priority);
    });
    forcedFontElements.clear();
  }

  function applyForcedFont(settings) {
    const selectedStack = FONT_STACKS[settings.fontFamily];
    const stack = settings.enabled
      ? document.documentElement.dataset.adhdScript === "latin" && selectedStack
        ? `"Avenir Next", "SF Pro Text", ${selectedStack}`
        : selectedStack
      : null;
    if (!stack) {
      restoreOriginalFonts();
      return;
    }

    const nextElements = new Set();
    currentContext.contents.forEach((content) => {
      [content, ...content.querySelectorAll(FONT_TARGET_SELECTOR)].forEach((element) => {
        if (!originalFontStyles.has(element)) {
          originalFontStyles.set(element, {
            value: element.style.getPropertyValue("font-family"),
            priority: element.style.getPropertyPriority("font-family")
          });
        }
        element.style.setProperty("font-family", stack, "important");
        forcedFontElements.add(element);
        nextElements.add(element);
      });
    });

    forcedFontElements.forEach((element) => {
      if (nextElements.has(element)) return;
      const original = originalFontStyles.get(element);
      if (element.isConnected) {
        if (!original?.value) element.style.removeProperty("font-family");
        else element.style.setProperty("font-family", original.value, original.priority);
      }
      forcedFontElements.delete(element);
    });
  }

  function clearTypographyHierarchy() {
    document.querySelectorAll(`[${GENERATED_HEADING_ATTR}='generated']`).forEach((element) => {
      element.classList.remove("adhd-reader-section-heading");
      element.removeAttribute(GENERATED_HEADING_ATTR);
    });
  }

  function typographyLeafBlocks(content) {
    return [...content.querySelectorAll(TYPOGRAPHY_CANDIDATE_SELECTOR)].filter((element) => {
      if (!hasMeaningfulText(element) || hasMedia(element)) return false;
      if (element.matches("p, blockquote, li, h1, h2, h3, h4, h5, h6")) return true;
      if (element.closest("li, blockquote")) return false;
      if (element.querySelector("p, blockquote, li, h1, h2, h3, h4, h5, h6")) return false;
      return ![...element.children].some((child) => {
        return child.matches("section, div") && hasMeaningfulText(child);
      });
    });
  }

  function hasHeadingStyleCue(element) {
    const styledElements = [element, ...element.querySelectorAll("span, strong, b")];
    return Boolean(element.querySelector("strong, b")) || styledElements.some((candidate) => {
      const weight = Number.parseInt(candidate.style.fontWeight, 10);
      const size = Number.parseFloat(candidate.style.fontSize);
      return weight >= 600 || (Number.isFinite(size) && size !== currentSettings.fontSize);
    });
  }

  function isPseudoSectionHeading(element, previous, next) {
    if (element.matches("h1, h2, h3, h4, h5, h6, li, blockquote")) return false;
    if (element.closest("ul, ol, a, footer, nav, aside")) return false;
    const text = meaningfulText(element);
    if (text.length < 2 || text.length > 28) return false;
    if (/[。！？!?；;…]$/.test(text) || /^[•·●▪◦\-–—]/.test(text)) return false;

    const previousLength = meaningfulText(previous).length;
    const nextLength = meaningfulText(next).length;
    const betweenBodyBlocks = previousLength >= 20 && nextLength >= 40;
    const headingPhrase = /^(?:第[一二三四五六七八九十\d]+[章节部分]|[一二三四五六七八九十\d]+[、.．]|背景|结论|总结|要点|重点|核心|方法|步骤|能力|特性|功能|优势|局限|案例|未来|关于)/.test(text);
    return betweenBodyBlocks && (text.length <= 18 || headingPhrase || hasHeadingStyleCue(element));
  }

  function applyTypographyHierarchy(settings) {
    clearTypographyHierarchy();
    if (!settings.enabled || !["wechat", "neican", "generic"].includes(currentContext.site)) return;

    currentContext.contents.forEach((content) => {
      const blocks = typographyLeafBlocks(content);
      blocks.forEach((element, index) => {
        const previous = blocks[index - 1];
        const next = blocks[index + 1];
        if (!previous || !next || !isPseudoSectionHeading(element, previous, next)) return;
        element.classList.add("adhd-reader-section-heading");
        element.setAttribute(GENERATED_HEADING_ATTR, "generated");
      });
    });
  }

  function applyMediaSizing(settings) {
    const active = settings.enabled && currentContext.site === "wechat";
    document.querySelectorAll(".adhd-reader-large-media").forEach((image) => {
      if (active && currentContext.contents.some((content) => content.contains(image))) return;
      const original = originalMediaStyles.get(image);
      if (original) {
        if (original.width) image.style.setProperty("width", original.width, original.widthPriority);
        else image.style.removeProperty("width");
        if (original.height) image.style.setProperty("height", original.height, original.heightPriority);
        else image.style.removeProperty("height");
      }
      image.classList.remove("adhd-reader-large-media");
      image.style.removeProperty("--adhd-media-natural-width");
    });
    if (!active) return;

    currentContext.contents.forEach((content) => {
      content.querySelectorAll("img").forEach((image) => {
        const classify = () => {
          const renderedBox = image.getBoundingClientRect();
          // 微信贴图常被作者按 559px 左右的移动端宽度写死。只看当前
          // 渲染宽度会把这类 1080px 原图漏掉，导致宽屏正文已经展开，
          // 贴图却仍缩在中间。这里用原图尺寸确认清晰度，再以较低的
          // 可见尺寸门槛排除头像、图标和装饰线。
          const isLarge = image.naturalWidth >= 700 &&
            image.naturalHeight >= 180 &&
            renderedBox.width >= 320 &&
            renderedBox.height >= 120;
          image.classList.toggle("adhd-reader-large-media", isLarge);
          if (isLarge) {
            if (!originalMediaStyles.has(image)) {
              originalMediaStyles.set(image, {
                width: image.style.getPropertyValue("width"),
                widthPriority: image.style.getPropertyPriority("width"),
                height: image.style.getPropertyValue("height"),
                heightPriority: image.style.getPropertyPriority("height")
              });
            }
            image.style.setProperty("--adhd-media-natural-width", `${image.naturalWidth}px`);
            image.style.setProperty("width", `${image.naturalWidth}px`, "important");
            image.style.setProperty("height", "auto", "important");
          } else {
            image.style.removeProperty("--adhd-media-natural-width");
          }
        };
        if (image.complete) classify();
        // 微信会先加载 1x1 占位图，再把 src 换成 data-src 中的真实图。
        // 即使当前已经 complete，也要监听下一次 load，避免永久保留占位
        // 尺寸的判断结果。
        if (!pendingMediaLoads.has(image)) {
          pendingMediaLoads.add(image);
          image.addEventListener("load", () => {
            pendingMediaLoads.delete(image);
            classify();
          }, { once: true });
        }
      });
    });
  }

  function expandWechatTextBlocks(settings) {
    const className = "adhd-reader-fluid-block";
    if (!settings.enabled || currentContext.site !== "wechat") {
      document.querySelectorAll(`.${className}`).forEach((element) => element.classList.remove(className));
      return;
    }
    currentContext.contents.forEach((content) => {
      content.querySelectorAll("section, div, p, blockquote, h1, h2, h3, h4, h5, h6").forEach((element) => {
        // Release desktop-sized fixed blocks, not small decorations or grid/flex cards.
        const style = getComputedStyle(element);
        const parentStyle = getComputedStyle(element.parentElement);
        const fixedSize = [element.style.width, element.style.maxWidth,
          element.style.inlineSize, element.style.maxInlineSize, style.maxWidth]
          .some((value) => /^\d+(?:\.\d+)?px$/.test(value) && Number.parseFloat(value) >= 320);
        const normalFlow = ["block", "flow-root"].includes(style.display) &&
          ["static", "relative"].includes(style.position) && style.float === "none" &&
          !/flex|grid/.test(parentStyle.display) &&
          !element.closest("table, figure, [contenteditable='true']");
        const isBodyBlock = hasMeaningfulText(element) || Boolean(element.querySelector("img, video"));
        element.classList.toggle(className, fixedSize && normalFlow && isBodyBlock);
      });
    });
  }

  function applyLayout(settings) {
    currentContext = discoverContext();
    const layoutEnabled = settings.enabled && currentContext.site !== "generic";
    syncTargetClasses(layoutEnabled
      ? currentContext
      : { ...currentContext, shells: [], surfaces: [], contents: [] });
    clearLegacyJikeDesktopColumns();
    const root = document.documentElement;
    root.classList.toggle(ROOT_CLASS, layoutEnabled);
    root.classList.toggle("adhd-reader-focus", layoutEnabled && settings.focusEnabled);
    root.dataset.adhdMode = currentContext.site === "generic" ? "translation-only" : "reading";
    root.dataset.adhdSite = currentContext.site;
    root.dataset.adhdJikeView = currentContext.site === "jike" ? currentContext.view || "unknown" : "none";
    root.dataset.adhdXView = currentContext.site === "x" ? currentContext.view || "feed" : "none";
    root.dataset.adhdScript = dominantContentScript();
    root.dataset.adhdFont = settings.fontFamily;
    root.dataset.adhdMarker = settings.markerColor;
    root.dataset.adhdMultiColor = String(settings.multiColorEnabled);
    const siteWidth = Math.min(settings.contentWidth, SITE_WIDTH_CAPS[currentContext.site] || settings.contentWidth);
    root.style.setProperty("--adhd-content-width", `${settings.contentWidth}px`);
    root.style.setProperty("--adhd-site-width", `${siteWidth}px`);
    root.style.setProperty("--adhd-font-size", `${settings.fontSize}px`);
    root.style.setProperty("--adhd-line-height", String(settings.lineHeight));
    root.style.setProperty("--adhd-paragraph-gap", `${settings.paragraphGap}em`);
    const effectiveSettings = layoutEnabled ? settings : { ...settings, enabled: false };
    expandWechatTextBlocks(effectiveSettings);
    applyForcedFont(effectiveSettings);
    applyTypographyHierarchy(effectiveSettings);
    applyMediaSizing(effectiveSettings);
  }

  function isVisuallyPlain(element) {
    const style = getComputedStyle(element);
    const backgroundIsClear = style.backgroundImage === "none" &&
      (style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent");
    const borderWidth = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
      .reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
    return backgroundIsClear && borderWidth < 1;
  }

  function compactArticleSpacing() {
    if (!currentSettings.enabled || currentContext.site !== "wechat") return;
    currentContext.contents.forEach((content) => {
      const candidates = [...content.querySelectorAll("p, section, div")];
      candidates.forEach((element) => {
        const empty = !hasMeaningfulText(element) && !hasMedia(element);
        element.classList.toggle("adhd-reader-empty-block", empty);
      });
      candidates.forEach((element) => {
        if (element.matches("p") || element.classList.contains("adhd-reader-empty-block") || hasMedia(element)) {
          element.classList.remove("adhd-reader-compact-wrapper");
          return;
        }
        const visibleChildren = [...element.children].filter((child) => {
          return !child.classList.contains("adhd-reader-empty-block") && (hasMeaningfulText(child) || hasMedia(child));
        });
        const hasOwnText = [...element.childNodes].some((node) => {
          return node.nodeType === Node.TEXT_NODE && Boolean((node.nodeValue || "").replace(/[\s\u00a0\u200b\ufeff]/g, ""));
        });
        if (hasOwnText || visibleChildren.length === 0 || !isVisuallyPlain(element)) {
          element.classList.remove("adhd-reader-compact-wrapper");
          return;
        }
        const style = getComputedStyle(element);
        const verticalSpace = [style.marginTop, style.marginBottom, style.paddingTop, style.paddingBottom]
          .reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
        const fontSize = Number.parseFloat(style.fontSize) || currentSettings.fontSize;
        element.classList.toggle("adhd-reader-compact-wrapper", visibleChildren.length === 1 || verticalSpace > fontSize * 1.5);
      });
    });
  }

  function textNodesWithin(block) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim() || node.parentElement?.closest(SKIP_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function createMark(className, text, category = "priority") {
    const mark = document.createElement("span");
    mark.className = `adhd-reader-mark ${className}`;
    mark.textContent = text;
    mark.dataset.adhdGenerated = "true";
    mark.dataset.adhdSemantic = category;
    return mark;
  }

  function supportsNativeHighlights() {
    return typeof globalThis.Highlight === "function" && Boolean(globalThis.CSS?.highlights);
  }

  function clearNativeEmphasis() {
    if (globalThis.CSS?.highlights) {
      NATIVE_HIGHLIGHT_NAMES.forEach((name) => globalThis.CSS.highlights.delete(name));
    }
    delete document.documentElement.dataset.adhdNativeHighlightCount;
  }

  function nativeHighlightName(match, settings, highlight, bold) {
    const prefix = document.documentElement.dataset.adhdScript === "latin" ? "adhd-reader-latin-" : "adhd-reader-";
    if (!highlight) return bold ? `${prefix}bold` : null;
    if (!settings.multiColorEnabled) return bold ? `${prefix}marker-strong` : `${prefix}marker`;
    if (bold && ["priority", "concept", "action"].includes(match.category)) {
      return `${prefix}${match.category}-strong`;
    }
    return `${prefix}${match.category}`;
  }

  function dominantContentScript() {
    let latinLetters = 0;
    let hanCharacters = 0;
    let sampled = 0;
    currentContext.contents.forEach((content) => {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (sampled >= 16000 || node.parentElement?.closest(MUTATION_IGNORE_SELECTOR)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      while (walker.nextNode() && sampled < 16000) {
        const text = walker.currentNode.nodeValue || "";
        latinLetters += (text.match(/[A-Za-z]/g) || []).length;
        hanCharacters += (text.match(/[\u3400-\u9fff]/g) || []).length;
        sampled += text.length;
      }
    });
    return latinLetters >= 120 && latinLetters > hanCharacters * 1.8 ? "latin" : "cjk";
  }

  function extractDocumentConcepts() {
    const counts = new Map();
    const stopWords = new Set(["我们", "他们", "你们", "这个", "那个", "这些", "那些", "一个", "一种", "什么", "为何", "为什么", "怎么", "如何", "不是", "可以", "需要", "已经", "没有", "还有", "以及", "因为", "所以", "但是", "相关", "变化", "事件", "为了", "起点", "有人", "所有人", "自己", "其它", "其中", "本身", "进行", "实现", "成为", "认为", "公开", "目前", "现在", "今天", "the", "and", "that", "this", "with", "from", "into", "there", "their", "they", "them", "then", "than", "when", "where", "which", "while", "would", "could", "should", "have", "has", "had", "been", "being", "were", "will", "more", "most", "some", "such", "only", "also", "about", "after", "before", "under", "over", "between", "through", "each", "every", "same", "other", "these", "those", "what", "much", "many", "very", "just", "article", "models", "datasets", "collections"]);
    const segmenter = typeof Intl?.Segmenter === "function" ? new Intl.Segmenter("zh-CN", { granularity: "word" }) : null;
    const remember = (term, boost = 1) => {
      const normalized = term.trim().replace(/^[“「『《]|[”」』》]$/g, "");
      const lower = normalized.toLocaleLowerCase("en-US");
      const isSingleLatinToken = /^[A-Za-z]+$/.test(normalized);
      if (normalized.length < 2 || normalized.length > 40 || stopWords.has(normalized) || stopWords.has(lower) || /^[一二三四五六七八九十百千万\d]+$/.test(normalized)) return;
      if (isSingleLatinToken && !/^[A-Z]{2,}$/.test(normalized) && !/^[A-Z][A-Za-z]{4,}$/.test(normalized)) return;
      counts.set(normalized, (counts.get(normalized) || 0) + boost);
    };
    currentContext.contents.forEach((content) => {
      const fullText = content.textContent || "";
      if (segmenter) {
        for (const segment of segmenter.segment(fullText)) {
          if (segment.isWordLike) remember(segment.segment);
        }
      }
      fullText.match(/\b(?:[A-Z]{2,}[A-Za-z0-9._+\-/]*|[A-Za-z]+[0-9][A-Za-z0-9._+\-/]*|[A-Za-z]+[-/][A-Za-z0-9._+\-/]+)\b/g)?.forEach((term) => remember(term));
      [...fullText.matchAll(/\b([A-Z][A-Za-z0-9.+/-]+(?:\s+[A-Z][A-Za-z0-9.+/-]+){1,3})\b/g)].forEach((match) => remember(match[1], 2));
      [...content.querySelectorAll("h1, h2, h3, h4")].forEach((element) => {
        const source = element.textContent || "";
        if (segmenter) {
          for (const segment of segmenter.segment(source)) {
            if (segment.isWordLike) remember(segment.segment, 3);
          }
        }
        source.match(/\b(?:[A-Z]{2,}[A-Za-z0-9._+\-/]*|[A-Za-z]+[0-9][A-Za-z0-9._+\-/]*|[A-Za-z]+[-/][A-Za-z0-9._+\-/]+)\b/g)?.forEach((term) => remember(term, 3));
        [...source.matchAll(/\b([A-Z][A-Za-z0-9.+/-]+(?:\s+[A-Z][A-Za-z0-9.+/-]+){1,3})\b/g)].forEach((match) => remember(match[1], 3));
      });
      [...fullText.matchAll(/[“「『《]([^”」』》\n]{2,12})[”」』》]/g)].forEach((match) => remember(match[1], 3));
    });
    return [...counts.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      .map(([term]) => term)
      .slice(0, 40);
  }

  function automaticConceptMatches(text, documentConcepts) {
    const matches = [];
    const addMatches = (pattern, weight) => {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const value = match[1] || match[0];
        const start = match.index + Math.max(0, match[0].indexOf(value));
        if (value.trim().length >= 2) {
          matches.push({ start, end: start + value.length, text: value, category: "concept", weight, boldOnly: false, ruleIndex: SEMANTIC_RULES.length });
        }
        if (match[0].length === 0) pattern.lastIndex += 1;
      }
    };

    addMatches(/\b((?:[A-Z]{2,}[A-Za-z0-9._+\-/]*|[A-Za-z]+[0-9][A-Za-z0-9._+\-/]*|[A-Za-z]+[-/][A-Za-z0-9._+\-/]+))\b/g, 4.8);
    addMatches(/\b([A-Z][A-Za-z0-9.+/-]+(?:\s+[A-Z][A-Za-z0-9.+/-]+){1,3})\b/g, 4.75);
    addMatches(/(?:^|[。！？；]\s*)([\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z0-9·+\-/]{1,7})(?=[：:])/g, 4.7);
    documentConcepts.forEach((term, index) => {
      let start = text.indexOf(term);
      while (start !== -1) {
        matches.push({ start, end: start + term.length, text: term, category: "concept", weight: 4.6 - index * 0.005, boldOnly: false, ruleIndex: SEMANTIC_RULES.length + 1 });
        start = text.indexOf(term, start + term.length);
      }
    });
    return matches;
  }

  function semanticMatches(text, settings, documentConcepts) {
    const candidates = automaticConceptMatches(text, documentConcepts);
    SEMANTIC_RULES.forEach((rule, ruleIndex) => {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(text)) !== null) {
        const matchedText = rule.capture ? match[rule.capture] : match[0];
        const relativeIndex = rule.capture ? match[0].indexOf(matchedText) : 0;
        const start = match.index + Math.max(0, relativeIndex);
        if (!matchedText?.trim()) continue;
        candidates.push({
          start,
          end: start + matchedText.length,
          text: matchedText,
          category: rule.category,
          weight: rule.weight,
          boldOnly: Boolean(rule.boldOnly),
          ruleIndex
        });
        if (match[0].length === 0) rule.pattern.lastIndex += 1;
      }
    });

    const sorted = candidates.sort((a, b) => b.weight - a.weight || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const nonOverlapping = [];
    sorted.forEach((candidate) => {
      if (!nonOverlapping.some((picked) => candidate.start < picked.end && candidate.end > picked.start)) {
        nonOverlapping.push(candidate);
      }
    });

    const maxPerNode = Math.max(1, Math.min(10, Math.round(1 + settings.emphasisDensity / 14)));
    return nonOverlapping
      .sort((a, b) => a.start - b.start)
      .filter((candidate, index) => {
        if (candidate.weight >= 6) return true;
        const threshold = Math.max(8, 78 - settings.emphasisDensity * 0.7 - candidate.weight * 6);
        const deterministic = (candidate.start * 29 + candidate.text.length * 17 + candidate.ruleIndex * 13 + index * 7) % 100;
        return deterministic >= threshold;
      })
      .slice(0, maxPerNode);
  }

  function emphasizeTextNode(node, settings, remainingBudget, documentConcepts) {
    const text = node.nodeValue;
    if (!text || text.trim().length < 2 || remainingBudget <= 0) return 0;
    const matches = semanticMatches(text, settings, documentConcepts).slice(0, remainingBudget);
    if (matches.length === 0) return 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    matches.forEach((match) => {
      if (match.start > cursor) fragment.append(text.slice(cursor, match.start));
      const highlight = settings.highlightEnabled && !match.boldOnly;
      const strongCategory = ["priority", "concept", "action"].includes(match.category);
      const className = [
        highlight ? "adhd-reader-highlight" : "",
        settings.boldEnabled && (match.boldOnly || strongCategory) ? "adhd-reader-auto-bold" : ""
      ].filter(Boolean).join(" ");
      if (className) fragment.append(createMark(className, match.text, match.category));
      else fragment.append(match.text);
      cursor = match.end;
    });
    fragment.append(text.slice(cursor));
    node.replaceWith(fragment);
    return matches.length;
  }

  function processBlock(block, _index, settings, documentConcepts) {
    if (block.dataset.adhdProcessed === "true" || block.closest(".adhd-reader-mark")) return;
    const text = block.textContent?.replace(/\s+/g, " ").trim() || "";
    if (text.length < 8) return;
    const maxPerBlock = Math.max(1, Math.min(14, Math.round(1 + settings.emphasisDensity / 10)));
    let used = 0;
    textNodesWithin(block).forEach((node) => {
      if (used >= maxPerBlock) return;
      used += emphasizeTextNode(node, settings, maxPerBlock - used, documentConcepts);
    });
    block.dataset.adhdProcessed = "true";
  }

  function processBlockNatively(block, settings, documentConcepts, rangesByName, remainingTotal) {
    const text = block.textContent?.replace(/\s+/g, " ").trim() || "";
    if (text.length < 8 || remainingTotal <= 0) return 0;
    if (document.documentElement.dataset.adhdScript === "latin" && /^H[1-6]$/.test(block.tagName)) return 0;
    const maxPerBlock = Math.max(1, Math.min(14, Math.round(1 + settings.emphasisDensity / 10)));
    let used = 0;
    textNodesWithin(block).forEach((node) => {
      if (used >= maxPerBlock || used >= remainingTotal) return;
      const matches = semanticMatches(node.nodeValue || "", settings, documentConcepts)
        .slice(0, Math.min(maxPerBlock - used, remainingTotal - used));
      matches.forEach((match) => {
        const highlight = settings.highlightEnabled && !match.boldOnly;
        const strongCategory = ["priority", "concept", "action"].includes(match.category);
        const bold = settings.boldEnabled && (match.boldOnly || strongCategory);
        const name = nativeHighlightName(match, settings, highlight, bold);
        if (!name) return;
        const range = document.createRange();
        range.setStart(node, match.start);
        range.setEnd(node, match.end);
        if (!rangesByName.has(name)) rangesByName.set(name, []);
        rangesByName.get(name).push(range);
        used += 1;
      });
    });
    return used;
  }

  function blocksWithin(content) {
    if (["jike", "x"].includes(currentContext.site)) return [content];
    const nested = [...content.querySelectorAll(BLOCK_SELECTOR)].filter((element) => {
      return ![...element.children].some((child) => child.matches(BLOCK_SELECTOR));
    });
    return nested.length ? nested : [content];
  }

  function processContentNatively(settings, documentConcepts) {
    const root = document.documentElement;
    root.dataset.adhdEmphasisMode = "safe-native";
    if (!supportsNativeHighlights()) {
      root.dataset.adhdEmphasisMode = "safe-fallback";
      return;
    }

    const rangesByName = new Map();
    const maxTotal = 1600;
    let total = 0;
    currentContext.contents.forEach((content) => {
      blocksWithin(content).forEach((block) => {
        if (total >= maxTotal) return;
        total += processBlockNatively(block, settings, documentConcepts, rangesByName, maxTotal - total);
      });
    });
    rangesByName.forEach((ranges, name) => {
      globalThis.CSS.highlights.set(name, new globalThis.Highlight(...ranges));
    });
    root.dataset.adhdNativeHighlightCount = String(total);
  }

  function processContent(settings) {
    clearNativeEmphasis();
    if (currentContext.site === "generic" || !settings.enabled || (!settings.boldEnabled && !settings.highlightEnabled)) {
      document.documentElement.dataset.adhdEmphasisMode = "off";
      return;
    }
    let index = 0;
    const documentConcepts = extractDocumentConcepts();
    if (currentContext.site !== "wechat") {
      processContentNatively(settings, documentConcepts);
      return;
    }
    document.documentElement.dataset.adhdEmphasisMode = "inline-static";
    currentContext.contents.forEach((content) => {
      blocksWithin(content).forEach((block) => processBlock(block, index++, settings, documentConcepts));
    });
  }

  function clearGeneratedEmphasis() {
    clearNativeEmphasis();
    document.querySelectorAll(".adhd-reader-mark[data-adhd-generated='true']").forEach((mark) => {
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
    });
    document.querySelectorAll("[data-adhd-processed='true']").forEach((element) => {
      delete element.dataset.adhdProcessed;
      element.normalize();
    });
  }

  function apply(settings, reprocess = false) {
    currentSettings = normalizedSettings(settings);
    applyLayout(currentSettings);
    compactArticleSpacing();
    if (reprocess) clearGeneratedEmphasis();
    processContent(currentSettings);
  }

  function loadSettings() {
    chrome.storage.sync.get({ [SETTINGS_KEY]: DEFAULTS }, (result) => {
      const normalized = normalizedSettings(result[SETTINGS_KEY]);
      apply(normalized, true);
      if (JSON.stringify(normalized) !== JSON.stringify(result[SETTINGS_KEY])) {
        chrome.storage.sync.set({ [SETTINGS_KEY]: normalized });
      }
    });
  }

  const storageChangeListener = (changes, area) => {
    if (area === "sync" && changes[SETTINGS_KEY]) apply(changes[SETTINGS_KEY].newValue, true);
  };
  chrome.storage.onChanged.addListener(storageChangeListener);

  const runtimeMessageListener = (message, _sender, sendResponse) => {
    if (message?.type === "ADHD_READER_REFRESH") {
      apply(message.settings || currentSettings, true);
      sendResponse({
        ok: currentContext.contents.length > 0,
        site: currentContext.site,
        siteLabel: SITE_LABELS[currentContext.site],
        contentCount: currentContext.contents.length,
        translationOnly: currentContext.site === "generic"
      });
    }
    if (message?.type === "ADHD_READER_STATUS") {
      applyLayout(currentSettings);
      sendResponse({
        ok: true,
        articleFound: currentContext.contents.length > 0,
        site: currentContext.site,
        siteLabel: SITE_LABELS[currentContext.site],
        contentCount: currentContext.contents.length,
        translationOnly: currentContext.site === "generic",
        settings: currentSettings
      });
    }
  };
  chrome.runtime.onMessage.addListener(runtimeMessageListener);

  function mutationNodeIsIgnored(node) {
    if (!node) return true;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element?.matches?.(MUTATION_IGNORE_SELECTOR) || element?.closest?.(MUTATION_IGNORE_SELECTOR));
  }

  function mutationsRequireRefresh(records) {
    if (currentContext.site === "generic") return false;
    return records.some((record) => {
      if (mutationNodeIsIgnored(record.target)) return false;
      if (
        currentContext.site === "wechat" &&
        record.target?.nodeType === Node.ELEMENT_NODE &&
        record.target.closest?.("[data-adhd-processed='true']")
      ) {
        return false;
      }
      const changedNodes = [...record.addedNodes, ...record.removedNodes];
      return changedNodes.some((node) => !mutationNodeIsIgnored(node));
    });
  }

  const observer = new MutationObserver((records) => {
    if (!mutationsRequireRefresh(records)) return;
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => {
      applyLayout(currentSettings);
      compactArticleSpacing();
      processContent(currentSettings);
    }, ["jike", "x"].includes(currentContext.site) ? 700 : 350);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  globalThis.__SHUDU_READER_CLEANUP__ = () => {
    observer.disconnect();
    window.clearTimeout(mutationTimer);
    chrome.storage.onChanged.removeListener(storageChangeListener);
    chrome.runtime.onMessage.removeListener(runtimeMessageListener);
    clearTypographyHierarchy();
  };
  loadSettings();
})();
