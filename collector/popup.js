const categories = [
  "AI 与技术",
  "视频与播客",
  "组织与管理",
  "商业与战略",
  "产品与增长",
  "认知与学习",
  "消费与零售",
  "个人成长",
  "其他"
];

const elements = {
  loading: document.querySelector("#loading"),
  form: document.querySelector("#form"),
  source: document.querySelector("#source"),
  mode: document.querySelector("#mode"),
  title: document.querySelector("#title"),
  selection: document.querySelector("#selection"),
  category: document.querySelector("#category"),
  digestTarget: document.querySelector("#digest-target"),
  destinationCreator: document.querySelector("#destination-creator"),
  destinationName: document.querySelector("#destination-name"),
  destinationParent: document.querySelector("#destination-parent"),
  createDestination: document.querySelector("#create-destination"),
  cancelDestination: document.querySelector("#cancel-destination"),
  destinationStatus: document.querySelector("#destination-status"),
  note: document.querySelector("#note"),
  saveImages: document.querySelector("#save-images"),
  imageCount: document.querySelector("#image-count"),
  enrich: document.querySelector("#enrich"),
  personalize: document.querySelector("#personalize"),
  conceptMap: document.querySelector("#concept-map"),
  save: document.querySelector("#save"),
  result: document.querySelector("#result"),
  dashboard: document.querySelector("#dashboard")
};

let pageData = null;
let mode = "page";
let destinations = [];
let chosenDestination = "concept";
let conceptMapTouched = false;

function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function extractFreshPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) throw new Error("没有可收藏的页面");
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [
      "collector/collection-mode.js",
      "collector/content-blocks.js",
      "collector/selection-context.js",
      "collector/selection-toolbar.js",
      "collector/annotations.js",
      "collector/feed-item.js",
      "collector/tencent-meeting.js",
      "collector/content.js"
    ]
  });
  return chrome.tabs.sendMessage(tab.id, { type: "SHUDU_EXTRACT_PAGE_150" });
}

function showResult(message, isError = false) {
  elements.result.hidden = false;
  elements.result.textContent = message;
  elements.result.classList.toggle("error", isError);
}

function destinationOption(destination) {
  const option = document.createElement("option");
  option.value = destination.id;
  option.textContent = destination.builtIn
    ? destination.label
    : `${destination.label} · 自定义`;
  return option;
}

function renderDestinations(selected = "") {
  elements.digestTarget.replaceChildren();
  const parents = ["video", "concept", "method", "research", "case", "project", "archive"];
  const ordered = [...destinations].sort((a, b) => {
    const aIndex = parents.indexOf(a.parent || a.id);
    const bIndex = parents.indexOf(b.parent || b.id);
    if (aIndex !== bIndex) return aIndex - bIndex;
    if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
    return a.label.localeCompare(b.label, "zh-CN");
  });
  for (const destination of ordered) {
    elements.digestTarget.append(destinationOption(destination));
  }
  const create = document.createElement("option");
  create.value = "__new__";
  create.textContent = "＋ 新建消化库…";
  elements.digestTarget.append(create);
  if (selected && ordered.some((item) => item.id === selected)) {
    elements.digestTarget.value = selected;
  }
}

function showDestinationCreator(show) {
  elements.destinationCreator.hidden = !show;
  elements.destinationStatus.hidden = true;
  elements.destinationStatus.classList.remove("error");
  if (show) {
    elements.destinationName.value = "";
    elements.destinationName.focus();
  }
}

async function loadDestinations() {
  const response = await send({ type: "POPUP_DESTINATIONS" });
  if (!response?.ok) throw new Error(response?.error || "读取消化库失败");
  destinations = response.destinations || [];
  renderDestinations();
}

async function init() {
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    elements.category.append(option);
  }

  try {
    await loadDestinations();
    const extracted = await extractFreshPage().catch(() => send({ type: "POPUP_EXTRACT" }));
    if (!extracted?.ok) throw new Error(extracted?.error || "读取页面失败");
    pageData = extracted.data;
    const isYoutube = pageData.siteType === "youtube";
    mode = isYoutube ? "page" : pageData.selection ? "selection" : "page";
    const preview = await send({ type: "POPUP_PREVIEW", data: pageData });
    if (!preview?.ok) throw new Error(preview?.error || "本地收藏服务未启动");

    elements.source.textContent = preview.preview.source;
    const meetingTranscript = pageData.tencentMeetingTranscript;
    elements.mode.textContent = meetingTranscript
      ? meetingTranscript.complete
        ? `完整逐字稿 · ${meetingTranscript.firstTimestamp}–${meetingTranscript.lastTimestamp} · ${meetingTranscript.segmentCount} 段`
        : `逐字稿未抓全 · ${meetingTranscript.reason || "请重试"}`
      : isYoutube ? "视频稍后看" : mode === "selection" ? "划线收藏" : "整页收藏";
    elements.title.textContent = pageData.title;
    elements.category.value = preview.preview.category;
    renderDestinations(preview.preview.digestTarget);
    chosenDestination = preview.preview.digestTarget;
    elements.conceptMap.checked = preview.preview.digestTarget === "concept";
    elements.imageCount.textContent = `(${pageData.images?.length || 0})`;
    if (pageData.selection) {
      elements.selection.hidden = false;
      elements.selection.textContent = pageData.selection;
    }
    if (isYoutube) {
      elements.note.placeholder = "可记录为什么想看，或看完后要回答的问题";
      elements.save.textContent = "加入视频稍后看";
    } else {
      elements.save.textContent = mode === "selection" ? "收藏这段划线" : "收藏当前网页";
    }
    elements.loading.hidden = true;
    elements.form.hidden = false;
  } catch (error) {
    elements.loading.textContent = error.message;
    elements.loading.classList.add("error");
  }
}

