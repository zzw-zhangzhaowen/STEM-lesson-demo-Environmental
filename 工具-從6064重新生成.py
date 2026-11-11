# -*- coding: utf-8 -*-
"""從 6064 的 Python 版重新產生這個靜態站（GitHub Pages 用）。

為什麼要這支腳本：小科的離線回答邏輯寫在 `app.py`，資料來自知識庫 txt。
靜態站不能跑 Python，所以資料要在「建置時」抽出來，變成 `xiaoke-data.js`。
好處是：改知識庫或改詞條後，重跑一次這支腳本，靜態版就跟 Python 版同步，
不會出現「兩套答案」。

用法（在 6064 目錄跑，或直接雙擊 `工具-重新生成-Windows.bat`）：
    python 工具-從6064重新生成.py

它只「讀」6064 的檔案，不會改動它。
"""

from __future__ import annotations

import importlib
import json
import re
import shutil
import sys
from pathlib import Path

SRC = Path(r"D:/Wen/EduHK/6064/FINAL/earth-hk-combined")
DST = Path(__file__).resolve().parent
WEB = SRC / "web"


def load_app():
    """匯入 6064 的 app.py，取得知識庫解析結果與所有離線文案。"""
    if not (SRC / "app.py").exists():
        sys.exit(f"找不到來源專案：{SRC}")
    sys.path.insert(0, str(SRC))
    module = importlib.import_module("app")
    return importlib.reload(module)   # 確保拿到最新內容（檔案可能剛被改過）


def build_data(app) -> dict:
    """把 JS 端需要的資料全部抽成一份 JSON。"""
    data = {
        "_meta": {
            "source": str(SRC),
            "kb_items": len(app.KB_ITEMS),
            "quiz": len(app.QUIZ_BANK),
            "faq": len(app.KB_FAQ),
            "note": "由 工具-從6064重新生成.py 自動產生，請勿手改。",        },
        "bin_codes": list(app.BIN_CODES),
        "bin_name": app.BIN_NAME,
        "bin_label": app.BIN_LABEL,
        "bin_match": {k: list(v) for k, v in app.BIN_MATCH.items()},
        "char2code": app.CHAR2CODE,
        "life_items": {k: list(v) for k, v in app.LIFE_ITEMS.items()},
        "quiz_bank": [list(row) for row in app.QUIZ_BANK],
        "item_en": app.ITEM_EN,
        "item_cn": app.ITEM_CN,
        "why_cn": dict(app.WHY_CN),
        "why_en": dict(app.WHY_EN),
        "offline_text": app.OFFLINE_TEXT,
        "offline_special": app.OFFLINE_SPECIAL,
        "level_hints": app.LEVEL_HINTS,
        "kb_items": app.KB_ITEMS,
        "kb_aliases": [list(pair) for pair in app.KB_ALIASES],
        "kb_faq": [list(pair) for pair in app.KB_FAQ],
        "ui_text": app.UI_TEXT,
        "openings": app.OPENINGS,
        "patterns": {
            "quiz": app.PAT_QUIZ.pattern,
            "four": app.PAT_FOUR.pattern,
            "debug": app.PAT_DEBUG.pattern,
            "greet": app.PAT_GREET.pattern,
        },
    }

    # 知識庫的「理由」只有粵語；中英文的原因寫在 資料-中英補充.json（只補不改）。
    extra_path = DST / "資料-中英補充.json"
    if extra_path.exists():
        extra = json.loads(extra_path.read_text(encoding="utf-8"))
        for key, bucket in (("why_cn", "why_cn"), ("why_en", "why_en")):
            patch = extra.get(key) or {}
            stale = [k for k in patch if k not in app.KB_ITEMS]
            if stale:
                print(f"      [警告] {extra_path.name} 有 {len(stale)} 條對不上知識庫詞條：{stale[:3]}…")
            data[bucket].update(patch)

    # 對齊正式版 prompt 的補充：進階生活題庫 + 安全／回收點／代碼變體話術。
    align_path = DST / "資料-對齊補充.json"
    data["quiz_life"] = []
    data["align"] = {}
    if align_path.exists():
        align = json.loads(align_path.read_text(encoding="utf-8"))

        pool = []
        for row in align.get("quiz_life") or []:
            key = row.get("key")
            entry = app.KB_ITEMS.get(key)
            if not entry:
                print(f"      [警告] 進階題庫的 key 不在知識庫：{key}")
                continue
            if entry.get("code") == "special":
                print(f"      [警告] 進階題庫不可用「不入四色桶」的詞條：{key}")
                continue
            pool.append({
                "key": key,
                "hk": row.get("hk") or key,
                "cn": row.get("cn") or entry.get("cn") or key,
                "en": row.get("en") or entry.get("en") or key,
                "code": entry["code"],
            })
        data["quiz_life"] = pool
        data["align"] = align.get("align") or {}
        data["_meta"]["quiz_life"] = len(pool)

        # 三語 FAQ：粵語原文來自知識庫，簡體／英文是補充翻譯（含題目，否則匹配不到）
        hk_fix = align.get("faq_hk_fix") or {}
        if hk_fix:
            data["kb_faq"] = [[q, hk_fix.get(q, a)] for q, a in data["kb_faq"]]
            stale = [k for k in hk_fix if k not in {q for q, _ in data["kb_faq"]}]
            if stale:
                print(f"      [警告] faq_hk_fix 對不上知識庫題目：{stale}")

        for lang, key in (("cn", "faq_cn"), ("en", "faq_en")):
            rows = align.get(key) or []
            data.setdefault("faq_lang", {})[lang] = [[r["q"], r["a"]] for r in rows]
            if rows and len(rows) != len(data["kb_faq"]):
                print(f"      [警告] {key} 有 {len(rows)} 條，知識庫有 {len(data['kb_faq'])} 條")

        # 同義問法：學生不會照題目念，把「為甚麼要分類」這類問法也接到同一條答案
        alias_map = align.get("faq_alias") or {}
        tables = {"hk": data["kb_faq"]}
        tables.update(data.get("faq_lang") or {})
        for lang, table in tables.items():
            by_q = {q: a for q, a in table}
            added = 0
            for question, aliases in (alias_map.get(lang) or {}).items():
                answer = by_q.get(question)
                if answer is None:
                    print(f"      [警告] faq_alias.{lang} 找不到題目：{question}")
                    continue
                for alias in aliases:
                    if alias not in by_q:
                        table.append([alias, answer])
                        by_q[alias] = answer
                        added += 1
            print(f"      同義問法 {lang}：+{added} 條")

        # 別名補丁：「玻璃」這種籠統說法會被「玻璃樽（不入四色桶）」搶走，
        # 害「玻璃杯」被答成唔可以丟四色桶。只加更長的別名，讓具體詞勝出。
        for name, extra in (align.get("alias_extra") or {}).items():
            entry = app.KB_ITEMS.get(name)
            if not entry:
                print(f"      [警告] alias_extra 找不到詞條：{name}")
                continue
            aliases = entry.setdefault("aliases", [])
            for alias in extra:
                if alias not in aliases:
                    aliases.append(alias)
                data["kb_aliases"].append([alias, name])
            print(f"      別名補丁：{name} +{len(extra)} 條")

        for lang, key in (("cn", "level_hints_cn"), ("en", "level_hints_en")):
            hints = align.get(key) or {}
            if hints:
                data.setdefault("level_hints_lang", {})[lang] = hints
                miss = [k for k in app.LEVEL_HINTS if k not in hints]
                if miss:
                    print(f"      [警告] {key} 缺這幾關：{miss}")

        # 題庫要能真的考：每個桶至少一題，否則學生會一直抽到同一類
        seen = {row["code"] for row in pool}
        missing = [c for c in app.BIN_CODES if c not in seen]
        if missing:
            print(f"      [警告] 進階題庫缺這幾個桶的題目：{missing}")

    return data



