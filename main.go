package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed ui
var uiFS embed.FS

//go:embed seed.json
var seedJSON []byte

const (
	appName     = "담당사업관리"
	dataName    = "담당사업관리_data.json"
	backupDir   = "백업"
	exportDir   = "내보내기"
	keepBackups = 40
)

var (
	dataDir    string
	mu         sync.Mutex
	lastBackup time.Time
	lastPing   = time.Now()
	pingMu     sync.Mutex
)

func main() {
	dataDir = resolveDataDir()
	ensureData()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fatal("내부 서버를 시작하지 못했습니다: " + err.Error())
	}
	url := fmt.Sprintf("http://%s/", ln.Addr().String())

	if other := checkRunning(); other != "" {
		// 이미 실행 중이면 기존 창 주소를 기본 브라우저로 열고 종료
		openInBrowser(other)
		return
	}
	writePortFile(url)
	defer os.Remove(portFile())

	mux := http.NewServeMux()
	sub, _ := fs.Sub(uiFS, "ui")
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))
	mux.HandleFunc("/api/data", handleData)
	mux.HandleFunc("/api/export", handleExport)
	mux.HandleFunc("/api/backups", handleBackups)
	mux.HandleFunc("/api/restore", handleRestore)
	mux.HandleFunc("/api/open-folder", handleOpenFolder)
	mux.HandleFunc("/api/open-url", handleOpenURL)
	mux.HandleFunc("/api/settings", handleSettings)
	mux.HandleFunc("/api/net-test", handleNetTest)
	mux.HandleFunc("/api/ai/extract", handleAIExtract)
	mux.HandleFunc("/api/notion/sync", handleNotionSync)
	mux.HandleFunc("/api/notion/test", handleNotionTest)
	mux.HandleFunc("/api/gcal", handleGcal)
	mux.HandleFunc("/api/gcal/script", handleGcalScript)
	mux.HandleFunc("/api/theme", func(w http.ResponseWriter, r *http.Request) {
		setWindowTheme(r.URL.Query().Get("dark") == "1")
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		pingMu.Lock()
		lastPing = time.Now()
		pingMu.Unlock()
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("/api/info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"dataDir": dataDir, "dataFile": filepath.Join(dataDir, dataName), "version": "1.4.0"})
	})
	go http.Serve(ln, mux)

	runWindow(url) // 창이 닫히면 반환
}

// ---------- 데이터 위치 ----------

func exeDir() string {
	p, err := os.Executable()
	if err != nil {
		return "."
	}
	p, _ = filepath.EvalSymlinks(p)
	return filepath.Dir(p)
}

func resolveDataDir() string {
	d := exeDir()
	if writable(d) {
		return d
	}
	base := os.Getenv("APPDATA")
	if base == "" {
		base, _ = os.UserHomeDir()
	}
	d = filepath.Join(base, appName)
	os.MkdirAll(d, 0o755)
	return d
}

func writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".wtest*")
	if err != nil {
		return false
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return true
}

func dataPath() string { return filepath.Join(dataDir, dataName) }
func portFile() string { return filepath.Join(os.TempDir(), appName+".port") }

func ensureData() {
	if _, err := os.Stat(dataPath()); errors.Is(err, os.ErrNotExist) {
		os.WriteFile(dataPath(), seedJSON, 0o644)
	}
	makeBackup("시작")
}

func writePortFile(url string) { os.WriteFile(portFile(), []byte(url), 0o644) }

func checkRunning() string {
	b, err := os.ReadFile(portFile())
	if err != nil {
		return ""
	}
	u := strings.TrimSpace(string(b))
	c := http.Client{Timeout: 700 * time.Millisecond}
	resp, err := c.Get(u + "api/ping")
	if err != nil {
		return ""
	}
	resp.Body.Close()
	return u
}

// ---------- 백업 ----------

func makeBackup(tag string) {
	src, err := os.ReadFile(dataPath())
	if err != nil || len(src) == 0 {
		return
	}
	dir := filepath.Join(dataDir, backupDir)
	os.MkdirAll(dir, 0o755)
	name := fmt.Sprintf("%s_%s.json", time.Now().Format("20060102_150405"), tag)
	os.WriteFile(filepath.Join(dir, name), src, 0o644)
	lastBackup = time.Now()
	pruneBackups(dir)
}

func listBackups() []string {
	dir := filepath.Join(dataDir, backupDir)
	ents, _ := os.ReadDir(dir)
	var names []string
	for _, e := range ents {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	return names
}

func pruneBackups(dir string) {
	names := listBackups()
	for i, n := range names {
		if i >= keepBackups {
			os.Remove(filepath.Join(dir, n))
		}
	}
}

// ---------- 핸들러 ----------

func handleData(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	switch r.Method {
	case http.MethodGet:
		b, err := os.ReadFile(dataPath())
		if err != nil {
			b = seedJSON
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(b)
	case http.MethodPost:
		body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		if err != nil || !json.Valid(body) {
			http.Error(w, "잘못된 데이터", 400)
			return
		}
		if time.Since(lastBackup) > 10*time.Minute {
			makeBackup("자동")
		}
		var pretty bytes.Buffer
		if json.Indent(&pretty, body, "", " ") == nil {
			body = pretty.Bytes()
		}
		tmp := dataPath() + ".tmp"
		if err := os.WriteFile(tmp, body, 0o644); err != nil {
			http.Error(w, "저장 실패: "+err.Error(), 500)
			return
		}
		if err := os.Rename(tmp, dataPath()); err != nil {
			http.Error(w, "저장 실패: "+err.Error(), 500)
			return
		}
		writeJSON(w, map[string]any{"ok": true, "savedAt": time.Now().Format(time.RFC3339)})
	default:
		http.Error(w, "method", 405)
	}
}

func handleBackups(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"backups": listBackups()})
}

func handleRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	name := filepath.Base(r.URL.Query().Get("name"))
	mu.Lock()
	defer mu.Unlock()
	b, err := os.ReadFile(filepath.Join(dataDir, backupDir, name))
	if err != nil || !json.Valid(b) {
		http.Error(w, "백업 파일을 읽지 못했습니다", 400)
		return
	}
	makeBackup("복원전")
	os.WriteFile(dataPath(), b, 0o644)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(b)
}

func handleOpenFolder(w http.ResponseWriter, r *http.Request) {
	which := r.URL.Query().Get("which")
	dir := dataDir
	switch which {
	case "backup":
		dir = filepath.Join(dataDir, backupDir)
	case "export":
		dir = filepath.Join(dataDir, exportDir)
	}
	os.MkdirAll(dir, 0o755)
	openPath(dir)
	writeJSON(w, map[string]any{"ok": true})
}

func handleOpenURL(w http.ResponseWriter, r *http.Request) {
	u := r.URL.Query().Get("u")
	if strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://") {
		openInBrowser(u)
	}
	writeJSON(w, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

// 브라우저 대체 모드에서 창이 닫혔는지 감시
func waitForBrowserClose() {
	for {
		time.Sleep(5 * time.Second)
		pingMu.Lock()
		idle := time.Since(lastPing)
		pingMu.Unlock()
		if idle > 45*time.Second {
			return
		}
	}
}
