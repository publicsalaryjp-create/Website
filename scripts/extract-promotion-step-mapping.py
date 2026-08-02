"""e-Gov の人事院規則9-8 XMLから行政職俸給表(一)の昇格時号俸対応表を抽出する。

使い方:
    python3 scripts/extract-promotion-step-mapping.py rule-9-8.xml js/promotion-step-mapping.js
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


TABLE_TITLE = "行政職俸給表（一）昇格時号俸対応表"


def text(element):
    return "".join(element.itertext()).strip()


def main(source_path: str, destination_path: str):
    root = ET.parse(source_path).getroot()
    table = None
    for item in root.iter("Item"):
        if TABLE_TITLE in text(item):
            table = item.find(".//TableStruct")
            break
    if table is None:
        raise ValueError(f"{TABLE_TITLE} が見つかりません")

    rows = []
    for table_row in table.findall(".//TableRow"):
        cells = [text(column) for column in table_row.findall("./TableColumn")]
        if cells:
            rows.append(cells)

    target_grades = [str(grade) for grade in range(2, 11)]
    mapping = {grade: {} for grade in target_grades}
    for row in rows[2:]:
        if len(row) != 10 or not row[0].isdigit():
            continue
        source_step = str(int(row[0]))
        for target_grade, target_step in zip(target_grades, row[1:]):
            if target_step.isdigit():
                mapping[target_grade][source_step] = int(target_step)

    if len(mapping["2"]) < 90:
        raise ValueError("対応表の抽出件数が不正です")

    output = {
        "source": "e-Gov 人事院規則9-8 別表第七（2026-04-01時点）",
        "tables": {"administrative_1": mapping},
    }
    Path(destination_path).write_text(
        "// e-Gov の人事院規則9-8 別表第七から生成。手編集しないこと。\n"
        "const PROMOTION_STEP_MAPPINGS = Object.freeze("
        + json.dumps(output, ensure_ascii=False, separators=(",", ":"))
        + ");\n",
        encoding="utf-8",
    )
    print(f"{destination_path}: 行政職俸給表(一)の昇格対応表を書き出しました")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("使い方: extract-promotion-step-mapping.py 入力.xml 出力.js")
    main(sys.argv[1], sys.argv[2])
