package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// 설정 파일(키는 Windows 계정 단위로 암호화해 저장)
type Settings struct {
	AnthropicKey string `json:"anthropicKey"`
	Model        string `json:"model"`
	NotionToken  string `json:"notionToken"`
	NotionDB     string `json:"notionDb"`
	AutoSync     bool   `json:"autoSync"`
	SyncMinutes  int    `json:"syncMinutes"`
	Proxy        string `json:"proxy"`
	LastSync     string `json:"lastSync"`
	GcalURL      string `json:"gcalUrl"`      // 구글 Apps Script 웹 앱 주소
	GcalSecret   string `json:"gcalSecret"`   // 스크립트와 맞추는 비밀 값
	GcalCalendar string `json:"gcalCalendar"` // 일정을 넣을 캘린더 ID
}

const (
	settingsName  = "담당사업관리_settings.json"
	defaultModel  = "claude-sonnet-5-5"
	defaultNotion = "7308d8d04b6c4d1397d1872892eedf7e"
)

var setMu sync.Mutex

func settingsPath() string { return filepath.Join(dataDir, settingsName) }

func loadSettings() Settings {
	setMu.Lock()
	defer setMu.Unlock()
	s := Settings{Model: defaultModel, NotionDB: defaultNotion, SyncMinutes: 10}
	b, err := os.ReadFile(settingsPath())
	if err == nil {
		json.Unmarshal(b, &s)
	}
	s.AnthropicKey = unseal(s.AnthropicKey)
	s.NotionToken = unseal(s.NotionToken)
	s.GcalURL = unseal(s.GcalURL)
	s.GcalSecret = unseal(s.GcalSecret)
	if s.Model == "" {
		s.Model = defaultModel
	}
	if s.NotionDB == "" {
		s.NotionDB = defaultNotion
	}
	if s.SyncMinutes <= 0 {
		s.SyncMinutes = 10
	}
	return s
}

func saveSettings(s Settings) error {
	setMu.Lock()
	defer setMu.Unlock()
	s.AnthropicKey = seal(s.AnthropicKey)
	s.NotionToken = seal(s.NotionToken)
	s.GcalURL = seal(s.GcalURL)
	s.GcalSecret = seal(s.GcalSecret)
	b, _ := json.MarshalIndent(s, "", " ")
	return os.WriteFile(settingsPath(), b, 0o600)
}

func seal(v string) string {
	if v == "" {
		return ""
	}
	if enc, err := protect([]byte(v)); err == nil {
		return "dpapi:" + base64.StdEncoding.EncodeToString(enc)
	}
	return "plain:" + v
}

func unseal(v string) string {
	switch {
	case strings.HasPrefix(v, "dpapi:"):
		raw, err := base64.StdEncoding.DecodeString(v[6:])
		if err != nil {
			return ""
		}
		out, err := unprotect(raw)
		if err != nil {
			return ""
		}
		return string(out)
	case strings.HasPrefix(v, "plain:"):
		return v[6:]
	}
	return v
}

func mask(v string) string {
	if v == "" {
		return ""
	}
	if len(v) <= 10 {
		return "••••"
	}
	return v[:6] + "••••" + v[len(v)-4:]
}

func maskURL(v string) string {
	if v == "" {
		return ""
	}
	if len(v) <= 40 {
		return "••••"
	}
	return v[:34] + "••••" + v[len(v)-10:]
}

