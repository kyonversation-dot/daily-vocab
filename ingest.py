#!/usr/bin/env python3
# ingest.py — 教材リンクDoc → 各子のPDFを読む → Claude visionで単元語彙を抽出 → プール更新
# 毎朝 GitHub Actions が generate.js の前に実行する（無人）。
#
# しくみ:
#   1. 公開Google Doc（教材リンク集）をテキストで取得
#   2. 「ひなの: <Driveリンク>」「マヤ: <Driveリンク>」を解析（xxxx等のプレースホルダは無視）
#   3. リンクが前回と同じなら その子はスキップ（API費用ゼロ）。変わっていたら:
#        PDFをDL → PyMuPDFでページ画像化 → Claude(opus-4-8) visionで {unit, words[]} 抽出
#        → 各プールJSONを上書き（unitが変わればgenerate.js側でseen自動リセット=Day1）
#   固定デッキ（小6漢字・小5漢字）は触らない。
#
# 必要env: ANTHROPIC_API_KEY（GitHub Secret）。依存: anthropic, pymupdf。

import os, re, io, json, base64, urllib.request, traceback
import fitz  # PyMuPDF
import anthropic

ROOT = os.path.dirname(os.path.abspath(__file__))
LINK_DOC_ID = "1dWEGDyhKzS92lAl-7cptKL1PjCoJZcShMCeM1LdzAsk"
LINK_DOC_URL = f"https://docs.google.com/document/d/{LINK_DOC_ID}/export?format=txt"
MODEL = "claude-opus-4-8"
MAX_PAGES = 12
ZOOM = 1.8

RUBY_NOTE = ("meaningの中で小学生に難しい漢字には <ruby>漢<rt>かん</rt></ruby> の形でふりがなを付ける。"
             "readingは全てひらがな（漢字の音読みだけカタカナ可）。")

# 子（Docの表示名）→ この単元PDFから作るプール群。固定漢字デッキはここに入れない。
DECKS = {
    "ひなの": [{
        "pool": "pool_hinano_vocab.json", "child": "ひなの",
        "subtitle": "ひなのの言葉れんしゅう", "itemLabel": "言葉", "counterUnit": "語",
        "titleFallback": "単元の言葉",
        "prompt": ("これは日本の中学1年生の国語教科書の単元ページの画像です。"
                   "この単元で学ぶ『重要語・難しい語彙・用語』を12〜20語ぬき出し、中学生向けのやさしい意味を付けてください。"
                   "古文の助詞のような細かい語ではなく、説明文・評論・物語文の理解に必要な言葉。" + RUBY_NOTE +
                   " unitはこの単元のタイトル。"),
    }],
    "マヤ": [
        {
            "pool": "pool_maya_vocab.json", "child": "マヤ",
            "subtitle": "マヤの言葉れんしゅう", "itemLabel": "言葉", "counterUnit": "語",
            "titleFallback": "説明の言葉",
            "prompt": ("これは小学5年生の国語教材の画像です。"
                       "本文が古文（古典）の場合は、古文そのものではなく『説明文・現代語訳・解説』に出てくる"
                       "『難しい言葉』を10〜16語ぬき出し、小5にやさしい意味を付けてください。" + RUBY_NOTE +
                       " unitは単元名に『＝説明の言葉』を付けたもの。"),
        },
        {
            "pool": "pool_maya_koten.json", "child": "マヤ",
            "subtitle": "マヤの古語れんしゅう", "itemLabel": "古語", "counterUnit": "語",
            "titleFallback": "古語",
            "prompt": ("これは小学5年生の国語教材の画像です。画像に古文（古典）の原文があれば、その中の『古語』を"
                       "10〜16語ぬき出し、現代語の意味を付けてください（例: 翁→おじいさん、いと→とても、うつくし→かわいらしい）。"
                       "jaに古語、readingはその古語のひらがな読み、meaningは現代語のやさしい意味。" + RUBY_NOTE +
                       " 古文が無ければwordsは空配列。unitは単元名。"),
        },
    ],
}

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "unit": {"type": "string"},
        "words": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {"ja": {"type": "string"}, "reading": {"type": "string"}, "meaning": {"type": "string"}},
                "required": ["ja", "reading", "meaning"],
            },
        },
    },
    "required": ["unit", "words"],
}


def read(p):
    with open(os.path.join(ROOT, p), "r", encoding="utf-8") as f:
        return f.read()


def load_json(p, default):
    try:
        return json.loads(read(p))
    except Exception:
        return default


def fetch_link_doc():
    with urllib.request.urlopen(LINK_DOC_URL, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def parse_links(text):
    out = {}
    for name in DECKS:
        m = re.search(re.escape(name) + r"\s*[:：]\s*(\S+)", text)
        if not m:
            continue
        fid = re.search(r"/d/([A-Za-z0-9_-]{10,})", m.group(1))
        if fid and fid.group(1).lower() not in ("xxxx", "yyyy"):
            out[name] = fid.group(1)
    return out


def download_pdf(fid):
    url = f"https://drive.google.com/uc?export=download&id={fid}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if not data[:5] == b"%PDF-":
        raise RuntimeError("not a PDF (Drive share may be private or a scan-warning page)")
    return data


def pages_b64(pdf_bytes):
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out = []
    for i in range(min(doc.page_count, MAX_PAGES)):
        pix = doc[i].get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM))
        out.append(base64.b64encode(pix.tobytes("png")).decode())
    return out


def extract(client, imgs, prompt):
    content = [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b}} for b in imgs]
    content.append({"type": "text", "text": prompt +
                    "\n出力は {unit, words:[{ja,reading,meaning}]} のJSONのみ。"})
    resp = client.messages.create(
        model=MODEL, max_tokens=8000,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": content}],
    )
    txt = next(b.text for b in resp.content if b.type == "text")
    return json.loads(txt)


def write_pool(cfg, unit, words):
    pool = {
        "unit": unit, "child": cfg["child"],
        "titleShort": (unit[:10] if unit else cfg["titleFallback"]),
        "subtitle": cfg["subtitle"], "itemLabel": cfg["itemLabel"], "counterUnit": cfg["counterUnit"],
        "words": words,
    }
    with open(os.path.join(ROOT, cfg["pool"]), "w", encoding="utf-8") as f:
        json.dump(pool, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("no ANTHROPIC_API_KEY — skip ingest (games still generate from existing pools)")
        return
    try:
        links = parse_links(fetch_link_doc())
    except Exception as e:
        print("could not read link doc:", e); return
    print("links:", {k: v[:8] + "…" for k, v in links.items()})
    state = load_json("ingest_state.json", {})
    client = anthropic.Anthropic()
    changed = False

    for name, fid in links.items():
        if state.get(name) == fid:
            print(f"[{name}] link unchanged — skip (no API cost)")
            continue
        try:
            imgs = pages_b64(download_pdf(fid))
            print(f"[{name}] {len(imgs)} pages → extracting…")
            for cfg in DECKS[name]:
                data = extract(client, imgs, cfg["prompt"])
                words = data.get("words", [])
                if not words:
                    print(f"  {cfg['pool']}: 0 words (kept old)"); continue
                write_pool(cfg, data.get("unit", cfg["titleFallback"]), words)
                print(f"  {cfg['pool']}: unit='{data.get('unit')}' {len(words)} words ✓")
            state[name] = fid
            changed = True
        except Exception as e:
            print(f"[{name}] FAILED — kept existing pools:", e)
            traceback.print_exc()

    if changed:
        with open(os.path.join(ROOT, "ingest_state.json"), "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.write("\n")
    print("ingest done.")


if __name__ == "__main__":
    main()
