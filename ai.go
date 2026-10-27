package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type aiContext struct {
	Mode       string           `json:"mode"` // "new" | "update"
	Today      string           `json:"today"`
	Schools    []string         `json:"schools"`
	Categories []string         `json:"categories"`
	Phases     []string         `json:"phases"`
	Parents    []map[string]any `json:"parents"`
	Examples   []map[string]any `json:"examples"`
	Current    map[string]any   `json:"current"`
}

const maxDocBytes = 30 << 20

func handleAIExtract(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	s := loadSettings()
	if s.AnthropicKey == "" {
		http.Error(w, "Claude API 키가 없습니다. 설정에서 키를 먼저 넣어 주세요.", 400)
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		http.Error(w, "파일을 받지 못했습니다: "+err.Error(), 400)
		return
	}
	var ctx aiContext
	json.Unmarshal([]byte(r.FormValue("context")), &ctx)

	var blocks []map[string]any
	var notes []string
	total := 0
	for _, fh := range r.MultipartForm.File["files"] {
		f, err := fh.Open()
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(f)
		f.Close()
		total += len(b)
		if total > maxDocBytes {
			http.Error(w, "파일이 너무 큽니다(합계 30MB 이하로 넣어 주세요).", 400)
			return
		}
		name := fh.Filename
		ext := strings.ToLower(filepath.Ext(name))
		label := map[string]any{"type": "text", "text": fmt.Sprintf("[첨부 파일: %s]", name)}
		switch ext {
		case ".pdf":
			blocks = append(blocks, label, map[string]any{"type": "document", "source": map[string]any{
				"type": "base64", "media_type": "application/pdf", "data": base64.StdEncoding.EncodeToString(b)}})
		case ".png", ".jpg", ".jpeg", ".gif", ".webp":
			if len(b) > 5<<20 {
				notes = append(notes, name+": 이미지가 5MB를 넘어 제외했습니다")
				continue
			}
			mt := map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}[ext]
			blocks = append(blocks, label, map[string]any{"type": "image", "source": map[string]any{
				"type": "base64", "media_type": mt, "data": base64.StdEncoding.EncodeToString(b)}})
		case ".hwp", ".hwpx", ".docx", ".txt", ".csv":
			var txt string
			var err error
			switch ext {
			case ".hwp":
				txt, err = extractHWP(b)
			case ".hwpx":
				txt, err = extractZipXML(b, "hwpx")
			case ".docx":
				txt, err = extractZipXML(b, "docx")
			default:
				txt = string(b)
			}
			if err != nil {
				notes = append(notes, name+": "+err.Error())
				continue
			}
			if len(txt) > 120000 {
				txt = txt[:120000]
			}
			blocks = append(blocks, map[string]any{"type": "text", "text": fmt.Sprintf("[첨부 파일: %s — 본문 텍스트]\n%s", name, txt)})
		default:
			notes = append(notes, name+": 지원하지 않는 형식(PDF·이미지·HWP·HWPX·DOCX·TXT 가능)")
		}
	}
	if pasted := strings.TrimSpace(r.FormValue("pasted")); pasted != "" {
		blocks = append(blocks, map[string]any{"type": "text", "text": "[붙여넣은 내용]\n" + pasted})
	}
	if len(blocks) == 0 {
		msg := "읽을 수 있는 문서가 없습니다."
		if len(notes) > 0 {
			msg += " " + strings.Join(notes, " / ")
		}
		http.Error(w, msg, 400)
		return
	}
	blocks = append(blocks, map[string]any{"type": "text", "text": instruction(ctx)})

	// 일부 최신 모델은 도구 강제 호출(tool_choice: tool)을 받지 않으므로 auto로 요청하고,
	// 도구를 호출하지 않은 경우 본문 JSON에서 값을 꺼낸다.
	req := map[string]any{
		"model":       s.Model,
		"max_tokens":  16000,
		"system":      systemPrompt(ctx) + "\n\n반드시 fill_contract 도구를 한 번 호출해 결과를 반환합니다. 도구 호출 외의 설명은 쓰지 않습니다.",
		"tools":       []any{contractTool(ctx)},
		"tool_choice": map[string]any{"type": "auto"},
		"messages":    []any{map[string]any{"role": "user", "content": blocks}},
	}
	rb, code, err := callAnthropic(s.AnthropicKey, req)
	if err != nil {
		http.Error(w, "Claude API에 연결하지 못했습니다(내부망 차단 여부를 설정 › 연결 테스트로 확인해 주세요): "+err.Error(), 502)
		return
	}
	if code == 400 && strings.Contains(string(rb), "tool_choice") { // 그래도 거부하면 tool_choice 없이 재시도
		delete(req, "tool_choice")
		rb, code, err = callAnthropic(s.AnthropicKey, req)
		if err != nil {
			http.Error(w, "Claude API에 연결하지 못했습니다: "+err.Error(), 502)
			return
		}
	}
	if code != 200 {
		http.Error(w, apiErr(code, rb), 502)
		return
	}
	var out struct {
		Content []struct {
			Type  string          `json:"type"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
			Text  string          `json:"text"`
		} `json:"content"`
		StopReason string         `json:"stop_reason"`
		Usage      map[string]any `json:"usage"`
	}
	json.Unmarshal(rb, &out)
	for _, c := range out.Content {
		if c.Type == "tool_use" && c.Name == "fill_contract" {
			writeJSON(w, map[string]any{"fields": c.Input, "notes": notes, "usage": out.Usage})
			return
		}
	}
	for _, c := range out.Content { // 도구 대신 글로 답한 경우 JSON 부분만 추출
		if c.Type == "text" {
			if i, j := strings.Index(c.Text, "{"), strings.LastIndex(c.Text, "}"); i >= 0 && j > i && json.Valid([]byte(c.Text[i:j+1])) {
				writeJSON(w, map[string]any{"fields": json.RawMessage(c.Text[i : j+1]), "notes": notes, "usage": out.Usage})
				return
			}
		}
	}
	if out.StopReason == "max_tokens" {
		http.Error(w, "Claude 응답이 길어 중간에 끊겼습니다. 필요한 페이지만 넣어 다시 시도해 주세요.", 502)
		return
	}
	http.Error(w, "Claude 응답에서 입력값을 찾지 못했습니다. 다시 시도해 주세요.", 502)
}

func apiErr(code int, b []byte) string {
	var e struct {
		Error struct{ Type, Message string } `json:"error"`
	}
	json.Unmarshal(b, &e)
	switch code {
	case 401:
		return "API 키가 올바르지 않습니다. 설정에서 키를 확인해 주세요."
	case 403:
		return "이 API 키로는 요청 권한이 없습니다: " + e.Error.Message
	case 404:
		return "모델 이름을 찾을 수 없습니다(설정의 모델명 확인): " + e.Error.Message
	case 413:
		return "문서가 너무 큽니다. 필요한 페이지만 넣어 주세요."
	case 429:
		return "요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요."
	case 529, 503:
		return "Claude 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요."
	}
	if e.Error.Message != "" {
		return fmt.Sprintf("Claude API 오류(%d): %s", code, e.Error.Message)
	}
	return fmt.Sprintf("Claude API 오류(%d)", code)
}

func systemPrompt(ctx aiContext) string {
	ex, _ := json.MarshalIndent(ctx.Examples, "", " ")
	return `당신은 서울특별시서부교육지원청 학교시설지원과 담당자의 계약 대장 입력을 돕습니다.
첨부된 계약서·계약 관련 문서(나라장터 계약정보, 착공계, 변경계약서, 납품요구서 등)를 읽고 계약 대장 한 건의 입력값을 fill_contract 도구로 반환합니다.

원칙
- 문서에 있는 내용만 옮깁니다. 추측으로 채우지 말고, 문서에 없으면 빈 문자열(금액은 0)로 둡니다.
- 확실하지 않거나 문서끼리 다른 값은 review에 짧게 적습니다.
- 날짜는 YYYY-MM-DD, 금액은 원 단위 정수(부가세 포함 총액)입니다.
- 계약자 표기: "업체명 대표 성명 (000-00-00000)". 공동도급은 줄마다 "(대표) …", "(공동) …" 형식.
- 장기계속계약: 총괄계약(총차)은 차수 "총괄", 각 차수 계약은 "1차"·"2차"… 이고 상위계약(parentId)에 맞는 총괄 계약 id를 고릅니다. 맞는 총괄이 없으면 빈 문자열.
- 관급자재 구매(납품요구)는 계약금액에 물품대금+수수료 합계를 넣고, 특이사항에 "물품 …원 / 수수료 …원 / 합계 …원"과 납품요구번호·단가계약번호를 적습니다.
- 착수일·완수일은 공사는 착공일·준공일, 용역은 착수일·완료일, 물품은 납품기한을 완수일로 봅니다.
- 특이사항에는 계약보증금(율), 공사·용역 기간(일수), 공동이행 지분율, 변경 사유처럼 대장에 남길 만한 핵심만 한두 줄로 씁니다.
- 요약명은 기존 대장 예시처럼 "학교약칭 + 짧은 내용" 형태(예: "갈현초 관급(철근)", "수색초 해체공사", "갈현초 공사(3차)")로 만듭니다.

기존 대장 입력 예시(형식 참고용)
` + string(ex)
}

func instruction(ctx aiContext) string {
	if ctx.Mode == "update" && ctx.Current != nil {
		cur, _ := json.MarshalIndent(ctx.Current, "", " ")
		return "아래는 대장에 이미 있는 계약입니다. 첨부 문서(변경계약서 등)를 반영한 최신 값으로 모든 칸을 다시 채워 주세요. 바뀌지 않은 칸은 기존 값을 그대로 둡니다. 변경 계약이면 특이사항 끝에 \"[변경 YYYY.MM.DD] 이전 → 이후 (증감) · 사유\" 한 줄을 덧붙입니다.\n오늘: " + ctx.Today + "\n기존 값:\n" + string(cur)
	}
	return "첨부 문서로 새 계약 한 건의 입력값을 채워 주세요. 오늘: " + ctx.Today
}

func contractTool(ctx aiContext) map[string]any {
	parents := []string{""}
	desc := "해당 없으면 빈 문자열. 후보:\n"
	for _, p := range ctx.Parents {
		id, _ := p["id"].(string)
		parents = append(parents, id)
		desc += fmt.Sprintf("- %s : %v (%v) %v\n", id, p["title"], p["school"], p["name"])
	}
	str := func(d string) map[string]any { return map[string]any{"type": "string", "description": d} }
	enum := func(v []string, d string) map[string]any {
		return map[string]any{"type": "string", "enum": v, "description": d}
	}
	schools := append([]string{}, ctx.Schools...)
	if !contains(schools, "*미지정") {
		schools = append(schools, "*미지정")
	}
	phases := append([]string{}, ctx.Phases...)
	for _, p := range []string{"단일", "총괄", "1차", "2차", "3차", "4차", "5차"} {
		if !contains(phases, p) {
			phases = append(phases, p)
		}
	}
	return map[string]any{
		"name":        "fill_contract",
		"description": "계약 대장 한 건의 입력값",
		"input_schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"title":        str("요약명"),
				"school":       enum(schools, "학교(목록에 없으면 *미지정)"),
				"category":     enum(ctx.Categories, "항목"),
				"phase":        enum(phases, "차수: 일반 계약은 단일"),
				"parentId":     map[string]any{"type": "string", "enum": parents, "description": desc},
				"status":       enum([]string{"진행", "중지", "완료"}, "상태(보통 진행)"),
				"name":         str("계약명(문서 표기 그대로)"),
				"no":           str("계약번호(예: R26TA02297318-00)"),
				"contractor":   str("계약자 표기"),
				"amount":       map[string]any{"type": "integer", "description": "계약금액(원)"},
				"contractDate": str("계약일 YYYY-MM-DD"),
				"startDate":    str("착수일 YYYY-MM-DD"),
				"endDate":      str("완수일 YYYY-MM-DD"),
				"contact":      str("업체 연락처(여러 개면 줄바꿈)"),
				"note":         str("특이사항"),
				"review":       map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "담당자가 확인할 점(불확실·누락·문서 간 불일치). 없으면 빈 배열"},
			},
			"required": []string{"title", "school", "category", "phase", "parentId", "status", "name", "no", "contractor", "amount", "contractDate", "startDate", "endDate", "contact", "note", "review"},
		},
	}
}

func contains(a []string, v string) bool {
	for _, x := range a {
		if x == v {
			return true
		}
	}
	return false
}

// 테스트용 주소 교체(환경변수) — 평소에는 공식 주소
func anthropicBase() string {
	if v := os.Getenv("DM_ANTHROPIC_BASE"); v != "" {
		return v
	}
	return "https://api.anthropic.com"
}

func notionBase() string {
	if v := os.Getenv("DM_NOTION_BASE"); v != "" {
		return v
	}
	return "https://api.notion.com"
}

func callAnthropic(key string, req map[string]any) ([]byte, int, error) {
	body, _ := json.Marshal(req)
	hreq, _ := http.NewRequest("POST", anthropicBase()+"/v1/messages", bytes.NewReader(body))
	hreq.Header.Set("x-api-key", key)
	hreq.Header.Set("anthropic-version", "2023-06-01")
	hreq.Header.Set("content-type", "application/json")
	resp, err := httpClient(300 * time.Second).Do(hreq)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	return rb, resp.StatusCode, nil
}