// 화면에 보낼 때는 키를 가린 값만
func handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s := loadSettings()
		writeJSON(w, map[string]any{
			"anthropicKeyMasked": mask(s.AnthropicKey), "hasAnthropicKey": s.AnthropicKey != "",
			"model": s.Model, "notionTokenMasked": mask(s.NotionToken), "hasNotionToken": s.NotionToken != "",
			"notionDb": s.NotionDB, "autoSync": s.AutoSync, "syncMinutes": s.SyncMinutes, "proxy": s.Proxy, "lastSync": s.LastSync,
			"hasGcal": s.GcalURL != "", "gcalUrlMasked": maskURL(s.GcalURL), "gcalCalendar": s.GcalCalendar,
		})
	case http.MethodPost:
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		var in map[string]any
		if err := json.Unmarshal(body, &in); err != nil {
			http.Error(w, "잘못된 요청", 400)
			return
		}
		s := loadSettings()
		str := func(k string) (string, bool) { v, ok := in[k].(string); return strings.TrimSpace(v), ok }
		if v, ok := str("anthropicKey"); ok {
			s.AnthropicKey = v // 빈 문자열이면 삭제
		}
		if v, ok := str("notionToken"); ok {
			s.NotionToken = v
		}
		if v, ok := str("model"); ok && v != "" {
			s.Model = v
		}
		if v, ok := str("notionDb"); ok {
			s.NotionDB = normalizeNotionID(v)
		}
		if v, ok := str("proxy"); ok {
			s.Proxy = v
		}
		if v, ok := str("gcalUrl"); ok {
			s.GcalURL = v
		}
		if v, ok := str("gcalCalendar"); ok {
			s.GcalCalendar = v
		}
		if v, ok := in["autoSync"].(bool); ok {
			s.AutoSync = v
		}
		if v, ok := in["syncMinutes"].(float64); ok && v >= 1 {
			s.SyncMinutes = int(v)
		}
		if err := saveSettings(s); err != nil {
			http.Error(w, "설정 저장 실패: "+err.Error(), 500)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	default:
		http.Error(w, "method", 405)
	}
}

// 노션 주소·ID 어느 형태로 넣어도 32자리 ID만 추출
func normalizeNotionID(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return defaultNotion
	}
	if i := strings.Index(v, "?"); i >= 0 {
		v = v[:i]
	}
	clean := strings.ReplaceAll(v, "-", "")
	hex := ""
	for i := len(clean) - 1; i >= 0 && len(hex) < 32; i-- {
		c := clean[i]
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') {
			hex = string(c) + hex
		} else if len(hex) > 0 {
			break
		}
	}
	if len(hex) == 32 {
		return strings.ToLower(hex)
	}
	return v
}

// 외부 연결용 HTTP 클라이언트(프록시 설정 반영)
func httpClient(timeout time.Duration) *http.Client {
	s := loadSettings()
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if s.Proxy != "" {
		p := s.Proxy
		if !strings.Contains(p, "://") {
			p = "http://" + p
		}
		if u, err := url.Parse(p); err == nil {
			tr.Proxy = http.ProxyURL(u)
		}
	}
	return &http.Client{Timeout: timeout, Transport: tr}
}

// 내부망에서 두 서비스에 닿는지 확인
func handleNetTest(w http.ResponseWriter, r *http.Request) {
	c := httpClient(8 * time.Second)
	probe := func(u string) map[string]any {
		t := time.Now()
		resp, err := c.Get(u)
		if err != nil {
			msg := err.Error()
			if strings.Contains(msg, "no such host") {
				msg = "주소를 찾지 못함(DNS 차단 가능성)"
			} else if strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline") {
				msg = "응답 없음(방화벽 차단 가능성)"
			} else if strings.Contains(msg, "refused") || strings.Contains(msg, "reset") {
				msg = "연결 거부(차단 가능성)"
			} else if strings.Contains(msg, "certificate") {
				msg = "보안 인증서 오류(보안 장비 개입 가능성)"
			}
			return map[string]any{"ok": false, "msg": msg}
		}
		resp.Body.Close()
		return map[string]any{"ok": true, "msg": "연결됨", "ms": time.Since(t).Milliseconds(), "code": resp.StatusCode}
	}
	res := map[string]any{
		"anthropic": probe("https://api.anthropic.com/v1/models"),
		"notion":    probe("https://api.notion.com/v1/users/me"),
	}
	if s := loadSettings(); s.GcalURL != "" {
		if out, err := callGcal(s, "ping", nil); err != nil {
			res["gcal"] = map[string]any{"ok": false, "msg": err.Error()}
		} else {
			res["gcal"] = map[string]any{"ok": true, "msg": "연결됨", "name": out["name"]}
		}
	}
	writeJSON(w, res)
}
