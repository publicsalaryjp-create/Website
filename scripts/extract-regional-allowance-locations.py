"""公式給与シミュレーターから地域手当の市区町村等データを抽出する。

使い方:
    python3 scripts/extract-regional-allowance-locations.py \
      /path/to/人事院_給与シミュレーター.xlsm \
      js/regional-allowance-locations.js

出力する JavaScript はブラウザでそのまま読み込むデータファイルである。元ブックの
「地域手当支給率」シートにある令和8年度支給割合（経過措置を含む）を採用する。
"""

import json
import sys
from pathlib import Path

import openpyxl


def main(source_path: str, destination_path: str):
    workbook = openpyxl.load_workbook(source_path, read_only=True, data_only=True, keep_vba=True)
    worksheet = workbook["地域手当支給率"]
    locations = []
    seen = set()

    # D:自治体コード、E:都道府県、F:市区町村等、G:級地区分、H:令和8年度支給割合
    for row in worksheet.iter_rows(min_row=2, values_only=True):
        municipality_code, prefecture, municipality, category, rate = row[4:9]
        if not prefecture or not municipality or rate is None:
            continue
        # 地域手当率は同じため、利用者の選択肢では本府省／本府省以外を区別しない。
        # 本府省勤務かどうかは、別途「本府省業務調整手当」で扱う。
        if prefecture == "東京都" and municipality in {"特別区（本府省）", "特別区（本府省以外）"}:
            municipality = "特別区"
        key = (prefecture, municipality, rate)
        if key in seen:
            continue
        seen.add(key)
        locations.append({
            "code": f"{municipality_code}:{municipality}",
            "prefecture": prefecture,
            "municipality": municipality,
            "category": category,
            "rate": float(rate) / 100,
        })

    if len(locations) < 1000:
        raise ValueError(f"抽出件数が不正です: {len(locations)}")

    destination = Path(destination_path)
    destination.write_text(
        "// 人事院公式『給与シミュレーター』（令和8年度）の地域手当支給率シートから生成。\n"
        "// 手編集しないこと。更新時は scripts/extract-regional-allowance-locations.py を実行する。\n"
        f"const REGIONAL_ALLOWANCE_LOCATIONS = Object.freeze({json.dumps(locations, ensure_ascii=False, separators=(',', ':'))});\n",
        encoding="utf-8",
    )
    print(f"{destination}: {len(locations)}件を書き出しました")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("使い方: extract-regional-allowance-locations.py 入力.xlsm 出力.js")
    main(sys.argv[1], sys.argv[2])
