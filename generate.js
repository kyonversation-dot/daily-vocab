// generate.js — 毎日の練習ゲームを各デッキ1本ずつ作る（決定的・LLM不要）
// 使い方: node generate.js
//   decks.json のデッキごとに pool と seen を読み、今日の「新出+復習」を選び、
//   templates/ から challenge/matching/index.html を各 out/ に書き出す。
//   さらに子ごとのハブ（docs/<childSlug>/index.html）とルート（docs/index.html）を作る。
//
// デッキ = { id, child, childSlug, label, pool, seen, out, big? }
// 単元を変えるとき: その pool を差し替えるだけ（unit が変わると seen 自動リセット）。

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DAILY_NEW = 8;
const REVIEW_COUNT = 4;

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readTpl = (p) => fs.readFileSync(path.join(ROOT, 'templates', p), 'utf8');
const pickRandom = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

const BIG_CSS = `
  .word-ja { font-size: 2.4rem; }
  .word-card .text { font-size: 2rem; }
`;

const PAGE_HEAD = `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">`;
const HUB_CSS = `
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Hiragino Kaku Gothic ProN','Meiryo',sans-serif; background:#1a1a2e; color:#eee;
         min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; gap:16px; }
  h1 { color:#ffb4d4; font-size:1.6rem; text-align:center; }
  .sub { color:#aaa; font-size:0.85rem; }
  .cards { display:flex; flex-direction:column; gap:14px; width:100%; max-width:360px; }
  a.card { display:block; text-decoration:none; color:white; font-weight:bold; font-size:1.15rem;
           padding:20px; border-radius:16px; text-align:center; }
  a.card small { display:block; font-weight:normal; font-size:0.72rem; opacity:0.85; margin-top:4px; }
  a.k { background:#c0436a; } a.v { background:#3a5ac0; } a.card:hover { opacity:0.9; }
  .foot { color:#666; font-size:0.7rem; margin-top:8px; text-align:center; }
`;

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const dateJa = `${now.getMonth() + 1}月${now.getDate()}日`;

const decks = readJSON('decks.json');
const children = {};  // childSlug -> { name, dir, decks:[{label,slug,itemLabel,stats}] }

decks.forEach(deck => {
  const meta = buildDeck(deck);
  const cs = deck.childSlug;
  if (!children[cs]) children[cs] = { name: deck.child, dir: path.dirname(deck.out), decks: [] };
  children[cs].decks.push(meta);
});

// 子ごとのハブ
Object.entries(children).forEach(([cs, c]) => {
  const cards = c.decks.map(d => {
    const cls = d.slug === 'kanji' ? 'k' : 'v';
    return `    <a class="card ${cls}" href="${d.slug}/">${d.label}<small>今日：新しい${d.newCount}＋復習${d.reviewCount}／${d.learned}・${d.total}${d.counterUnit}</small></a>`;
  }).join('\n');
  const html = `<!DOCTYPE html><html lang="ja"><head>${PAGE_HEAD}<title>${c.name}のまいにち勉強</title><style>${HUB_CSS}</style></head>
<body>
  <h1>📚 ${c.name}のまいにち勉強</h1>
  <div class="sub">${dateJa}</div>
  <div class="cards">
${cards}
  </div>
  <div class="foot">毎日あたらしいゲームになるよ ✨</div>
</body></html>
`;
  fs.mkdirSync(path.join(ROOT, c.dir), { recursive: true });
  fs.writeFileSync(path.join(ROOT, c.dir, 'index.html'), html);
  fs.writeFileSync(path.join(ROOT, c.dir, '.nojekyll'), '');
});

// ルート索引（子を選ぶ）
const rootCards = Object.entries(children).map(([cs, c]) =>
  `    <a class="card v" href="${cs}/">${c.name}</a>`).join('\n');
const rootHtml = `<!DOCTYPE html><html lang="ja"><head>${PAGE_HEAD}<title>まいにち勉強ゲーム</title><style>${HUB_CSS}</style></head>
<body>
  <h1>📚 まいにち勉強ゲーム</h1>
  <div class="sub">だれの？</div>
  <div class="cards">
${rootCards}
  </div>
</body></html>
`;
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), rootHtml);
fs.writeFileSync(path.join(ROOT, 'docs', '.nojekyll'), '');

console.log(`\n✅ ${dateStr} 完了：ハブ ${Object.keys(children).map(cs => '/'+cs+'/').join(' , ')}`);

