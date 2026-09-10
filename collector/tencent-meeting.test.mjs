import assert from "node:assert/strict";

await import("./tencent-meeting.js");

const helper = globalThis.ShuduTencentMeeting;

assert.equal(helper.timestampSeconds("07:28"), 448);
assert.equal(helper.timestampSeconds("2:45:14"), 9914);
assert.equal(helper.timestampSeconds("bad"), null);
assert.equal(helper.isRecordingPage({ hostname: "meeting.tencent.com", pathname: "/cw/abc" }), true);
assert.equal(
  helper.isRecordingPage({ hostname: "meeting.tencent.com", pathname: "/meeting-record/shares" }),
  true
);
assert.equal(helper.isRecordingPage({ hostname: "meeting.tencent.com", pathname: "/home" }), false);

const normalized = helper.normalizeSegments([
  { timestamp: "10:00", text: "讲者\n10:00\n第二段", order: 2 },
  { timestamp: "07:28", text: "讲者\n07:28\n第一段", order: 1 },
  { timestamp: "07:28", text: "讲者\n07:28\n第一段", order: 9 }
]);

assert.deepEqual(normalized.map((item) => item.timestamp), ["07:28", "10:00"]);
assert.equal(normalized.length, 2);

console.log("tencent-meeting tests passed");
