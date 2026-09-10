import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(new URL("./video-export.js", import.meta.url), "utf8");
const sandbox = {};
runInNewContext(source, sandbox);
const { matchingVideoExport, videoExportKey } = sandbox.SHUDU_VIDEO_EXPORT;

test("只接收两个指定视频助手的真实导出文件", () => {
  assert.deepEqual(
    { ...matchingVideoExport({
      id: 7,
      byExtensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      filename: "/home/example/Downloads/demo-transcript (2).txt"
    }) },
    {
      sourceExtensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source: "youtube-digest",
      filePath: "/home/example/Downloads/demo-transcript (2).txt"
    }
  );
  assert.equal(matchingVideoExport({
    byExtensionId: "unknown",
    filename: "/home/example/Downloads/demo-transcript.txt"
  }), null);
  assert.equal(matchingVideoExport({
    byExtensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    filename: "/home/example/Downloads/普通笔记.md"
  }), null);
});

test("下载完成记录使用下载编号、路径和完成时间去重", () => {
  assert.equal(
    videoExportKey({ id: 9, filename: "/tmp/a.md", endTime: "2026-08-26T10:00:00Z" }),
    "9:/tmp/a.md:2026-08-26T10:00:00Z"
  );
});
