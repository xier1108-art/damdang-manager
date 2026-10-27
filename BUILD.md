# 담당사업관리 — 소스와 빌드 방법

## 구성
- `main.go` — 실행·내장 웹서버·데이터 저장/백업
- `ai.go` — 문서로 추가(Claude API 호출)
- `textextract.go` — HWP·HWPX·DOCX 본문 추출
- `notion.go` — 노션 양방향 동기화
- `settings.go` — 설정(키는 Windows DPAPI 암호화), 연결 테스트
- `gcal.go` — 구글 캘린더 '업무'에 (착수)/(완수) 일정 등록 (사용자 계정의 Apps Script 웹 앱을 거침)
- `export.go` — 엑셀 내보내기
- `platform_windows.go` / `platform_other.go` — 창(WebView2)·OS 기능
- `ui/` — 화면(index.html, app.css, app.js, 글꼴)
- `seed.json` — 최초 실행 시 넣는 노션 데이터(118건)
- `winres/` — 아이콘·버전 정보, `rsrc_windows_amd64.syso` — 빌드에 쓰는 리소스

## 빌드 (Windows PC)
1. Go 1.24 이상 설치: https://go.dev/dl/
2. 이 폴더에서 PowerShell 실행
   ```
   go build -trimpath -ldflags "-s -w -H windowsgui" -o 담당사업관리.exe .
   ```
3. 아이콘·버전을 바꿨을 때만 리소스를 다시 생성
   ```
   go install github.com/tc-hib/go-winres@v0.3.3
   go-winres make --in winres/winres.json --arch amd64
   ```

## 다른 OS에서 Windows용으로 빌드
```
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H windowsgui" -o 담당사업관리.exe .
```

## 참고
- 데이터 파일(`담당사업관리_data.json`)과 설정 파일은 exe와 같은 폴더에 생깁니다. 소스 폴더에는 포함되지 않습니다.
- 테스트용 환경변수 `DM_ANTHROPIC_BASE`, `DM_NOTION_BASE`로 API 주소를 바꿀 수 있습니다(평소에는 쓰지 않음).
