# 戴卫得工作台 CLI

入口为知识库根目录的 `assets/scripts/david-workbench.cjs`。供 Codex、Claude Code 等本地 AI 调用，返回标准 JSON。需要 Obsidian 正在运行且已启用工作台插件。此版通过本地文件队列调用插件的原有业务方法，不需要 API key，也不监听网络端口。

```bash
node assets/scripts/david-workbench.cjs help
node assets/scripts/david-workbench.cjs status
node assets/scripts/david-workbench.cjs topics.list '{"stage":"准备中"}'
node assets/scripts/david-workbench.cjs x.list
node assets/scripts/david-workbench.cjs feed.list '{"limit":20}'
```

使用绝对入口路径也可以从任意目录运行。所有稿件路径均相对于知识库根目录。

## 现有命令

| 命令 | 功能 |
| --- | --- |
| status | 检查插件连接、忙碌任务、命令与参数说明 |
| topics.list | 查看累计选题，按阶段和标题筛选 |
| topics.update | 改选题阶段、分类和配色 |
| topics.create-draft | 用日期和选题 ID 建立或复用稿件 |
| topics.generate | 使用工作台原有模型与规则追加一批选题 |
| draft.read | 读大纲、正文、文件版本 hash，以及画布是否有未保存修改 |
| draft.set-outline | 替换大纲，正文保持原样，自动备份完整旧稿 |
| draft.set-body | 替换正文，大纲保持原样，自动备份完整旧稿 |
| draft.write | 按文件中已保存的大纲生成／重写正文，先备份旧稿 |
| feed.list | 查看信息流，支持关键词与数量筛选 |
| feed.refresh | 调用现有信息源刷新流程 |
| x.list | 查看跨天累计的 X 待发与候补，不返回历史已发 |
| x.add | 新增待发帖子，自动生成 id，校验版本并备份队列 |
| x.update | 按日期和 id 替换待发帖子的指定字段，校验版本并备份 |
| x.remove | 按日期和 id 从待发队列删除条目，不标记已发布，校验版本并备份 |
| x.complete | 用户明确已发后，从待发队列中移除，不执行平台发布 |
| job | 查询耗时任务的结果 |

第一版未接入视频、配图、Skill 管理和外部发布。不得把生成、推送草稿或打开发布页面视为已经发布。

## AI 调用规则

1. 先调用 `status`，使用返回的命令参数，不猜测业务方法。
2. 修改稿件前调用 `draft.read`，把返回的 `hash` 作为 `expectedHash`。版本过期时重新读取，不能强制覆盖。
3. 大纲和正文是两个独立字段。新的写作要求应先整理成大纲，再调用 `draft.set-outline`；获得新 hash 后调用 `draft.write`。不能把要求写进正文后以为大纲已经更新。
4. `draft.write` 会重写当前正文，需用户已经授权该稿件的重写。旧稿完整保存在工作台 `版本` 目录，返回 `backup` 路径。
5. 若 `unsavedCanvas` 为 true，先处理画布修改。CLI 拒绝覆盖存在未保存编辑的稿件。
6. 只有用户明确确认已经发布某条帖子，才调用 `x.complete`。不提供推断已发布的命令。
7. 返回 `pending` 或 `running` 不是完成，必须根据任务 ID 查询。不得重复提交同一个耗时操作。

建议把长文本参数先写入临时 JSON 文件，避免 shell 引号破坏中文、换行、反引号和美元符号。

```bash
node assets/scripts/david-workbench.cjs draft.set-outline --args-file /tmp/workbench-outline.json
node assets/scripts/david-workbench.cjs draft.write --args-file /tmp/workbench-write.json --wait 10
node assets/scripts/david-workbench.cjs job 任务编号
```

参数文件示例，其中 hash 必须来自最近一次读取或保存的返回值。

```json
{"path":"公众号写作台/稿件/文章.md","text":"新大纲内容","expectedHash":"读取结果中的hash"}
```

## X 待发队列写入

