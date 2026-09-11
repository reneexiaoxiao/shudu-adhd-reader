# 本机收藏服务接入

客户端启用收藏同步后请求 `http://127.0.0.1:8765`；公开版默认关闭收藏同步。本仓库不附带作者的私人服务，也尚未提供通用服务安装包、Vault 选择器和个人画像编辑界面。

不接服务时，排版、本机划线评论及配置 API 后的译读仍可使用。只有开启收藏同步后，收藏、目录加载和 Obsidian 同步才会请求服务；未部署兼容服务时会提示不可用。

目录列表和个性化处理由接入者自己的服务提供，不应假定用户拥有作者的 Vault、目录结构或画像。“分析和我的关系”标志不是一份内置画像，也不代表服务已经具备个性化分析能力。

所有响应为 JSON；失败使用合适的 HTTP 错误码与 `{ "ok": false, "error": "可操作的错误提示" }`。需要验证请求来源、限制大小并拒绝任意文件路径与外部命令。

## 核心端点

| 方法与路径 | 输入 | 响应 |
| --- | --- | --- |
| GET `/collection-destinations` | 无 | `{ok:true,destinations:[{id,label,parent,builtIn}]}` |
| POST `/collection-destinations` | `{label,parent}` | `{ok:true,destination:{id,label,parent,builtIn:false}}` |
| POST `/collection-preview` | 提取后的文章数据 | `{ok:true,preview:{source,category,digestTarget}}` |
| POST `/collect` | 下述收藏数据 | `{ok:true,collection:{id,title,category,imageCount,enrichmentQueued,personalized,conceptMapQueued}}` |
| POST `/annotation-note` | `{url,title,selection,selectionContext,note}` | `{ok:true}`，必须在目标笔记更新成功后返回 |

`/collect` 可包含 `url`、`canonicalUrl`、`title`、`text`、`selection`、`selectionContext`、`contentBlocks`、`images`、`note`、`mode`、`category`、`digestTarget`、`enrich`、`personalize`、`conceptMap`。以 `collector/background-module.js` 的 `savePayload` 为准；图片可能含下载后的 base64 数据。服务端应保留文字和图片顺序，按 URL 与摘录身份去重。

批注更新必须只修改对应摘录的个人想法，不覆盖用户手写内容；空 note 表示清除此条想法。服务端不支持的高级能力应明确返回错误，不应声称完成分析或同步。

## 可选集成

微信读书上传队列、视频导入和私人概念地图属于可选服务能力。公开版不默认调度微信读书同步；视频助手 ID 已替换为示例 ID，需自行配置并审查风险后启用。作者本机的 LaunchAgent、磁盘目录、画像、文章和模型凭据不会随扩展发布。

公开版的“打开 Obsidian”只打开应用，不携带作者的 Vault 名称或仪表盘路径。
