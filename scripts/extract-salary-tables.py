"""
data/salary-tables.json の生成スクリプト。

公式の俸給表xlsx（人事院公表の別表第一〜第十等に相当する各シート、列D以降が
各級、行が号俸というレイアウト）を読み込み、data/salary-tables.json を再生成する。

使い方:
    python3 scripts/extract-salary-tables.py path/to/official-salary-tables.xlsx

前提とするシート構成:
- 「職務の級」を含むヘッダーセルの右側に級番号が並ぶ「級構成」シート
  （行政職(一)・行政職(二)・専門行政職・税務職・公安職(一)(二)・海事職(一)(二)・
   教育職(一)(二)・研究職・医療職(一)(二)(三)・福祉職・専門スタッフ職）
- 号俸と俸給月額のみの「フラット構成」シート（指定職）
- 複数のフラット表が縦に並ぶ特殊シート（任期付研究員・特定任期付）

シート構成が異なるファイルを渡す場合は、GRADED_SHEETS 等の定義を書き換えること。
"""

import json
import sys

import openpyxl

GRADED_SHEETS = {
    "行政職（一）": ("administrative_1", "行政職俸給表(一)"),
    "行政職（二）": ("administrative_2", "行政職俸給表(二)"),
    "専門行政職": ("specialized_administrative", "専門行政職俸給表"),
    "税務職": ("tax", "税務職俸給表"),
    "公安職（一）": ("public_safety_1", "公安職俸給表(一)"),
    "公安職（二）": ("public_safety_2", "公安職俸給表(二)"),
    "海事職（一）": ("maritime_1", "海事職俸給表(一)"),
    "海事職（二）": ("maritime_2", "海事職俸給表(二)"),
    "教育職（一）": ("education_1", "教育職俸給表(一)"),
    "教育職（二）": ("education_2", "教育職俸給表(二)"),
    "研究職": ("research", "研究職俸給表"),
    "医療職（一）": ("medical_1", "医療職俸給表(一)"),
    "医療職（二）": ("medical_2", "医療職俸給表(二)"),
    "医療職（三）": ("medical_3", "医療職俸給表(三)"),
    "福祉職": ("welfare", "福祉職俸給表"),
    "専門スタッフ職": ("specialist_staff", "専門スタッフ職俸給表"),
}


def parse_graded_sheet(ws):
    header_row = None
    grade_col_start = None
    for r in range(1, 8):
        for c in range(1, 6):
            v = ws.cell(row=r, column=c).value
            if isinstance(v, str) and "職務" in v and "級" in v:
                header_row = r
                grade_col_start = c + 1
                break
        if header_row:
            break
    if not header_row:
        return None

    grades = {}
    grade_cols = {}
    c = grade_col_start
    while True:
        v = ws.cell(row=header_row, column=c).value
        if isinstance(v, int):
            grade_cols[c] = v
            grades[str(v)] = []
            c += 1
        else:
            break

    step_col = grade_col_start - 2
    data_start = header_row + 3

    r = data_start
    while r <= ws.max_row:
        col_a_val = ws.cell(row=r, column=1).value
        if isinstance(col_a_val, str) and col_a_val.strip():
            break  # "定年前再任用短時間勤務職員" 区分や備考の開始
        step_val = ws.cell(row=r, column=step_col).value
        row_vals = {gc: ws.cell(row=r, column=gc).value for gc in grade_cols}
        if step_val is None and all(v is None for v in row_vals.values()):
            r += 1
            continue
        if step_val is not None:
            for gc, grade_num in grade_cols.items():
                amt = row_vals[gc]
                if amt is not None:
                    grades[str(grade_num)].append(amt)
        r += 1
        if r - data_start > 400:
            break

    return {k: v for k, v in grades.items() if v}


def parse_flat_table(ws, data_start_row, step_col, val_col, stop_after_blank=1):
    steps = []
    r = data_start_row
    blanks = 0
    while r <= ws.max_row:
        step_val = ws.cell(row=r, column=step_col).value
        amt = ws.cell(row=r, column=val_col).value
        if step_val is None and amt is None:
            blanks += 1
            if blanks > stop_after_blank:
                break
            r += 1
            continue
        blanks = 0
        if amt is not None:
            steps.append(amt)
        r += 1
    return steps


def main():
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <official-salary-tables.xlsx>")
        sys.exit(1)

    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    order = list(GRADED_SHEETS.values())
    order_keys = [k for k, _ in order]
    tables = {}

    for sheet_name, (key, label) in GRADED_SHEETS.items():
        if sheet_name not in wb.sheetnames:
            print(f"skip (sheet not found): {sheet_name}")
            continue
        grades = parse_graded_sheet(wb[sheet_name])
        if not grades:
            print(f"FAILED TO PARSE: {sheet_name}")
            continue
        tables[key] = {"label": label, "type": "graded", "grades": grades}
        print(sheet_name, "->", key, {g: len(v) for g, v in grades.items()})

    if "指定職" in wb.sheetnames:
        steps = parse_flat_table(wb["指定職"], data_start_row=6, step_col=1, val_col=3)
        tables["designated"] = {"label": "指定職俸給表", "type": "flat", "steps": steps}
        order_keys.append("designated")
        print("指定職 ->", steps)

    if "任期付研究員・特定任期付" in wb.sheetnames:
        ws = wb["任期付研究員・特定任期付"]
        for key, label, start_row in [
            ("fixed_term_researcher_type1", "任期付研究員（第一号）俸給表（号俸のみ）", 6),
            ("fixed_term_researcher_type2", "任期付研究員（第二号）俸給表（号俸のみ）", 17),
            ("fixed_term_staff_specified", "特定任期付職員俸給表（号俸のみ）", 26),
        ]:
            steps = parse_flat_table(ws, data_start_row=start_row, step_col=4, val_col=6, stop_after_blank=0)
            tables[key] = {"label": label, "type": "flat", "steps": steps}
            order_keys.append(key)
            print(key, "->", steps)

    out = {
        "source": "ユーザー提供の公式俸給表データ（一般職の職員の給与に関する法律 別表に基づく）",
        "note": "適用年度・施行日は未確認のため、必ず最新の人事院公表資料と照合してください。",
        "order": order_keys,
        "tables": tables,
    }

    with open("data/salary-tables.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print("wrote data/salary-tables.json with", len(tables), "tables")


if __name__ == "__main__":
    main()
