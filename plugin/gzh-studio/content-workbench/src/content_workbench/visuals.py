"""戴卫得AI工作台 · 封面和正文逻辑图（HTML 模板 + 本机浏览器截图，图上的字一定是对的）。

封面一次出三张：公众号 2.35:1（核心字压在正中 42.6% 的分享安全区，朋友圈只显示中间的正方形）、
方形 1:1 短标题、X 长文 5:2。正文配图按关系类型画：递进、流程、循环、层次、对比、矩阵。
设计规则参考 creator-buddy 的 space-gzh-cover / space-text-logic-diagram（MIT），模板是自己写的。"""

from __future__ import annotations

import hashlib
import html
import json
import re

from . import images

PALETTES = [  # (强调色, 浅底色)
    ("#3E63DD", "#EEF2FF"), ("#1F8A5B", "#ECF8F2"), ("#E2683C", "#FFF3EC"),
    ("#6E56CF", "#F3F0FF"), ("#0B7FA5", "#EAF6FA"), ("#C2410C", "#FFF4E8"),
]
FONT = '"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Noto Sans SC","Microsoft YaHei",sans-serif'


def _palette(seed: str) -> tuple[str, str]:
    return PALETTES[int(hashlib.md5(seed.encode()).hexdigest(), 16) % len(PALETTES)]


def _esc(s) -> str:
    return html.escape(str(s or ""))


# ------------------------------------------------------------------ 浏览器截图

def _render(pages: list[tuple[str, int, int]]) -> list[bytes]:
    """pages: [(html, width, height)] → PNG bytes（2 倍清晰度）。优先用本机 Chrome，没有就用 Playwright 自带的 Chromium。"""
    from playwright.sync_api import sync_playwright
    out = []
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", headless=True)
        except Exception:  # noqa: BLE001
            browser = p.chromium.launch(headless=True)
        try:
            for doc, w, h in pages:
                page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
                page.set_content(doc, wait_until="load")
                page.wait_for_timeout(250)
                out.append(page.screenshot(type="png", full_page=False))
                page.close()
        finally:
            browser.close()
    return out


FIT_JS = """
<script>
// 字号自动缩小，直到标题放进框里、不超过最大行数
document.querySelectorAll('[data-fit]').forEach(el => {
  const max = +el.dataset.max, min = +el.dataset.min, lines = +el.dataset.lines;
  let size = max;
  const lh = 1.18;
  el.style.fontSize = size + 'px';
  while (size > min && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > size * lh * lines + 2)) {
    size -= 2; el.style.fontSize = size + 'px';
  }
});
</script>"""


def _cover_doc(kind: str, title: str, short: str, label: str, accent: str, soft: str) -> tuple[str, int, int]:
    base = f"""<!doctype html><html><head><meta charset="utf-8"><style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:{FONT};background:{soft};color:#16181D;overflow:hidden}}
.t{{font-weight:800;line-height:1.18;letter-spacing:.5px;word-break:break-all;text-align:center}}
.lab{{font-size:20px;font-weight:600;color:{accent};letter-spacing:3px}}
.by{{font-size:18px;color:#5B616E;letter-spacing:2px}}
.dot{{position:absolute;border-radius:50%;background:{accent};opacity:.12}}
.bar{{position:absolute;background:{accent}}}
</style></head><body>"""
    if kind == "wechat":  # 1175×500，安全区 x 337–837
        w, h = 1175, 500
        doc = base + f"""
<div class="dot" style="width:420px;height:420px;left:-150px;top:-120px"></div>
<div class="dot" style="width:300px;height:300px;right:-90px;bottom:-110px;opacity:.16"></div>
<div class="bar" style="left:70px;top:70px;width:10px;height:120px;border-radius:5px;opacity:.85"></div>
<div class="bar" style="right:70px;bottom:70px;width:120px;height:10px;border-radius:5px;opacity:.85"></div>
<div style="position:absolute;left:337px;width:500px;top:0;height:500px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px">
  {f'<div class="lab">{_esc(label)}</div>' if label else ''}
  <div class="t" data-fit data-max="92" data-min="60" data-lines="2" style="width:500px">{_esc(title)}</div>
  <div class="by">戴卫得 · 把 AI 用明白</div>
</div>{FIT_JS}</body></html>"""
    elif kind == "square":  # 1080×1080，短标题大字居中
        w, h = 1080, 1080
        doc = base + f"""
<div class="dot" style="width:640px;height:640px;left:-260px;top:-260px"></div>
<div class="dot" style="width:420px;height:420px;right:-140px;bottom:-140px;opacity:.16"></div>
<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;padding:0 110px">
  <div class="t" data-fit data-max="170" data-min="96" data-lines="2" style="width:860px">{_esc(short)}</div>
  <div class="bar" style="position:static;width:120px;height:12px;border-radius:6px"></div>
  <div class="by" style="font-size:30px">戴卫得</div>
</div>{FIT_JS}</body></html>"""
    else:  # X 长文封面 1200×480
        w, h = 1200, 480
        doc = base + f"""
<div class="dot" style="width:460px;height:460px;right:-120px;top:-160px"></div>
<div class="bar" style="left:80px;top:96px;width:12px;height:288px;border-radius:6px"></div>
<div style="position:absolute;left:130px;right:120px;top:0;height:480px;display:flex;flex-direction:column;justify-content:center;gap:24px">
  {f'<div class="lab">{_esc(label)}</div>' if label else ''}
  <div class="t" data-fit data-max="84" data-min="52" data-lines="2" style="width:950px;text-align:left">{_esc(title)}</div>
  <div class="by"></div>
</div>{FIT_JS}</body></html>"""
    return doc, w, h


