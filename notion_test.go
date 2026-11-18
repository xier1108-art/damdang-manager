package main

import "testing"

func TestSyncLooksBroken(t *testing.T) {
	cases := []struct {
		known, missing, remote int
		want                   bool
	}{
		{106, 106, 0, true},  // 노션에서 0건 — 권한 문제
		{106, 60, 46, true},  // 절반 넘게 빠짐
		{106, 2, 104, false}, // 노션에서 실제로 몇 건 지움
		{4, 4, 10, false},    // 적은 수는 정상 삭제로 본다
		{0, 0, 0, false},     // 처음 받아오기
	}
	for _, c := range cases {
		if got := syncLooksBroken(c.known, c.missing, c.remote); got != c.want {
			t.Errorf("syncLooksBroken(%d,%d,%d) = %v, want %v", c.known, c.missing, c.remote, got, c.want)
		}
	}
}

func TestBlockedPage(t *testing.T) {
	if blockedPage([]byte(`<!DOCTYPE html><html><body><iframe src="https://x/warning.html"></iframe>`)) == nil {
		t.Error("차단 안내 HTML을 놓침")
	}
	if blockedPage([]byte(` {"object":"list","results":[]}`)) != nil {
		t.Error("정상 JSON을 차단으로 봄")
	}
}
