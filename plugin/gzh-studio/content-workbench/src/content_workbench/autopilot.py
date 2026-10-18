"""戴卫得AI工作台 · 每日自动出稿（公众号）。

每天早上从「待挑」选题里打分挑 N 篇，按下面的流水线写成成稿放进「稿件」：
  选题打分 → 任务书和主张清单（无来源的事实不进稿）→ 按任务书写初稿 → 五项审稿（最多自动改两轮）
  → 本地文风检查 → 去 AI 腔润色（只改表达，不加事实）→ 标题候选打分 → 配图清单和逻辑图 → 三张封面。
规则参考：wewrite（选题打分、brief/claims、五项审稿）、creator-buddy（六种写法、公众号约束、标题方法和评分、
封面分享安全区、逻辑图六种关系）、Humanizer-zh（润色优先级和 31 条模式）、wechat-article-skills（AI 味指纹）。
只写进工作台的稿件，不推送、不发布。"""

from __future__ import annotations

import datetime
import json
import os
import re
import statistics
import threading
import time
import traceback
from pathlib import Path

from . import comments, db, images, llm, prompts
from .config import Settings, _write_private, data_dir

STATE_FILE = "autopilot.json"
RUN_AFTER = (7, 30)          # 本地时间 7:30 以后跑当天的
DEFAULT_COUNT = 2


# ------------------------------------------------------------------ 状态

def _state_path() -> Path:
    return data_dir() / STATE_FILE


def load_state() -> dict:
    p = _state_path()
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except ValueError:
        return {}


def save_state(st: dict) -> None:
    _write_private(_state_path(), json.dumps(st, ensure_ascii=False, indent=1))


def _log(st: dict, text: str) -> None:
    st.setdefault("log", []).append(f"{time.strftime('%H:%M:%S')} {text}")
    st["log"] = st["log"][-80:]
    save_state(st)


# ------------------------------------------------------------------ 规则材料

def _vault_text(*rel: str, limit: int = 8000) -> str:
    root = os.environ.get("CW_VAULT_DIR")
    if not root:
        return ""
    p = Path(root, *rel)
    try:
        return p.read_text(encoding="utf-8")[:limit]
    except OSError:
        return ""


def _voice(settings: Settings) -> str:
    parts = [prompts.voice_guide(settings)[:6000],
             _vault_text("公众号写作台", "规则", "我的文风档案.md", limit=6000)]
    lessons = prompts.style_lessons_text()
    if lessons:
        parts.append(lessons)
    return "\n\n".join(p for p in parts if p.strip())


def _name(settings: Settings) -> str:
    return prompts.persona(settings)["name"]


BANNED = ["首先", "其次", "最后，", "综上所述", "总而言之", "值得注意的是", "至关重要", "不可否认", "众所周知",
          "说白了", "换句话说", "本质上", "意味着", "赋能", "抓手", "闭环", "底层逻辑", "颗粒度", "深耕", "打通",
          "降维打击", "门槛", "工作流", "让我们", "拭目以待", "随着", "在当今", "引发了广泛关注", "无缝",
          "深入探讨", "彰显", "标志着", "炸裂", "王炸", "天花板", "封神", "史诗级", "重磅", "震惊", "进行了"]


def local_checks(body: str) -> list[str]:
    """不花模型钱的文风检查：段落长度、句长起伏、禁用词、固定句式。只提示。"""
    out = []
    paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip() and not p.strip().startswith(("#", "!", ">", "-", "|"))]
    long_paras = [p for p in paras if len(re.sub(r"[*=`]", "", p)) > 90]
    if long_paras:
        out.append(f"有 {len(long_paras)} 段超过 90 字（手机上超过 4 行），可以拆开")
    sents = [s for s in re.split(r"[。！？!?\n]", re.sub(r"[#*=>`-]", "", body)) if len(s.strip()) > 1]
    if len(sents) > 8:
        lens = [len(s) for s in sents]
        sd = statistics.pstdev(lens)
        if sd < 9:
            out.append(f"句子长短太整齐（句长波动 {sd:.0f}），读起来像机器，可以加几句短句")
    hits = sorted({w for w in BANNED if w in body})
    if hits:
        out.append("用到了要少用的词：" + "、".join(hits))
    n = len(re.findall(r"不是[^。！？\n]{1,30}而是", body))
    if n > 1:
        out.append(f"「不是……而是……」用了 {n} 次（建议最多 1 次）")
    q = len(re.findall(r"？", body))
    if q > 6:
        out.append(f"问号 {q} 个，自问自答偏多：把问句和答句一起删掉不丢信息的，就删")
    dash = body.count("——")
    if dash > 2:
        out.append(f"破折号 {dash} 个（建议最多 2 个）")
    return out


