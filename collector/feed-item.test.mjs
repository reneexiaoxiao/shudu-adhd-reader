import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./feed-item.js", import.meta.url), "utf8");
const sandbox = { URL };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const helper = sandbox.ShuduFeedItem;

function anchor(href) {
  return { href, getAttribute: () => href };
}

function item({
  text,
  selectors = {},
  links = [],
  rect = { width: 600, height: 180, top: 100, right: 900, left: 300 },
  matches = () => true
}) {
  return {
    nodeType: 1,
    innerText: text,
    textContent: text,
    parentElement: null,
    ownerDocument: { body: {}, documentElement: {} },
    matches,
    querySelector(selector) {
      return selectors[selector] || null;
    },
    querySelectorAll(selector) {
      return selector === "a[href]" ? links : [];
    },
    getBoundingClientRect: () => rect
  };
}

test("只在 X、即刻和知识星球启用单条收藏", () => {
  assert.equal(helper.siteTypeForLocation({ hostname: "x.com" }), "twitter");
  assert.equal(helper.siteTypeForLocation({ hostname: "web.okjike.com" }), "jike");
  assert.equal(helper.siteTypeForLocation({ hostname: "wx.zsxq.com" }), "zsxq");
  assert.equal(helper.siteTypeForLocation({ hostname: "example.com" }), "");
});

test("X 单条内容使用推文永久链接和正文", () => {
  const root = item({
    text: "Shudu\n正文内容",
    links: [anchor("https://x.com/shudu/status/123456")],
    selectors: {
      '[data-testid="tweetText"]': { innerText: "这是一条值得收藏的推文" },
      '[data-testid="User-Name"]': { innerText: "Shudu\n@shudu" },
      "time[datetime]": { dateTime: "2026-08-13T01:00:00.000Z" }
    }
  });
  const result = helper.extractItem(root, "twitter", { href: "https://x.com/home" });
  assert.equal(result.url, "https://x.com/shudu/status/123456");
  assert.equal(result.text, "这是一条值得收藏的推文");
  assert.equal(result.author, "Shudu");
  assert.equal(result.dedupeByUrl, true);
  assert.equal(result.collectionId, "");
});

test("知识星球没有永久链接时使用内容身份，避免不同卡片合并成整页", () => {
  const root = item({ text: "ledao\n2026-08-13 09:13\n一条独立的星球内容\n查看详情" });
  const result = helper.extractItem(root, "zsxq", { href: "https://wx.zsxq.com/dweb2/index/group/123" });
  assert.equal(result.url, "https://wx.zsxq.com/dweb2/index/group/123");
  assert.match(result.collectionId, /^feed:zsxq:/);
  assert.equal(result.dedupeByUrl, false);
  assert.match(result.text, /一条独立的星球内容/);
  assert.doesNotMatch(result.text, /查看详情/);
});

test("收藏点固定在卡片内侧，不再隔着会触发隐藏的空隙", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(helper.computeLauncherPosition(
      { top: 100, left: 200, right: 700, height: 80 },
      { width: 32, height: 32 },
      { width: 1000, height: 800 }
    ))),
    { left: 658, top: 124, placement: "inside-right" }
  );
  assert.equal(
    helper.computeLauncherPosition(
      { top: 100, left: 300, right: 980, height: 180 },
      { width: 280, height: 40 },
      { width: 1000, height: 800 }
    ).placement,
    "inside-right"
  );
});

test("知识星球短段落卡片仍可识别并预提取为稳定快照", () => {
  const root = item({
    text: "Preston\n2026-08-14 11:09\n凡是不赚钱的人，脑子都非常复杂。赚钱只需要高判断力和简单的执行力。\n这句话来自纳瓦尔。\n查看详情",
    rect: { width: 920, height: 150, top: 220, right: 1510, left: 590 }
  });
  assert.equal(helper.findItemRoot(root, "zsxq", 1170), root);
  const snapshot = helper.extractItem(root, "zsxq", {
    href: "https://wx.zsxq.com/dweb2/index/group/123"
  });
  assert.match(snapshot.title, /凡是不赚钱的人/);
  assert.match(snapshot.collectionId, /^feed:zsxq:/);
  assert.equal(snapshot.dedupeByUrl, false);
});

test("知识星球单行且没有查看详情的卡片仍会显示收藏入口", () => {
  const root = item({
    text: "Preston\n2026-08-14 11:09\n孤独对我来说，是莫大的幸福。",
    rect: { width: 920, height: 40, top: 220, right: 1510, left: 590 },
    matches: () => false
  });
  const textLeaf = item({
    text: "孤独对我来说，是莫大的幸福。",
    rect: { width: 420, height: 20, top: 230, right: 1050, left: 630 },
    matches: () => false
  });
  textLeaf.parentElement = root;

  assert.equal(helper.findItemRoot(textLeaf, "zsxq", 1170), root);
  assert.match(
    helper.extractItem(root, "zsxq", { href: "https://wx.zsxq.com/dweb2/index/group/123" }).text,
    /孤独对我来说/
  );
});
