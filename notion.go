package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const notionVersion = "2022-06-28"

// 대장 필드 ↔ 노션 속성
type fieldDef struct{ key, prop, kind string }

var fields = []fieldDef{
	{"title", "요약명", "title"},
	{"school", "학교", "select"},
	{"category", "항목", "select"},
	{"phase", "차수", "select"},
	{"status", "상태", "select"},
	{"name", "계약명", "text"},
	{"no", "계약번호", "text"},
	{"contractor", "계약자", "text"},
	{"amount", "계약금액(원)", "number"},
	{"contractDate", "계약일", "date"},
	{"startDate", "착수일", "date"},
	{"endDate", "완수일", "date"},
	{"contact", "연락처·담당", "text"},
	{"bizno", "비즈노넷", "bizno"},
	{"note", "특이사항", "text"},
	{"parentId", "상위계약", "relation"},
}

type notionClient struct {
	token string
	hc    *http.Client
	last  time.Time
}

func (n *notionClient) do(method, path string, body any) (map[string]any, error) {
	if d := time.Since(n.last); d < 350*time.Millisecond { // 초당 3회 제한
		time.Sleep(350*time.Millisecond - d)
	}
	for attempt := 0; attempt < 4; attempt++ {
		var rd io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rd = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(method, notionBase()+"/v1"+path, rd)
		req.Header.Set("Authorization", "Bearer "+n.token)
		req.Header.Set("Notion-Version", notionVersion)
		req.Header.Set("Content-Type", "application/json")
		resp, err := n.hc.Do(req)
		n.last = time.Now()
		if err != nil {
			return nil, fmt.Errorf("노션에 연결하지 못했습니다(내부망 차단 여부 확인): %v", err)
		}
		rb, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			time.Sleep(time.Duration(1+attempt) * time.Second)
			continue
		}
		var m map[string]any
		json.Unmarshal(rb, &m)
		if resp.StatusCode != 200 {
			msg, _ := m["message"].(string)
			switch resp.StatusCode {
			case 401:
				return nil, errors.New("노션 토큰이 올바르지 않습니다")
			case 404:
				return nil, errors.New("데이터베이스를 찾지 못했습니다. 노션에서 해당 DB의 ⋯ › 연결(Connections)에 통합을 추가했는지 확인해 주세요")
			}
			return nil, fmt.Errorf("노션 오류(%d): %s", resp.StatusCode, msg)
		}
		return m, nil
	}
	return nil, errors.New("노션 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요")
}

func cleanID(id string) string { return strings.ReplaceAll(id, "-", "") }

// ---------- 노션 페이지 → 값 ----------

func plain(arr any) string {
	var sb strings.Builder
	if a, ok := arr.([]any); ok {
		for _, x := range a {
			if m, ok := x.(map[string]any); ok {
				s, _ := m["plain_text"].(string)
				sb.WriteString(s)
			}
		}
	}
	return sb.String()
}

func pageValues(pg map[string]any) map[string]string {
	props, _ := pg["properties"].(map[string]any)
	v := map[string]string{}
	for _, f := range fields {
		p, _ := props[f.prop].(map[string]any)
		if p == nil {
			continue
		}
		switch f.kind {
		case "title":
			v[f.key] = plain(p["title"])
		case "text", "bizno":
			v[f.key] = plain(p["rich_text"])
		case "select":
			if s, ok := p["select"].(map[string]any); ok {
				v[f.key], _ = s["name"].(string)
			}
		case "number":
			if n, ok := p["number"].(float64); ok {
				v[f.key] = strconv.FormatInt(int64(n), 10)
			} else {
				v[f.key] = "0"
			}
		case "date":
			if d, ok := p["date"].(map[string]any); ok {
				s, _ := d["start"].(string)
				if len(s) > 10 {
					s = s[:10]
				}
				v[f.key] = s
			}
		case "relation":
			if a, ok := p["relation"].([]any); ok && len(a) > 0 {
				m, _ := a[0].(map[string]any)
				id, _ := m["id"].(string)
				v[f.key] = cleanID(id)
			}
		}
		if _, ok := v[f.key]; !ok {
			v[f.key] = ""
		}
	}
	if v["amount"] == "" {
		v["amount"] = "0"
	}
	return v
}

