"use strict";

const views = Object.freeze({
  reader: { src: "reader-popup.html", title: "阅读设置" },
  collector: { src: "collector/popup.html", title: "收藏与消化" }
});

const frame = document.querySelector("#featureFrame");
document.querySelector("#extensionVersion").textContent = `v${chrome.runtime.getManifest().version}`;
const tabs = [...document.querySelectorAll("[data-view]")];

function showView(view, { focus = false } = {}) {
  const nextView = views[view] ? view : "reader";
  const next = views[nextView];
  if (frame.getAttribute("src") !== next.src) frame.setAttribute("src", next.src);
  frame.setAttribute("title", next.title);
  tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.view === nextView)));
  localStorage.setItem("shuduActiveFeature", nextView);
  if (focus) tabs.find((tab) => tab.dataset.view === nextView)?.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    showView(next.dataset.view, { focus: true });
  });
});

const previewView = new URLSearchParams(location.search).get("view");
showView(previewView || localStorage.getItem("shuduActiveFeature") || "reader");