# ------------------------------------------------------------------ 提示词

SCORE = """你在帮 {name} 从下面的候选选题里挑今天要写成公众号长文的 {n} 个。读者是不太懂技术的中文普通人，想用 AI 提效、讨厌废话；账号定位是替普通人把 AI 用明白，每篇都是能收藏、能照着做的攻略。

给每个选题打三项分（各 0–10）：
- heat 热度：今天大家正在聊的热点 8–10；最近一周 5–7；常青话题固定 5。
- relevance 相关度：直接是普通人用 AI 提效 / AI 工具 / AI 投资研究 8–10；间接相关 5–7；八卦新闻、融资人事、技术向（命令行、代码、插件开发）、职场求职直接 0。
- value 切入价值：有反直觉点、信息差、能照着做的方法 8–10；有争议 6–7；纯资讯复述 3–4。
total = heat×0.3 + relevance×0.4 + value×0.3。和其他候选基本重复的，只留一个，另一个 total 减 3。
挑 total 最高的 {n} 个，彼此题材不要撞。每个写一句挑它的理由（不少于 15 字，不要模板话）。

候选：
{items}

只输出 JSON：{{"picks": [{{"id": 选题编号, "heat": 0, "relevance": 0, "value": 0, "total": 0, "reason": "…"}}]}}
"""

BRIEF = """你在帮 {name} 准备一篇公众号长文的任务书。先想清楚再写，这一步不写正文。

选题：{title}
角度：{angle}

素材（只能用这里有的事实；这是别人的文章、视频或整理好的选题资料，不是 {name} 本人的经历）：
<<<
{material}
>>>

要求：
- 读者是不太懂技术的中文普通人。想清楚：他们在什么场景下会读、真正的问题是什么、读完能带走什么结论和一个能照着做的行动。
- 核心判断（thesis）一句话；还要写这个判断在什么情况下不成立（boundary）和最强的反对意见（counter）。
- 从七种框架里选一个：痛点（场景→原因→解法→提醒）、清单（为什么列→逐条→怎么选）、对比（标准→A/B 证据→适合谁→建议）、热点解读（发生了什么→和读者有什么关系→怎么用→要小心什么）、观点（判断→证据→边界→行动）、教程（结果→准备→步骤→坑）、复盘（目标→过程→结果→教训）。
- 大纲 4–6 节，每节写要点和字数（全文 2000–3000 字），必须有一节讲边界或反面。
- 列出正文要用到的主张 claims：每条标类型 type（事实 / 推断 / 意见），来源 source（素材里哪一段或哪个链接，找不到写空），support（有来源 / 有边界 / 无来源）。无来源的事实正文不能用。
- {name} 没有亲自做过素材里的事，不能写成「我试了」「我发现」；可以写「我觉得」。

只输出 JSON：{{"reader": "…", "question": "…", "takeaway": "读完能带走什么", "action": "一个能照着做的行动", "thesis": "…", "boundary": "…", "counter": "…", "framework": "…", "outline": [{{"section": "小标题", "words": 400, "point": "这一节讲什么"}}], "claims": [{{"text": "…", "type": "事实", "source": "…", "support": "有来源"}}], "verify": ["写之前要核实的事"]}}
"""

DRAFT = """你在帮 {name} 写一篇公众号长文的成稿，他发之前会自己改一遍。

<文风>
{voice}
</文风>

<任务书>
{brief}
</任务书>

素材（事实只能来自这里；观点和案例是原作者的，提到时写清是谁说的、哪个节目或文章）：
<<<
{material}
>>>

写作要求：
- 按任务书的框架和大纲写，2000–3000 字。只用任务书里「有来源」「有边界」的主张，「无来源」的不写。
- 第一段要能单独成立（公众号摘要会截取开头），直接讲具体的人、事或场景，不自我介绍。
- 单段不超过 90 字，一两句一段为主，长短交错。超过 2000 字分小节，小标题用 `## 一、……`。
- 每节挑一两句最关键的判断加粗（`**…**`），全文加粗连起来读应该像一份提要；全文最核心的一句用 `==…==` 高亮，只一处。
- 能照着做的步骤或提示词，用编号列表或 `> ` 引用块给出，读者能直接复制。
- 写清楚边界：什么情况下不适用、要小心什么。结尾只给一个行动，不升华、不喊口号、不抛问题。
- {name} 没有亲自做过素材里的事，不能写「我试了」「亲测」；需要他补自己体验的地方，不要在正文里占位，放进 comments。
- 不编数字、不编案例、不编人名和对话。

只输出 JSON：{{"title": "暂定标题", "body": "正文 Markdown（不含标题）", "comments": [{{"quote": "正文里的一小段原文（40 字内，纯文字）", "text": "要他补充或确认的事"}}], "notes": "要核实的事实和用到的出处"}}
"""