// ---------- 값 → 노션 속성 ----------

var bizRe = regexp.MustCompile(`\d{3}-\d{2}-\d{5}`)

func richText(s string) []any {
	out := []any{}
	r := []rune(s)
	for len(r) > 0 {
		n := len(r)
		if n > 1900 {
			n = 1900
		}
		out = append(out, map[string]any{"type": "text", "text": map[string]any{"content": string(r[:n])}})
		r = r[n:]
	}
	return out
}

// 비즈노넷: 줄마다 계약자 사업자번호로 bizno.net 링크
func biznoText(bizno, contractor string) []any {
	cl := strings.Split(contractor, "\n")
	out := []any{}
	lines := strings.Split(bizno, "\n")
	for i, line := range lines {
		if i > 0 {
			out = append(out, map[string]any{"type": "text", "text": map[string]any{"content": "\n"}})
		}
		if line == "" {
			continue
		}
		t := map[string]any{"content": line}
		if i < len(cl) {
			if num := bizRe.FindString(cl[i]); num != "" {
				t["link"] = map[string]any{"url": "https://bizno.net/article/" + strings.ReplaceAll(num, "-", "")}
			}
		}
		out = append(out, map[string]any{"type": "text", "text": t})
	}
	return out
}

func propValue(f fieldDef, v map[string]string) any {
	val := v[f.key]
	switch f.kind {
	case "title":
		return map[string]any{"title": richText(val)}
	case "text":
		return map[string]any{"rich_text": richText(val)}
	case "bizno":
		return map[string]any{"rich_text": biznoText(val, v["contractor"])}
	case "select":
		if val == "" {
			return map[string]any{"select": nil}
		}
		return map[string]any{"select": map[string]any{"name": strings.ReplaceAll(val, ",", " ")}}
	case "number":
		n, _ := strconv.ParseInt(val, 10, 64)
		if n == 0 {
			return map[string]any{"number": nil}
		}
		return map[string]any{"number": n}
	case "date":
		if val == "" {
			return map[string]any{"date": nil}
		}
		return map[string]any{"date": map[string]any{"start": val}}
	case "relation":
		if val == "" {
			return map[string]any{"relation": []any{}}
		}
		return map[string]any{"relation": []any{map[string]any{"id": val}}}
	}
	return nil
}

// ---------- 대장 항목 ----------

func itemValues(it map[string]any) map[string]string {
	v := map[string]string{}
	for _, f := range fields {
		switch x := it[f.key].(type) {
		case string:
			v[f.key] = x
		case float64:
			v[f.key] = strconv.FormatInt(int64(x), 10)
		case nil:
			v[f.key] = ""
		default:
			v[f.key] = fmt.Sprint(x)
		}
	}
	if v["amount"] == "" {
		v["amount"] = "0"
	}
	return v
}

func applyValues(it map[string]any, v map[string]string) {
	for _, f := range fields {
		val := v[f.key]
		switch f.key {
		case "amount":
			n, _ := strconv.ParseInt(val, 10, 64)
			it[f.key] = n
		case "parentId":
			if val == "" {
				it[f.key] = nil
			} else {
				it[f.key] = val
			}
		default:
			it[f.key] = val
		}
	}
}

func snapOf(v map[string]string) map[string]any {
	m := map[string]any{}
	for k, x := range v {
		m[k] = x
	}
	return m
}

func snapValues(it map[string]any) map[string]string {
	s, ok := it["_snap"].(map[string]any)
	if !ok {
		return nil
	}
	v := map[string]string{}
	for k, x := range s {
		v[k], _ = x.(string)
	}
	return v
}

func ts(s string) time.Time { t, _ := time.Parse(time.RFC3339, s); return t }

// ---------- 동기화 ----------

type syncReport struct {
	Pulled, Pushed, Created, Archived, RemovedLocal, AddedLocal int
	Conflicts                                                   []string
	Errors                                                      []string
}

