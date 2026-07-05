# せどりレーダー

抽選・数量限定・予約商品のニュースを毎日自動収集し、メルカリ相場ベースの利益をトラッキングする個人用ダッシュボード。

- **ダッシュボード**: https://tomioba1215.github.io/sedori-radar/ (GitHub Pages)
- **データベース**: Supabase (`sedori-radar` プロジェクト, ap-northeast-1)
- **自動巡回**: Supabase Edge Function `collect` を pg_cron が毎朝 7:00 JST に実行。Google News RSS を 9 クエリで巡回し `candidates` テーブルへ upsert
- **利益計算**: メルカリ相場 × 0.9 (販売手数料 10% 控除) − 送料 − 定価

## 構成

| パス | 役割 |
|---|---|
| `index.html` | ダッシュボード本体 (単一 HTML + Chart.js) |
| `supabase/functions/collect/index.ts` | ニュース収集 Edge Function (JWT 必須) |
| `supabase/functions/app/index.ts` | GitHub Pages へのリダイレクト |

## メモ

- 埋め込まれている Supabase キーは anon (publishable) キーで、RLS 前提の公開可能キー。secret キーは一切使用していない。
- メルカリ相場は規約に配慮し自動スクレイピングせず、ワンクリック検索リンク + 手入力で記録する半自動方式。
