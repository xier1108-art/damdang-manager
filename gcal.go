package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // 시간대 데이터를 실행 파일에 넣는다(Go가 없는 PC 대비)
)

// 구글 캘린더 연동 — 일반 캘린더 앱처럼 'Google 계정으로 로그인'(OAuth, PKCE)
// 로그인 창은 기본 브라우저로 열고, 돌아오는 코드를 잠깐 여는 로컬 주소에서 받는다.
// 코드 → 토큰 교환은 클라이언트 보안 비밀이 있으면 구글과 직접, 없으면 할일정리 앱과 같은 중계 서버를 거친다.
// (기관망처럼 중계 서버가 막힌 곳에서는 설정에 보안 비밀을 한 번 넣어 두면 된다)

const (
	googleClientID = "643329263654-mmjq4v1vcd5gtaj8s5r7ib9qhrmo9317.apps.googleusercontent.com" // 공개 정보
	googleRelay    = "https://todo-manager-gcal-relay.vercel.app"
	googleScope    = "https://www.googleapis.com/auth/calendar"
	calTZ          = "Asia/Seoul"
)

// 테스트용 환경변수로 주소를 바꿀 수 있다(평소에는 쓰지 않음)
func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

var (
	googleAuth  = envOr("DM_GOOGLE_AUTH", "https://accounts.google.com/o/oauth2/v2/auth")
	googleToken = envOr("DM_GOOGLE_TOKEN", "https://oauth2.googleapis.com/token")
	calAPI      = envOr("DM_CALENDAR_API", "https://www.googleapis.com/calendar/v3")
)

// 빌드할 때 -ldflags "-X main.buildClientSecret=…"로 넣을 수 있다(저장소에는 두지 않음)
var buildClientSecret string

var (
	tokMu     sync.Mutex
	accessTok string
	accessExp time.Time
	loginMu   sync.Mutex
)

// 한국 시간대 — 데이터가 없어도 +9시간으로
func kst() *time.Location {
	if l, err := time.LoadLocation(calTZ); err == nil {
		return l
	}
	return time.FixedZone("KST", 9*3600)
}

func clientSecret(s Settings) string {
	if s.GoogleSecret != "" {
		return s.GoogleSecret
	}
	return buildClientSecret
}

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func randToken(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return b64url(b)
}

// 코드·리프레시 토큰을 구글 토큰으로 바꾼다 (직접 또는 중계 서버)
func tokenRequest(s Settings, form url.Values, relayPath string, relayBody map[string]string) (map[string]any, error) {
	c := httpClient(20 * time.Second)
	var resp *http.Response
	var err error
	if sec := clientSecret(s); sec != "" {
		form.Set("client_id", googleClientID)
		form.Set("client_secret", sec)
		resp, err = c.PostForm(googleToken, form)
	} else {
		b, _ := json.Marshal(relayBody)
		resp, err = c.Post(googleRelay+relayPath, "application/json", bytes.NewReader(b))
		if err != nil {
			return nil, fmt.Errorf("중계 서버에 연결하지 못했습니다(기관망에서는 막혀 있을 수 있음). 설정의 '클라이언트 보안 비밀'을 넣으면 직접 연결합니다: %v", err)
		}
	}
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out map[string]any
	if json.Unmarshal(raw, &out) != nil {
		return nil, fmt.Errorf("토큰 응답을 읽지 못했습니다(HTTP %d)", resp.StatusCode)
	}
	if e, _ := out["error"].(string); e != "" || resp.StatusCode >= 400 {
		d, _ := out["error_description"].(string)
		if e == "invalid_grant" {
			return nil, errors.New("구글 로그인이 만료되었습니다. 설정에서 다시 로그인해 주세요")
		}
		return nil, fmt.Errorf("구글 토큰 오류: %s %s", e, d)
	}
	return out, nil
}

func accessToken() (string, error) {
	tokMu.Lock()
	defer tokMu.Unlock()
	if accessTok != "" && time.Now().Before(accessExp) {
		return accessTok, nil
	}
	s := loadSettings()
	if s.GoogleRefresh == "" {
		return "", errors.New("구글 계정으로 로그인되어 있지 않습니다")
	}
	out, err := tokenRequest(s, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {s.GoogleRefresh}}, "/api/refresh", map[string]string{"refresh_token": s.GoogleRefresh})
	if err != nil {
		return "", err
	}
	accessTok, _ = out["access_token"].(string)
	sec, _ := out["expires_in"].(float64)
	accessExp = time.Now().Add(time.Duration(sec-60) * time.Second)
	return accessTok, nil
}

