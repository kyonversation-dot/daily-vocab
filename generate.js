// generate.js — 毎日の練習ゲームを各デッキ1本ずつ作る（決定的・LLM不要）
// 使い方: node generate.js
//   decks.json のデッキごとに pool（語彙プール）と seen（既出ログ）を読み、
//   今日の「新出 DAILY_NEW 語 ＋ 復習 REVIEW_COUNT 語」を選び、
//   templates/ から challenge.html / matching.html / index.html を各 out/ に書き出す。
//
// デッキ = { id, pool, seen, out, big?, }  ／ pool.json 側に unit/child/titleShort/subtitle/words 等。
// 単元を変えるとき: その pool を差し替えるだけ（unit が変わると seen は自動リセット）。

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DAILY_NEW = 8;      // 1日の新出
const REVIEW_COUNT = 4;   // 1日の復習（既出から）

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readTpl = (p) => fs.readFileSync(path.join(ROOT, 'templates', p), 'utf8');
const pickRandom = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

// 単漢字は大きく見せる用の追加CSS
const BIG_CSS = `
  .word-ja { font-size: 2.4rem; }
  .word-card .text { font-size: 2rem; }
`;

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const dateJa = `${now.getMonth() + 1}月${now.getDate()}日`;

const decks = readJSON('decks.json');
decks.forEach(buildDeck);

function buildDeck(deck) {
  const pool = readJSON(deck.pool);
  let seen = fs.existsSync(path.join(ROOT, deck.seen))
    ? readJSON(deck.seen) : { unit: '', seen: [] };

  // 単元が変わったら既出ログをリセット
  if (seen.unit !== pool.unit) seen = { unit: pool.unit, seen: [] };

  const seenSet = new Set(seen.seen);
  const byJa = Object.fromEntries(pool.words.map(w => [w.ja, w]));

  // 1) 新出＝プール順の未出から先頭 DAILY_NEW
  const unseen = pool.words.filter(w => !seenSet.has(w.ja));
  const newWords = unseen.slice(0, DAILY_NEW).map(w => ({ ...w, review: false }));

  // 2) 復習＝既出からランダム
  const alreadySeen = [...seenSet].map(ja => byJa[ja]).filter(Boolean);
  let unitComplete = false, reviewWords;
  if (newWords.length === 0) {
    unitComplete = true;
    reviewWords = pickRandom(alreadySeen, Math.min(DAILY_NEW + REVIEW_COUNT, alreadySeen.length))
      .map(w => ({ ...w, review: true }));
  } else {
    reviewWords = pickRandom(alreadySeen, Math.min(REVIEW_COUNT, alreadySeen.length))
      .map(w => ({ ...w, review: true }));
  }

  const today = [...newWords, ...reviewWords];

  // 3) 既出ログ更新
  newWords.forEach(w => seenSet.add(w.ja));
  seen = { unit: pool.unit, seen: [...seenSet] };
  fs.writeFileSync(path.join(ROOT, deck.seen), JSON.stringify(seen, null, 2) + '\n');

  // 4) テンプレ差し込み
  const wordsJson = JSON.stringify(today, null, 2);
  const outDir = path.join(ROOT, deck.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
  const extraCss = deck.big ? BIG_CSS : '';

  const fill = (tpl, title) => tpl
    .replaceAll('__WORDS_JSON__', wordsJson)
    .replaceAll('__TITLE__', title)
    .replaceAll('__SUBTITLE__', pool.subtitle)
    .replaceAll('__EXTRACSS__', extraCss);

  fs.writeFileSync(path.join(outDir, 'challenge.html'),
    fill(readTpl('challenge.html'), `${pool.titleShort}チャレンジ`));
  fs.writeFileSync(path.join(outDir, 'matching.html'),
    fill(readTpl('matching.html'), `${pool.titleShort}マッチング`));

  // 5) index（ブックマーク先）
  const itemLabel = pool.itemLabel || '言葉';
  const counterUnit = pool.counterUnit || '語';
  const total = pool.words.length;
  const learned = seenSet.size;
  const newCount = newWords.length;
  const reviewCount = reviewWords.length;
  const completeMsg = unitComplete
    ? `<div class="banner">🎉 「${pool.unit}」の新しい${itemLabel}は全部やったよ！今日はぜんぶ復習。<br>次にすすむ準備ができたら、おうちの人に教えてね。</div>`
    : '';

  const index = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>今日の${itemLabel}ゲーム｜${pool.subtitle}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Hiragino Kaku Gothic ProN','Meiryo',sans-serif; background:#1a1a2e; color:#eee;
         min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; gap:18px; }
  h1 { color:#ffb4d4; font-size:1.5rem; text-align:center; }
  .date { color:#aaa; font-size:0.9rem; }
  .stats { color:#a8e6c1; font-size:0.85rem; text-align:center; line-height:1.6; }
  .banner { background:#2a1f00; border:1px solid #f5a623; color:#ffd88a; border-radius:12px;
            padding:12px 16px; font-size:0.8rem; text-align:center; max-width:420px; line-height:1.6; }
  .buttons { display:flex; flex-direction:column; gap:14px; width:100%; max-width:340px; }
  a.game { display:block; text-align:center; text-decoration:none; color:white; font-weight:bold;
           font-size:1.1rem; padding:18px; border-radius:16px; }
  a.challenge { background:#c0436a; }
  a.matching { background:#3a5ac0; }
  a.game:hover { opacity:0.9; }
  .foot { color:#666; font-size:0.7rem; margin-top:8px; text-align:center; }
</style>
</head>
<body>
  <h1>📚 今日の${itemLabel}ゲーム</h1>
  <div class="date">${dateJa}（${pool.subtitle}・「${pool.unit}」）</div>
  ${completeMsg}
  <div class="stats">今日の${itemLabel}：新しい ${newCount} ${counterUnit} ＋ 復習 ${reviewCount} ${counterUnit}<br>この単元：${learned} / ${total} ${counterUnit}やったよ</div>
  <div class="buttons">
    <a class="game challenge" href="challenge.html">📖 ${itemLabel}チャレンジ（60秒）</a>
    <a class="game matching" href="matching.html">🔗 ${itemLabel}マッチング</a>
  </div>
  <div class="foot">毎日あたらしいゲームになるよ ✨</div>
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), index);

  console.log(`✅ [${deck.id}] ${dateStr} 単元:${pool.unit} / 新出${newCount}+復習${reviewCount} (計${today.length}) 進捗${learned}/${total}${unitComplete ? ' ★一巡' : ''} → ${deck.out}`);
}
