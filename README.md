# keiba-site — 競馬予想記録サイト

競馬予想エンジン V9.0 の予想を掲載し、成績を前向きに積み上げる**静的サイト**。
「よく当たる・無駄に負けない」が趣旨。「儲かる」とは書かない。

## 構成
- 静的HTML/CSS/JS のみ。ビルド不要・CDN不使用・UTF-8。
- GitHub Pages は **docs/ 方式**（`docs/index.html` が入口）。
- 見た目は「平成個人サイト」様式（罫線テーブル主役・システムフォント・装飾なし）。

```
docs/
  index.html     最新予想(結論ブロック優先)
  seiseki.html   成績(年月別テーブル・場別マップ・凍結注記)
  kensho.html    検証中コーナー(前向き検証装置)
  archive.html   過去予想一覧(詳細インライン展開)
  about.html     概要・免責
  style.css      平成様式スタイル
  app.js         fetch + レンダリング(判断は data.json 側で確定済み)
  data/
    index.json   アーカイブ索引(publish_site.py が生成)
    stats.json   成績集計(format_prediction.py --stats)
    archive/*.json  1レース=1 data.json(format_prediction.py --json)
```

## 更新方法
競馬リポジトリ側の `predict_and_publish.ps1` を実行すると、
予想実行 → data.json/stats.json 生成 → 本リポジトリの `docs/data/` へコピー →
索引再生成 → commit/push まで自動で行われる。

このリポジトリを直接手で編集する必要は基本的に無い（`docs/data/` は自動生成物）。

## 公開URL
https://norenorebot.github.io/norenorebotkeiba-site/

（GitHub Pages は `main` ブランチの `docs/` を公開する設定。
　運用スクリプトはサイトURLを `git remote origin` から自動導出するため、
　リポジトリを移管してもコード側の修正は不要。）

## 免責
本サイトは個人の予想記録です。的中・収支を保証するものではありません。
馬券の購入は自己責任で。20歳未満の馬券購入は禁止されています。

Since 2026
