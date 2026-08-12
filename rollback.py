# -*- coding: utf-8 -*-
"""やらなかった日の語を「未出題」に戻す（2026-07-26 キヨ決定・二号機）

なぜ要るか：
  seen.json が記録しているのは「**出題した**」であって「**やった**」ではない。
  ゲームは毎朝自動生成されるが、子供はAI先生のレッスンがある日しか開いていない。
  そのため、開かなかった日の語も seen に入って「済み」になり、
  **会っていない語が静かに消えていく**（キヨ指摘 2026-07-26）。
  → まとめが届かなかった日＝やっていない日。その日ぶんをこれで戻す。

使い方（`C:\\Users\\Kiyoko\\Desktop\\daily-vocab` で）：
  python rollback.py               # 直近1日ぶんを戻す（正確：today の新出だけ戻す）
  python rollback.py 3             # 直近3日ぶんを戻す（git の daily コミットから復元）
  ⚠️ **N は「N日ぶん」ではなく「N-1日ぶん」戻る**（N日前の daily コミット時点の seen に
     戻す作りなので、その日ぶんは残る）。7日ぶん戻したいなら 8 を渡す（2026-08-12に実測）。
  ⚠️ **走らせる前に git pull**。cronがリモートに毎朝コミットするので、遅れたまま巻き戻すと
     子供が実際にひらいた出題と別の履歴ができる（冒頭で警告を出すようにした）。
  python rollback.py 3 maya-vocab  # デッキを指定（省略＝全デッキ）
  python rollback.py --dry 3       # 何が戻るか見るだけ（変更しない）

戻したあと：
  node generate.js  を回すと、その日ぶんが作り直される（戻した語がまた出るようになる）。
  ※Windowsで文字化けするときは PYTHONIOENCODING=utf-8 を付ける。
"""
import json, io, os, sys, subprocess

os.chdir(os.path.dirname(os.path.abspath(__file__)))
DAILY_NEW = 8   # generate.js と合わせる

args = [a for a in sys.argv[1:]]
dry = "--dry" in args
args = [a for a in args if a != "--dry"]
days = int(args[0]) if args and args[0].isdigit() else 1
deck_filter = args[1] if len(args) > 1 else (args[0] if args and not args[0].isdigit() else None)


def load(p):
    with io.open(p, encoding="utf-8") as f:
        return json.load(f)


def save(p, d):
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")


def daily_commits():
    """新しい順の `daily: YYYY-MM-DD` コミットSHA。git が使えなければ空。"""
    try:
        out = subprocess.check_output(
            ["git", "log", "--format=%H %s", "-n", "60"],
            stderr=subprocess.DEVNULL).decode("utf-8", "replace")
    except Exception:
        return []
    return [ln.split(" ", 1)[0] for ln in out.splitlines() if " daily: " in " " + ln]


def seen_at(sha, path):
    """そのコミット時点の seen ファイル（無ければ None）。"""
    try:
        out = subprocess.check_output(["git", "show", "%s:%s" % (sha, path)],
                                      stderr=subprocess.DEVNULL)
        return json.loads(out.decode("utf-8"))
    except Exception:
        return None


def warn_if_behind_remote():
    """🔴 2026-08-12の事故。cron（GitHub Actions）は毎朝 origin に直接コミットする。
    手元が遅れたまま巻き戻すと、**子供が実際にひらいた出題と別物の履歴**ができる。
    このスクリプトは「静かに消える」を防ぐ道具なので、ここで鳴らさないと意味がない。"""
    try:
        subprocess.check_call(["git", "fetch", "-q", "origin"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        behind = subprocess.check_output(
            ["git", "rev-list", "--count", "HEAD..origin/main"],
            stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return
    if behind and behind != "0":
        print("=" * 62)
        print("🔴 リモートが %s コミット先行しています。**巻き戻す前に `git pull`**。" % behind)
        print("   先行分にはcronが生成した今日ぶんが入っています。取り込まずに巻き戻すと、")
        print("   子供が今朝ひらいた出題とは別の履歴を作ってしまいます（2026-08-12の事故）。")
        print("=" * 62)


warn_if_behind_remote()

decks = load("decks.json")
commits = daily_commits()
changed = []

for d in decks:
    if deck_filter and d["id"] != deck_filter:
        continue
    if not os.path.exists(d["seen"]):
        continue
    state = load(d["seen"])
    before = list(state.get("seen", []))

    if days == 1:
        # 正確：today の新出（review=false）だけ戻す
        todays_new = [t["ja"] for t in state.get("today", []) if not t.get("review")]
        after = [ja for ja in before if ja not in todays_new]
        how = "today の新出"
    else:
        # days 日前の daily コミット時点の seen に戻す
        old = None
        if len(commits) >= days:
            old = seen_at(commits[days - 1], d["seen"])
        if old and old.get("unit") == state.get("unit"):
            after = list(old.get("seen", []))
            how = "git の %d日前のコミット" % days
        else:
            cut = min(DAILY_NEW * days, len(before))
            after = before[:len(before) - cut]
            how = "⚠️概算（gitに履歴なし＝末尾%d語を削除）" % cut

    removed = [ja for ja in before if ja not in after]
    if not removed:
        print("%-18s 戻すものなし" % d["id"])
        continue

    print("%-18s -%d語 [%s] → %s" % (d["id"], len(removed), how, " ".join(removed)))
    if not dry:
        state["seen"] = after
        state["date"] = ""      # ← 日付を消す＝次の generate.js で作り直される
        state["today"] = []
        save(d["seen"], state)
        changed.append(d["id"])

print()
if dry:
    print("（--dry なので何も変更していません）")
elif changed:
    print("戻した:", ", ".join(changed))
    print("→ 次に `node generate.js` を回すと、その日ぶんが作り直されます。")
else:
    print("変更なし。")
