(() => {
  "use strict";
  const KEY = "shuduCollectionEnabled";
  // Existing personal installations retain their collection workflow.
  // The public export changes this default to false, without changing stored choices.
  const DEFAULT_ENABLED = false;
  async function isEnabled() {
    const stored = await chrome.storage.local.get(KEY);
    return typeof stored[KEY] === "boolean" ? stored[KEY] : DEFAULT_ENABLED;
  }
  async function requireEnabled() {
    if (!await isEnabled()) throw new Error("收藏同步已关闭；如需收藏，请在舒读中开启收藏同步");
  }
  globalThis.ShuduCollectionMode = Object.freeze({ KEY, isEnabled, requireEnabled });
})();
