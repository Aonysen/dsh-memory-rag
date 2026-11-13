# Changelog

## 1.1.3

- 图标重绘：以侧视大脑为模板，去掉头部轮廓与脑干；改为**等宽笔画**
  （统一 2px，圆头圆角），画布提升到 64×64，`docs/icon-180.png` 同步更新。

## 1.1.2

- 新图标：黑白线条风的大脑（`icon.svg`，36×36 透明底、白色脑体 + 黑色褶皱线），
  替换原来的蓝紫渐变方块；同时更新 `docs/icon-180.png` 市场卡片图。

## 1.1.1

- 插件详情页（插件 → 详细介绍）改为显示专门的简介文档：`locale/*.json` 的
  `meta.detail` 指向 `docs/intro.zh.md` / `docs/intro.en.md`，不再依赖 README 兜底。
- 发布产物新增这两个简介文件（`files`），从 npm 安装时详情页同样可用。

## 1.1.0

安全与并发修复版。

- **多进程丢写修复**：写入前 `refreshIfChanged()` 重读磁盘，`compact()` 同样先重读；
  读路径（list/get/stats）也会检测磁盘变化。A 进程不会再用手里的陈旧内存覆盖
  B 进程刚写入的记录；桌面端也能看到 CLI 的写入而无需重启。
- **锁不再阻塞事件循环 3 秒**：同步等待上限改为 `lockWaitMs`（默认 100ms），
  超时抛 `StoreBusyError`；工具层与设置页的写入改为异步退避重试（约 2.5s 预算）。
- **`rag_ingest` 增加读取边界**：`ingestDeny` 默认拒绝 `~/.ssh`、`~/.aws`、`~/.gnupg`、
  `~/.config`、`%APPDATA%`、`C:\Windows`、`/etc` 等；`ingestRoots` 可选白名单；
  工作目录之外的路径默认给出"内容会发往嵌入端点"的警告（可配 `deny`/`allow`）。
- **Key 存储加固**：`keyStorage: auto` 时优先写 DSH 凭据服务，回退文件；
  Windows 上对 `api-key` 尽力执行 `icacls` 收紧 ACL；README 明确标注明文文件的边界。
- **规模护栏**：`largeStoreWarning`（默认 20000）触发 `rag_stats` 提示；
  README 新增实测数据（1k/5k/20k 条查询耗时与内存）与「规模与限制」。
- 修正 `lib/search.js`、`lib/chunk.js` 的旧插件名注释；`maxInjectChars` 截断改为
  按行边界（不再切半行）。
- 单测 94 → 104，新增跨实例丢写回归、忙锁、重试、ingest 边界与截断用例。

## 1.0.0

首个公开发布版本（0.x 为内部迭代，从未发布到 npm，不构成兼容承诺）。

- Agent 工具：`rag_search` / `rag_remember` / `rag_ingest` / `rag_forget` / `rag_stats`
- 三种运行模式：云端 OpenAI 兼容 embeddings / 本地 Ollama / 纯关键词 BM25
  （关键词模式无需 Key、无需联网、无需下载模型）
- 会话索引注入：本地渲染、零网络、前缀稳定
- 设置页：提供商、API Key（只写不读）、模型与维度、检索参数、连接测试、记忆库浏览
- 一级侧栏「记忆洞察」：KPI、每日新增、构成、标签、最近写入、存储、56 天活跃度
- 追加式 JSONL 向量库：跨进程写锁、墓碑压缩、模型/维度一致性守卫、旧数据迁移
- 94 个离线单测；Apache-2.0
## 0.6.0

- **更名为 `dsh-memory-rag`**（避开同名插件 `dsh-rag-memory`）：包名、插件 row id、
  客户端模块 id 与设置/洞察 API 前缀（`/dsh-memory-rag/api/*`）一并更新。