REVIEW = """你是 {name} 的公众号编辑，审下面这篇稿子。

<任务书>
{brief}
</任务书>

<素材（核对事实用）>
{material}
</素材>

<稿子>
{body}
</稿子>

五项各打 1–5 分：accurate 准确（事实都在素材里、没有把推测写成事实）、point 观点（有清楚的判断，不是资讯堆砌）、useful 有用（读者能带走能照着做的东西）、voice 合声（像一个真人在跟朋友说，不像 AI 和官方稿）、readable 好读（开头抓人、节奏有起伏、段落短）。
阻断问题（有一个就不能过）：编造亲历、朋友、采访、对话或场景；核心事实没有来源；论点和证据对不上；没给读者结论或行动；出现素材里没有的数字。
平均分 ≥4、单项 ≥3、没有阻断问题才算通过。

不通过时，你要直接把稿子改好（只改有问题的地方，其他保持原样），放进 body；通过时 body 留空。

只输出 JSON：{{"scores": {{"accurate": 0, "point": 0, "useful": 0, "voice": 0, "readable": 0}}, "blockers": ["…"], "pass": true, "problems": ["最主要的三个问题"], "body": ""}}
"""

HUMANIZE = """你在给一篇中文公众号稿子做最后一道润色，让它读起来像真人写的。这一步是流水线的一环，只输出改好的终稿。

优先级（按顺序）：
1. 保留全部信息和确定程度：不新增事实、数字、经历；不把相关写成因果、可能写成确定、计划写成完成；限定词和出处都保留。
2. 只改确实有问题的表达，没问题的段落原样保留，润色不等于扩写。
3. 匹配作者的声音：口语、直接、有判断，像朋友分享。
4. 最后才处理下面这些 AI 腔：
- 铺垫代替陈述：「不是 X 而是 Y」、戏剧性碎句、格言式伪深度、「让我们深入看看」式起跑、和假想敌辩论。
- 公式化节奏：硬凑三段式、句首复读、破折号当万能连接、限定词堆叠、被动句缺主语、每段都以「而」「然而」开头。
- 拔高和借权威：赋能、至关重要、深入探讨、无缝、闭环；「标志着新时代」式拔高；句尾「彰显了……」；「专家认为」。
- 聊天残留：客服腔、重复免责、首句复读标题。
- 中文的毛病：层叠的「的」、「进行 + 动词」、被字句堆叠、四字词排比、「随着……的发展」开头、「让我们拭目以待」收尾。
- 自问自答：把问句和答句一起删掉不丢信息的，就删。
本地检查还提示了这些（只作线索）：{hints}

代码、链接、图片、Markdown 标题层级、加粗和高亮标记都不要动。

<稿子>
{body}
</稿子>

只输出 JSON：{{"body": "润色后的全文 Markdown"}}
"""

TITLES = """给这篇公众号文章起标题。读者是不太懂技术的中文普通人。

<文章>
{body}
</文章>

先写内容简报和事实边界（文章没证明的东西不准进标题），再起标题：
- 至少用 6 种方法，出 12 个候选：实体锚定、数字结果、任务结果、生活痛点原话、身份场景、收益损失、反差转折、问题悬念、隐藏机制、场景画面、强时效、首次/极值（极值和独家必须有证据）。
- 10 万+ 标题字数中位数是 22 字，66% 含具体实体（产品名、人名、工具名），只有 30% 含数字：先锚一个强实体，比堆数字更稳。
- 不用：震惊、重磅、炸裂、王炸、天花板、封神、yyds；不用「不是……而是……」；没有真实过程不能写「实测」「亲测」。
- 每个打分（满分 100）：兑现度 25、相关 15、具体 15、好奇缺口 15、收益或后果 10、情绪冲突 10、节奏 5、独特 5。扣分：推测写成事实 −25、夸大因果 −15、无证据的第一/唯一 −12、蹭实体 −10、缺口过大 −8、堆情绪词 −5。正文兑现不了的直接淘汰。风险分 低/中/高，高风险不能当首选。
- 选出 Top5 分角色：首选、稳健、传播、搜索、实验，5 个不能都来自同一种方法。
- 另外给封面用：cover_title 是封面大字（6–14 字，最多两行，核心 4–6 字要能单独看懂），cover_short 是方形小图用的短标题（动词 + 宾语，4–10 字）。

只输出 JSON：{{"facts_boundary": "…", "top5": [{{"role": "首选", "title": "…", "method": "…", "score": 0, "risk": "低"}}], "cover_title": "…", "cover_short": "…", "summary": "40 字以内的摘要，不能和第一段是同一句话"}}
"""