**更新代码后，需要在 Obsidian 里重载戴卫得工作台插件，新命令才能生效。**

数据源是工作台根目录下的 `X/每日/YYYY-MM-DD.json`，默认位于 `公众号写作台/X/每日/`。`x.list` 使用 `loadPostTimeline` 查找跨天记录，返回原始队列快照及每日版本。原有 `x.complete` 使用 `loadDay`、`mutateDay` 标记 `posted`，本次三个写入命令不调用它，也不发布内容、不启动生成或配图。

先读取目标日期的版本，即使那天还没有队列文件也要读取。

```bash
node assets/scripts/david-workbench.cjs x.list '{"postDate":"2026-10-13"}'
```

取返回的 `result.versions["2026-10-13"].hash` 作为 `expectedHash`。`postDate` 不过滤其他日期的列表，只保证返回目标日期的版本。每次成功写入返回新的 `result.hash`、`backup`、`id` 和 `postDate`；新增和更新还返回 `item`。下例的 hash 与 id 均须替换为实际返回值，每一步使用最新 hash。

```bash
node assets/scripts/david-workbench.cjs x.add '{"postDate":"2026-10-13","expectedHash":"当天hash","text":"待发正文","bj":"18:00","kind":"single","arche":"工具教程型","source":{"url":"https://example.com","title":"来源标题"}}'
node assets/scripts/david-workbench.cjs x.update '{"postDate":"2026-10-13","id":"新增返回的id","expectedHash":"新增返回的hash","text":"替换后的完整正文","bj":"19:00"}'
node assets/scripts/david-workbench.cjs x.remove '{"postDate":"2026-10-13","id":"新增返回的id","expectedHash":"更新返回的hash"}'
```

- 三个命令都必须传 `postDate`、`expectedHash`。更新和删除还必须传 `id`，同日 id 重复时拒绝操作。`postDate` 是队列所属日期，更新时不用于跨日搬移。
- 新增必须有非空 `text`。`id` 自动生成，`status` 固定为 `ready`。默认 `kind` 为 `single`、`bj` 为 `17:00`、`arche` 为 `工具教程型`、`source` 为 `{}`。
- 可写字段仅为 `text`、`bj`、`kind`、`arche`、`source`、`parts`、`title`、`outline`、`five`、`imagePrompt`。未知字段一律拒绝，包括嵌套对象中的未知字段。客户端不能指定 id、发布状态、素材库关联或其他内部字段；更新保留已有内部字段。
- `bj` 为北京时间 `HH:mm`；`kind` 为 `single`、`thread` 或 `article`。`source` 仅允许字符串字段 `url`、`tweetUrl`、`author`、`title`，非空链接须为 HTTP(S)。`five` 仅允许字符串字段 `promise`、`scene`、`entry`、`evidence`、`keep`。`parts`、`outline` 为非空字符串数组，其余可写字段为字符串。
- 更新至少指定一个可写字段，指定字段整体替换，未指定字段保持原值。`parts` 只适用于串帖，至少两条，且 `text` 等于首条；只改串帖 `text` 时同步首条，只改 `parts` 时同步 `text`，两者一起传入须一致。
- 更新和删除只操作 `items` 中未标记 `posted`／`skipped` 的条目。删除从数组移除条目，保留候补 `pool` 和其他记录；不把条目标记为已发，也不删除任何队列文件。素材库关联记录不会被此命令同步修改。
- 版本针对整个当天文件，其他条目变化也会导致冲突。冲突后重新 `x.list` 检查内容，再提交；不能强制覆盖。
- 写入前将完整旧文件逐字备份到工作台 `版本/CLI-X-*.json`，`backup` 为库内相对路径。首次创建队列时备份内容为 JSON `null`，表示原文件不存在。备份失败就停止写入。
- 原始 `mutateDay` 没有版本检查，因此新命令同步执行 hash 检查、备份、再次检查和原子替换，期间不让出插件事件循环。此校验不约束其他进程或已经在运行的旧异步写入；生成和界面保存完成后再调用写入命令。

