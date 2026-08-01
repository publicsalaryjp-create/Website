# data/salary-tables.json について

このアプリが読み込む俸給表データ本体です。ユーザーから提供された公式の俸給表xlsx
（行政職・公安職・教育職・医療職など19表を含む）から `scripts/extract-salary-tables.py`
で抽出しました。

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

同じシート構成（各職種のシートに「職務の級」ヘッダーと号俸ごとの俸給月額表がある形式）の
公式xlsxを入手した場合は、以下で再生成できます。

```bash
python3 scripts/extract-salary-tables.py path/to/official-salary-tables.xlsx
```

シート名や列レイアウトが異なる場合は `scripts/extract-salary-tables.py` 内の
`GRADED_SHEETS` 等を実際のファイルに合わせて修正してください。
