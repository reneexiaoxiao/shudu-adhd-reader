import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./annotations.js", import.meta.url), "utf8");
const sandbox = { URL };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const { findQuoteMatch, normalizePageUrl, normalizeWhitespace, STYLE_IDS } = sandbox.ShuduAnnotations;

test("编辑想法先本地保存，再同步；同步失败可以重试", async () => {
  const synced = [];
  let fail = true;
  let saves = 0;
  const manager = new sandbox.ShuduAnnotations.AnnotationManager({
    onUpdate: async (annotation) => {
      if (fail) throw new Error("offline");
      synced.push(annotation);
    }
  });
  manager.annotations = [{ id: "a", quote: "原文", note: "旧想法", style: "marker-yellow" }];
  manager.saveCurrentPage = async () => { saves++; };
  manager.renderHighlights = () => {};
  manager.renderDots = () => {};
  await assert.rejects(manager.update("a", { note: "新想法" }), /offline/);
  assert.equal(manager.annotations[0].note, "新想法");
  assert.equal(saves, 1);
  fail = false;
  await manager.update("a", { note: "新想法" });
  assert.equal(synced.length, 1);
  assert.equal(synced[0].note, "新想法");
});

test("同一句重复出现时用前后文恢复到正确位置", () => {
  const text = "第一段里有一个共同判断。中间内容。第二段里也有一个共同判断，但结论不同。";
  const result = findQuoteMatch(text, "有一个共同判断", "第二段里也", "但结论不同");
  assert.equal(text.slice(result.start, result.end), "有一个共同判断");
  assert.equal(result.start, text.lastIndexOf("有一个共同判断"));
});

test("页面锚点忽略 hash 和常见追踪参数", () => {
  const value = normalizePageUrl("https://example.com/read?id=42&utm_source=x#chapter-2");
  assert.equal(value, "https://example.com/read?id=42");
});

test("页面锚点保留决定内容的查询参数", () => {
  const value = normalizePageUrl("https://example.com/read?chapter=3&id=42");
  assert.equal(value, "https://example.com/read?chapter=3&id=42");
});

test("划线支持四种可区分样式", () => {
  assert.deepEqual([...STYLE_IDS], ["marker-yellow", "underline-blue", "marker-green", "wavy-red"]);
});

test("定位时统一网页中的换行和多余空格", () => {
  assert.equal(normalizeWhitespace("一段\n  有间隔\t的文字"), "一段 有间隔 的文字");
});