func runSync() (map[string]any, *syncReport, error) {
	s := loadSettings()
	if s.NotionToken == "" {
		return nil, nil, errors.New("노션 토큰이 없습니다. 설정에서 먼저 넣어 주세요")
	}
	nc := &notionClient{token: s.NotionToken, hc: httpClient(30 * time.Second)}

	// 1) 노션 전체 조회
	remote := map[string]map[string]any{}
	cursor := ""
	for {
		body := map[string]any{"page_size": 100}
		if cursor != "" {
			body["start_cursor"] = cursor
		}
		m, err := nc.do("POST", "/databases/"+s.NotionDB+"/query", body)
		if err != nil {
			return nil, nil, err
		}
		res, _ := m["results"].([]any)
		for _, r := range res {
			pg, _ := r.(map[string]any)
			id, _ := pg["id"].(string)
			remote[cleanID(id)] = pg
		}
		if more, _ := m["has_more"].(bool); !more {
			break
		}
		cursor, _ = m["next_cursor"].(string)
	}

	// 2) 로컬 데이터
	mu.Lock()
	defer mu.Unlock()
	raw, err := os.ReadFile(dataPath())
	if err != nil {
		return nil, nil, err
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, nil, err
	}
	makeBackup("동기화전")
	itemsAny, _ := doc["items"].([]any)
	var items []map[string]any
	for _, x := range itemsAny {
		if m, ok := x.(map[string]any); ok {
			items = append(items, m)
		}
	}
	deleted := map[string]bool{}
	if d, ok := doc["deleted"].([]any); ok {
		for _, x := range d {
			if id, ok := x.(string); ok {
				deleted[id] = true
			}
		}
	}
	lastSync, _ := doc["lastSync"].(string)
	rep := &syncReport{}

	// 3) 로컬 삭제 → 노션 보관(휴지통)
	for id := range deleted {
		if _, ok := remote[id]; ok {
			if _, err := nc.do("PATCH", "/pages/"+id, map[string]any{"archived": true}); err != nil {
				rep.Errors = append(rep.Errors, "삭제 반영 실패: "+err.Error())
				continue
			}
			rep.Archived++
			delete(remote, id)
		}
	}

	local := map[string]bool{}
	var keep []map[string]any
	var creates []map[string]any
	for _, it := range items {
		id, _ := it["id"].(string)
		local[id] = true
		pg, inRemote := remote[id]
		if !inRemote {
			if strings.HasPrefix(id, "l") { // 아직 노션에 없는 새 계약
				creates = append(creates, it)
				keep = append(keep, it)
			} else { // 노션에서 삭제됨
				rep.RemovedLocal++
			}
			continue
		}
		rv := pageValues(pg)
		lv := itemValues(it)
		base := snapValues(it)
		redited, _ := pg["last_edited_time"].(string)
		lupd, _ := it["updatedAt"].(string)
		localNewer := lupd != "" && ts(lupd).After(ts(redited))
		final := map[string]string{}
		push := map[string]bool{}
		conflict := false
		for _, f := range fields {
			l, r := lv[f.key], rv[f.key]
			if l == r {
				final[f.key] = l
				continue
			}
			var b string
			hasBase := base != nil
			if hasBase {
				b = base[f.key]
			}
			switch {
			case hasBase && l == b:
				final[f.key] = r
			case hasBase && r == b:
				final[f.key] = l
				push[f.key] = true
			default: // 양쪽 모두 바뀜(또는 기준 없음) → 더 최근 쪽
				if hasBase {
					conflict = true
				}
				if localNewer {
					final[f.key] = l
					push[f.key] = true
				} else {
					final[f.key] = r
				}
			}
		}
		if conflict {
			rep.Conflicts = append(rep.Conflicts, lv["title"])
		}
		if len(push) > 0 {
			props := map[string]any{}
			for _, f := range fields {
				if push[f.key] || (f.key == "bizno" && push["contractor"] && final["bizno"] != "") {
					props[f.prop] = propValue(f, final)
				}
			}
			m, err := nc.do("PATCH", "/pages/"+id, map[string]any{"properties": props})
			if err != nil {
				rep.Errors = append(rep.Errors, lv["title"]+": "+err.Error())
			} else {
				rep.Pushed++
				redited, _ = m["last_edited_time"].(string)
			}
		}
		changedLocal := false
		for k, v := range final {
			if lv[k] != v {
				changedLocal = true
			}
		}
		if changedLocal {
			rep.Pulled++
			applyValues(it, final)
		}
		it["_snap"] = snapOf(final)
		it["_nEdited"] = redited
		keep = append(keep, it)
	}

	// 4) 노션에만 있는 계약 → 로컬 추가
	for id, pg := range remote {
		if local[id] || deleted[id] {
			continue
		}
		v := pageValues(pg)
		it := map[string]any{"id": id}
		applyValues(it, v)
		it["_snap"] = snapOf(v)
		it["_nEdited"], _ = pg["last_edited_time"].(string)
		keep = append(keep, it)
		rep.AddedLocal++
	}

	// 5) 새 계약 → 노션 생성 (총괄을 먼저 만들어 차수 연결)
	idMap := map[string]string{}
	sort.SliceStable(creates, func(i, j int) bool {
		pi, _ := creates[i]["parentId"].(string)
		pj, _ := creates[j]["parentId"].(string)
		return (pi == "" || !strings.HasPrefix(pi, "l")) && strings.HasPrefix(pj, "l")
	})
	for _, it := range creates {
		v := itemValues(it)
		if p, ok := idMap[v["parentId"]]; ok {
			v["parentId"] = p
		}
		if strings.HasPrefix(v["parentId"], "l") {
			v["parentId"] = "" // 부모 생성 실패 시 연결 생략
		}
		props := map[string]any{}
		for _, f := range fields {
			if f.kind == "relation" && v[f.key] == "" {
				continue
			}
			props[f.prop] = propValue(f, v)
		}
		m, err := nc.do("POST", "/pages", map[string]any{"parent": map[string]any{"database_id": s.NotionDB}, "properties": props})
		if err != nil {
			rep.Errors = append(rep.Errors, v["title"]+": "+err.Error())
			continue
		}
		nid, _ := m["id"].(string)
		nid = cleanID(nid)
		oldID, _ := it["id"].(string)
		idMap[oldID] = nid
		it["id"] = nid
		it["parentId"] = nilIfEmpty(v["parentId"])
		it["_snap"] = snapOf(v)
		it["_nEdited"], _ = m["last_edited_time"].(string)
		rep.Created++
	}
	// 로컬 차수의 상위계약 id도 새 id로 교체
	for _, it := range keep {
		if p, ok := it["parentId"].(string); ok {
			if n, ok := idMap[p]; ok {
				it["parentId"] = n
			}
		}
	}

	// 6) 노션의 새 학교·항목 선택지를 목록에 추가
	if opts, ok := doc["options"].(map[string]any); ok {
		addOpt := func(key, field string) {
			list, _ := opts[key].([]any)
			have := map[string]bool{}
			for _, x := range list {
				if s, ok := x.(string); ok {
					have[s] = true
				}
			}
			for _, it := range keep {
				if s, ok := it[field].(string); ok && s != "" && !have[s] {
					list = append(list, s)
					have[s] = true
				}
			}
			opts[key] = list
		}
		addOpt("schools", "school")
		addOpt("categories", "category")
		addOpt("phases", "phase")
	}

	out := make([]any, len(keep))
	for i, it := range keep {
		out[i] = it
	}
	doc["items"] = out
	doc["deleted"] = []any{}
	now := time.Now().Format(time.RFC3339)
	doc["lastSync"] = now
	_ = lastSync
	b, _ := json.MarshalIndent(doc, "", " ")
	tmp := dataPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return nil, nil, err
	}
	os.Rename(tmp, dataPath())
	s2 := loadSettings()
	s2.LastSync = now
	saveSettings(s2)
	return doc, rep, nil
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

var syncBusy = make(chan struct{}, 1)

func handleNotionSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	select {
	case syncBusy <- struct{}{}:
		defer func() { <-syncBusy }()
	default:
		http.Error(w, "이미 동기화 중입니다", 409)
		return
	}
	doc, rep, err := runSync()
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]any{"data": doc, "report": rep})
}

func handleNotionTest(w http.ResponseWriter, r *http.Request) {
	s := loadSettings()
	if s.NotionToken == "" {
		http.Error(w, "노션 토큰이 없습니다", 400)
		return
	}
	nc := &notionClient{token: s.NotionToken, hc: httpClient(15 * time.Second)}
	m, err := nc.do("GET", "/databases/"+s.NotionDB, nil)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	title := plain(m["title"])
	writeJSON(w, map[string]any{"ok": true, "title": title})
}
