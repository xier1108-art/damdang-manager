//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

// 작업 표시줄 알림 영역(트레이) 아이콘
// 창의 X를 누르면 창만 숨기고 계속 실행한다. 트레이 아이콘을 누르면 다시 열리고, 메뉴의 '종료'로 끝낸다.

var (
	user32                 = windows.NewLazySystemDLL("user32.dll")
	procSetWindowLongPtr   = user32.NewProc("SetWindowLongPtrW")
	procCallWindowProc     = user32.NewProc("CallWindowProcW")
	procShowWindow         = user32.NewProc("ShowWindow")
	procIsIconic           = user32.NewProc("IsIconic")
	procIsWindowVisible    = user32.NewProc("IsWindowVisible")
	procSetForegroundWin   = user32.NewProc("SetForegroundWindow")
	procCreatePopupMenu    = user32.NewProc("CreatePopupMenu")
	procAppendMenu         = user32.NewProc("AppendMenuW")
	procSetMenuDefaultItem = user32.NewProc("SetMenuDefaultItem")
	procTrackPopupMenu     = user32.NewProc("TrackPopupMenu")
	procDestroyMenu        = user32.NewProc("DestroyMenu")
	procGetCursorPos       = user32.NewProc("GetCursorPos")
	procPostMessage        = user32.NewProc("PostMessageW")
	procRegisterWindowMsg  = user32.NewProc("RegisterWindowMessageW")
	procLoadImage          = user32.NewProc("LoadImageW")
	procGetSystemMetrics   = user32.NewProc("GetSystemMetrics")
	procGetModuleHandle    = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW")
	procShellNotifyIcon    = windows.NewLazySystemDLL("shell32.dll").NewProc("Shell_NotifyIconW")
)

const (
	wmNull         = 0x0000
	wmClose        = 0x0010
	wmContextMenu  = 0x007B
	wmLButtonUp    = 0x0202
	wmLButtonDbl   = 0x0203
	wmRButtonUp    = 0x0205
	wmTray         = 0x8001 // WM_APP+1 (WM_APP은 go-webview2가 씀)
	nimAdd         = 0
	nimModify      = 1
	nimDelete      = 2
	nifMessage     = 0x01
	nifIcon        = 0x02
	nifTip         = 0x04
	nifInfo        = 0x10
	niifInfo       = 0x01
	swHide         = 0
	swShow         = 5
	swRestore      = 9
	mfString       = 0x0000
	mfSeparator    = 0x0800
	tpmRightButton = 0x0002
	tpmBottomAlign = 0x0020
	tpmReturnCmd   = 0x0100
	cmdOpen        = 1
	cmdQuit        = 2
)

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         windows.GUID
	HBalloonIcon     uintptr
}

var (
	trayView       webview2.WebView
	trayHwnd       uintptr
	origWndProc    uintptr
	quitting       bool
	taskbarCreated uintptr
	trayIcon       uintptr
	trayProcCB     = syscall.NewCallback(trayWndProc)
)

func setUTF16(dst []uint16, s string) {
	u, _ := windows.UTF16FromString(s)
	if len(u) > len(dst) {
		u = append(u[:len(dst)-1], 0)
	}
	copy(dst, u)
}

func installTray(w webview2.WebView) {
	trayView = w
	trayHwnd = uintptr(w.Window())
	name, _ := windows.UTF16PtrFromString("TaskbarCreated")
	taskbarCreated, _, _ = procRegisterWindowMsg.Call(uintptr(unsafe.Pointer(name)))
	hinst, _, _ := procGetModuleHandle.Call(0)
	cx, _, _ := procGetSystemMetrics.Call(49)                   // SM_CXSMICON
	cy, _, _ := procGetSystemMetrics.Call(50)                   // SM_CYSMICON
	trayIcon, _, _ = procLoadImage.Call(hinst, 1, 1, cx, cy, 0) // 리소스 아이콘 1번, IMAGE_ICON
	// 창 메시지를 가로채 X를 숨기기로 바꾼다 (GWLP_WNDPROC = -4)
	origWndProc, _, _ = procSetWindowLongPtr.Call(trayHwnd, ^uintptr(3), trayProcCB)
	addTrayIcon()
}

