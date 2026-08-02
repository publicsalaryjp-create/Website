-- compare-official-simulator.mjs から呼び出すMicrosoft Excel for Mac用ブリッジ。
-- 公式ブックは保存せずに閉じる。Excelのマクロを有効にして実行すること。

on tabItems(theText)
	set AppleScript's text item delimiters to tab
	set itemsList to text items of theText
	set AppleScript's text item delimiters to ""
	return itemsList
end tabItems

on numericValue(theText)
	if theText is "" then return 0
	return theText as number
end numericValue

on run argv
	if (count of argv) is not 3 then error "Usage: official-simulator-bridge.applescript <book.xlsm> <input.tsv> <output.tsv>"
	set bookPath to item 1 of argv
	set inputPath to item 2 of argv
	set outputPath to item 3 of argv
	set inputLines to paragraphs of (read POSIX file inputPath as «class utf8»)
	set outputText to "id" & tab & "baseSalary" & tab & "specialAdjustmentAllowance" & tab & "regionalAllowance" & tab & "honshoAllowance" & tab & "singleAssignmentAllowance" & tab & "housingAllowance" & tab & "dependentAllowance" & tab & "overtimeAllowance" & tab & "monthlyTotal" & tab & "commutingAnnual" & tab & "bonusAnnualMin" & tab & "bonusAnnualMax" & tab & "annualIncomeMin" & tab & "annualIncomeMax" & linefeed

	tell application "Microsoft Excel"
		activate
		open POSIX file bookPath
		set wb to active workbook
		set ws to worksheet "計算ツール" of wb
		repeat with rowIndex from 2 to count of inputLines
			set fields to my tabItems(item rowIndex of inputLines)
			if (count of fields) is 19 then
				set value of range "C6" of ws to item 2 of fields
				set value of range "C7" of ws to my numericValue(item 3 of fields)
				set value of range "E7" of ws to my numericValue(item 4 of fields)
				set value of range "C8" of ws to item 5 of fields
				set value of range "D13" of ws to item 6 of fields
				set value of range "C17" of ws to item 7 of fields
				set value of range "C22" of ws to my numericValue(item 8 of fields)
				set value of range "F22" of ws to my numericValue(item 9 of fields)
				set value of range "D27" of ws to my numericValue(item 10 of fields)
				set value of range "C31" of ws to my numericValue(item 11 of fields)
				set value of range "F32" of ws to item 12 of fields
				set value of range "F33" of ws to item 13 of fields
				set value of range "F34" of ws to item 14 of fields
				set value of range "F35" of ws to item 15 of fields
				set value of range "C36" of ws to my numericValue(item 16 of fields)
				set value of range "C40" of ws to my numericValue(item 17 of fields)
				set value of range "D45" of ws to item 18 of fields
				set value of range "D46" of ws to item 19 of fields
				calculate
				set outputText to outputText & item 1 of fields
				repeat with cellAddress in {"E51", "E52", "E53", "E54", "E55", "E56", "E57", "E58", "E60", "E62", "E63", "G63", "E65", "G65"}
					set outputText to outputText & tab & (value of range cellAddress of ws as text)
				end repeat
				set outputText to outputText & linefeed
			end if
		end repeat
		close wb saving no
	end tell

	set outputFile to POSIX file outputPath
	set fileRef to open for access outputFile with write permission
	try
		set eof of fileRef to 0
		write outputText to fileRef as «class utf8»
		close access fileRef
	on error errMessage number errNumber
		try
			close access fileRef
		end try
		error errMessage number errNumber
	end try
end run
