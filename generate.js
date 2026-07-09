// generate.js — 毎日の語彙ゲームを1本作る（決定的・LLM不要）
// 使い方: node generate.js
//   pool.json（今の単元の語彙プール）と seen.json（既出ログ）を読み、
//   今日の「新出 DAILY_NEW 語 ＋ 復習 REVIEW_COUNT 語」を選び、
//   templates/ から challenge.html / matching.html / index.html を site/ に書き出す。
//
// 単元を変えるとき: pool.json を新しい単元に差し替えるだけ。
//   （pool.unit が seen.unit と変わったら seen を自動リセット）

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DAILY_NEW = 8;      // 1日の新出語
const REVIEW_COUNT = 4;   // 1日の復習語（既出から）

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readTpl = (p) => fs.readFileSync(path.join(ROOT, 'templates', p), 'utf8');

const pool = readJSON('pool.json');
let seen = readJSON('seen.json');

// 単元が変わったら既出ログをリセット
if (seen.unit !== pool.unit) {
  seen = { unit: pool.unit, seen: [] };
}

const seenSet = new Set(seen.seen);
const byJa = Object.fromEntries(pool.words.map(w => [w.ja, w]));

// 1) 新出＝プール順の未出から先頭 DAILY_NEW 語
const unseen = pool.words.filter(w => !seenSet.has(w.ja));
const newWords = unseen.slice(0, DAILY_NEW).map(w => ({ ...w, review: false }));

// 2) 復習＝既出からランダムに REVIEW_COUNT 語
const pickRandom = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const alreadySeen = [...seenSet].map(ja => byJa[ja]).filter(Boolean);

let unitComplete = false;
let reviewWords;
if (newWords.length === 0) {
  // 新出が尽きた＝単元一巡。全部復習にする
  unitComplete = true;
  reviewWords = pickRandom(alreadySeen, Math.min(DAILY_NEW + REVIEW_COUNT, alreadySeen.length))
    .map(w => ({ ...w, review: true }));
} else {
  reviewWords = pickRandom(alreadySeen, Math.min(REVIEW_COUNT, alreadySeen.length))
    .map(w => ({ ...w, review: true }));
}

const today = [...newWords, ...reviewWords];

// 3) 既出ログを更新（新出を追加）
newWords.forEach(w => seenSet.add(w.ja));
seen = { unit: pool.unit, seen: [...seenSet] };
fs.writeFileSync(path.join(ROOT, 'seen.json'), JSON.stringify(seen, null, 2) + '\n');

// 4) 日付（現地時間）
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const dateJa = `${now.getMonth() + 1}月${now.getDate()}日`;

// 5) テンプレに差し込み
const wordsJson = JSON.stringify(today, null, 2);
const outDir = path.join(ROOT, 'docs');   // GitHub Pages を /docs から配信
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '.nojekyll'), '');  // Pages の Jekyll 処理を無効化

const fill = (tpl, title) => tpl
  .replaceAll('__WORDS_JSON__', wordsJson)
  .replaceAll('__TITLE__', title)
  .replaceAll('__SUBTITLE__', pool.subtitle);

fs.writeFileSync(path.join(outDir, 'challenge.html'),
  fill(readTpl('challenge.html'), `${pool.titleShort}語彙チャレンジ`));
fs.writeFileSync(path.join(outDir, 'matching.html'),
  fill(readTpl('matching.html'), `${pool.titleShort}語彙マッチング`));

// 6) index（ブックマーク先）
const total = pool.words.length;
const learned = seenSet.size;
const newCount = newWords.length;
const reviewCount = reviewWords.length;
const completeMsg = unitComplete
  ? `<div class="banner">🎉 「${pool.unit}」の新しい言葉は全部やったよ！今日はぜんぶ復習。<br>次の単元にすすむ準備ができたら、おうちの人に教えてね。</div>`
  : '';

const index = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>今日の語彙ゲーム｜${pool.subtitle}</title>
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
  <h1>📚 今日の語彙ゲーム</h1>
  <div class="date">${dateJa}（${pool.subtitle}・「${pool.unit}」）</div>
  ${completeMsg}
  <div class="stats">今日の言葉：新しい ${newCount} 語 ＋ 復習 ${reviewCount} 語<br>この単元：${learned} / ${total} 語やったよ</div>
  <div class="buttons">
    <a class="game challenge" href="challenge.html">📖 語彙チャレンジ（60秒）</a>
    <a class="game matching" href="matching.html">🔗 語彙マッチング</a>
  </div>
  <div class="foot">毎日あたらしいゲームになるよ ✨</div>
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, 'index.html'), index);

console.log(`✅ ${dateStr} 生成完了`);
console.log(`   単元: ${pool.unit} / 新出 ${newCount}語 + 復習 ${reviewCount}語 (計${today.length}語)`);
console.log(`   進捗: ${learned}/${total} 語${unitComplete ? ' ★単元一巡・以降は全部復習' : ''}`);
console.log(`   出力: ${path.join(outDir)}`);
