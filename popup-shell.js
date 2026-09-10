"use strict";

const views = Object.freeze({
  reader: { src: "reader-popup.html", title: "阅读设置" },
  collector: { src: "collector/popup.html", title: "收藏与消化" }
});

const frame = document.querySelector("#featureFrame");
document.querySelector("#extensionVersion").textContent = `v${chrome.runtime.getManifest().version}`;
const tabs = [...document.querySelectorAll("[data-view]")];
const collectionToggle = document.querySelector("#collectionEnabled");
const collectionStatus = document.querySelector("#collectionModeStatus");
let collectionEnabled = false;

function showView(view, { focus = false } = {}) {
  const nextView = views[view] && (view !== "collector" || collectionEnabled) ? view : "reader";
  const next = views[nextView];
  if (frame.getAttribute("src") !== next.src) frame.setAttribute("src", next.src);
  frame.setAttribute("title", next.title);
  tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.view === nextView)));
  localStorage.setItem("shuduActiveFeature", nextView);
  if (focus) tabs.find((tab) => tab.dataset.view === nextView)?.focus();
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const visibleTabs = tabs.filter((item) => !item.hidden);
    const index = visibleTabs.indexOf(tab);
    const next = visibleTabs[(index + offset + visibleTabs.length) % visibleTabs.length];
    showView(next.dataset.view, { focus: true });
  });
});

const previewView = new URLSearchParams(location.search).get("view");
function renderCollectionMode(enabled) {
  collectionEnabled = enabled;
  collectionToggle.checked = enabled;
  document.querySelector("#collectorTab").hidden = !enabled;
  document.querySelector(".feature-tabs").classList.toggle("local-only", !enabled);
  collectionStatus.textContent = enabled
    ? "划线同时收藏，评论同步到 Obsidian；需启动本机收藏服务。"
    : "仅本机划线与评论，不收藏、不连接 Obsidian。";
  if (!enabled) showView("reader");
}
async function initializeCollectionMode() {
  try {
    const savedView = previewView || localStorage.getItem("shuduActiveFeature") || "reader";
    renderCollectionMode(await ShuduCollectionMode.isEnabled());
    showView(savedView);
    collectionToggle.disabled = false;
  } catch {
    renderCollectionMode(false);
    collectionStatus.textContent = "设置读取失败，请重新打开舒读。";
  }
}
collectionToggle.addEventListener("change", async () => {
  const enabled = collectionToggle.checked;
  collectionToggle.disabled = true;
  try {
    await chrome.storage.local.set({ [ShuduCollectionMode.KEY]: enabled });
    renderCollectionMode(enabled);
  } catch {
    collectionToggle.checked = collectionEnabled;
    collectionStatus.textContent = "设置保存失败，请重试。";
  } finally { collectionToggle.disabled = false; }
});
initializeCollectionMode();