SHOTS = """给这篇公众号文章配 3–5 张正文配图。只给「认知锚点」配图：核心判断、流程步骤、前后对比、分层结构、常见坑。不平均分配，不配纯装饰。

每张图先判断关系类型（只能选一个）：progress 递进、flow 流程（有先后步骤）、cycle 循环、layers 层次（从上到下或从基础到高级）、compare 对比（两边对照）、matrix 矩阵（两个维度四个象限）。
每张图 2–6 个节点，每个节点标题不超过 12 个字，可以带一行不超过 18 字的说明；compare 给左右两组，matrix 给四个象限和两条轴。图上的字必须来自文章，不编数字。

<文章>
{body}
</文章>

只输出 JSON：{{"shots": [{{"after": "这张图放在哪一段后面：抄那一段开头的 12–20 个字", "type": "flow", "title": "图的标题（12 字内）", "nodes": [{{"label": "…", "note": "…"}}], "left": {{"label": "…", "items": ["…"]}}, "right": {{"label": "…", "items": ["…"]}}, "axes": {{"x": "…", "y": "…"}}, "quadrants": [{{"label": "…", "note": "…"}}]}}]}}
"""


# ------------------------------------------------------------------ 流水线

def _json_call(prompt: str, timeout: int = 900, purpose: str = "") -> dict:
    reply = llm.run(prompt, timeout=timeout, tools=[purpose] if purpose else None)
    data = llm.extract_json(reply)
    return data if isinstance(data, dict) else {"items": data}


def _material_of(idea: dict) -> dict:
    m = db.row("SELECT * FROM materials WHERE id=?", (idea["material_id"],)) if idea.get("material_id") else None
    return m or {"title": idea["title"], "body": (idea.get("angle") or "") + "\n" + (idea.get("notes") or ""), "source": "note"}


def pick_ideas(settings: Settings, n: int, st: dict) -> list[dict]:
    since = db.now() - 3 * 86400
    cands = db.rows("""SELECT * FROM ideas WHERE status='new' AND trashed_at IS NULL AND created_at > ?
                       ORDER BY created_at DESC LIMIT 25""", (since,))
    if len(cands) < n:
        cands = db.rows("SELECT * FROM ideas WHERE status='new' AND trashed_at IS NULL ORDER BY created_at DESC LIMIT 25")
    if not cands:
        return []
    if len(cands) <= n:
        return cands
    items = []
    for c in cands:
        m = _material_of(c)
        items.append(f"[{c['id']}] {c['title']}\n角度：{(c.get('angle') or '')[:200]}\n资料摘要：{(m.get('body') or '')[:300]}")
    res = _json_call(SCORE.format(name=_name(settings), n=n, items="\n\n".join(items)), timeout=600, purpose="autopilot-score")
    picks = res.get("picks") or []
    by_id = {c["id"]: c for c in cands}
    chosen = []
    for p in sorted(picks, key=lambda x: -float(x.get("total") or 0)):
        c = by_id.get(int(p.get("id") or 0))
        if c and c not in chosen:
            c = dict(c)
            c["_score"] = p
            chosen.append(c)
        if len(chosen) >= n:
            break
    for c in cands:  # 模型没挑够就按时间补
        if len(chosen) >= n:
            break
        if c["id"] not in {x["id"] for x in chosen}:
            chosen.append(dict(c))
    st["scores"] = picks
    return chosen


def _set_progress(did: int, text: str) -> None:
    with db.tx() as conn:
        conn.execute("UPDATE drafts SET error=?, updated_at=? WHERE id=?", (text, db.now(), did))


