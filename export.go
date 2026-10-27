package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

type exportRow struct {
	School     string `json:"school"`
	Title      string `json:"title"`
	Category   string `json:"category"`
	Phase      string `json:"phase"`
	Status     string `json:"status"`
	Parent     string `json:"parent"`
	Name       string `json:"name"`
	No         string `json:"no"`
	Contractor string `json:"contractor"`
	Amount     int64  `json:"amount"`
	ContractDt string `json:"contractDate"`
	StartDate  string `json:"startDate"`
	EndDate    string `json:"endDate"`
	Contact    string `json:"contact"`
	Bizno      string `json:"bizno"`
	Note       string `json:"note"`
	Level      int    `json:"level"`
}

type exportReq struct {
	Title string      `json:"title"`
	Rows  []exportRow `json:"rows"`
}

func handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	var req exportReq
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "잘못된 요청", 400)
		return
	}
	path, err := writeXLSX(req)
	if err != nil {
		http.Error(w, "엑셀 저장 실패: "+err.Error(), 500)
		return
	}
	selectInExplorer(path)
	writeJSON(w, map[string]any{"ok": true, "path": path})
}

func writeXLSX(req exportReq) (string, error) {
	f := excelize.NewFile()
	defer f.Close()
	sh := "계약 추진현황"
	f.SetSheetName("Sheet1", sh)

	head := []string{"학교", "요약명", "항목", "차수", "상태", "상위계약", "계약명", "계약번호", "계약자", "계약금액(원)", "계약일", "착수일", "완수일", "연락처·담당", "비즈노넷", "특이사항"}
	widths := []float64{10, 30, 12, 7, 7, 22, 46, 20, 38, 17, 11, 11, 11, 18, 24, 50}

	title := req.Title
	if title == "" {
		title = "계약 추진현황"
	}
	f.SetCellValue(sh, "A1", title)
	f.SetCellValue(sh, "A2", "출력일 "+time.Now().Format("2006-01-02 15:04")+fmt.Sprintf(" · %d건", len(req.Rows)))
	tStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 14, Family: "맑은 고딕"}})
	sStyle, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Size: 9, Color: "666666", Family: "맑은 고딕"}})
	f.SetCellStyle(sh, "A1", "A1", tStyle)
	f.SetCellStyle(sh, "A2", "A2", sStyle)

	border := []excelize.Border{
		{Type: "left", Color: "D5D9E0", Style: 1}, {Type: "right", Color: "D5D9E0", Style: 1},
		{Type: "top", Color: "D5D9E0", Style: 1}, {Type: "bottom", Color: "D5D9E0", Style: 1},
	}
	hStyle, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "FFFFFF", Family: "맑은 고딕", Size: 10},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"2F5BEA"}, Pattern: 1},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true},
		Border:    border,
	})
	base := excelize.Style{Font: &excelize.Font{Family: "맑은 고딕", Size: 10}, Alignment: &excelize.Alignment{Vertical: "top", WrapText: true}, Border: border}
	txt, _ := f.NewStyle(&base)
	numSt := base
	fmtStr := "#,##0"
	numSt.CustomNumFmt = &fmtStr
	num, _ := f.NewStyle(&numSt)
	childSt := base
	childSt.Font = &excelize.Font{Family: "맑은 고딕", Size: 10, Color: "4B5260"}
	childSt.Fill = excelize.Fill{Type: "pattern", Color: []string{"F7F8FA"}, Pattern: 1}
	child, _ := f.NewStyle(&childSt)
	childNumSt := childSt
	childNumSt.CustomNumFmt = &fmtStr
	childNum, _ := f.NewStyle(&childNumSt)

	const hr = 4
	for i, h := range head {
		col, _ := excelize.ColumnNumberToName(i + 1)
		f.SetCellValue(sh, fmt.Sprintf("%s%d", col, hr), h)
		f.SetColWidth(sh, col, col, widths[i])
	}
	last, _ := excelize.ColumnNumberToName(len(head))
	f.SetCellStyle(sh, fmt.Sprintf("A%d", hr), fmt.Sprintf("%s%d", last, hr), hStyle)
	f.SetRowHeight(sh, hr, 24)

	for i, r := range req.Rows {
		row := hr + 1 + i
		title := r.Title
		if r.Level > 0 {
			title = "  └ " + title
		}
		vals := []any{r.School, title, r.Category, r.Phase, r.Status, r.Parent, r.Name, r.No, r.Contractor, r.Amount, r.ContractDt, r.StartDate, r.EndDate, r.Contact, r.Bizno, r.Note}
		for j, v := range vals {
			col, _ := excelize.ColumnNumberToName(j + 1)
			cell := fmt.Sprintf("%s%d", col, row)
			if j == 9 && r.Amount == 0 {
				f.SetCellValue(sh, cell, "")
				continue
			}
			f.SetCellValue(sh, cell, v)
		}
		st, nst := txt, num
		if r.Level > 0 {
			st, nst = child, childNum
		}
		f.SetCellStyle(sh, fmt.Sprintf("A%d", row), fmt.Sprintf("%s%d", last, row), st)
		f.SetCellStyle(sh, fmt.Sprintf("J%d", row), fmt.Sprintf("J%d", row), nst)
	}
	f.SetPanes(sh, &excelize.Panes{Freeze: true, XSplit: 2, YSplit: hr, TopLeftCell: fmt.Sprintf("C%d", hr+1), ActivePane: "bottomRight"})
	f.AutoFilter(sh, fmt.Sprintf("A%d:%s%d", hr, last, hr+len(req.Rows)), nil)

	dir := filepath.Join(dataDir, exportDir)
	os.MkdirAll(dir, 0o755)
	safe := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_").Replace(title)
	path := filepath.Join(dir, fmt.Sprintf("%s_%s.xlsx", safe, time.Now().Format("20060102_150405")))
	return path, f.SaveAs(path)
}
