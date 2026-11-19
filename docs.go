package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// 계약 문서 보관: 보관 위치(설정, 기본은 데이터 폴더\문서) 아래 계약명 폴더를 만들고,
// 그 안에 '2026-11-20 변경 - 계약금액·완수일'처럼 날짜와 사유를 붙인 폴더로 나눠 원본 파일을 둔다.
// 계약에는 보관 위치 기준 상대 경로(docDir)만 저장한다.

const docsDirName = "문서"

func defaultDocsRoot() string { return filepath.Join(dataDir, docsDirName) }

func docsRoot() string {
	if r := loadSettings().DocsRoot; r != "" {
		return filepath.Clean(r)
	}
	return defaultDocsRoot()
}

// 파일·폴더 이름에 쓸 수 없는 글자를 바꾸고 길이를 줄인다
func safeName(s string, max int) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`\/:*?"<>|`, r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(s))
	if rs := []rune(s); len(rs) > max {
		s = string(rs[:max])
	}
	s = strings.Trim(s, " .")
	if s == "" {
		s = "이름없음"
	}
	return s
}

// 파일 이름은 확장자를 지키고 앞부분만 줄인다(확장자가 잘리면 열 프로그램을 못 찾는다)
func safeFileName(s string) string {
	ext := filepath.Ext(s)
	if len([]rune(ext)) > 10 || strings.ContainsAny(ext, ` \/:*?"<>|`) {
		ext = ""
	}
	return safeName(strings.TrimSuffix(s, ext), 100) + ext
}

// dir 안의 하위 경로 — 밖으로 나가는 경로는 거부
func within(dir, sub string) (string, error) {
	p := filepath.Join(dir, filepath.FromSlash(sub))
	if p != dir && !strings.HasPrefix(p, dir+string(filepath.Separator)) {
		return "", errors.New("잘못된 경로")
	}
	return p, nil
}

// 화면이 보낸 상대 경로를 보관 위치 안의 실제 경로로
func resolveDocDir(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" || filepath.IsAbs(rel) || filepath.VolumeName(rel) != "" {
		return "", errors.New("잘못된 문서 폴더")
	}
	p, err := within(docsRoot(), rel)
	if err != nil || p == docsRoot() {
		return "", errors.New("잘못된 문서 폴더")
	}
	return p, nil
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
	Name     string `json:"name"`   // 계약 폴더 기준 경로('2026-11-20 변경 - 계약금액/계약서.pdf')
	Folder   string `json:"folder"` // 날짜·사유 폴더(없으면 빈 값)
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

func listDocs(dir string) []docFile {
	out := []docFile{}
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		rel = filepath.ToSlash(rel)
		folder := ""
		if i := strings.LastIndex(rel, "/"); i >= 0 {
			folder = rel[:i]
		}
		out = append(out, docFile{Name: rel, Folder: folder, Size: info.Size(), Modified: info.ModTime().Format("2006-01-02T15:04:05Z07:00")})
		return nil
	})
	sort.Slice(out, func(i, j int) bool {
		if out[i].Folder != out[j].Folder {
			return out[i].Folder > out[j].Folder // 날짜로 시작하므로 최신 폴더가 위로
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// POST /api/docs/upload — dir(없으면 계약명 name으로 새로) 아래 sub(날짜·사유) 폴더에 파일 저장
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
		base := safeName(r.FormValue("name"), 60)
		rel = base
		for i := 2; ; i++ { // 다른 계약이 쓰는 폴더면 번호를 붙인다
			if _, err := os.Stat(filepath.Join(docsRoot(), rel)); errors.Is(err, os.ErrNotExist) {
				break
			}
			rel = fmt.Sprintf("%s (%d)", base, i)
		}
	}
	dir, err := resolveDocDir(rel)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	target := dir
	if sub := r.FormValue("sub"); sub != "" {
		target = filepath.Join(dir, safeName(sub, 60))
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		http.Error(w, "폴더를 만들지 못했습니다: "+err.Error(), 500)
		return
	}
	var saved []string
	for _, fh := range r.MultipartForm.File["files"] {
		src, err := fh.Open()
		if err != nil {
			continue
		}
		p := uniquePath(target, safeFileName(filepath.Base(fh.Filename)))
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

// GET /api/docs/open?dir=&name= — 파일은 기본 프로그램으로, 폴더는 탐색기로. root=1이면 보관 위치 자체
func handleDocsOpen(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("root") == "1" {
		os.MkdirAll(docsRoot(), 0o755)
		openPath(docsRoot())
		writeJSON(w, map[string]any{"ok": true})
		return
	}
	dir, err := resolveDocDir(q.Get("dir"))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	target := dir
	if name := q.Get("name"); name != "" {
		if target, err = within(dir, name); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
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

// 보관 위치를 바꿀 때 기존 문서를 통째로 옮긴다(다른 드라이브면 복사 후 원본 삭제)
func moveDocs(from, to string) error {
	if filepath.Clean(from) == filepath.Clean(to) {
		return nil
	}
	if strings.HasPrefix(filepath.Clean(to)+string(filepath.Separator), filepath.Clean(from)+string(filepath.Separator)) {
		return errors.New("새 보관 위치가 지금 보관 위치 안에 있습니다")
	}
	if err := os.MkdirAll(to, 0o755); err != nil {
		return err
	}
	ents, err := os.ReadDir(from)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	for _, e := range ents {
		src, dst := filepath.Join(from, e.Name()), filepath.Join(to, e.Name())
		if _, err := os.Stat(dst); err == nil {
			return fmt.Errorf("새 보관 위치에 같은 이름이 이미 있습니다: %s", e.Name())
		}
		if os.Rename(src, dst) == nil {
			continue
		}
		if err := copyTree(src, dst); err != nil {
			os.RemoveAll(dst)
			return fmt.Errorf("%s 옮기기 실패: %v", e.Name(), err)
		}
		os.RemoveAll(src)
	}
	return nil
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		t := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(t, 0o755)
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(t)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			return err
		}
		return out.Close()
	})
}
