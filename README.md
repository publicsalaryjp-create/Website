# salary-calculator

[![CI](https://github.com/MTMR-code/salary-calculator/actions/workflows/ci.yml/badge.svg)](https://github.com/MTMR-code/salary-calculator/actions/workflows/ci.yml)

国家公務員（行政職俸給表(一)を想定）の給与を概算計算する静的Webサイトです。
ビルド不要、HTML/CSS/バニラJavaScriptのみで動作します。

詳細な仕様は [docs/requirements.md](docs/requirements.md)（要件定義書）を、
開発の進め方（バックログ・スプリント記録など）は [docs/README.md](docs/README.md) を参照してください。
変更履歴は [CHANGELOG.md](CHANGELOG.md) にあります。

## 使い方（ローカル確認）

ブラウザの `fetch` を使うため、`file://` で直接開くのではなく簡易HTTPサーバー経由で開いてください。

```bash
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

## テスト

```bash
npm install
npx playwright install --with-deps chromium  # 初回のみ
npm test
```

`npm test` は「俸給表データの検証」「計算ロジックのユニットテスト」「ブラウザでのE2Eスモークテスト」を
順に実行します。個別に実行する場合は `npm run test:data` / `npm run test:unit` / `npm run test:e2e`。
GitHub Actions（`.github/workflows/ci.yml`）で `main` へのpushとPull Requestのたびに自動実行されます。

## 計算している項目

- 俸給月額（俸給表の種類 × 職務の級 × 号俸。行政職・公安職・教育職・医療職など20表に対応）
- 地域手当（勤務地の級地区分：1級地20%〜5級地4%、非支給地0%）
- 扶養手当（配偶者・子・父母等。配偶者手当の段階的廃止スケジュールに対応）
- 住居手当（賃貸住宅の家賃に応じた支給額）
- 通勤手当（公共交通機関の運賃 or 自動車等の距離）
- 期末手当・勤勉手当（賞与）の年間支給月数からの概算
- 超過勤務手当（残業代）: 平日時間外125%・深夜150%・休日135%・休日深夜160%、月60時間超は150%／深夜175%に切替
- 上記を合算した月額給与・年収の概算
- 俸給表バージョンの切替（現行／人事院勧告後。勧告後は現時点でデータ未登録）
- 生涯賃金シミュレーション（1〜35年目の級・号俸・地域手当区分を年ごとに設定）
- 新規採用職員向け別ページ（`new-hire.html`）: 在職期間別割合（期間率）を適用した初年度賞与・年収

含まれていないもの: 所得税・住民税・共済組合掛金等の控除、単身赴任手当、寒冷地手当など。
このツールが出す金額はすべて**控除前の額面（支給額）**です。

## ⚠️ データについての重要な注意

**俸給表（`data/salary-tables.json`）はユーザーから提供された公式データ（20表、令和8年4月1日施行）を使用しています。**
制度は毎年改定されるため、施行日以降に人事院勧告等による改定があった場合は最新の公表資料と照合してください。
何らかの理由でこのファイルの読み込みに失敗した場合（`file://` で直接開いた場合など）は、
行政職俸給表(一)相当の簡易な参考値にフォールバックし、画面上にもその旨を表示します。

データを更新・再生成する場合は `data/README.md` と `scripts/extract-salary-tables.py` を参照してください。

地域手当・扶養手当・住居手当・通勤手当・賞与支給月数についてはWeb検索で確認できた範囲の公表情報をもとにしていますが、
制度は毎年改定されるため、最新の金額は人事院・内閣人事局の一次情報でご確認ください。

- [俸給表（別表第一）PDF - 人事院](https://www.jinji.go.jp/content/900030877.pdf)
- [人事院 令和6年人事院勧告](https://www.jinji.go.jp/seisaku/kankoku/archive/r6/r6_top.html)
- [内閣人事局 国家公務員の給与（令和6年版）](https://www.cas.go.jp/jp/gaiyou/jimu/jinjikyoku/pdf/r06_kyuyo.pdf)

超過勤務手当の割増率・算定方法は「一般職の職員の給与に関する法律」第16条・第19条及び人事院規則15-14を根拠にしています。
時間単価の算定基礎（俸給＋地域手当＋扶養手当）や年間所定勤務時間（週38時間45分×52週）、月60時間超の取扱い（60時間を超えた分は
平日時間外150%・深夜175%）は一般的な解説記事で確認できた内容に基づく概算です。実際の算定基礎額には広域異動手当・研究員調整手当等
このツールでは扱っていない手当が含まれる場合があるため、正確な金額は所属官署の給与担当にご確認ください。

## ディレクトリ構成

```
index.html                       通常版の画面
new-hire.html                     新規採用職員向けの画面
css/style.css                     スタイル（両画面共通）
js/data.js                         俸給表カタログ・手当データ、読み込み処理
js/calculator.js                   計算ロジック（純粋関数）
js/app.js                          index.html のDOM配線（生涯賃金シミュレーション含む）
js/new-hire.js                     new-hire.html のDOM配線
data/salary-tables.json            俸給表データ本体（20表、現行バージョン）
data/vintages.json                 俸給表バージョン（現行／人事院勧告後）の一覧
scripts/extract-salary-tables.py   俸給表xlsxからJSONを再生成するスクリプト
tests/validate-data.mjs            俸給表データの構造検証
tests/run-tests.mjs                計算ロジックのユニットテスト
tests/e2e.mjs                      ブラウザでのE2Eスモークテスト
.github/workflows/ci.yml           GitHub Actions CI設定
docs/requirements.md               要件定義書
docs/product-backlog.md            プロダクトバックログ
docs/definition-of-done.md         開発体制・Definition of Done / Ready
docs/sprint-template.md            スプリント記録のテンプレート
docs/sprints/                      過去のスプリント記録
CHANGELOG.md                       変更履歴
```
