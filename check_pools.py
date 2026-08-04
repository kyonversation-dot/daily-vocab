# -*- coding: utf-8 -*-
"""プールの残り数と「明日の新出8語」を1発で見る（統括＝Claude Codeが毎日のルーティンで叩く）
使い方：  python check_pools.py
※Windowsで文字化けするときは  PYTHONIOENCODING=utf-8 python check_pools.py

残りが 24（＝約3日ぶん）を切ったら 🔴 が出る。
→ その日のうちにキヨへ「教科書の該当ページの写真」を頼む（忘れると復習だけの日になる）。
   キヨ方針（2026-07-26）＝復習だけの日が「たまに」あるのは可。毎日になるのは困る。

★「明日の新出8語」を必ず見ること（2026-07-27追加）。
   generate.js は未出題語を「プールの並び順どおり」に8語取る（ランダムではない）。
   だから新しい単元の語を末尾に足しただけでは、当分出てこない＝レッスンとゲームが
   つながらない。出したい語は pool の words 配列の先頭へ移す。
   ここに出た8語を、そのまま翌日のレッスンプランの【明日の朝ゲーム】欄に貼る。

⚠️ 例外＝decks.json に "random": true が付いたデッキ（2026-08-04・maya-kanji）。
   そこは未出題からランダムに引くので【明日の8語は前もって決まっていない】。
   ここには「🎲ランダム」とだけ出る＝**プランの朝ゲーム欄に漢字を書かない**。
   （書くと当たっていない表がプランに載る。言葉デッキは並び順のままなので従来どおり）
"""
import json, io, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))
DAILY_NEW = 8  # generate.js の DAILY_NEW と合わせる

decks = json.load(io.open("decks.json", encoding="utf-8"))
need = []
tomorrow = []
for d in decks:
    pool = json.load(io.open(d["pool"], encoding="utf-8"))
    seen = json.load(io.open(d["seen"], encoding="utf-8"))
    seen_set = set(seen.get("seen", []))
    total = len(pool["words"])
    left = total - len(seen_set)
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
    unseen = [w["ja"] for w in pool["words"] if w["ja"] not in seen_set]
    if d.get("random"):
        nxt = None if unseen else []          # None = ランダム＝予測できない
    else:
        nxt = unseen[:DAILY_NEW]
    tomorrow.append((d["id"], nxt))

print()
print("── 明日の新出%d語（並び順どおりに出ます・復習4語はランダム）──" % DAILY_NEW)
for did, nxt in tomorrow:
    if nxt is None:
        body = "🎲 ランダム＝明日の字は決まっていない（プランに書かない）"
    elif nxt:
        body = "・".join(nxt)
    else:
        body = "（新出なし＝復習だけ）"
    print("%-18s %s" % (did, body))
print("※ここに明日のレッスンで使う語が入っていなければ、pool の words 配列の先頭へ移すこと。")
print("※この8語をレッスンプランの【明日の朝ゲーム】欄にそのまま貼る（🎲の行は書かない）。")

print()
if need:
    print("→ 補充が要る:", ", ".join(need))
    print("  教科書ページが要るものは、その日のうちにキヨへ写真を頼む。")
else:
    print("→ ぜんぶ余裕あり。")
