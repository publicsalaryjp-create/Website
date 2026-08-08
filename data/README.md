# data/salary-tables-r8.json について

このアプリが読み込む俸給表データ本体です。ユーザーから提供された公式の俸給表xlsx
（行政職・公安職・教育職・医療職など19表を含む）から `scripts/extract-salary-tables.py`
で抽出しました。令和8年4月1日施行の俸給表（`data/vintages.json` の `current`）です。

## data/salary-tables-r9.json について

令和8年人事院勧告で公表された、令和9年4月1日から適用される俸給表です
（`data/vintages.json` の `post_recommendation`）。シート構成が異なる別ファイルの
xlsx（`行（一）`等の略記シート名、号俸ヘッダーの位置が異なる指定職・任期付職員シート）
から同じ `scripts/extract-salary-tables.py` で抽出しています。19表の構成
（俸給表の種類・級ごとの号俸数）は現行と同一で、金額のみ改定されています。

読み込みには `fetch` を使うため、簡易HTTPサーバー経由（例: `python3 -m http.server`）で
アクセスしている必要があります。`file://` で直接開いた場合は読み込みに失敗し、
行政職俸給表(一)相当の参考値にフォールバックします。

## フォーマット

```json
{
  "source": "ユーザー提供の公式俸給表データ（...）",
  "note": "提供時点（2026-07-28）で有効な俸給表として掲載。実際の施行日は前年度分の可能性があるため、最新の人事院公表資料と照合してください。",
  "effectiveDate": "2026-07-28",
  "order": ["administrative_1", "specialized_administrative", "...", "designated"],
  "tables": {
    "administrative_1": {
      "label": "行政職俸給表(一)　― 一般行政事務など",
      "type": "graded",
      "grades": {
        "1": [195800, 196900, 198100, "..."],
        "2": [242000, 243300, "..."]
      }
    },
    "designated": {
      "label": "指定職俸給表　― 本省局長等（号俸のみ、級なし）",
      "type": "flat",
      "steps": [736000, 794000, 852000, "..."]
    }
  }
}
```

- `type: "graded"` は職務の級ごとに号俸配列を持つ通常の俸給表（行政職・公安職・教育職など）。
  `grades` の各キーは職務の級（文字列）、値は号俸1番目から順に並べた俸給月額（円）の配列。
- `type: "flat"` は級の概念がない俸給表（指定職、任期付研究員等）。`steps` が号俸1番目からの俸給月額配列。
- `order` は俸給表選択プルダウンの表示順。

## データを更新・再生成する

各職種のシートに「職務の級」ヘッダーと号俸ごとの俸給月額表がある形式の公式xlsxを
入手した場合は、以下で再生成できます（シート名の表記ゆれ「行政職（一）」「行（一）」
などは `GRADED_SHEETS` の候補リストで吸収します）。

```bash
python3 scripts/extract-salary-tables.py path/to/official-salary-tables.xlsx \
  data/salary-tables-r8.json 2026-04-01 "出典の説明"
```

引数は xlsxパス・出力先・`effectiveDate`・`source` の順（出力先以降は省略可、
省略時は `data/salary-tables-r8.json` に本日日付で書き込む）。新しいバージョン
（施行日違い）を追加する場合は出力先を別ファイル名にし、`data/vintages.json` に
`key`/`label`/`note`/`file`/`effectiveDate`/`available: true` のエントリを追加してください。

シート名や列レイアウトが大きく異なる場合は `scripts/extract-salary-tables.py` 内の
`GRADED_SHEETS` 等の定義を実際のファイルに合わせて修正してください。

## `allowance-rates-r8.json` / `allowance-rates-r8_kankokugo.json` について

期末手当など、年度によって改定される手当率を俸給表と同様にアプリ本体から分離して管理します。
`terminalAllowance` に職員区分（`general`、`senior_manager`、`designated`）ごとの支給月数を、
`june`（6月期）・`december`（12月期）をキーとして記録します。年間支給月数は保持しません。
更新時は `source` と `fiscalYear` も合わせて変更してください。
`bonusRoleStageAdditionRates` には、期末・勤勉手当の算定基礎に加える役職段階別加算割合を
俸給表・級ごとに記録します。指定職は級がないため、区分に対する割合を直接記録します。

俸給表と同様、期末手当の支給月数もバージョン（現行／人事院勧告反映後）ごとに異なりうるため、
`data/vintages.json` の各バージョンに `allowanceFile` を持たせ、`file`（俸給表）と一緒に
読み込む・切り替える仕組みになっています（`js/data.js` の `switchVintage()` 参照）。
ファイル名は年度ごとに「ノーマル（`allowance-rates-r{年度}.json`）」と
「勧告後（`allowance-rates-r{年度}_kankokugo.json`）」の2本立てで管理します。
`allowance-rates-r8_kankokugo.json` は令和8年度のうち、6月期は勧告前（現行）の値のまま、
12月期のみ人事院勧告反映後の推定値（一般職員・特定管理職員・指定職員とも「6月期の値+0.025」）
に置き換えたものです。12月期の正式な公表値は未入手のため暫定的な推定値であることを
`source` フィールドに明記しています。なお勤勉手当は成績率のみで算定しており
「支給月数」の概念を持たないため、勤勉手当側の月数データがあってもこのファイルには反映しません
（勤勉手当の12月期の成績率シフトは `js/data.js` の `MERIT_RATE_CATEGORIES_POST_RECOMMENDATION_DECEMBER` を参照）。

`allowance-rates-r9nendo.json` は令和9年度（6月期・12月期とも）の推定値で、現行の値に一律
+0.0125（一般職員1.2625→1.275等）を加えたものです。`allowance-rates-r8_kankokugo.json`と同様、
正式な公表値は未入手のため暫定的な推定値であることを`source`フィールドに明記しています。
対応する勤勉手当の成績率シフト（6月期・12月期とも+0.0125）は `js/data.js` の
`MERIT_RATE_CATEGORIES_REIWA9_NENDO` を参照してください。`data/vintages.json` の
バージョン一覧は、俸給表バージョン・支給期の組み合わせごとの成績率シフト幅を管理する
`MERIT_RATE_SHIFT_BY_VINTAGE`（`js/data.js`）と対応させる必要があります。
