# -*- coding: utf-8 -*-
"""プールの残り数を1発で見る（統括＝Claude Codeが毎日のルーティンで叩く）
使い方：  python check_pools.py
※Windowsで文字化けするときは  PYTHONIOENCODING=utf-8 python check_pools.py

残りが 24（＝約3日ぶん）を切ったら 🔴 が出る。
→ その日のうちにキヨへ「教科書の該当ページの写真」を頼む（忘れると復習だけの日になる）。
   キヨ方針（2026-07-26）＝復習だけの日が「たまに」あるのは可。毎日になるのは困る。
"""
import json, io, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))
DAILY_NEW = 8  # generate.js の DAILY_NEW と合わせる

decks = json.load(io.open("decks.json", encoding="utf-8"))
need = []
for d in decks:
    pool = json.load(io.open(d["pool"], encoding="utf-8"))
    seen = json.load(io.open(d["seen"], encoding="utf-8"))
    total = len(pool["words"])
    left = total - len(seen.get("seen", []))
    days = left // DAILY_NEW
    flag = ""
    if left == 0:
        flag = "🔴 尽きた＝新出なし（復習だけ）"
    elif left < 24:
        flag = "🔴 要補充"
    if flag:
        need.append(d["id"])
    print("%-18s %-24s 残り%3d / 全%3d  ＝ あと約%d日  %s"
          % (d["id"], pool.get("unit", "")[:22], left, total, days, flag))

print()
if need:
    print("→ 補充が要る:", ", ".join(need))
    print("  教科書ページが要るものは、その日のうちにキヨへ写真を頼む。")
else:
    print("→ ぜんぶ余裕あり。")
