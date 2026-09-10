import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./selection-context.js", import.meta.url), "utf8");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const { selectionDataFrom } = sandbox.ShuduSelectionContext;

function element(tagName, innerText, parentElement = null) {
  const item = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    innerText,
    textContent: innerText,
    parentElement,
    ownerDocument: parentElement?.ownerDocument,
    matches(selector) {
      if (selector === "section, div") {
        return tagName === "section" || tagName === "div";
      }
      return selector
        .split(",")
        .map((value) => value.trim())
        .some((value) => value === tagName || (value === "[role='paragraph']" && item.role === "paragraph"));
    },
    closest(selector) {
      for (let current = item; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    }
  };
  return item;
}

function textNode(parentElement) {
  return { nodeType: 3, parentElement };
}

function selection(text, startContainer, endContainer) {
  return {
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => ({ startContainer, endContainer })
  };
}

test("跨多个内联节点时只取共同的最近段落", () => {
  const body = element("body", "");
  body.ownerDocument = { body };
  const article = element("div", "文章开头\n目标段落\n文章结尾", body);
  const paragraph = element("p", "目标段落的完整文字。", article);
  const firstSpan = element("span", "目标段落", paragraph);
  const secondSpan = element("span", "的完整文字。", paragraph);

  const result = selectionDataFrom(
    selection("目标段落的完整文字", textNode(firstSpan), textNode(secondSpan))
  );
  assert.equal(result.selectionContext, "目标段落的完整文字。");
  assert.equal(result.selectionContext.includes("文章开头"), false);
});

test("跨两个段落时只保留起止段落", () => {
  const body = element("body", "");
  body.ownerDocument = { body };
  const article = element("div", "开头\n第一段\n第二段\n结尾", body);
  const first = element("p", "第一段完整文字。", article);
  const second = element("p", "第二段完整文字。", article);

  const result = selectionDataFrom(
    selection("第一段到第二段", textNode(first), textNode(second))
  );
  assert.equal(result.selectionContext, "第一段完整文字。\n\n第二段完整文字。");
});

test("找不到段落且最近容器是文章全文时不写上下文", () => {
  const body = element("body", "");
  body.ownerDocument = { body };
  const article = element("div", "文章全文。".repeat(1000), body);
  const span = element("span", "一小段划线", article);

  const result = selectionDataFrom(
    selection("一小段划线", textNode(span), textNode(span))
  );
  assert.equal(result.selectionContext, "");
});