func trayData() notifyIconData {
	n := notifyIconData{HWnd: trayHwnd, UID: 1}
	n.CbSize = uint32(unsafe.Sizeof(n))
	return n
}

func addTrayIcon() {
	n := trayData()
	n.UFlags = nifMessage | nifIcon | nifTip
	n.UCallbackMessage = wmTray
	n.HIcon = trayIcon
	setUTF16(n.SzTip[:], "담당사업 관리")
	procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&n)))
}

func removeTray() {
	n := trayData()
	procShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&n)))
}

func trayBalloon(title, msg string) {
	n := trayData()
	n.UFlags = nifInfo
	n.DwInfoFlags = niifInfo
	setUTF16(n.SzInfoTitle[:], title)
	setUTF16(n.SzInfo[:], msg)
	procShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&n)))
}

func trayWndProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch {
	case msg == wmClose && !quitting:
		hideMain()
		return 0
	case msg == wmClose && quitting:
		removeTray()
	case msg == wmTray:
		switch lp & 0xFFFF {
		case wmLButtonUp, wmLButtonDbl:
			showMain()
		case wmRButtonUp, wmContextMenu:
			trayMenu()
		}
		return 0
	case taskbarCreated != 0 && msg == taskbarCreated: // 탐색기가 다시 시작되면 아이콘을 다시 단다
		addTrayIcon()
	}
	r, _, _ := procCallWindowProc.Call(origWndProc, hwnd, msg, wp, lp)
	return r
}

func hideMain() {
	procShowWindow.Call(trayHwnd, swHide)
	if s := loadSettings(); !s.TrayHinted { // 처음 한 번만 안내
		trayBalloon("담당사업 관리는 계속 실행 중입니다", "작업 표시줄 오른쪽 아이콘을 누르면 다시 열리고, 아이콘 메뉴의 '종료'로 끝낼 수 있습니다.")
		s.TrayHinted = true
		saveSettings(s)
	}
}

func showMain() {
	if iconic, _, _ := procIsIconic.Call(trayHwnd); iconic != 0 {
		procShowWindow.Call(trayHwnd, swRestore)
	} else {
		procShowWindow.Call(trayHwnd, swShow)
	}
	procSetForegroundWin.Call(trayHwnd)
}

func trayMenu() {
	m, _, _ := procCreatePopupMenu.Call()
	open, _ := windows.UTF16PtrFromString("열기")
	quit, _ := windows.UTF16PtrFromString("종료")
	procAppendMenu.Call(m, mfString, cmdOpen, uintptr(unsafe.Pointer(open)))
	procAppendMenu.Call(m, mfSeparator, 0, 0)
	procAppendMenu.Call(m, mfString, cmdQuit, uintptr(unsafe.Pointer(quit)))
	procSetMenuDefaultItem.Call(m, cmdOpen, 0)
	var pt struct{ X, Y int32 }
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWin.Call(trayHwnd) // 메뉴 밖을 누르면 닫히도록
	cmd, _, _ := procTrackPopupMenu.Call(m, tpmReturnCmd|tpmRightButton|tpmBottomAlign, uintptr(pt.X), uintptr(pt.Y), 0, trayHwnd, 0)
	procPostMessage.Call(trayHwnd, wmNull, 0, 0)
	procDestroyMenu.Call(m)
	switch cmd {
	case cmdOpen:
		showMain()
	case cmdQuit:
		quitApp()
	}
}

// 화면에 남은 저장을 먼저 끝내고 창을 닫는다
func quitApp() {
	quitting = true
	if trayView != nil {
		trayView.Eval(`try { clearTimeout(saveTimer); saveNow(); } catch (e) {}`)
	}
	time.AfterFunc(700*time.Millisecond, func() { procPostMessage.Call(trayHwnd, wmClose, 0, 0) })
}

// 다른 곳(두 번째 실행 등)에서 창을 다시 보이게 할 때
func showMainWindow() {
	if trayView == nil {
		return
	}
	trayView.Dispatch(showMain)
}
