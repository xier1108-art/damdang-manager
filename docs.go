package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// 계약 문서 보관: 데이터 폴더 아래 문서\학교\요약명 폴더에 계약서 등 원본 파일을 둔다.
// 계약에는 그 폴더의 상대 경로(docDir)만 저장한다.

const docsDirName = "문서"

func docsRoot() string { return filepath.Join(dataDir, docsDirName) }

// 파일·폴더 이름에 쓸 수 없는 글자를 바꾸고 길이를 줄인다
func safeName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`\/:*?"<>|`, r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(s))
	if rs := []rune(s); len(rs) > 60 {
		s = string(rs[:60])
	}
	s = strings.Trim(s, " .")
	if s == "" {
		s = "이름없음"
	}
	return s
}

// 화면이 보낸 상대 경로를 문서 폴더 안의 실제 경로로 (밖으로 나가는 경로는 거부)
func resolveDocDir(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return "", errors.New("문서 폴더가 정해지지 않았습니다")
	}
	clean := filepath.Clean(filepath.FromSlash(rel))
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.VolumeName(clean) != "" {
		return "", errors.New("잘못된 문서 폴더")
	}
	full := filepath.Join(docsRoot(), clean)
	if !strings.HasPrefix(full, docsRoot()+string(filepath.Separator)) {
		return "", errors.New("잘못된 문서 폴더")
	}
	return full, nil
}

// 같은 이름이 있으면 " (2)", " (3)"…을 붙인다
func uniquePath(dir, name string) string {
	p := filepath.Join(dir, name)
	if _, err := os.Stat(p); errors.Is(err, os.ErrNotExist) {
		return p
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 2; ; i++ {
		p = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
		if _, err := os.Stat(p); errors.Is(err, os.ErrNotExist) {
			return p
		}
	}
}

type docFile struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

func listDocs(dir string) []docFile {
	ents, _ := os.ReadDir(dir)
	out := []docFile{}
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		if info, err := e.Info(); err == nil {
			out = append(out, docFile{Name: e.Name(), Size: info.Size(), Modified: info.ModTime().Format("2006-01-02T15:04:05Z07:00")})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified > out[j].Modified })
	return out
}

// POST /api/docs/upload — 파일들을 계약 문서 폴더에 저장. dir이 비면 학교·요약명으로 새로 만든다
func handleDocsUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		http.Error(w, "파일을 받지 못했습니다: "+err.Error(), 400)
		return
	}
	rel := r.FormValue("dir")
	if rel == "" {
		school, title := safeName(r.FormValue("school")), safeName(r.FormValue("title"))
		rel = school + "/" + title
		for i := 2; ; i++ { // 다른 계약이 쓰는 폴더면 번호를 붙인다
			if _, err := os.Stat(filepath.Join(docsRoot(), filepath.FromSlash(rel))); errors.Is(err, os.ErrNotExist) {
				break
			}
			rel = fmt.Sprintf("%s/%s (%d)", school, title, i)
		}
	}
	dir, err := resolveDocDir(rel)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, "폴더를 만들지 못했습니다: "+err.Error(), 500)
		return
	}
	var saved []string
	for _, fh := range r.MultipartForm.File["files"] {
		src, err := fh.Open()
		if err != nil {
			continue
		}
		p := uniquePath(dir, safeName(filepath.Base(fh.Filename)))
		dst, err := os.Create(p)
		if err == nil {
			_, err = io.Copy(dst, src)
			dst.Close()
		}
		src.Close()
		if err != nil {
			os.Remove(p)
			http.Error(w, fh.Filename+" 저장 실패: "+err.Error(), 500)
			return
		}
		saved = append(saved, filepath.Base(p))
	}
	writeJSON(w, map[string]any{"dir": filepath.ToSlash(rel), "saved": saved, "files": listDocs(dir)})
}

// GET /api/docs/list?dir=
func handleDocsList(w http.ResponseWriter, r *http.Request) {
	dir, err := resolveDocDir(r.URL.Query().Get("dir"))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	writeJSON(w, map[string]any{"files": listDocs(dir)})
}

// GET /api/docs/open?dir=&name= — 기본 프로그램으로 파일 열기. name이 없으면 폴더 열기
func handleDocsOpen(w http.ResponseWriter, r *http.Request) {
	dir, err := resolveDocDir(r.URL.Query().Get("dir"))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	target := dir
	if name := r.URL.Query().Get("name"); name != "" {
		target = filepath.Join(dir, filepath.Base(name))
		if _, err := os.Stat(target); err != nil {
			http.Error(w, "파일이 없습니다: "+name, 404)
			return
		}
	} else {
		os.MkdirAll(dir, 0o755)
	}
	openPath(target)
	writeJSON(w, map[string]any{"ok": true})
}
