import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const readerBackground = await readFile(new URL("../reader-background.js", import.meta.url), "utf8");
const popup = await readFile(new URL("../popup.js", import.meta.url), "utf8");
const popupShell = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const collectorBackground = await readFile(new URL("../collector/background-module.js", import.meta.url), "utf8");
const collectorPopup = await readFile(new URL("../collector/popup.js", import.meta.url), "utf8");
const content = await readFile(new URL("../translation.js", import.meta.url), "utf8");
const reader = await readFile(new URL("../content.js", import.meta.url), "utf8");
const readerCss = await readFile(new URL("../reader.css", import.meta.url), "utf8");

test("0.7.2 将阅读、译读、批注与收藏打包到同一个扩展", () => {
  assert.equal(manifest.version, "0.7.2");
  assert.equal(manifest.background.service_worker, "unified-worker.js");
  assert.deepEqual(manifest.content_scripts[1].js, ["translation-core.js", "content.js", "translation.js"]);
  assert.deepEqual(manifest.content_scripts[1].css, ["reader.css", "translation.css"]);
  assert.ok(manifest.content_scripts[0].js.includes("collector/annotations.js"));
  assert.equal(manifest.commands["toggle-translation"].suggested_key.mac, "Alt+Shift+F");
  assert.equal(manifest.commands["quick-save-page"].suggested_key.mac, "Alt+Shift+S");
  assert.equal(manifest.commands["quick-save-selection"].suggested_key.mac, "Alt+Shift+X");
  assert.match(background, /reader-background\.js/);
  assert.match(background, /collector\/background-module\.js/);
  assert.match(popupShell, /data-view="reader"/);
  assert.match(popupShell, /data-view="collector"/);
  assert.doesNotMatch(collectorPopup, /runtime\.reload/);
  assert.match(collectorBackground, /collector\/content\.js/);
});

test("合并后台只响应各自的消息，收藏与译读不再互相抢答", () => {
  assert.match(readerBackground, /const READER_MESSAGE_TYPES = new Set/);
  assert.match(readerBackground, /if \(!READER_MESSAGE_TYPES\.has\(message\?\.type\)\) return false/);
  assert.match(collectorBackground, /const COLLECTOR_MESSAGE_TYPES = new Set/);
  assert.match(collectorBackground, /if \(!COLLECTOR_MESSAGE_TYPES\.has\(message\?\.type\)\) return false/);
  assert.doesNotMatch(readerBackground, /未知的舒读后台请求/);
  assert.doesNotMatch(collectorBackground, /error: "未知操作"/);
});

test("X 与 Twitter 暂停注入，避免无限滚动时布局跳动", () => {
  assert.ok(!manifest.host_permissions.includes("https://x.com/*"));
  assert.ok(!manifest.host_permissions.includes("https://twitter.com/*"));
  assert.ok(!manifest.content_scripts[0].matches.includes("https://x.com/*"));
  assert.ok(!manifest.content_scripts[0].matches.includes("https://twitter.com/*"));
  assert.match(popup, /const isX =/);
  assert.match(popup, /injectable: !isX/);
  assert.match(readerBackground, /hostname !== "x\.com"/);
});

test("即刻新版桌面详情只扩宽为单栏正文", () => {
  assert.match(reader, /function isJikeDesktopPostRoute/);
  assert.match(reader, /\[class\*='_postCard_'\]/);
  assert.match(reader, /whiteSpace === "break-spaces"/);
  assert.match(reader, /jike: 1400/);
  assert.match(readerCss, /data-adhd-jike-view="desktop-detail"/);
  assert.match(readerCss, /--page-container-width:/);
  assert.doesNotMatch(readerCss, /column-width:/);
  assert.doesNotMatch(readerCss, /column-count:/);
  assert.doesNotMatch(readerCss, /column-rule:/);
});

test("公众号贴图按原图宽度展开，不再漏掉 559px 移动端贴图", () => {
  assert.match(reader, /image\.naturalWidth >= 700/);
  assert.match(reader, /image\.naturalHeight >= 180/);
  assert.match(reader, /renderedBox\.width >= 320/);
  assert.match(reader, /renderedBox\.height >= 120/);
  assert.match(reader, /pendingMediaLoads\.delete\(image\)/);
  assert.match(readerCss, /width: min\(100%, var\(--adhd-media-natural-width\)\)/);
  assert.doesNotMatch(reader, /renderedWidth >= 560/);
});

test("AI 内参自动运行且只扩展文章列，不把侧栏识别为正文", () => {
  assert.ok(manifest.host_permissions.includes("https://*/*"));
  assert.ok(manifest.content_scripts[1].matches.includes("https://ai.candobear.com/*"));
  assert.match(popup, /ai\.candobear\.com/);
  assert.match(reader, /function discoverNeican/);
  assert.match(reader, /\.prose\.entry, \.prose/);
  assert.match(reader, /closest\("\[class~='max-w-3xl'\]"\)/);
  assert.match(readerCss, /data-adhd-site="neican"/);
});

test("只调用智谱标准开放平台端点，不误用 Coding Plan", () => {
  assert.match(readerBackground, /https:\/\/open\.bigmodel\.cn\/api\/paas\/v4\/chat\/completions/);
  assert.doesNotMatch(readerBackground, /api\/coding\/paas/);
  assert.match(readerBackground, /glm-5\.2/);
});

