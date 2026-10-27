package main

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"io"
	"sort"
	"strings"
	"unicode/utf16"

	"github.com/richardlehane/mscfb"
)

// ---------- HWP 5.0 (한글 바이너리) ----------

func extractHWP(b []byte) (string, error) {
	doc, err := mscfb.New(bytes.NewReader(b))
	if err != nil {
		return "", errors.New("한글(HWP) 파일을 열지 못했습니다")
	}
	streams := map[string][]byte{}
	for e, err := doc.Next(); err == nil; e, err = doc.Next() {
		path := strings.Join(append(append([]string{}, e.Path...), e.Name), "/")
		if e.Size > 0 && (e.Name == "FileHeader" || e.Name == "PrvText" || strings.HasPrefix(path, "BodyText/Section")) {
			buf := make([]byte, e.Size)
			io.ReadFull(e, buf)
			streams[path] = buf
		}
	}
	hdr := streams["FileHeader"]
	compressed, encrypted, dist := true, false, false
	if len(hdr) >= 40 {
		flags := binary.LittleEndian.Uint32(hdr[36:40])
		compressed = flags&1 != 0
		encrypted = flags&2 != 0
		dist = flags&4 != 0
	}
	var secs []string
	for k := range streams {
		if strings.HasPrefix(k, "BodyText/Section") {
			secs = append(secs, k)
		}
	}
	sort.Slice(secs, func(i, j int) bool { return secNum(secs[i]) < secNum(secs[j]) })

	var out strings.Builder
	if !encrypted && !dist {
		for _, k := range secs {
			data := streams[k]
			if compressed {
				r := flate.NewReader(bytes.NewReader(data))
				d, err := io.ReadAll(r)
				r.Close()
				if err != nil && len(d) == 0 {
					continue
				}
				data = d
			}
			out.WriteString(hwpParaText(data))
		}
	}
	text := tidyLines(out.String())
	if text == "" { // 배포용·암호 문서 등은 미리보기 텍스트로 대체
		if p := streams["PrvText"]; len(p) > 1 {
			text = strings.TrimSpace(utf16le(p))
		}
		if text == "" {
			return "", errors.New("한글 문서에서 글자를 읽지 못했습니다(배포용·암호 문서는 PDF로 저장해 넣어 주세요)")
		}
		text = "[주의: 미리보기 텍스트만 읽음 — 일부 내용 누락 가능]\n" + text
	}
	return text, nil
}

func secNum(s string) int {
	n := 0
	for _, c := range s[strings.LastIndex(s, "Section")+7:] {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}

func hwpParaText(d []byte) string {
	var sb strings.Builder
	for p := 0; p+4 <= len(d); {
		h := binary.LittleEndian.Uint32(d[p:])
		p += 4
		tag := h & 0x3FF
		size := int(h >> 20)
		if size == 0xFFF {
			if p+4 > len(d) {
				break
			}
			size = int(binary.LittleEndian.Uint32(d[p:]))
			p += 4
		}
		if p+size > len(d) {
			break
		}
		if tag == 67 { // HWPTAG_PARA_TEXT
			sb.WriteString(hwpChars(d[p : p+size]))
			sb.WriteByte('\n')
		}
		p += size
	}
	return sb.String()
}

func hwpChars(b []byte) string {
	u := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); {
		c := binary.LittleEndian.Uint16(b[i:])
		switch {
		case c == 0 || c == 10 || c == 13 || (c >= 24 && c <= 31):
			if c == 10 {
				u = append(u, '\n')
			}
			i += 2
		case c < 32: // 인라인·확장 컨트롤은 8글자 분량
			if c == 9 {
				u = append(u, '\t')
			} else {
				u = append(u, ' ')
			}
			i += 16
		default:
			u = append(u, c)
			i += 2
		}
	}
	return string(utf16.Decode(u))
}

func utf16le(b []byte) string {
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = binary.LittleEndian.Uint16(b[i*2:])
	}
	return string(utf16.Decode(u))
}

// ---------- HWPX · DOCX (zip + XML) ----------

func extractZipXML(b []byte, kind string) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return "", errors.New("문서 파일을 열지 못했습니다")
	}
	var names []string
	for _, f := range zr.File {
		n := f.Name
		if (kind == "hwpx" && strings.HasPrefix(n, "Contents/section") && strings.HasSuffix(n, ".xml")) ||
			(kind == "docx" && n == "word/document.xml") {
			names = append(names, n)
		}
	}
	sort.Slice(names, func(i, j int) bool {
		return secNum(strings.Replace(names[i], "section", "Section", 1)) < secNum(strings.Replace(names[j], "section", "Section", 1))
	})
	var sb strings.Builder
	for _, n := range names {
		f, _ := zr.Open(n)
		dec := xml.NewDecoder(f)
		inT := false
		for {
			tok, err := dec.Token()
			if err != nil {
				break
			}
			switch t := tok.(type) {
			case xml.StartElement:
				switch t.Name.Local {
				case "t":
					inT = true
				case "tab":
					sb.WriteByte('\t')
				case "br", "lineBreak":
					sb.WriteByte('\n')
				case "tc": // 표 칸 구분
					sb.WriteString(" | ")
				}
			case xml.EndElement:
				switch t.Name.Local {
				case "t":
					inT = false
				case "p":
					sb.WriteByte('\n')
				}
			case xml.CharData:
				if inT {
					sb.Write(t)
				}
			}
		}
		f.Close()
	}
	s := strings.TrimSpace(sb.String())
	if s == "" {
		return "", errors.New("문서에서 글자를 읽지 못했습니다")
	}
	return s, nil
}

// 공백뿐인 줄 정리
func tidyLines(s string) string {
	var out []string
	blank := false
	for _, l := range strings.Split(s, "\n") {
		l = strings.TrimSpace(l)
		if l == "" {
			if !blank && len(out) > 0 {
				out = append(out, "")
			}
			blank = true
			continue
		}
		blank = false
		out = append(out, l)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}