def make_covers(draft_id: int, title: str, short: str, label: str = "") -> dict:
    accent, soft = _palette(title)
    label = re.sub(r"[：:].*$", "", label or "")[:8]
    docs = [_cover_doc(k, title, short, label, accent, soft) for k in ("wechat", "square", "x")]
    pngs = _render(docs)
    out = {}
    for key, data in zip(("wechat", "square", "x"), pngs):
        im = images.save(draft_id, f"封面-{ {'wechat': '公众号2.35比1', 'square': '方形1比1', 'x': 'X长文5比2'}[key] }.png", data)
        out[key] = im["id"]
    return out


# ------------------------------------------------------------------ 逻辑图

def _card(label: str, note: str, accent: str, soft: str, extra: str = "") -> str:
    return (f'<div class="card" style="border-color:{accent};background:{soft};{extra}"><div class="lb">{_esc(label)}</div>'
            + (f'<div class="nt">{_esc(note)}</div>' if note else "") + "</div>")


def _diagram_doc(shot: dict, accent: str, soft: str) -> tuple[str, int, int]:
    w, h = 1280, 720
    kind = str(shot.get("type") or "flow")
    nodes = [n for n in shot.get("nodes") or [] if isinstance(n, dict) and n.get("label")][:6]
    arrow = f'<div class="ar" style="color:{accent}">➜</div>'
    if kind in ("flow", "progress") and nodes:
        rows = [nodes[:3], nodes[3:6]] if len(nodes) > 4 else [nodes]
        inner = ""
        for i, row in enumerate(rows):
            cells = arrow.join(_card(n["label"], n.get("note", ""), accent, soft, "flex:1") for n in row)
            if i:
                inner += f'<div class="ar" style="color:{accent};transform:rotate(90deg);margin:6px auto">➜</div>'
            inner += f'<div class="row">{cells}</div>'
        if kind == "progress":
            inner += f'<div class="up" style="background:linear-gradient(90deg,{soft},{accent})"></div>'
        body = inner
    elif kind == "cycle" and nodes:
        import math
        n = len(nodes)
        cx, cy, rx, ry = 570, 255, 330, 190   # 相对图区（宽 1140、高 520）
        parts = [f'<div class="ring" style="border-color:{accent};left:{cx - rx}px;top:{cy - ry}px;width:{2 * rx}px;height:{2 * ry}px"></div>'
                 f'<div class="ctr" style="color:{accent};left:{cx - 40}px;top:{cy - 55}px">↻</div>']
        for i, nd in enumerate(nodes):
            a = -math.pi / 2 + 2 * math.pi * i / n
            x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
            parts.append(_card(nd["label"], nd.get("note", ""), accent, soft,
                               f"position:absolute;left:{x - 140:.0f}px;top:{y - 52:.0f}px;width:280px;background:#fff"))
        body = "".join(parts)
    elif kind == "layers" and nodes:
        k = len(nodes)
        body = "".join(_card(nd["label"], nd.get("note", ""), accent, soft,
                             f"width:{48 + 44 * i / max(1, k - 1):.0f}%;margin:0 auto 14px;text-align:center")
                       for i, nd in enumerate(nodes))
    elif kind == "compare":
        def col(side):
            s = shot.get(side) or {}
            items = "".join(f"<li>{_esc(x)}</li>" for x in (s.get("items") or [])[:5])
            return f'<div class="col" style="border-color:{accent}"><div class="ch" style="background:{accent}">{_esc(s.get("label"))}</div><ul>{items}</ul></div>'
        body = f'<div class="row" style="align-items:stretch">{col("left")}<div class="vs" style="color:{accent}">VS</div>{col("right")}</div>'
    elif kind == "matrix":
        qs = [q for q in shot.get("quadrants") or [] if isinstance(q, dict)][:4]
        while len(qs) < 4:
            qs.append({"label": "", "note": ""})
        ax = shot.get("axes") or {}
        cells = "".join(_card(q.get("label", ""), q.get("note", ""), accent, soft, "height:100%") for q in qs)
        body = (f'<div class="mx"><div class="ay">↑ {_esc(ax.get("y"))}</div><div class="grid">{cells}</div>'
                f'<div class="axx">{_esc(ax.get("x"))} →</div></div>')
    else:
        body = '<div class="row">' + arrow.join(_card(n["label"], n.get("note", ""), accent, soft, "flex:1") for n in nodes) + "</div>"
    doc = f"""<!doctype html><html><head><meta charset="utf-8"><style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:{FONT};background:#fff;color:#1F2328;width:{w}px;height:{h}px;overflow:hidden;position:relative}}
.ttl{{text-align:center;font-size:40px;font-weight:800;padding-top:46px;height:150px}}
.ttl span{{border-bottom:8px solid {soft};}}
.wrap{{position:absolute;left:70px;right:70px;top:150px;bottom:50px;display:flex;flex-direction:column;justify-content:center}}
.row{{display:flex;align-items:center;gap:18px}}
.card{{border:3px solid;border-radius:18px;padding:22px 22px;min-height:96px;display:flex;flex-direction:column;justify-content:center}}
.lb{{font-size:30px;font-weight:700;line-height:1.3}}
.nt{{font-size:22px;color:#4B5160;margin-top:8px;line-height:1.4}}
.ar{{font-size:40px;flex:none}}
.up{{height:10px;border-radius:5px;margin-top:22px}}
.ring{{position:absolute;border:4px dashed;border-radius:50%;opacity:.45}}
.ctr{{position:absolute;font-size:80px;font-weight:700;width:80px;text-align:center}}
.col{{flex:1;border:3px solid;border-radius:18px;overflow:hidden}}
.ch{{color:#fff;font-size:32px;font-weight:800;text-align:center;padding:16px}}
.col ul{{list-style:none;padding:20px 26px}}
.col li{{font-size:26px;line-height:1.5;padding:8px 0;border-bottom:1px dashed #D8DBE2}}
.col li:last-child{{border:none}}
.vs{{font-size:56px;font-weight:900;flex:none;padding:0 6px}}
.mx{{display:grid;grid-template-columns:60px 1fr;grid-template-rows:1fr 50px;height:100%}}
.ay{{writing-mode:vertical-rl;font-size:24px;color:#5B616E;text-align:center}}
.grid{{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:16px}}
.axx{{grid-column:2;text-align:center;font-size:24px;color:#5B616E;padding-top:10px}}
</style></head><body><div class="ttl"><span>{_esc(shot.get('title'))}</span></div><div class="wrap">{body}</div></body></html>"""
    return doc, w, h


