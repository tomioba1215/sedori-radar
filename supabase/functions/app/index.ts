// Supabase は Edge Functions / Storage からの text/html 配信をブロックするため、
// ダッシュボード本体は GitHub Pages でホストし、ここはリダイレクトのみ行う。
const DASHBOARD_URL = "https://tomioba1215.github.io/sedori-radar/";

Deno.serve(() => Response.redirect(DASHBOARD_URL, 302));