// 구글 캘린더 API 호출. body가 있으면 JSON으로 보낸다
func calCall(method, path string, q url.Values, body any) (map[string]any, int, error) {
	tok, err := accessToken()
	if err != nil {
		return nil, 0, err
	}
	u := calAPI + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, u, rd)
	req.Header.Set("Authorization", "Bearer "+tok)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := httpClient(30 * time.Second).Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	var out map[string]any
	json.Unmarshal(raw, &out)
	if resp.StatusCode >= 400 {
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if e, ok := out["error"].(map[string]any); ok {
			if m, _ := e["message"].(string); m != "" {
				msg = m
			}
		}
		return out, resp.StatusCode, fmt.Errorf("구글 캘린더: %s", msg)
	}
	return out, resp.StatusCode, nil
}

func calID(s Settings) string {
	if s.GcalCalendar != "" {
		return s.GcalCalendar
	}
	return "primary"
}

func calPath(id string) string { return "/calendars/" + url.PathEscape(id) }

// ---------- 로그인 ----------

// POST /api/google/login — 브라우저로 로그인 창을 열고, 끝날 때까지(최대 5분) 기다린다
func handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	if !loginMu.TryLock() {
		http.Error(w, "이미 로그인 창이 열려 있습니다. 브라우저를 확인해 주세요", 409)
		return
	}
	defer loginMu.Unlock()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		http.Error(w, "로그인을 받을 주소를 열지 못했습니다: "+err.Error(), 500)
		return
	}
	defer ln.Close()
	redirect := fmt.Sprintf("http://localhost:%d", ln.Addr().(*net.TCPAddr).Port)
	verifier, state := randToken(48), randToken(16)
	sum := sha256.Sum256([]byte(verifier))
	auth := googleAuth + "?" + url.Values{
		"client_id": {googleClientID}, "redirect_uri": {redirect}, "response_type": {"code"}, "scope": {googleScope},
		"code_challenge": {b64url(sum[:])}, "code_challenge_method": {"S256"}, "state": {state},
		"access_type": {"offline"}, "prompt": {"consent"},
	}.Encode()

	type result struct{ code, err string }
	got := make(chan result, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(cw http.ResponseWriter, cr *http.Request) {
		q := cr.URL.Query()
		if q.Get("state") != state && q.Get("error") == "" {
			http.NotFound(cw, cr)
			return
		}
		cw.Header().Set("Content-Type", "text/html; charset=utf-8")
		msg := "로그인되었습니다. 이 창을 닫고 담당사업관리로 돌아가세요."
		if q.Get("error") != "" {
			msg = "로그인하지 않았습니다 (" + q.Get("error") + "). 이 창을 닫아도 됩니다."
		}
		fmt.Fprintf(cw, `<!doctype html><meta charset="utf-8"><title>담당사업관리</title><body style="font-family:'Malgun Gothic',sans-serif;display:grid;place-items:center;height:90vh;color:#191C22"><p style="font-size:18px">%s</p></body>`, msg)
		select {
		case got <- result{q.Get("code"), q.Get("error")}:
		default:
		}
	})}
	go srv.Serve(ln)
	defer srv.Close()

	if os.Getenv("DM_GOOGLE_AUTH") != "" { // 테스트: 브라우저 대신 직접 따라간다
		go httpClient(10 * time.Second).Get(auth)
	} else {
		openInBrowser(auth)
	}
	var res result
	select {
	case res = <-got:
	case <-time.After(5 * time.Minute):
		http.Error(w, "5분 안에 로그인하지 않아 취소했습니다", 408)
		return
	case <-r.Context().Done():
		return
	}
	if res.err != "" || res.code == "" {
		http.Error(w, "구글 로그인을 마치지 못했습니다: "+res.err, 400)
		return
	}
	s := loadSettings()
	out, err := tokenRequest(s, url.Values{"grant_type": {"authorization_code"}, "code": {res.code}, "code_verifier": {verifier}, "redirect_uri": {redirect}},
		"/api/exchange", map[string]string{"code": res.code, "code_verifier": verifier, "redirect_uri": redirect})
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	rt, _ := out["refresh_token"].(string)
	if rt == "" {
		http.Error(w, "구글이 장기 로그인 토큰을 주지 않았습니다. 다시 시도해 주세요", 502)
		return
	}
	tokMu.Lock()
	accessTok, _ = out["access_token"].(string)
	sec, _ := out["expires_in"].(float64)
	accessExp = time.Now().Add(time.Duration(sec-60) * time.Second)
	tokMu.Unlock()
	s = loadSettings() // 로그인하는 동안 바뀐 다른 설정을 덮어쓰지 않도록 다시 읽는다
	s.GoogleRefresh = rt
	if err := saveSettings(s); err != nil {
		http.Error(w, "설정 저장 실패: "+err.Error(), 500)
		return
	}
	if p, _, err := calCall("GET", calPath("primary"), nil, nil); err == nil {
		s = loadSettings()
		s.GoogleEmail, _ = p["id"].(string) // 기본 캘린더 ID가 곧 계정 주소
	}
	if err := saveSettings(s); err != nil {
		http.Error(w, "설정 저장 실패: "+err.Error(), 500)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "email": s.GoogleEmail})
}