elements.digestTarget.addEventListener("change", () => {
  if (elements.digestTarget.value === "__new__") {
    showDestinationCreator(true);
  } else {
    chosenDestination = elements.digestTarget.value;
    showDestinationCreator(false);
    if (!conceptMapTouched) {
      const selected = destinations.find((item) => item.id === elements.digestTarget.value);
      elements.conceptMap.checked = (selected?.parent || selected?.id) === "concept";
    }
  }
});

elements.conceptMap.addEventListener("change", () => {
  conceptMapTouched = true;
});

elements.personalize.addEventListener("change", () => {
  if (elements.personalize.checked) elements.enrich.checked = true;
});

elements.cancelDestination.addEventListener("click", () => {
  showDestinationCreator(false);
  renderDestinations(chosenDestination);
});

elements.createDestination.addEventListener("click", async () => {
  const label = elements.destinationName.value.trim();
  if (label.length < 2) {
    elements.destinationStatus.hidden = false;
    elements.destinationStatus.textContent = "请填写至少 2 个字的名称";
    elements.destinationStatus.classList.add("error");
    return;
  }
  elements.createDestination.disabled = true;
  elements.createDestination.textContent = "正在初始化…";
  elements.destinationStatus.hidden = true;
  try {
    const response = await send({
      type: "CREATE_DESTINATION",
      data: {
        label,
        parent: elements.destinationParent.value
      }
    });
    if (!response?.ok) throw new Error(response?.error || "创建失败");
    destinations = [
      ...destinations.filter((item) => item.id !== response.destination.id),
      response.destination
    ];
    chosenDestination = response.destination.id;
    renderDestinations(response.destination.id);
    if (!conceptMapTouched) {
      elements.conceptMap.checked = response.destination.parent === "concept";
    }
    showDestinationCreator(false);
    showResult(`已初始化“${response.destination.label}”，本次收藏会直接进入该分类建议。`);
  } catch (error) {
    elements.destinationStatus.hidden = false;
    elements.destinationStatus.textContent = error.message;
    elements.destinationStatus.classList.add("error");
  } finally {
    elements.createDestination.disabled = false;
    elements.createDestination.textContent = "创建并选中";
  }
});

elements.save.addEventListener("click", async () => {
  if (!pageData) return;
  if (elements.digestTarget.value === "__new__") {
    showResult("请先创建或选择一个消化库", true);
    return;
  }
  elements.save.disabled = true;
  elements.save.textContent = "正在保存…";
  elements.result.hidden = true;
  try {
    const response = await send({
      type: "POPUP_SAVE",
      data: pageData,
      options: {
        mode,
        category: elements.category.value,
        digestTarget: elements.digestTarget.value,
        note: elements.note.value.trim(),
        saveImages: elements.saveImages.checked,
        enrich: elements.enrich.checked || elements.personalize.checked,
        personalize: elements.personalize.checked,
        conceptMap: elements.conceptMap.checked
      }
    });
    if (!response?.ok) throw new Error(response?.error || "保存失败");
    const item = response.collection;
    const prefix = pageData.siteType === "youtube" ? "已加入稍后观看" : `已进入 ${item.category}`;
    showResult(`${prefix} · ${item.imageCount} 张原图${item.enrichmentQueued ? " · AI 消化中" : ""}${item.personalized ? " · 正在分析和你的关系" : ""}${item.conceptMapQueued ? " · 概念地图同步中" : ""}`);
    elements.save.textContent = "已收藏";
  } catch (error) {
    showResult(error.message, true);
    elements.save.disabled = false;
    elements.save.textContent = pageData?.siteType === "youtube"
      ? "加入视频稍后看"
      : mode === "selection" ? "收藏这段划线" : "收藏当前网页";
  }
});

elements.dashboard.addEventListener("click", () => {
  send({ type: "OPEN_OBSIDIAN_DASHBOARD" });
});

init();
