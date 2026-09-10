import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./selection-toolbar.js", import.meta.url), "utf8");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox);
const { computePosition, selectionAnchor, nearbyImageIndexes } = sandbox.ShuduSelectionToolbar;
const { computeDockPosition } = sandbox.ShuduSelectionToolbar;

test("选区在上半屏时浮条停靠底边，给原生菜单留出空间", () => {
  const result = computeDockPosition({ top: 110, bottom: 160 }, { width: 620, height: 42 }, { width: 1200, height: 800 });
  assert.equal(result.placement, "dock-bottom");
  assert.equal(result.top, 746);
  assert.ok(result.top > 160 + 80);
});

test("选区靠近底部时浮条停靠顶边", () => {
  const result = computeDockPosition({ top: 650, bottom: 760 }, { width: 620, height: 42 }, { width: 1200, height: 800 });
  assert.equal(result.placement, "dock-top");
  assert.equal(result.top, 12);
  assert.ok(result.top + 42 < 650 - 80);
});

test("展开图片和批注后仍按完整选区避让，窄屏位置在视口内", () => {
  const result = computeDockPosition({ top: 250, bottom: 580 }, { width: 294, height: 90 }, { width: 320, height: 640 });
  assert.equal(result.placement, "dock-top");
  assert.ok(result.left >= 0 && result.left + 294 <= 320);
  assert.ok(result.top + 90 < 250);
});

test("多行划线使用最后一行作为圆点锚点", () => {
  const first = { top: 100, right: 300, bottom: 124, left: 80, width: 220, height: 24 };
  const last = { top: 130, right: 210, bottom: 154, left: 80, width: 130, height: 24 };
  assert.equal(selectionAnchor([first, last], null), last);
});

test("空间足够时工具条显示在选区上方并对齐末端", () => {
  const result = computePosition(
    { top: 200, right: 500, bottom: 224, left: 200 },
    { width: 320, height: 42 },
    { width: 1200, height: 800 }
  );
  assert.equal(result.left, 180);
  assert.equal(result.top, 150);
  assert.equal(result.placement, "above-end");
});

test("选区靠近顶部时自动改到下方", () => {
  const result = computePosition(
    { top: 12, right: 500, bottom: 36, left: 200 },
    { width: 320, height: 42 },
    { width: 1200, height: 800 }
  );
  assert.equal(result.left, 180);
  assert.equal(result.top, 44);
  assert.equal(result.placement, "below-end");
});

test("窄窗口中展开菜单仍限制在视口范围内", () => {
  const result = computePosition(
    { top: 100, right: 300, bottom: 124, left: 260 },
    { width: 360, height: 42 },
    { width: 320, height: 480 }
  );
  assert.equal(result.left, 8);
  assert.equal(result.top, 50);
});

test("划线默认选择上方和下方各自最近的一张图片", () => {
  const result = nearbyImageIndexes(
    [
      { index: 0, top: -900, bottom: -500 },
      { index: 1, top: 100, bottom: 280 },
      { index: 2, top: 520, bottom: 720 },
      { index: 3, top: 1200, bottom: 1500 }
    ],
    { top: 360, bottom: 420 },
    900
  );
  assert.deepEqual([...result], [1, 2]);
});

test("距离过远的图片不会自动附带", () => {
  const result = nearbyImageIndexes(
    [
      { index: 0, top: -1600, bottom: -1300 },
      { index: 1, top: 2200, bottom: 2500 }
    ],
    { top: 300, bottom: 360 },
    1000
  );
  assert.deepEqual([...result], []);
});