// POST /api/google/logout — 토큰을 폐기하고 지운다
func handleGoogleLogout(w http.ResponseWriter, r *http.Request) {
	s := loadSettings()
	if s.GoogleRefresh != "" {
		httpClient(10*time.Second).PostForm("https://oauth2.googleapis.com/revoke", url.Values{"token": {s.GoogleRefresh}})
	}
	s.GoogleRefresh, s.GoogleEmail = "", ""
	saveSettings(s)
	tokMu.Lock()
	accessTok, accessExp = "", time.Time{}
	tokMu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- 캘린더 작업 (예전 Apps Script와 같은 응답 모양) ----------

var progEvent = regexp.MustCompile(`^\((착수|완수)\) `)

func nextDay(d string) string {
	t, err := time.Parse("2006-01-02", d)
	if err != nil {
		return d
	}
	return t.AddDate(0, 0, 1).Format("2006-01-02")
}

func dayRange(d string) url.Values {
	loc := kst()
	t, _ := time.ParseInLocation("2006-01-02", d, loc)
	return url.Values{"timeMin": {t.Format(time.RFC3339)}, "timeMax": {t.AddDate(0, 0, 1).Format(time.RFC3339)}, "singleEvents": {"true"}, "maxResults": {"250"}}
}

func items(m map[string]any) []map[string]any {
	arr, _ := m["items"].([]any)
	out := make([]map[string]any, 0, len(arr))
	for _, x := range arr {
		if e, ok := x.(map[string]any); ok {
			out = append(out, e)
		}
	}
	return out
}

func evDate(e map[string]any, k string) (date, dateTime string) {
	m, _ := e[k].(map[string]any)
	date, _ = m["date"].(string)
	dateTime, _ = m["dateTime"].(string)
	return
}

// 그날 같은 제목의 종일 일정
func findSame(cal, title, date string) string {
	if title == "" || date == "" {
		return ""
	}
	out, _, err := calCall("GET", calPath(cal)+"/events", dayRange(date), nil)
	if err != nil {
		return ""
	}
	for _, e := range items(out) {
		d, _ := evDate(e, "start")
		if t, _ := e["summary"].(string); t == title && d == date {
			id, _ := e["id"].(string)
			return id
		}
	}
	return ""
}

func runOp(cal string, op map[string]any) map[string]any {
	str := func(k string) string { v, _ := op[k].(string); return v }
	id, title, date := str("id"), str("title"), str("date")
	if id != "" && strings.Contains(id, "@") { // Apps Script 시절 ID(iCalUID)는 API에서 쓸 수 없다
		id = ""
	}
	switch str("op") {
	case "delete":
		if id != "" {
			if _, code, err := calCall("DELETE", calPath(cal)+"/events/"+url.PathEscape(id), nil, nil); err != nil && code != 404 && code != 410 {
				return map[string]any{"ok": false, "error": err.Error()}
			}
		}
		return map[string]any{"ok": true}
	case "find":
		return map[string]any{"ok": true, "id": findSame(cal, title, date)}
	}
	if id != "" { // 지운 일정이면 새로 찾는다
		if e, _, err := calCall("GET", calPath(cal)+"/events/"+url.PathEscape(id), nil, nil); err != nil || e["status"] == "cancelled" {
			id = ""
		}
	}
	if id == "" {
		id = findSame(cal, title, date)
	}
	if id == "" {
		id = findSame(cal, str("prevTitle"), str("prevDate"))
	}
	body := map[string]any{"summary": title, "start": map[string]any{"date": date}, "end": map[string]any{"date": nextDay(date)}}
	var out map[string]any
	var err error
	if id != "" {
		out, _, err = calCall("PATCH", calPath(cal)+"/events/"+url.PathEscape(id), nil, body)
	} else {
		out, _, err = calCall("POST", calPath(cal)+"/events", nil, body)
	}
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	nid, _ := out["id"].(string)
	return map[string]any{"ok": true, "id": nid}
}

func calendarList() ([]map[string]any, error) {
	out, _, err := calCall("GET", "/users/me/calendarList", url.Values{"maxResults": {"250"}}, nil)
	if err != nil {
		return nil, err
	}
	var cals []map[string]any
	for _, c := range items(out) {
		role, _ := c["accessRole"].(string)
		prim, _ := c["primary"].(bool)
		cals = append(cals, map[string]any{"id": c["id"], "name": c["summary"], "color": c["backgroundColor"], "editable": role == "owner" || role == "writer", "primary": prim})
	}
	return cals, nil
}

// 구글 일정 하나를 화면에서 쓰는 모양으로
func eventOut(e map[string]any, cal map[string]any) map[string]any {
	loc := kst()
	title, _ := e["summary"].(string)
	desc, _ := e["description"].(string)
	eid, _ := e["id"].(string)
	calID, _ := cal["id"].(string)
	_, recurring := e["recurringEventId"]
	ev := map[string]any{"id": calID + "|" + eid, "calId": calID, "eid": eid, "title": title, "desc": desc,
		"color": cal["color"], "cal": cal["name"], "editable": cal["editable"], "recurring": recurring}
	ev["evColor"], _ = e["colorId"].(string)
	sd, sdt := evDate(e, "start")
	ed, edt := evDate(e, "end")
	if sd != "" { // 종일 일정(끝 날짜는 다음 날로 오므로 하루 뺀다)
		end := sd
		if t, err := time.Parse("2006-01-02", ed); err == nil {
			end = t.AddDate(0, 0, -1).Format("2006-01-02")
		}
		ev["allDay"], ev["start"], ev["end"], ev["time"], ev["etime"] = true, sd, end, "", ""
	} else {
		st, _ := time.Parse(time.RFC3339, sdt)
		et, _ := time.Parse(time.RFC3339, edt)
		st, et = st.In(loc), et.In(loc)
		ev["allDay"], ev["start"], ev["end"], ev["time"], ev["etime"] = false, st.Format("2006-01-02"), et.Format("2006-01-02"), st.Format("15:04"), et.Format("15:04")
	}
	return ev
}

func calMeta(id string, cals []map[string]any) map[string]any {
	for _, c := range cals {
		if c["id"] == id {
			return c
		}
	}
	return map[string]any{"id": id, "name": id, "color": "", "editable": true}
}

// 같이 볼 캘린더들의 일정 (프로그램이 만든 (착수)/(완수) 일정은 빼고)
func listEvents(s Settings, from, to string) ([]map[string]any, error) {
	loc := kst()
	tf, err1 := time.ParseInLocation("2006-01-02", from, loc)
	tt, err2 := time.ParseInLocation("2006-01-02", to, loc)
	if err1 != nil || err2 != nil {
		return nil, errors.New("날짜 범위가 잘못되었습니다")
	}
	ids := s.GcalShow
	if len(ids) == 0 {
		ids = []string{calID(s)}
	}
	cals, err := calendarList()
	if err != nil {
		return nil, err
	}
	events := []map[string]any{}
	for _, id := range ids {
		q := url.Values{"timeMin": {tf.Format(time.RFC3339)}, "timeMax": {tt.Format(time.RFC3339)}, "singleEvents": {"true"}, "orderBy": {"startTime"}, "maxResults": {"2500"}, "timeZone": {calTZ}}
		out, _, err := calCall("GET", calPath(id)+"/events", q, nil)
		if err != nil {
			continue // 볼 수 없는 캘린더는 건너뜀
		}
		meta := calMeta(id, cals)
		for _, e := range items(out) {
			title, _ := e["summary"].(string)
			if progEvent.MatchString(title) || e["status"] == "cancelled" {
				continue
			}
			events = append(events, eventOut(e, meta))
		}
	}
	return events, nil
}

// 화면에서 고치거나 새로 만든 일정을 구글에 저장 (다른 캘린더로 옮기기 포함)
func saveEvent(s Settings, req map[string]any) (map[string]any, error) {
	str := func(k string) string { v, _ := req[k].(string); return strings.TrimSpace(v) }
	cal, eid, target := str("calId"), str("eid"), str("target")
	if cal == "" {
		cal = calID(s)
	}
	if target == "" {
		target = cal
	}
	start, end := str("start"), str("end")
	if end == "" || end < start {
		end = start
	}
	body := map[string]any{"summary": str("title"), "description": str("desc")}
	if all, _ := req["allDay"].(bool); all {
		body["start"] = map[string]any{"date": start, "dateTime": nil, "timeZone": nil}
		body["end"] = map[string]any{"date": nextDay(end), "dateTime": nil, "timeZone": nil}
	} else {
		st, et := str("stime"), str("etime")
		if st == "" {
			st = "09:00"
		}
		if et == "" || (end == start && et <= st) { // 끝 시간이 없거나 앞서면 1시간짜리로
			t, _ := time.Parse("15:04", st)
			et = t.Add(time.Hour).Format("15:04")
			if et < st {
				et = "23:59"
			}
		}
		body["start"] = map[string]any{"dateTime": start + "T" + st + ":00+09:00", "timeZone": calTZ, "date": nil}
		body["end"] = map[string]any{"dateTime": end + "T" + et + ":00+09:00", "timeZone": calTZ, "date": nil}
	}
	var out map[string]any
	var err error
	if eid != "" {
		if target != cal { // 다른 캘린더로 옮기기
			if _, _, err = calCall("POST", calPath(cal)+"/events/"+url.PathEscape(eid)+"/move", url.Values{"destination": {target}}, nil); err != nil {
				return nil, err
			}
		}
		out, _, err = calCall("PATCH", calPath(target)+"/events/"+url.PathEscape(eid), nil, body)
	} else {
		out, _, err = calCall("POST", calPath(target)+"/events", nil, body)
	}
	if err != nil {
		return nil, err
	}
	cals, _ := calendarList()
	return eventOut(out, calMeta(target, cals)), nil
}

func callGcal(s Settings, action string, ops []any) (map[string]any, error) {
	return callGcalWith(s, map[string]any{"action": action, "ops": ops})
}

func callGcalWith(s Settings, req map[string]any) (map[string]any, error) {
	if s.GoogleRefresh == "" {
		return nil, errors.New("구글 계정으로 로그인되어 있지 않습니다")
	}
	cal := calID(s)
	switch req["action"] {
	case "ping":
		out, _, err := calCall("GET", calPath(cal), nil, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "name": out["summary"], "version": 2}, nil
	case "calendars":
		cals, err := calendarList()
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "version": 2, "calendars": cals}, nil
	case "evSave":
		ev, err := saveEvent(s, req)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "event": ev}, nil
	case "evDelete":
		cal, _ := req["calId"].(string)
		eid, _ := req["eid"].(string)
		if _, code, err := calCall("DELETE", calPath(cal)+"/events/"+url.PathEscape(eid), nil, nil); err != nil && code != 404 && code != 410 {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	case "list":
		from, _ := req["from"].(string)
		to, _ := req["to"].(string)
		evs, err := listEvents(s, from, to)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "version": 2, "events": evs}, nil
	}
	ops, _ := req["ops"].([]any)
	results := make([]any, 0, len(ops))
	for _, o := range ops {
		m, _ := o.(map[string]any)
		if _, err := accessToken(); err != nil { // 로그인이 풀렸으면 바로 알린다
			return nil, err
		}
		results = append(results, runOp(cal, m))
	}
	return map[string]any{"ok": true, "results": results}, nil
}

// POST /api/gcal — 화면이 보낸 일정 작업(ops)·일정 목록(list)·캘린더 목록(calendars)
func handleGcal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	var in map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&in); err != nil {
		http.Error(w, "잘못된 요청", 400)
		return
	}
	if a, _ := in["action"].(string); a == "" {
		in["action"] = "ops"
	}
	out, err := callGcalWith(loadSettings(), in)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, out)
}
