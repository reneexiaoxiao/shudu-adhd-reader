(() => {
  const sources = Object.freeze({
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: {
      source: "youtube-digest",
      filePattern: /-transcript(?: \(\d+\))?\.txt$/
    },
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: {
      source: "bilibili-digest",
      filePattern: /-学习稿(?: \(\d+\))?\.md$/
    }
  });

  function matchingVideoExport(downloadItem) {
    const config = sources[String(downloadItem?.byExtensionId || "")];
    const filename = String(downloadItem?.filename || "");
    if (!config || !filename || !config.filePattern.test(filename)) return null;
    return {
      sourceExtensionId: downloadItem.byExtensionId,
      source: config.source,
      filePath: filename
    };
  }

  function videoExportKey(downloadItem) {
    return [
      downloadItem?.id,
      downloadItem?.filename,
      downloadItem?.endTime || ""
    ].join(":");
  }

  globalThis.SHUDU_VIDEO_EXPORT = {
    matchingVideoExport,
    videoExportKey
  };
})();
