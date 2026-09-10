import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./content.js", import.meta.url), "utf8");
const actions = source.slice(source.indexOf("  async function saveInlineSelection("),
  source.indexOf("  function showToolbar("));

function setup() {
  const calls = { annotations: [], collections: [], statuses: [] };
  const state = { collectionOk: true, annotationError: false };
  const buttons = [{ disabled: false }];
  const shadow = { querySelectorAll: () => buttons };
  const sandbox = {
    selectionSnapshot: { selection: "选中的正文", selectionContext: "上下文", range: {}, nearbyImages: [] },
    toolbarBusy: false, selectionTimer: null,
    clearTimeout() {}, setTimeout() {}, hideToolbar() {},
    window: { getSelection: () => ({ removeAllRanges() {} }) },
    limitText: (text, length) => text.slice(0, length),
    toolbarStatus: (_shadow, message, status) => calls.statuses.push({ message, status }),
    extractPageData: async () => ({ title: "文章", url: "https://example.com/article" }),
    annotationManager: {
      async create(annotation) {
        if (state.annotationError) throw new Error("划线保存失败");
        calls.annotations.push(annotation);
      }
    },
    chrome: { runtime: { async sendMessage(message) {
      calls.collections.push(message);
      return state.collectionOk ? { ok: true } : { ok: false, error: "收藏服务未连接" };
    } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(actions, sandbox);
  return { calls, state, sandbox, shadow, buttons };
}

test("点一次划线，同时保存指定样式和收藏正文", async () => {
  const { sandbox, shadow, calls } = setup();
  await sandbox.saveInlineAnnotation(shadow, "underline-blue", "我的笔记");
  assert.equal(calls.annotations.length, 1);
  assert.equal(calls.annotations[0].style, "underline-blue");
  assert.equal(calls.collections.length, 1);
  assert.equal(calls.collections[0].type, "INLINE_SAVE_SELECTION");
  assert.equal(calls.collections[0].data.selection, "选中的正文");
  assert.equal(calls.collections[0].note, "我的笔记");
  assert.equal(calls.statuses.at(-1).message, "已批注并收藏");
});

test("单独收藏不新增划线", async () => {
  const { sandbox, shadow, calls } = setup();
  await sandbox.saveInlineSelection(shadow);
  assert.equal(calls.annotations.length, 0);
  assert.equal(calls.collections.length, 1);
  assert.equal(calls.statuses.at(-1).message, "已收藏");
});

test("收藏失败后重试不会重复创建已保存的划线", async () => {
  const { sandbox, shadow, calls, state, buttons } = setup();
  state.collectionOk = false;
  await sandbox.saveInlineAnnotation(shadow);
  assert.match(calls.statuses.at(-1).message, /划线已保存，收藏失败/);
  assert.equal(buttons[0].disabled, false);
  state.collectionOk = true;
  await sandbox.saveInlineAnnotation(shadow);
  assert.equal(calls.annotations.length, 1);
  assert.equal(calls.collections.length, 2);
  assert.equal(calls.statuses.at(-1).message, "已划线并收藏");
});

test("划线保存失败不会提交收藏或显示成功", async () => {
  const { sandbox, shadow, calls, state } = setup();
  state.annotationError = true;
  await sandbox.saveInlineAnnotation(shadow);
  assert.equal(calls.collections.length, 0);
  assert.equal(calls.statuses.at(-1).status, "error");
});

test("连续点击划线只触发一份划线和一份收藏", async () => {
  const { sandbox, shadow, calls } = setup();
  await Promise.all([sandbox.saveInlineAnnotation(shadow), sandbox.saveInlineAnnotation(shadow)]);
  assert.equal(calls.annotations.length, 1);
  assert.equal(calls.collections.length, 1);
});