def _insert_after(body: str, snippet: str, img_md: str) -> tuple[str, bool]:
    paras = re.split(r"(\n\s*\n)", body)
    key = re.sub(r"[\s*=`#>\-]", "", snippet or "")[:12]
    if len(key) < 6:
        return body, False
    for i in range(0, len(paras), 2):
        if key in re.sub(r"[\s*=`#>\-]", "", paras[i]):
            paras[i] = paras[i].rstrip() + "\n\n" + img_md
            return "".join(paras), True
    return body, False


def illustrate(draft_id: int, body: str, shots_json: dict) -> tuple[str, int]:
    shots = [s for s in (shots_json.get("shots") or []) if isinstance(s, dict)][:5]
    if not shots:
        return body, 0
    accent, soft = _palette(str(draft_id) + body[:40])
    pngs = _render([_diagram_doc(s, accent, soft) for s in shots])
    made = 0
    for s, data in zip(shots, pngs):
        nm = re.sub(r"[^\w一-鿿]+", "", str(s.get("title") or "图"))[:16]
        im = images.save(draft_id, f"配图-{nm}.png", data)
        new, ok = _insert_after(body, str(s.get("after") or ""), f"![{s.get('title') or ''}](/api/images/{im['id']})")
        if ok:
            body, made = new, made + 1
        else:
            images.delete(im["id"])
    return body, made