test("API Key 仅由本机 storage.local 读取，不存在源码默认值", () => {
  assert.match(readerBackground, /shuduZhipuApiKey/);
  assert.match(readerBackground, /chrome\.storage\.local/);
  assert.doesNotMatch(readerBackground, /const\s+API_KEY\s*=\s*["'][^"']+["']/);
  assert.match(popup, /chrome\.storage\.local\.set/);
  assert.doesNotMatch(popup, /chrome\.storage\.sync[^\n]*shuduZhipuApiKey/);
});

test("动态补译使用滚动与 MutationObserver，译文不改写原文", () => {
  assert.match(content, /document\.addEventListener\("scroll"/);
  assert.match(content, /new MutationObserver/);
  assert.match(content, /seenSourceTexts\.has\(textKey\)/);
  assert.match(content, /entry\.element\.append\(wrapper\)/);
  assert.doesNotMatch(content, /entry\.element\.replace/);
});

test("普通英文网页只译读，不改变原网页排版", () => {
  assert.match(reader, /layoutEnabled = settings\.enabled && currentContext\.site !== "generic"/);
  assert.match(reader, /adhdMode = currentContext\.site === "generic" \? "translation-only"/);
  assert.match(reader, /currentContext\.site === "generic" \|\| !settings\.enabled/);
  assert.match(reader, /if \(currentContext\.site === "generic"\) return false/);
  assert.match(popup, /仅译读，保留原网页排版/);
});

test("译读立即响应并按三段渐进返回", () => {
  assert.match(content, /MAX_REQUEST_BLOCKS = 3/);
  assert.match(content, /pending = untranslated\.slice\(0, MAX_REQUEST_BLOCKS\)/);
  assert.match(content, /void translateVisible\(\{ toggleIfComplete: false, quiet: true \}\)\.then/);
  assert.match(content, /Promise\.resolve\(task\)\.then/);
  assert.match(content, /processing: true/);
  assert.match(readerBackground, /const BATCH_SIZE = 3/);
  assert.match(readerBackground, /controller\.abort\(\), 30000/);
  assert.match(popup, /正在翻译当前屏前/);
  assert.match(popup, /page\?\.lastAction === "error"/);
});

test("普通英文文章锁定文章容器，不再把每个英文单词画成粗标记", () => {
  assert.match(reader, /"\.blog-content"/);
  assert.match(reader, /"\.prose"/);
  assert.match(reader, /dataSet|dataset\.adhdScript|adhdScript/);
  assert.doesNotMatch(reader, /addMatches\(\/\\b\(\[A-Za-z\]\[A-Za-z0-9\._\+\\\-\/\]\{2,24\}\)\\b\/g/);
  assert.match(readerCss, /adhd-reader-latin-concept/);
  assert.match(readerCss, /background-color: rgba\(96, 165, 250, 0\.08\)/);
});

test("全部语义标记保持透明且动态页面不再绘制下划线", () => {
  const semanticLines = readerCss.match(/(?:--adhd-(?:marker|priority|concept|action|evidence|degree)-color|background-color): rgba\([^;]+\)/g) || [];
  assert.ok(semanticLines.length >= 18);
  semanticLines.forEach((line) => {
    const alpha = Number(line.match(/,\s*(0?\.\d+)\)$/)?.[1]);
    assert.ok(alpha > 0 && alpha <= 0.18, `标记透明度超出范围：${line}`);
  });
  assert.match(readerCss, /text-decoration-line: none/);
  assert.doesNotMatch(readerCss, /text-decoration-thickness:/);
  assert.doesNotMatch(readerCss, /text-decoration-color:/);
});

test("通用文章识别覆盖更多语义正文容器", () => {
  assert.match(reader, /\[itemprop='articleBody'\]/);
  assert.match(reader, /\.post-body/);
  assert.match(reader, /\.article-body/);
  assert.match(reader, /\.story-body/);
  assert.match(reader, /\.markdown-body/);
});

test("译读覆盖散落正文，并向面板报告候选数和空结果", () => {
  assert.match(content, /collectLooseTextBlocks/);
  assert.match(content, /candidateCount/);
  assert.match(content, /auto-started-empty/);
  assert.match(popup, /当前屏未识别到英文正文/);
});

test("重新注入前清理同版本旧脚本，避免 Receiving end does not exist", () => {
  assert.match(readerBackground, /__SHUDU_TRANSLATION_CLEANUP__/);
  assert.match(readerBackground, /delete globalThis\.__SHUDU_TRANSLATION_VERSION__/);
  assert.match(readerBackground, /delete globalThis\.__SHUDU_READER_CONTENT_VERSION__/);
  assert.match(readerBackground, /舒读刚刚重新加载/);
  assert.match(popup, /舒读后台尚未启动/);
});

test("阅读器 UI、机器译文和收藏批注互不进入彼此的正文索引", async () => {
  const readerSource = await readFile(new URL("../content.js", import.meta.url), "utf8");
  const translationSource = await readFile(new URL("../translation.js", import.meta.url), "utf8");
  const collectorSource = await readFile(new URL("../collector/content.js", import.meta.url), "utf8");
  const blockSource = await readFile(new URL("../collector/content-blocks.js", import.meta.url), "utf8");
  const annotationSource = await readFile(new URL("../collector/annotations.js", import.meta.url), "utf8");
  assert.match(readerSource, /#shudu-annotation-layer-host/);
  assert.match(translationSource, /\[data-adhd-reader-ui='true'\]/);
  assert.match(collectorSource, /dataset\.adhdReaderUi = "true"/);
  assert.match(blockSource, /\[data-shudu-translation\]/);
  assert.match(annotationSource, /\[data-shudu-translation\]/);
});
