# daily-vocab — 毎日の語彙ゲーム（Girls study buddy）

娘の「今の単元の語彙」から、毎日あたらしい語彙ゲームを自動で1本作って公開する仕組み。
- **語彙チャレンジ**（60秒でカードめくり）と **語彙マッチング**（言葉↔意味を結ぶ）の2種類。
- 毎日：新出 8 語 ＋ 復習 4 語（前に出た語からランダム）。
- 娘は **ブックマーク1個**（GitHub PagesのURL）を開くだけ。ログイン不要。

## しくみ
```
GitHub Actions が毎朝(06:00 CEST)自動で:
  1. pool.json（今の単元の語彙）を読む
  2. seen.json（既出ログ）を見て、今日の新出8語＋復習を選ぶ
  3. templates/ から docs/ に challenge.html / matching.html / index.html を生成
  4. seen.json と docs をコミット → GitHub Pages が公開
```
- 生成は決定的（LLM不要）。だから毎日 タダ・PC不要 で回る。
- ブックマーク先 = GitHub Pages の `index.html`。

## 単元を変えるとき（＝あなたがやる唯一の作業・週1くらい）
一番ラクな方法：**単語リストを貼る／教科書の語彙ページを写真で送る** → Claudeが定義＋ふりがな付きの `pool.json` を作って push。
自分でやる場合は `pool.json` を差し替えるだけ：

```json
{
  "unit": "単元名（例：ちょっと立ち止まって）",
  "child": "マヤ",
  "titleShort": "見出し用の短い名前",
  "subtitle": "今日の読書語彙",
  "words": [
    { "ja": "語", "reading": "よみ（ひらがな）", "meaning": "子供向けの意味（難しい漢字は <ruby>漢<rt>かん</rt></ruby> でふりがな）" }
  ]
}
```
- `unit` が変わると `seen.json` は自動リセット（新単元を最初から）。
- 1単元は **章まるごと40〜60語** をまとめて入れると、補充が週1で済む。

## 手元で試す
```
node generate.js      # docs/ に今日ぶんを生成
```
`docs/index.html` をブラウザで開けば確認できる。

## 調整
- 1日の新出/復習の数 … `generate.js` の `DAILY_NEW` / `REVIEW_COUNT`
- 更新時刻 … `.github/workflows/daily.yml` の cron（UTC基準）
