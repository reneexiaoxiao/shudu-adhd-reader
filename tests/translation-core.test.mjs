import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../translation-core.js", import.meta.url), "utf8");
const context = { globalThis: {} };
vm.runInNewContext(source, context);
const core = context.globalThis.ShuduTranslationCore;

const blocks = [
  {
    id: "shudu-first-0",
    tag: "p",
    text: "A brittle consensus can obscure the trade-offs that matter most."
  },
  {
    id: "shudu-second-1",
    tag: "p",
    text: "Good teams make useful things and learn every day."
  }
];

test("只识别以英文为主的正文", () => {
  assert.equal(core.isTranslatableText(blocks[0].text, "P"), true);
  assert.equal(core.isTranslatableText("这是一段已经翻译完成的中文。", "P"), false);
  assert.equal(core.isTranslatableText("https://example.com", "P"), false);
});

test("六级 524 档明确保留 B2+/C1 表达且不拿基础词凑数", () => {
  const prompt = core.buildPrompt({ blocks, retention: "cet6", page: { title: "Test", language: "en" } });
  assert.match(prompt, /六级 524/);
  assert.match(prompt, /3-5 个/);
  assert.match(prompt, /A1-B1 基础词/);
  assert.match(prompt, /一段都不能遗漏/);
  assert.match(prompt, /不可信原文/);
});

test("学习词过滤基础词、重复词和原文外词", () => {
  const terms = core.cleanLearningTerms([
    { term: "good", gloss: "好" },
    { term: "brittle consensus", gloss: "脆弱的共识" },
    { term: "Brittle consensus", gloss: "重复" },
    { term: "epistemic closure", gloss: "原文不存在" }
  ], blocks[0].text);
  assert.deepEqual(JSON.parse(JSON.stringify(terms)), [
    { term: "brittle consensus", gloss: "脆弱的共识" }
  ]);
});

test("结构化结果逐段校验并报告漏译", () => {
  const result = core.normalizeTranslationBatch(blocks, JSON.stringify({
    translations: [
      {
        id: blocks[0].id,
        translation: "一种 brittle consensus（脆弱的共识）会遮蔽真正重要的取舍。",
        learningTerms: [
          { term: "brittle consensus", gloss: "脆弱的共识" },
          { term: "good", gloss: "好" }
        ]
      }
    ]
  }), "cet6");
  assert.equal(result.translations.length, 1);
  assert.deepEqual([...result.missing], [blocks[1].id]);
  assert.equal(result.translations[0].learningTerms.length, 1);
});

test("缓存键按模型、保留档位和正文区分", () => {
  const first = core.cacheKey(blocks[0], "glm-5.2", "cet6");
  assert.equal(first, core.cacheKey({ ...blocks[0], id: "shudu-other-9" }, "glm-5.2", "cet6"));
  assert.notEqual(first, core.cacheKey(blocks[0], "glm-5.2", "intensive"));
  assert.notEqual(first, core.cacheKey(blocks[0], "glm-other", "cet6"));
});
