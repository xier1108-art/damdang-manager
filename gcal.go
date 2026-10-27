package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// 구글 캘린더 연동
// 구글 클라우드 프로젝트·OAuth 없이 쓰도록, 사용자가 자기 계정에 올린 Apps Script 웹 앱을 거쳐
// '업무' 캘린더에 종일 일정을 만들고 고치고 지운다. 스크립트는 사용자 권한으로 실행된다.

const gcalScript = `// 담당사업관리 → 구글 캘린더 연결용 스크립트
// script.google.com에서 새 프로젝트를 만들고 이 내용을 그대로 붙여넣은 뒤
// 배포 › 새 배포 › 웹 앱 (실행: 나, 액세스 권한: 모든 사용자)으로 배포하세요.
const SECRET = '%s';

function doPost(e) {
  const req = JSON.parse(e.postData.contents);
  if (req.secret !== SECRET) return out({ ok: false, error: '비밀 값이 맞지 않습니다. 프로그램 설정의 스크립트로 다시 배포하세요.' });
  const cal = req.calendarId ? CalendarApp.getCalendarById(req.calendarId) : CalendarApp.getDefaultCalendar();
  if (!cal) return out({ ok: false, error: '캘린더를 찾지 못했습니다: ' + req.calendarId });
  if (req.action === 'ping') return out({ ok: true, name: cal.getName() });
  const results = (req.ops || []).map(function (op) {
    try { return run(cal, op); } catch (err) { return { ok: false, error: String(err) }; }
  });
  return out({ ok: true, results: results });
}

function day(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }

function findSame(cal, title, date) {
  if (!title || !date) return null;
  const evs = cal.getEventsForDay(day(date));
  for (let i = 0; i < evs.length; i++) if (evs[i].isAllDayEvent() && evs[i].getTitle() === title) return evs[i];
  return null;
}

function run(cal, op) {
  let ev = op.id ? cal.getEventById(op.id) : null;
  if (op.op === 'delete') { if (ev) ev.deleteEvent(); return { ok: true }; }
  if (op.op === 'find') { ev = findSame(cal, op.title, op.date); return { ok: true, id: ev ? ev.getId() : '' }; }
  if (!ev) ev = findSame(cal, op.title, op.date) || findSame(cal, op.prevTitle, op.prevDate);
  if (ev) {
    if (ev.getTitle() !== op.title) ev.setTitle(op.title);
    ev.setAllDayDate(day(op.date));
    return { ok: true, id: ev.getId() };
  }
  ev = cal.createAllDayEvent(op.title, day(op.date));
  return { ok: true, id: ev.getId() };
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`

// 스크립트 내용(처음 열 때 비밀 값을 만든다)
func handleGcalScript(w http.ResponseWriter, r *http.Request) {
	s := loadSettings()
	if s.GcalSecret == "" {
		b := make([]byte, 16)
		rand.Read(b)
		s.GcalSecret = hex.EncodeToString(b)
		if err := saveSettings(s); err != nil {
			http.Error(w, "설정 저장 실패: "+err.Error(), 500)
			return
		}
	}
	writeJSON(w, map[string]any{"script": fmt.Sprintf(gcalScript, s.GcalSecret)})
}

func callGcal(s Settings, action string, ops []any) (map[string]any, error) {
	if s.GcalURL == "" {
		return nil, fmt.Errorf("구글 캘린더 연결이 설정되지 않았습니다")
	}
	body, _ := json.Marshal(map[string]any{"secret": s.GcalSecret, "calendarId": s.GcalCalendar, "action": action, "ops": ops})
	// 웹 앱은 결과 주소로 302를 돌려주고, Go 클라이언트는 이를 GET으로 따라간다
	resp, err := httpClient(5*time.Minute).Post(s.GcalURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	var out map[string]any
	if json.Unmarshal(raw, &out) != nil {
		txt := strings.TrimSpace(string(raw))
		if strings.Contains(txt, "<html") || strings.Contains(txt, "<!DOCTYPE") {
			return nil, fmt.Errorf("스크립트가 JSON 대신 웹 페이지를 돌려줬습니다(HTTP %d). 웹 앱 액세스 권한이 '모든 사용자'인지, 주소가 /exec로 끝나는지 확인하세요", resp.StatusCode)
		}
		if len(txt) > 200 {
			txt = txt[:200]
		}
		return nil, fmt.Errorf("스크립트 응답을 읽지 못했습니다(HTTP %d): %s", resp.StatusCode, txt)
	}
	if ok, _ := out["ok"].(bool); !ok {
		msg, _ := out["error"].(string)
		return nil, fmt.Errorf("%s", msg)
	}
	return out, nil
}

// 화면이 보낸 일정 작업 묶음을 스크립트로 전달
func handleGcal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	var in struct {
		Action string `json:"action"`
		Ops    []any  `json:"ops"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&in); err != nil {
		http.Error(w, "잘못된 요청", 400)
		return
	}
	if in.Action == "" {
		in.Action = "ops"
	}
	out, err := callGcal(loadSettings(), in.Action, in.Ops)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, out)
}
