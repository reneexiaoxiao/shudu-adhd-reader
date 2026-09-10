import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
const read = p => readFile(new URL(p, import.meta.url), 'utf8');
test('三个面板共享主题且支持深色、键盘焦点和减少动态效果', async () => {
  for (const p of ['../popup.html', '../reader-popup.html', '../collector/popup.html']) {
    assert.match(await read(p), /ui-theme\.css/);
  }
  const theme = await read('../ui-theme.css');
  for (const token of ['prefers-color-scheme: dark', 'prefers-reduced-motion', ':focus-visible']) assert.ok(theme.includes(token));
  assert.doesNotMatch(theme, /transition:\s*all/);
});
test('手动标记透明，细线不盖住文字，不用 DOM 包裹替换原文', async () => {
  const source = await read('../collector/annotations.js');
  const rules = source.match(/::highlight\(shudu-annotation-[^\n]+/g);
  assert.equal(rules.length, 4);
  for (const line of rules) {
    const alpha = Number(line.match(/rgba\([^)]*,\s*(\.?\d+)\)/)?.[1]);
    assert.ok(alpha > 0 && alpha <= .52, line);
  }
  assert.match(source, /underline 1\.5px rgba/);
  assert.match(source, /underline wavy 1px rgba/);
  assert.doesNotMatch(source, /surroundContents/);
});
test('界面不暴露个人成绩或虚假隐私承诺', async () => {
  const html = await read('../reader-popup.html');
  assert.doesNotMatch(html, /personal-score|不上传正文 · 不改动原网页|chrome\.storage\.local/);
  assert.match(html, /英文将发送至智谱 API/);
});