def write_one(settings: Settings, idea: dict, st: dict) -> int:
    name = _name(settings)
    material = _material_of(idea)
    mat_text = (material.get("body") or "")[:24000]
    with db.tx() as conn:
        cur = conn.execute("""INSERT INTO drafts(idea_id, platform, title, status, error, created_at, updated_at)
                              VALUES (?, 'wechat', ?, 'generating', '准备任务书…', ?, ?)""",
                           (idea["id"], idea["title"], db.now(), db.now()))
        did = cur.lastrowid
        conn.execute("UPDATE ideas SET status='drafted' WHERE id=?", (idea["id"],))
    try:
        # 1 任务书和主张清单
        brief = _json_call(BRIEF.format(name=name, title=idea["title"], angle=idea.get("angle") or "", material=mat_text),
                           purpose="autopilot-brief")
        claims = [c for c in brief.get("claims") or [] if isinstance(c, dict)]
        brief["claims"] = [c for c in claims if c.get("support") != "无来源"]
        dropped = [c.get("text", "") for c in claims if c.get("support") == "无来源"]
        brief_text = json.dumps(brief, ensure_ascii=False, indent=1)
        _log(st, f"《{idea['title'][:20]}》任务书好了：{brief.get('framework', '')}，{len(brief['claims'])} 条可用主张")

        # 2 初稿
        _set_progress(did, "按任务书写初稿…")
        draft = _json_call(DRAFT.format(name=name, voice=_voice(settings), brief=brief_text, material=mat_text),
                           timeout=1200, purpose="autopilot-draft")
        body = comments.PLACEHOLDER.sub("", str(draft.get("body") or ""))
        if len(body) < 400:
            raise RuntimeError("初稿太短，模型可能没写完")

        # 3 审稿，最多自动改两轮
        review = {}
        for rnd in range(2):
            _set_progress(did, f"编辑审稿（第 {rnd + 1} 轮）…")
            review = _json_call(REVIEW.format(name=name, brief=brief_text, material=mat_text[:16000], body=body),
                                timeout=1200, purpose="autopilot-review")
            if review.get("pass") or not str(review.get("body") or "").strip():
                break
            new = str(review["body"])
            if len(new) > len(body) * 0.6:
                body = comments.PLACEHOLDER.sub("", new)
        _log(st, f"《{idea['title'][:20]}》审稿：{json.dumps(review.get('scores', {}), ensure_ascii=False)} {'通过' if review.get('pass') else '未完全通过'}")

        # 4 本地检查 + 去 AI 腔润色
        hints = local_checks(body)
        _set_progress(did, "去 AI 腔润色…")
        hum = _json_call(HUMANIZE.format(hints="；".join(hints) or "无", body=body), timeout=1200, purpose="autopilot-humanize")
        new = str(hum.get("body") or "")
        if 0.8 * len(body) < len(new) < 1.25 * len(body) and images.referenced(new) == images.referenced(body):
            body = new
        hints_after = local_checks(body)

        # 5 标题
        _set_progress(did, "起标题…")
        titles = _json_call(TITLES.format(body=body[:9000]), timeout=600, purpose="autopilot-titles")
        top5 = [t for t in titles.get("top5") or [] if isinstance(t, dict) and t.get("title")]
        title = (top5[0]["title"] if top5 else draft.get("title") or idea["title"]).strip()

        # 6 配图和封面（失败不影响成稿）
        _set_progress(did, "做封面和配图…")
        cover_note = ""
        try:
            from . import visuals
            body, made = visuals.illustrate(did, body, _json_call(SHOTS.format(body=body[:9000]), timeout=600, purpose="autopilot-shots"))
            covers = visuals.make_covers(did, titles.get("cover_title") or title, titles.get("cover_short") or title[:10], label=brief.get("framework") or "")
            with db.tx() as conn:
                conn.execute("UPDATE drafts SET cover_wechat=?, cover_x=?, cover_crop=? WHERE id=?",
                             (covers.get("wechat"), covers.get("x"), json.dumps({"square_x": 0.5}), did))
            cover_note = f"自动配了 {made} 张逻辑图和 3 张封面（公众号 2.35:1、方形 1:1、X 5:2），在「封面·配图」里。"
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            cover_note = f"封面和配图这次没做成：{str(exc)[:120]}"

        # 7 存
        lines = ["【今日自动稿】", f"选题打分：{json.dumps(idea.get('_score') or {}, ensure_ascii=False)}" if idea.get("_score") else "",
                 "", "标题候选（点标题可以直接改）："]
        for t in top5:
            lines.append(f"- {t.get('role', '')}｜{t['title']}（{t.get('method', '')}，{t.get('score', '')} 分，风险{t.get('risk', '')}）")
        sc = review.get("scores") or {}
        lines += ["", f"审稿：准确 {sc.get('accurate', '-')} · 观点 {sc.get('point', '-')} · 有用 {sc.get('useful', '-')} · 合声 {sc.get('voice', '-')} · 好读 {sc.get('readable', '-')}"
                  + ("" if review.get("pass") else "（没完全过，重点看下面的问题）")]
        for p in (review.get("blockers") or []) + (review.get("problems") or []):
            lines.append(f"- {p}")
        if brief.get("verify") or draft.get("notes"):
            lines += ["", "发之前要核实：", *[f"- {v}" for v in brief.get("verify") or []], str(draft.get("notes") or "")]
        if dropped:
            lines += ["", "这些说法找不到来源，没写进正文：", *[f"- {d}" for d in dropped[:8]]]
        if hints_after:
            lines += ["", "文风提示：", *[f"- {h}" for h in hints_after]]
        lines += ["", cover_note, "", "任务书：", f"读者：{brief.get('reader', '')}", f"核心判断：{brief.get('thesis', '')}",
                  f"边界：{brief.get('boundary', '')}", f"反方：{brief.get('counter', '')}"]
        summary = str(titles.get("summary") or "")[:120]
        with db.tx() as conn:
            conn.execute("""UPDATE drafts SET title=?, body=?, notes=?, summary=?, status='draft', error=NULL, updated_at=? WHERE id=?""",
                         (title[:200], body, "\n".join(x for x in lines if x is not None).strip(), summary, db.now(), did))
            conn.execute("INSERT INTO draft_versions(draft_id, title, body, created_at, origin) VALUES (?,?,?,?, 'generated')",
                         (did, title, body, db.now()))
        for c in draft.get("comments") or []:
            if isinstance(c, dict) and str(c.get("text", "")).strip():
                comments.add(did, "ai", str(c["text"]), quote=str(c.get("quote") or "").strip()[:80] or None)
        _log(st, f"《{title[:24]}》写好了")
        return did
    except Exception as exc:
        with db.tx() as conn:
            conn.execute("UPDATE drafts SET status='failed', error=?, updated_at=? WHERE id=?", (f"自动出稿失败：{exc}"[:500], db.now(), did))
            conn.execute("UPDATE ideas SET status='new' WHERE id=?", (idea["id"],))
        raise


