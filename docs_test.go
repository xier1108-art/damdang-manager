package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeFileNameKeepsExtension(t *testing.T) {
	long := "(학교시설지원과-13273 (본문) 서울특별시서부교육지원청 재정지원과) [변경계약서](장기2차)갈현초 그린스마트 미래학교 및 복합화시설 증개축공사 건설사업관리용역.pdf"
	got := safeFileName(long)
	if !strings.HasSuffix(got, ".pdf") || len([]rune(got)) > 104 {
		t.Errorf("확장자를 지키며 줄여야 함: %q", got)
	}
	if safeFileName("a:b?.hwp") != "a_b_.hwp" {
		t.Errorf("못 쓰는 글자 바꾸기: %q", safeFileName("a:b?.hwp"))
	}
}

func TestWithinRejectsEscape(t *testing.T) {
	dir := filepath.Join("C:\\", "docs", "계약")
	if _, err := within(dir, "2026-11-20 변경/계약서.pdf"); err != nil {
		t.Error("하위 경로는 허용해야 함")
	}
	for _, bad := range []string{"../다른계약/x.pdf", "../../windows", "a/../../x"} {
		if _, err := within(dir, bad); err == nil {
			t.Errorf("폴더 밖 경로 허용됨: %s", bad)
		}
	}
}
