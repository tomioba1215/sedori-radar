// 抽選・限定商品ニュース自動収集 (pg_cron で毎朝 7:00 JST に実行 / ダッシュボードから手動実行)
// Google News RSS を複数クエリで巡回し、candidates テーブルへ upsert する。

const SUPABASE_URL = "https://rtsnrkkarbsjuvtvlvjx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_v9qtzFSVvH4Pnpz5TPWyCA_anO4JnRy";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const QUERIES = [
  { q: "スニーカー 抽選", cat: "sneaker" },
  { q: "スニーカー 限定 発売", cat: "sneaker" },
  { q: "ポケモンカード 抽選", cat: "tcg" },
  { q: "トレカ 予約 発売", cat: "tcg" },
  { q: "一番くじ 発売", cat: "hobby" },
  { q: "フィギュア 限定 予約", cat: "hobby" },
  { q: "ゲーム機 抽選 販売", cat: "game" },
  { q: "遊戯王 予約 抽選", cat: "tcg" },
  { q: "ワンピースカード 予約 抽選", cat: "tcg" },
  { q: "ガンプラ 予約 抽選", cat: "hobby" },
  { q: "ウイスキー 抽選 販売", cat: "liquor" },
  { q: "日本酒 限定 抽選", cat: "liquor" },
  { q: "ユニクロ コラボ 発売", cat: "fashion" },
  { q: "シュプリーム 発売", cat: "fashion" },
  { q: "G-SHOCK 限定 発売", cat: "gadget" },
  { q: "腕時計 限定 抽選", cat: "gadget" },
  { q: "抽選販売 受付", cat: "other" },
  { q: "数量限定 発売 予約", cat: "other" },
];

const CATEGORY_RULES: { cat: string; re: RegExp }[] = [
  { cat: "sneaker", re: /スニーカー|ナイキ|NIKE|SNKRS|アディダス|adidas|エアジョーダン|Jordan|ダンク|New Balance|ニューバランス|asics|アシックス/i },
  { cat: "tcg", re: /ポケカ|ポケモンカード|トレカ|遊戯王|ワンピースカード|デュエマ|カードゲーム|TCG|拡張パック/i },
  { cat: "game", re: /Switch|スイッチ|PS5|PlayStation|プレステ|Xbox|ゲーム機|本体.*抽選/i },
  { cat: "hobby", re: /一番くじ|フィギュア|ガンプラ|プラモ|ねんどろいど|figma|ホビー|ぬいぐるみ|グッズ/i },
  { cat: "liquor", re: /ウイスキー|山崎|白州|響\s|イチローズモルト|日本酒|焼酎|ワイン|スピリッツ|蒸留所|酒/i },
  { cat: "fashion", re: /ユニクロ|UNIQLO|\bGU\b|Supreme|シュプリーム|アパレル|Tシャツ|パーカー|スウェット/i },
  { cat: "gadget", re: /G-SHOCK|Gショック|カシオ|CASIO|セイコー|SEIKO|腕時計|イヤホン|ヘッドホン|カメラ|家電/i },
];

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]) : null;
}

function categorize(title: string, fallback: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(title)) return rule.cat;
  }
  return fallback;
}

async function fetchQuery({ q, cat }: { q: string; cat: string }) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (sedori-radar personal feed reader)" } });
  if (!res.ok) throw new Error(`RSS fetch failed (${q}): ${res.status}`);
  const xml = await res.text();
  const items = [];
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 直近7日のみ
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    let title = tag(block, "title");
    const link = tag(block, "link");
    const pubDate = tag(block, "pubDate");
    const source = tag(block, "source");
    if (!title || !link) continue;
    const ts = pubDate ? Date.parse(pubDate) : NaN;
    if (!Number.isNaN(ts) && ts < cutoff) continue;
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(` - ${source}`.length)).trim();
    }
    items.push({
      title,
      url: link,
      source: source || null,
      category: categorize(title, cat),
      published_at: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
    });
  }
  return items;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const settled = await Promise.allSettled(QUERIES.map(fetchQuery));
    const errors: string[] = [];
    const byUrl = new Map<string, unknown>();
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        for (const it of r.value) if (!byUrl.has(it.url)) byUrl.set(it.url, it);
      } else {
        errors.push(`${QUERIES[i].q}: ${r.reason?.message ?? r.reason}`);
      }
    });
    const rows = [...byUrl.values()];

    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };

    let inserted = 0;
    if (rows.length > 0) {
      const up = await fetch(`${SUPABASE_URL}/rest/v1/candidates?on_conflict=url`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(rows),
      });
      if (!up.ok) throw new Error(`Supabase upsert failed: ${up.status} ${await up.text()}`);
      inserted = (await up.json()).length;
    }

    // 30日以上前の未処理候補は自動で却下扱いにして受信箱を掃除
    const staleBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/candidates?status=eq.new&fetched_at=lt.${staleBefore}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "dismissed" }),
    });

    return new Response(JSON.stringify({ ok: true, fetched: rows.length, inserted, errors }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
