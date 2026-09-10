import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./content-blocks.js", import.meta.url), "utf8");
const sandbox = { URL };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const { extractContentBlocks, filterSelectionImages, firstMatchingElement, imageUrlFromElement } = sandbox.ShuduContentBlocks;

function text(value) {
  return { nodeType: 3, nodeValue: value };
}

function element(tagName, childNodes = [], attributes = {}) {
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes,
    ...attributes
  };
}

test("正文提取保留文字、图片、文字的网页顺序", () => {
  const imageUrl = "https://example.com/chart.png";
  const root = element("article", [
    element("p", [text("第一段说明。")]),
    element("section", [
      element("img", [], { currentSrc: imageUrl })
    ]),
    element("p", [text("第二段结论。")])
  ]);

  const blocks = extractContentBlocks(root, [
    { url: imageUrl, alt: "关键图表" }
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(blocks)),
    [
      { type: "text", text: "第一段说明。" },
      { type: "image", url: imageUrl, alt: "关键图表" },
      { type: "text", text: "第二段结论。" }
    ]
  );
});

test("只采集已通过内容图片筛选的图片", () => {
  const contentUrl = "https://example.com/content.png";
  const root = element("div", [
    text("正文"),
    element("img", [], { currentSrc: "https://example.com/logo.png" }),
    element("img", [], { currentSrc: contentUrl })
  ]);
  const blocks = extractContentBlocks(root, [{ url: contentUrl, alt: "" }]);
  assert.equal(blocks.filter((block) => block.type === "image").length, 1);
  assert.equal(blocks.some((block) => block.url?.includes("logo.png")), false);
});

test("X 图片 URL 与原有高清地址规则一致", () => {
  const url = imageUrlFromElement({
    currentSrc: "https://pbs.twimg.com/media/example.jpg?format=jpg&name=small"
  });
  assert.match(url, /name=orig/);
});

test("正文容器按选择器优先级查找，不被外层 main 抢先", () => {
  const article = { id: "article-content" };
  const main = { id: "whole-page" };
  const calls = [];
  const document = {
    querySelector(selector) {
      calls.push(selector);
      return selector === ".blog-post-content" ? article : selector === "main" ? main : null;
    }
  };
  const result = firstMatchingElement(document, ["article", ".blog-post-content", "main"]);
  assert.equal(result, article);
  assert.deepEqual(calls, ["article", ".blog-post-content"]);
});

test("正文块跳过表单、页脚和隐藏的 Webflow 状态文案", () => {
  const root = element("main", [
    element("p", [text("有效正文")]),
    element("form", [text("Sign up for our newsletter")]),
    element("div", [text("Thank you! Your submission has been received!")], { className: "w-form-done" }),
    element("footer", [text("Get a demo")])
  ]);
  const blocks = extractContentBlocks(root, [{ url: "https://example.com/unmatched.png" }]);
  assert.equal(blocks.map((block) => block.text || "").join("\n"), "有效正文");
});

test("正文块保留沉浸式翻译原文并跳过译文节点", () => {
  const root = element("article", [
    element("p", [
      text("Agent = Model + Harness"),
      element("font", [text("代理 = 模型 + 支架")], {
        className: "notranslate immersive-translate-target-wrapper"
      })
    ]),
    element("p", [
      text("Original paragraph."),
      element("span", [text("译文段落。")], {
        hasAttribute(name) {
          return name === "data-immersive-translate-translation-element-mark";
        }
      })
    ])
  ]);
  const blocks = extractContentBlocks(root, []);
  assert.equal(
    blocks.map((block) => block.text || "").join("\n\n"),
    "Agent = Model + Harness\n\nOriginal paragraph."
  );
});

test("划线收藏只保留用户勾选的附近图片和对应图片块", () => {
  const keep = "https://example.com/nearby.png";
  const drop = "https://example.com/far-away.png";
  const result = filterSelectionImages({
    images: [{ url: keep }, { url: drop }],
    contentBlocks: [
      { type: "text", text: "划线内容" },
      { type: "image", url: keep },
      { type: "image", url: drop }
    ]
  }, [keep]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.images)), [{ url: keep }]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.contentBlocks)),
    [{ type: "text", text: "划线内容" }, { type: "image", url: keep }]
  );
});
