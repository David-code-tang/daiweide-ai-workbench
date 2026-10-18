"""Run the owner's logged-in Claude Code CLI headless.

All context goes into the prompt over stdin; the CLI runs from the private data
directory so no project instruction files are picked up, and tool use is denied.
This calls Anthropic's service under the author's own subscription — it is not
offline inference, and the UI says so."""

from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from .config import Settings, data_dir


class LlmUnavailable(RuntimeError):
    pass


def claude_bin() -> str:
    explicit = os.environ.get("CW_CLAUDE_BIN")
    if explicit:
        return explicit
    found = shutil.which("claude")
    if found:
        return found
    bundles = []
    for path in glob.glob(str(Path.home() / "Library/Application Support/Claude/claude-code/*/*/claude.app/Contents/MacOS/claude")):
        version = Path(path).parts[-6]
        if re.fullmatch(r"\d+(\.\d+)*", version):
            bundles.append((tuple(int(p) for p in version.split(".")), path))
    if bundles:
        return max(bundles)[1]
    raise LlmUnavailable("没找到 Claude Code 命令行")


def _env() -> dict:
    env = dict(os.environ)
    token_file = Settings.load().claude_token_file
    if token_file and Path(token_file).is_file():
        env["CLAUDE_CODE_OAUTH_TOKEN"] = Path(token_file).read_text(encoding="utf-8").strip()
    return env


DENY = "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task,Agent"

# Read-only 生财 MCP tools for finding cases (深海圈 posts, 精华, project cases,
# 航海 material). The MCP server and its login come from the owner's Claude Code
# user config; only these tools are allowed, nothing that writes.
SCYS_TOOLS = [f"mcp__scys-mcp__{name}" for name in (
    "searchDeepseaPublicContent", "getDeepseaContentDetail", "contentSearch", "searchTopic", "topicDetail",
    "searchProjectCases", "projectLibDetail", "searchTrustedContent", "getTrustedContentSection",
    "searchNavigatorContent", "getNavigatorContentDetail", "searchDeepseaCourseChapters")]


# 戴卫得AI工作台：设置了 CW_LLM_URL 时，所有模型调用都交给 Obsidian 里的工作台插件，
# 用插件里选好的模型（默认 GPT 6.1，走 Codex 订阅），不另外调用 Claude Code。
BRIDGE_URL = os.environ.get("CW_LLM_URL", "")
BRIDGE_KEY = os.environ.get("CW_LLM_KEY", "")


def _bridge(prompt: str, timeout: int, purpose: str = "") -> str:
    import httpx
    try:
        r = httpx.post(BRIDGE_URL, json={"prompt": prompt, "timeout": timeout, "purpose": purpose},
                       headers={"x-cw-key": BRIDGE_KEY}, timeout=timeout + 30)
    except httpx.HTTPError as exc:
        raise LlmUnavailable(f"连不上 Obsidian 里的工作台（请确认 Obsidian 开着）：{exc}") from None
    try:
        data = r.json()
    except ValueError:
        raise LlmUnavailable(f"工作台返回的不是 JSON：{r.text[:200]}") from None
    if r.status_code != 200:
        raise LlmUnavailable(f"模型调用失败：{str(data.get('error') or data)[:300]}")
    return str(data.get("text", ""))


def run(prompt: str, timeout: int = 600, tools: list[str] | None = None, max_turns: int = 2, allow_read: bool = False) -> str:
    if BRIDGE_URL:
        return _bridge(prompt, timeout, ",".join(tools or []))
    return _run_claude(prompt, timeout, tools, max_turns, allow_read)


def _run_claude(prompt: str, timeout: int = 600, tools: list[str] | None = None, max_turns: int = 2, allow_read: bool = False) -> str:
    """allow_read lets the model open files we put in its working directory (the
    video planner looks at the article's screenshots that way); nothing else changes."""
    deny = ",".join(t for t in DENY.split(",") if not (allow_read and t == "Read"))
    cmd = [claude_bin(), "-p", "--output-format", "json", "--max-turns", str(max_turns), "--disallowedTools", deny]
    if tools:
        cmd += ["--allowedTools", ",".join(tools)]
    workdir = data_dir() / "llm-cwd"
    workdir.mkdir(exist_ok=True)
    try:
        proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout, cwd=workdir, env=_env())
    except subprocess.TimeoutExpired:
        raise LlmUnavailable("模型调用超时") from None
    try:
        out = json.loads(proc.stdout)
    except ValueError:
        raise LlmUnavailable(f"模型没有返回结果：{(proc.stderr or proc.stdout)[:300]}") from None
    result = str(out.get("result", ""))
    if out.get("is_error"):
        if "login" in result.lower() or "logged in" in result.lower():
            raise LlmUnavailable("Claude Code 命令行还没登录，需要在终端里运行一次 claude setup-token 或 claude login")
        raise LlmUnavailable(f"模型调用失败：{result[:300]}")
    return result


def status() -> dict:
    if BRIDGE_URL:
        import httpx
        try:
            r = httpx.post(BRIDGE_URL, json={"ping": True}, headers={"x-cw-key": BRIDGE_KEY}, timeout=5)
            d = r.json()
            return {"ok": r.status_code == 200, "detail": d.get("detail") or d.get("error") or ""}
        except Exception as exc:
            return {"ok": False, "detail": f"连不上 Obsidian 里的工作台：{exc}"}
    try:
        binary = claude_bin()
    except LlmUnavailable as exc:
        return {"ok": False, "detail": str(exc)}
    try:
        proc = subprocess.run([binary, "auth", "status"], capture_output=True, text=True, timeout=20, env=_env())
        info = json.loads(proc.stdout or "{}")
        if info.get("loggedIn"):
            return {"ok": True, "detail": f"已登录（{info.get('authMethod', '')}）"}
        return {"ok": False, "detail": "Claude Code 命令行还没登录，需要在终端里运行一次 claude setup-token"}
    except Exception as exc:  # status is advisory only
        return {"ok": False, "detail": f"无法确认登录状态：{exc}"}


def extract_json(text: str):
    """Pull the first JSON object/array out of a model reply."""
    fenced = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    start = min([i for i in (candidate.find("{"), candidate.find("[")) if i >= 0], default=-1)
    if start < 0:
        raise ValueError("no json in reply")
    return json.JSONDecoder().raw_decode(candidate[start:])[0]
