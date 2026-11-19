//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

func runWindow(url string) {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		local = os.TempDir()
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  filepath.Join(local, appName, "WebView2"),
		WindowOptions: webview2.WindowOptions{
			Title:  "담당사업 관리",
			Width:  1480,
			Height: 920,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		// WebView2 런타임이 없으면 기본 브라우저로 대체
		openInBrowser(url)
		waitForBrowserClose()
		return
	}
	defer w.Destroy()
	mainView = w
	w.SetSize(1180, 720, webview2.HintMin)
	installTray(w)
	defer removeTray()
	w.Navigate(url)
	w.Run()
}

var (
	mainView         webview2.WebView
	procDwmSetAttr   = windows.NewLazySystemDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
	procSetWindowPos = windows.NewLazySystemDLL("user32.dll").NewProc("SetWindowPos")
)

const (
	dwmaUseDarkMode  = 20 // DWMWA_USE_IMMERSIVE_DARK_MODE (Windows 10 20H1+)
	dwmaCaptionColor = 35 // DWMWA_CAPTION_COLOR (Windows 11)
	dwmaTextColor    = 36 // DWMWA_TEXT_COLOR (Windows 11)
)

// 창 제목 표시줄을 화면 테마에 맞춘다. 색은 COLORREF(0x00BBGGRR)
func setWindowTheme(dark bool) {
	w := mainView
	if w == nil {
		return
	}
	w.Dispatch(func() {
		hwnd := uintptr(w.Window())
		set := func(attr uint32, v uint32) {
			procDwmSetAttr.Call(hwnd, uintptr(attr), uintptr(unsafe.Pointer(&v)), 4)
		}
		var on, caption, text uint32 = 0, 0x00FFFFFF, 0x00221C19 // 라이트: 흰 바탕(사이드바와 같음)
		if dark {
			on, caption, text = 1, 0x0023201F, 0x00EBE9E8 // 다크: #1F2023 바탕, #E8E9EB 글자
		}
		set(dwmaUseDarkMode, on)
		set(dwmaCaptionColor, caption)
		set(dwmaTextColor, text)
		// Windows 10은 프레임을 다시 그려야 바로 바뀐다
		const swpFlags = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020 // NOSIZE|NOMOVE|NOZORDER|NOACTIVATE|FRAMECHANGED
		procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, swpFlags)
	})
}

// 파일은 기본 프로그램으로, 폴더는 탐색기로 연다 (숨김 옵션으로 explorer를 띄우면 창이 안 보였다)
func openPath(p string) {
	go func() {
		runtime.LockOSThread()
		windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED)
		defer windows.CoUninitialize()
		verb, _ := windows.UTF16PtrFromString("open")
		file, _ := windows.UTF16PtrFromString(p)
		windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
	}()
}

// 폴더 선택 창(취소하면 빈 값). 콘솔 창 없이 PowerShell 폴더 대화상자를 띄운다
func pickFolder(start string) (string, error) {
	script := "Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
		"$f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '계약 문서를 보관할 폴더를 고르세요'; $f.SelectedPath = $env:DM_START; " +
		"$o = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}; if ($f.ShowDialog($o) -eq 'OK') { $f.SelectedPath }"
	cmd := exec.Command("powershell", "-NoProfile", "-STA", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000} // CREATE_NO_WINDOW: 대화상자는 보이고 콘솔만 숨김
	cmd.Env = append(os.Environ(), "DM_START="+start)
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

func selectInExplorer(p string) {
	hidden(exec.Command("explorer", "/select,", p)).Start()
}

func openInBrowser(u string) {
	hidden(exec.Command("rundll32", "url.dll,FileProtocolHandler", u)).Start()
}

func fatal(msg string) {
	t, _ := windows.UTF16PtrFromString("담당사업 관리")
	m, _ := windows.UTF16PtrFromString(msg)
	windows.MessageBox(0, m, t, windows.MB_ICONERROR)
	os.Exit(1)
}

// Windows 계정에 묶인 암호화(DPAPI) — 다른 PC·계정에서는 복호화 불가
func protect(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return nil, nil
	}
	in := windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
	var out windows.DataBlob
	if err := windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}

func unprotect(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return nil, nil
	}
	in := windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}
