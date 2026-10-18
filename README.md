# 戴卫得AI工作台

一个装在 **Obsidian** 里的自媒体工作台：每天自动刷信息流、出选题、写公众号、准备 X（推特）帖子和评论、整理学习笔记。

它不用 API Key，直接调用你电脑上已经登录好的 **Claude Code** 或 **Codex（ChatGPT）**，用的是你自己的订阅额度。所有数据都存在你自己的电脑里。

> 作者：戴卫得（X：[@davidtangX](https://x.com/davidtangX)）。这是我自己每天在用的工具，整理出来分享给大家。

---

## 先搞懂几个词（新手必看）

| 词 | 是什么 |
| --- | --- |
| **Obsidian** | 一个免费的本地笔记软件，所有笔记都是你电脑上的普通文件。官网：[obsidian.md](https://obsidian.md) |
| **库（Vault）** | Obsidian 里的一个「笔记文件夹」。你打开 Obsidian 时选的那个文件夹就是库 |
| **插件** | 给 Obsidian 加功能的小程序。分两种：官方「社区插件市场」里能直接搜到安装的，和像本工作台这样手动放进去的 |
| **Claude Code / Codex** | Anthropic 和 OpenAI 出的命令行 AI 助手。装好并登录一次，工作台就能借用它们来写东西 |
| **Skill** | 一份写给 AI 的「做事说明书」（一个文件夹，里面有 SKILL.md）。比如「卡兹克写作 Skill」教 AI 用卡兹克的方法写公众号 |

---

## 它能做什么

工作台顶部有这些页面（顺序可以在 `公众号写作台/模块排列.json` 里调）：

- **微信公众号**：每天早上自动出选题 → 选一个 → 自动写大纲和正文 → 选中任意一段可以让 AI 改写、扩写、配图 → 一键复制成公众号格式。内嵌了 Gary（曹淦）开源的 [content-workbench](https://github.com/garycaogan/content-workbench)，可以批注改稿、推到公众号草稿箱。
- **X 发帖台**：每天按你的作息时间排好要发的帖子（长文、串、单条、引用转发），自动配图；「评论雷达」帮你找热帖并写好推荐回复。点「去发」会打开 X 的发帖框，最后点发送的永远是你自己。
- **信息流**：把 RSS、YouTube 频道、公众号、你的网页剪藏汇在一起，每条可以一键变成公众号选题或 X 帖子。
- **学习**：本地知识库 + 书架，读 EPUB/PDF、划线、AI 翻译和朗读（配合乔木 Reader 更好用）。
- **生财有术**：连接生财有术官方接口看社群内容（需要你自己有生财有术账号）。
- **自媒体视频**：把选题做成竖屏口播视频的脚本和素材。
- **本周 / 历史**：本周发了什么、内容配比提醒、历史稿件。
- **Skill 收集**：自动扫描你电脑上所有的 AI Skill 并分类，方便挑着用。

还附带：
- **浏览器助手**（`公众号写作台/浏览器助手`）：一个 Chrome 扩展。在 X 网页上显示粉丝数，一键出评论灵感、引用观点、存素材；还能把稿子存进公众号草稿箱。
- **命令行入口**（`assets/scripts/david-workbench.cjs`）：让 Claude Code、Codex 等 AI 直接操作工作台，说明见 `公众号写作台/CLI使用说明.md`。

---

## 安装前要准备的

| 必需 | 说明 |
| --- | --- |
| Mac 电脑 | 目前只在 macOS 上用过 |
| [Obsidian](https://obsidian.md) 1.5 以上 | 下载安装，新建或打开一个库 |
| [Node.js](https://nodejs.org) LTS 版 | 装插件依赖用，下载安装包一路下一步 |
| Claude Code **或** Codex，二选一或都装 | 装好后在「终端」里运行一次 `claude` 或 `codex` 并登录。工作台默认用 Codex（GPT），在插件设置里可以改 |

| 可选 | 用来干嘛 |
| --- | --- |
| Google Chrome | 装浏览器助手 |
| ffmpeg（终端运行 `brew install ffmpeg`） | 处理视频 |

---

## 安装（3 步）

**第 1 步：下载**

点这个页面右上角绿色的 **Code → Download ZIP**，解压。或者用终端：

```bash
git clone https://github.com/David-code-tang/daiweide-ai-workbench.git
```

**第 2 步：运行安装脚本**

打开「终端」，把下面引号里的路径换成你自己的 Obsidian 库路径（不知道路径？在访达里把库文件夹直接拖进终端窗口就会自动填好）：

```bash
cd daiweide-ai-workbench
bash install.sh "/Users/你的用户名/Documents/你的库"
```

脚本会：把插件放进库的 `.obsidian/plugins/gzh-studio`，把工作台文件夹放进库里的 `公众号写作台`，安装依赖，下载 uv。你库里已有的同名文件不会被覆盖。

**第 3 步：在 Obsidian 里打开**

1. 完全退出 Obsidian 再打开。
2. 设置 → 第三方插件 → 关闭「安全模式」→ 在「已安装插件」里打开 **戴卫得AI工作台**。
3. 左边栏点报纸图标（或命令面板 `Cmd+P` 搜「打开写作台」）。第一次打开有新手指引。
4. 插件设置里点「检测 Claude Code 和 Codex」，确认能找到。

<details>
<summary>不想用脚本？手动安装</summary>

1. 把 `plugin/gzh-studio` 整个文件夹复制到 `你的库/.obsidian/plugins/` 下面（`.obsidian` 是隐藏文件夹，访达里按 `Cmd+Shift+.` 显示）。
2. 把 `vault-folder/公众号写作台` 复制到库的根目录；`vault-folder/assets/scripts/david-workbench.cjs` 复制到 `你的库/assets/scripts/`。
3. 终端进入 `你的库/.obsidian/plugins/gzh-studio`，运行 `npm install --omit=dev`。
4. 想用「微信公众号」页的内容工作台：装 [uv](https://docs.astral.sh/uv/)，把 `uv` 可执行文件放到 `gzh-studio/bin/uv`。
5. 按上面第 3 步打开。
</details>

### 装浏览器助手（可选）

1. Chrome 地址栏打开 `chrome://extensions`，右上角打开「开发者模式」。
2. 点「加载已解压的扩展程序」，选你库里的 `公众号写作台/浏览器助手` 文件夹。
3. Obsidian 要开着，扩展才连得上工作台。详细用法见 `浏览器助手/使用说明.md`。

---

## 第一次用，改成你自己的

工作台原本是按我的账号调的，你需要改成你自己：

1. **写作规则**：`公众号写作台/规则/写作规则.md`，写你的读者是谁、语气、不想用的词。改完马上生效。
2. **X 规则**：第一次打开 X 发帖台会自动生成 `规则/X写作规则.md`，把里面的「账号定位」改成你自己的。
3. **插件设置**：填你的 X 账号、每天发几条、作息时间（几点到几点能发）、每个动作用哪个模型、禁用词。
4. **微信公众号页的人设**：这页内嵌的内容工作台有自己的设置，第一次打开时把作者名、身份、写作领域改成你自己的。
5. **信息源**：`规则/信息源过滤.md` 里屏蔽你不想看的来源。
6. **Skill**：想让 AI 用某种写法，把 Skill 文件夹放进 `公众号写作台/skills/`，在设置里选。说明见 `skills/怎么加自己的 Skill.md`。

日常怎么用，看 `公众号写作台/使用说明.md`。

---

## 我参考和配合使用的插件

工作台很多设计参考了 **向阳乔木**（[@vista8](https://x.com/vista8)）的开源插件，有几个和工作台是联动的（比如学习页的书架读的是乔木 Reader 的书库，信息流的「我的剪藏」读的是乔木剪藏存下来的网页）。

👉 完整清单和新手说明：**[推荐插件.md](./推荐插件.md)**

---

## 注意

- 会占用你 Claude / ChatGPT 订阅的额度。登录过期时，在终端运行 `claude` 或 `codex` 重新登录。
- 工作台只帮你准备内容、填好发帖框或放进草稿箱，**不会替你点发布**。
- 本仓库不含我的任何个人数据、稿件、API Key 或登录信息。

## 致谢与授权

- 「微信公众号」页内嵌的 `content-workbench` 来自 Gary（曹淦）：[garycaogan/content-workbench](https://github.com/garycaogan/content-workbench)，MIT 协议，原版授权文件在 `plugin/gzh-studio/content-workbench/LICENSE`。
- `skills/khazix-writer` 来自数字生命卡兹克：[KKKKhazix/khazix-skills](https://github.com/KKKKhazix/khazix-skills)，MIT 协议。
- `skills/keke-podcast-to-article` 来自 sunkeke-ai，MIT 协议。
- 设计参考了向阳乔木的 Obsidian 插件系列：[github.com/joeseesun](https://github.com/joeseesun)。
- 以上第三方部分各自沿用原作者的授权协议。