- 数据目录保持不变（`<DSH_HOME>/memories/dsh-rag-memory/`），升级无需迁移。
- 面板 id 与设置分区 id 保持 `rag-memory` / `rag-memory-insights` 不变。
## 0.5.0

- **一级侧栏页面「记忆洞察」**：侧栏注册面板入口（`sidebar.panellist`），
  页面挂到同 id 的 `main` keyed slot；风格对齐 dsh-context 洞察页
  （KPI 卡片、柱状图、环形图、进度条、标签条形、最近写入、存储、活跃度热力图）。
- 新增 `GET /dashboard?days=7|30|90`：按条目时间戳推导每日新增、构成、作用域、
  标签、文件分组、存储占用与 56 天活跃度；纯本地计算，不联网。
- 新增 `lib/dashboard.js` 与单测（共 94 个用例）。

## 0.4.1

- **设置页新增「运行状况」面板**：模式（云端/本地模型/关键词）、端点、模型与维度、
  条目/笔记/文档块/项目/全局/置顶分布、存储占用、revision、写锁、tokens、
  最近 5 条写入、标签分布；默认 10 秒自动刷新（可关）。
- **设置页新增「记忆库」浏览器**：按关键词搜索、分页浏览、置顶/取消置顶、删除。
- 新增宿主 API：`GET /status`、`GET /memories`、`POST /memories/update`。
- `MemoryStore.updateMeta()`：追加同 id 记录覆盖元数据（置顶无需重写整库）。
- 单测增至 90 个。

## 0.4.0

- **本地关键词模式 `provider: keyword`**：纯 BM25（Intl.Segmenter 分词 + CJK 双字 +
  内存倒排索引），零依赖、零网络、零模型、无需 API Key，装完即用。
- **本地 Ollama 可用**：`keyOptional` 的 provider 在无 Key 时不再报错，也不发鉴权头；
  配合 `provider: ollama` + `bge-m3` / `nomic-embed-text` 可全程本机推理。
- 设置页：提供商新增「本地关键词」，关键词模式下隐藏端点/模型/维度字段，
  Key 状态显示「无需 Key」，测试连接直接返回关键词模式。
- 从向量模式切到关键词模式**不需要清库**（关键词只读文本）；切回向量仍需清库重建。
- 新增 `lib/bm25.js` 与对应单测（共 82 个用例）。

## 0.3.0

- 更名 `dsh-rag-memory`：从「Qwen 专用」扩展为**任意 OpenAI 兼容 embeddings 端点**。
- 提供商预设：千问（国内/国际）、硅基流动、OpenAI、本地 Ollama、自定义。
- 设置页：提供商切换、Key 管理、模型/维度、检索与注入参数、连接测试、拉取模型列表。
- 修复桌面端 `dsh-app://` 页面的跨源请求（CORS 预检 + 允许头），并保留回环/同源校验。
- 写入加跨进程锁（`.write.lock`），墓碑超过阈值时自动压缩索引。
- 数据目录更名，首次启动自动从旧的 `memories/dsh-qwen-rag` 复制（保留原件）。
- 客户端文案支持中/英（跟随浏览器语言）；补齐表单可访问性属性。
- 补齐发布元数据：Apache-2.0、`dsh.compatibility`、`engines.dsh`、英文 README、CI。

## 0.2.1

- 设置页跨源修复：`Access-Control-Allow-Origin` / 预检（`OPTIONS`）。
- 索引按文件聚合展示；文件块标题改为「文件名 · 首个标题」。

## 0.2.0

- 新增设置页与宿主 API：`/settings`、`/key`、`/test`。
- 设置持久化到 `<memoryDir>/settings.json`，优先级高于 cordis 配置。
- 记忆库非空时拒绝更换模型/维度。

## 0.1.0

- 首个版本：`rag_search` / `rag_remember` / `rag_ingest` / `rag_forget` / `rag_stats`。
- 追加式 JSONL 向量库、会话索引注入、千问 `text-embedding-v4`。