// ---- デッキ1本を生成し、ハブ用メタを返す ----
// 状態(seenファイル)= { unit, date, seen:[ja...], today:[{ja,review}] }
// 「1日1セット」＝同じ date に何度実行しても同じ today を再生成（進めない）。
// date が変わった時・unit が変わった時だけ新しく進める。
function buildDeck(deck) {
  const pool = readJSON(deck.pool);
  const byJa = Object.fromEntries(pool.words.map(w => [w.ja, w]));

  let state = fs.existsSync(path.join(ROOT, deck.seen))
    ? readJSON(deck.seen) : { unit: '', date: '', seen: [], today: [] };
  if (state.unit !== pool.unit) state = { unit: pool.unit, date: '', seen: [], today: [] };

  let todaySel;  // [{ja, review}]
  if (state.date === dateStr && Array.isArray(state.today) && state.today.length) {
    // 同じ日：今日のセットをそのまま再生成（進めない）
    todaySel = state.today.filter(t => byJa[t.ja]);
  } else {
    // 新しい日（または単元変更）：今日ぶんを選んで進める
    const prevSeen = new Set(state.seen || []);
    const unseen = pool.words.filter(w => !prevSeen.has(w.ja));
    const newJa = unseen.slice(0, DAILY_NEW).map(w => w.ja);
    const reviewPool = [...prevSeen].filter(ja => byJa[ja]);
    const nReview = newJa.length === 0 ? DAILY_NEW + REVIEW_COUNT : REVIEW_COUNT;
    const reviewJa = pickRandom(reviewPool, Math.min(nReview, reviewPool.length));
    todaySel = [
      ...newJa.map(ja => ({ ja, review: false })),
      ...reviewJa.map(ja => ({ ja, review: true })),
    ];
    const seenSet = new Set([...prevSeen, ...newJa]);
    state = { unit: pool.unit, date: dateStr, seen: [...seenSet], today: todaySel };
  }
  fs.writeFileSync(path.join(ROOT, deck.seen), JSON.stringify(state, null, 2) + '\n');

  const seenSet = new Set(state.seen);
  const today = todaySel.map(t => ({ ...byJa[t.ja], review: t.review }));
  const newWords = today.filter(w => !w.review);
  const reviewWords = today.filter(w => w.review);
  const unitComplete = newWords.length === 0 && seenSet.size > 0;

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

  fs.writeFileSync(path.join(outDir, 'challenge.html'), fill(readTpl('challenge.html'), `${pool.titleShort}チャレンジ`));
  fs.writeFileSync(path.join(outDir, 'matching.html'), fill(readTpl('matching.html'), `${pool.titleShort}マッチング`));

  const itemLabel = pool.itemLabel || '言葉';
  const counterUnit = pool.counterUnit || '語';
  const total = pool.words.length;
  const learned = seenSet.size;
  const newCount = newWords.length;
  const reviewCount = reviewWords.length;
  const completeMsg = unitComplete
    ? `<div class="banner">🎉 「${pool.unit}」の新しい${itemLabel}は全部やったよ！今日はぜんぶ復習。<br>次にすすむ準備ができたら、おうちの人に教えてね。</div>` : '';

  const index = `<!DOCTYPE html>
<html lang="ja">
<head>${PAGE_HEAD}
<title>今日の${itemLabel}ゲーム｜${pool.subtitle}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family:'Hiragino Kaku Gothic ProN','Meiryo',sans-serif; background:#1a1a2e; color:#eee;
         min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; gap:18px; }
  h1 { color:#ffb4d4; font-size:1.5rem; text-align:center; }
  .date { color:#aaa; font-size:0.9rem; }
  .stats { color:#a8e6c1; font-size:0.85rem; text-align:center; line-height:1.6; }
  .banner { background:#2a1f00; border:1px solid #f5a623; color:#ffd88a; border-radius:12px;
            padding:12px 16px; font-size:0.8rem; text-align:center; max-width:420px; line-height:1.6; }
  .buttons { display:flex; flex-direction:column; gap:14px; width:100%; max-width:340px; }
  a.game { display:block; text-align:center; text-decoration:none; color:white; font-weight:bold; font-size:1.1rem; padding:18px; border-radius:16px; }
  a.challenge { background:#c0436a; } a.matching { background:#3a5ac0; } a.game:hover { opacity:0.9; }
  a.back { color:#888; font-size:0.8rem; text-decoration:none; margin-top:4px; }
  .foot { color:#666; font-size:0.7rem; margin-top:4px; text-align:center; }
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
  <a class="back" href="../">← ${deck.child}のトップにもどる</a>
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), index);

  console.log(`  [${deck.id}] ${pool.unit} 新出${newCount}+復習${reviewCount} 進捗${learned}/${total}${unitComplete ? ' ★一巡' : ''} → ${deck.out}`);

  return { label: deck.label, slug: path.basename(deck.out), itemLabel, counterUnit, newCount, reviewCount, learned, total };
}