_lock = threading.Lock()


def run(settings: Settings, n: int | None = None, manual: bool = False) -> dict:
    if not _lock.acquire(blocking=False):
        return {"running": True}
    try:
        st = load_state()
        today = datetime.date.today().isoformat()
        n = int(n or st.get("count") or DEFAULT_COUNT)
        st.update(date=today, running=True, started_at=db.now(), manual=manual, drafts=st.get("drafts") if st.get("date") == today else [], error="")
        _log(st, f"开始出今天的 {n} 篇")
        try:
            ideas = pick_ideas(settings, n, st)
            if not ideas:
                _log(st, "没有待挑的选题，跳过")
            for idea in ideas:
                try:
                    did = write_one(settings, idea, st)
                    st.setdefault("drafts", []).append(did)
                except Exception as exc:  # noqa: BLE001
                    traceback.print_exc()
                    _log(st, f"《{idea['title'][:20]}》没写成：{str(exc)[:160]}")
                save_state(st)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            st["error"] = str(exc)[:300]
            _log(st, f"出错了：{str(exc)[:160]}")
        st.update(running=False, finished_at=db.now())
        save_state(st)
        return st
    finally:
        _lock.release()


def scheduler(settings: Settings) -> None:
    """每 5 分钟看一次：本地时间过了 7:30、今天还没跑过、开着自动出稿，就跑一次。"""
    time.sleep(90)
    while True:
        try:
            st = load_state()
            now = datetime.datetime.now()
            if st.get("enabled", True) and st.get("date") != now.date().isoformat() and (now.hour, now.minute) >= RUN_AFTER:
                # 等旧写作台把今天的选题同步进来（早上第一次开 Obsidian 才出选题）；10 点以后不再等
                midnight = datetime.datetime.combine(now.date(), datetime.time()).timestamp()
                fresh = db.row("SELECT COUNT(*) n FROM ideas WHERE status='new' AND trashed_at IS NULL AND created_at >= ?", (midnight,))["n"]
                if fresh or now.hour >= 10:
                    run(settings)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        time.sleep(300)
