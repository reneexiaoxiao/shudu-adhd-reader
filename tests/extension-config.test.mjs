import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const popup = await readFile(new URL("../popup.js", import.meta.url), "utf8");
const content = await readFile(new URL("../translation.js", import.meta.url), "utf8");
const reader = await readFile(new URL("../content.js", import.meta.url), "utf8");
const readerCss = await readFile(new URL("../reader.css", import.meta.url), "utf8");

test("0.4.3 打包智能译读脚本、样式、后台和快捷键", () => {
  assert.equal(manifest.version, "0.4.3");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.content_scripts[0].js, ["translation-core.js", "content.js", "translation.js"]);
  assert.deepEqual(manifest.content_scripts[0].css, ["reader.css", "translation.css"]);
  assert.equal(manifest.commands["toggle-translation"].suggested_key.mac, "Alt+Shift+F");
});

test("AI 内参自动运行且只扩展文章列，不把侧栏识别为正文", () => {
  assert.ok(manifest.host_permissions.includes("https://ai.candobear.com/*"));
  assert.ok(manifest.content_scripts[0].matches.includes("https://ai.candobear.com/*"));
  assert.match(popup, /ai\.candobear\.com/);
  assert.match(reader, /function discoverNeican/);
  assert.match(reader, /\.prose\.entry, \.prose/);
  assert.match(reader, /closest\("\[class~='max-w-3xl'\]"\)/);
  assert.match(readerCss, /data-adhd-site="neican"/);
});

test("只调用智谱标准开放平台端点，不误用 Coding Plan", () => {
  assert.match(background, /https:\/\/open\.bigmodel\.cn\/api\/paas\/v4\/chat\/completions/);
  assert.doesNotMatch(background, /api\/coding\/paas/);
  assert.match(background, /glm-5\.2/);
});

test("API Key 仅由本机 storage.local 读取，不存在源码默认值", () => {
  assert.match(background, /shuduZhipuApiKey/);
  assert.match(background, /chrome\.storage\.local/);
  assert.doesNotMatch(background, /const\s+API_KEY\s*=\s*["'][^"']+["']/);
  assert.match(popup, /chrome\.storage\.local\.set/);
  assert.doesNotMatch(popup, /chrome\.storage\.sync[^\n]*shuduZhipuApiKey/);
});

test("动态补译使用滚动与 MutationObserver，译文不改写原文", () => {
  assert.match(content, /document\.addEventListener\("scroll"/);
  assert.match(content, /new MutationObserver/);
  assert.match(content, /entry\.element\.append\(wrapper\)/);
  assert.doesNotMatch(content, /entry\.element\.replace/);
});

test("普通英文文章锁定文章容器，不再把每个英文单词画成粗标记", () => {
  assert.match(reader, /"\.blog-content"/);
  assert.match(reader, /"\.prose"/);
  assert.match(reader, /dataSet|dataset\.adhdScript|adhdScript/);
  assert.doesNotMatch(reader, /addMatches\(\/\\b\(\[A-Za-z\]\[A-Za-z0-9\._\+\\\-\/\]\{2,24\}\)\\b\/g/);
  assert.match(readerCss, /adhd-reader-latin-concept/);
  assert.match(readerCss, /text-decoration-thickness: 0\.18em/);
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
  assert.match(background, /__SHUDU_TRANSLATION_CLEANUP__/);
  assert.match(background, /delete globalThis\.__SHUDU_TRANSLATION_VERSION__/);
  assert.match(background, /delete globalThis\.__SHUDU_READER_CONTENT_VERSION__/);
  assert.match(background, /舒读刚刚重新加载/);
  assert.match(popup, /舒读后台尚未启动/);
});