def write_data(app) -> None:
    data = build_data(app)
    payload = json.dumps(data, ensure_ascii=False, indent=1)
    out = DST / "xiaoke-data.js"
    out.write_text(
        "/* 由 工具-從6064重新生成.py 自動產生，請勿手改。 */\n"
        f"window.XK_DATA = {payload};\n",
        encoding="utf-8",
    )
    print(f"[1/4] 資料已寫入 {out.name}（{len(payload)//1024} KB，"
          f"詞條 {data['_meta']['kb_items']}、題庫 {data['_meta']['quiz']}、"
          f"進階題 {data['_meta'].get('quiz_life', 0)}、"
          f"FAQ {data['_meta']['faq']}）")


# ---------------------------------------------------------------------------
# 首頁：把 Python 版的路徑改成「相對路徑」，並把小科的 iframe 指向靜態頁
# ---------------------------------------------------------------------------
def build_index() -> None:
    src = (WEB / "index.html").read_text(encoding="utf-8")
    html = src

    # 小科：Gradio 的 /xiaoke/<lang>/ → 靜態 xiaoke.html?lang=<lang>
    html = html.replace(
        """  const want = '/xiaoke/' + lang + '/?__theme=light';
  if (!chatFrame.src.includes('/xiaoke/' + lang + '/')) {""",
        """  const want = 'xiaoke.html?lang=' + lang;
  if (!chatFrame.src.includes('xiaoke.html?lang=' + lang)) {""",
    )
    html = html.replace(
        'src="/xiaoke/hk/?__theme=light"', 'src="xiaoke.html?lang=hk"'
    )
    # 靜態站的所有資源都是相對路徑（Pages 的站點可能在 /repo/ 子路徑下）
    html = html.replace('"/assets/', '"assets/').replace("'/assets/", "'assets/")
    html = html.replace('"/game/index.html"', '"game/index.html"')
    html = html.replace("'/game/index.html?t='", "'game/index.html?t='")

    left = sorted(set(re.findall(r'["\'](/(?:assets|game|xiaoke)[^"\']*)', html)))
    if left:
        raise SystemExit(f"[中止] 仍有絕對路徑未改：{left}")

    # 瀏覽器一定會請求 favicon，指去地球頭像，免得控制台一直出現 404
    if 'rel="icon"' not in html:
        html = html.replace(
            "</head>",
            '  <link rel="icon" href="assets/mother-earth-avatar.png">\n</head>',
            1,
        )

    out = DST / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"[2/4] 首頁已產生 {out.name}（{len(html)//1024} KB）")


def copy_assets() -> None:
    for name in ("game", "assets"):
        target = DST / name
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(WEB / name, target)
    avatar = DST / "assets" / "mother-earth-avatar.png"
    print(f"[3/4] 已複製 game/ 與 assets/（頭像 {'有' if avatar.exists() else '缺少！'}）")


def main() -> None:
    app = load_app()
    write_data(app)
    build_index()
    copy_assets()
    print("[4/4] 完成。用瀏覽器打開 index.html 的最簡單方式：")
    print(f"      cd {DST}")
    print("      python -m http.server 8080   →  http://127.0.0.1:8080/")


if __name__ == "__main__":
    main()
