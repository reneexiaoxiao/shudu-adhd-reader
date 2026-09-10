import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const modeSource = await readFile(new URL("./collection-mode.js", import.meta.url), "utf8");
const contentSource = await readFile(new URL("./content.js", import.meta.url), "utf8");
const backgroundSource = await readFile(new URL("./background-module.js", import.meta.url), "utf8");
const annotationSource = await readFile(new URL("./annotations.js", import.meta.url), "utf8");

function setup(enabled = false) {
  const store = { shuduCollectionEnabled: enabled };
  const calls = { fetch: [], messages: [], menus: [], tabs: [] };
  const event = () => ({ addListener() {}, removeListener() {} });
  const sandbox = { URL, AbortController, console, setTimeout, clearTimeout,
    fetch: async (...args) => { calls.fetch.push(args); return { ok: true, json: async () => ({ ok: true }) }; },
    canonicalUrl: () => "https://example.com/article", document: { title: "文章" },
    chrome: {
      storage: { local: {
        get: async (key) => ({ [key]: structuredClone(store[key]) }),
        set: async (values) => Object.assign(store, structuredClone(values))
      }, onChanged: event() },
      runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), sendMessage: async (message) => { calls.messages.push(message); return { ok: true }; } },
      alarms: { create() {}, clear: async () => true, onAlarm: event() },
      contextMenus: { removeAll(callback) { callback(); }, create(menu) { calls.menus.push(menu); }, onClicked: event() },
      downloads: { onChanged: event(), search: async () => { throw Error("Downloads must not be accessed in local mode"); } },
      commands: { onCommand: event() }, tabs: { create: async (tab) => { calls.tabs.push(tab); } }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(modeSource, sandbox);
  const onUpdateText = contentSource.slice(contentSource.indexOf("onUpdate: async (annotation) => {") + "onUpdate: ".length,
    contentSource.indexOf("\n  });\n  if (annotationManager)"));
  sandbox.onUpdate = vm.runInContext(`(${onUpdateText.trim()})`, sandbox);
  return { sandbox, calls, store };
}

test("显式选择优先于个人版和公开版的默认值", async () => {
  const { sandbox, store } = setup(false);
  assert.equal(await sandbox.ShuduCollectionMode.isEnabled(), false);
  await assert.rejects(sandbox.ShuduCollectionMode.requireEnabled(), /收藏同步已关闭/);
  store.shuduCollectionEnabled = true;
  assert.equal(await sandbox.ShuduCollectionMode.isEnabled(), true);
  delete store.shuduCollectionEnabled;
  const expected = /const DEFAULT_ENABLED = true;/.test(modeSource);
  assert.equal(await sandbox.ShuduCollectionMode.isEnabled(), expected);
});

test("本机模式编辑评论后可从存储恢复，关闭或重开同步不删除批注", async () => {
  const { sandbox, calls, store } = setup(false);
  vm.runInContext(annotationSource, sandbox);
  const manager = new sandbox.ShuduAnnotations.AnnotationManager({
    document: sandbox.document, storage: sandbox.chrome.storage.local, onUpdate: sandbox.onUpdate
  });
  manager.pageKey = "https://example.com/article";
  manager.annotations = [{ id: "a", quote: "原文", note: "", style: "marker-yellow" }];
  manager.renderHighlights = manager.renderDots = () => {};
  await manager.update("a", { note: "本机评论" });
  const restored = await manager.getStore();
  assert.equal(restored[manager.pageKey].annotations[0].note, "本机评论");
  assert.equal(calls.messages.length, 0);
  store.shuduCollectionEnabled = true;
  await manager.update("a", { note: "同步评论" });
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].type, "SYNC_ANNOTATION_NOTE");
  store.shuduCollectionEnabled = false;
  assert.equal((await manager.getStore())[manager.pageKey].annotations.length, 1);
});

test("本机模式在后台拒绝收藏网络请求、自动导入和打开 Obsidian", async () => {
  const { sandbox, calls } = setup(false);
  let listener;
  sandbox.chrome.runtime.onMessage.addListener = (fn) => { listener = fn; };
  vm.runInContext(backgroundSource, sandbox);
  for (const type of ["POPUP_SAVE", "INLINE_SAVE_SELECTION", "SYNC_ANNOTATION_NOTE", "OPEN_OBSIDIAN_DASHBOARD", "WEREAD_SYNC_NOW"]) {
    const result = await new Promise((resolve) => listener({ type, data: {} }, {}, resolve));
    assert.equal(result.ok, false);
    assert.match(result.error, /收藏同步已关闭/);
  }
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.tabs.length, 0);
  assert.equal(calls.menus.length, 0);
});