长正文仍建议使用 `--args-file`。

## 任务等待与限制

默认等待 10 秒，可设置 `--wait 0` 至 `--wait 60`。成功状态为 `completed`，失败为 `failed` 并返回非零退出码。任务在当前用户临时目录中保存，系统清理临时目录后不能继续查旧任务。插件重载或退出期间不要启动生成任务；若运行中的任务被中断，需要先检查稿件实际内容，不能盲目重新提交。

刷新与生成沿用工作台现有模型、登录和信息源配置，CLI 本身不产生模型费用。模型命令仍会使用对应订阅额度。外部发布仍使用原有界面，由用户确认。

## 实现与验证

- 插件桥接模块：`公众号写作台/工作台接口.cjs`。
- 客户端入口：`assets/scripts/david-workbench.cjs`。
- 插件启动时加载桥接模块，插件关闭时关闭本地接口。
- 已验证真实的状态、准备中选题、信息流、X 待发和稿件读取。
- 已通过隔离测试验证版本冲突、未保存画布拦截、大纲与正文独立替换、备份、路径限制和未知命令拒绝。
- X 写入隔离测试入口为 `node --test 公众号写作台/工作台接口.test.cjs`。仅在系统临时目录创建合成队列副本，覆盖新增、字段替换、删除、版本冲突、备份、非法参数和串帖一致性，不调用真实插件或 `x.complete`。

## 第二版命令（2026-10-13，配合「今日」页）

**更新后需要彻底退出并重开 Obsidian，新命令才会生效。** `status` 返回 `version: 2` 即为新版。

| 命令 | 功能 |
| --- | --- |
| x.today | 今日页的全部内容：发帖和评论的完成数与目标、涨粉进度、今天的帖子（带发帖形式 `format` 和行动建议 `plan`）、今天的评论 |
| x.generate | 从信息流热点补一批候选（引用转发为主，新闻最多 2 条） |
| x.fill-library | 从博主素材库挑高收藏、没用过的内容改写成原创，默认 5 条 |
| x.write-candidates | 把待写候选依次写成帖子 |
| x.convert | 改发帖形式：quote 引用转发、reply 回复原帖、single、thread、article。博主素材只能改成原创形式 |
| x.rewrite | 按一句话要求改写，可带链接，会一起读原帖和链接内容 |
| x.restore | 把已归档或「不发了」的帖子放回今天 |
| radar.list | 今天待回的评论（`all:true` 包含往日） |
| radar.refresh | 找一批评论帖，`batch` 为 13:00、18:00 或 22:00（北京时间） |
| radar.update | 改某条评论的回复文字 |
| radar.complete | 用户确认已回复后记一条 |
| radar.remove | 拿掉不合适的评论 |
| growth.get / growth.set | 查看或记录粉丝数，返回离一万粉还差多少、需日均多少 |
| library.reminders | 哪些博主素材快用完或该更新 |

- `x.list` 不再返回已归档的帖子，每条多了 `format` 和 `plan` 两个字段。
- 生成和改写类命令耗时较长，建议加 `--wait 60`，超时后用 `job 任务编号` 查结果。
- 只有用户明确说发了或回了，才调用 `x.complete`、`radar.complete`。

### 行业快讯（2026-10-13）
- `x.news` `{count?:1-10, model?}`：从 X/快讯源.md 的英文一手源 + XHunt 全球榜挑新消息，写成中文快讯（引用转发），自动配原帖截图。返回 `{added}`。
- `x.source-shot` `{date, id}`：把某条帖子的配图换成原帖截图（原帖有图就标红关键句，没图就画原帖卡片）。

### X 收藏（2026-10-14）
- `bookmarks.import`：读 X 收藏，导入博主素材库「我的收藏」。返回 `{added}`。
- `bookmarks.pending`：已经导入、还没取消收藏的清单。
- `bookmarks.remove` `{ids?}`：取消收藏（只取消已导入的；不填 ids 就全部）。
