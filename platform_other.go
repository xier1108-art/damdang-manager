//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
)

// 개발·테스트용(리눅스): 창 대신 주소만 출력하고 계속 실행
func runWindow(url string) {
	fmt.Println("UI:", url)
	select {}
}

func openPath(p string)         { exec.Command("xdg-open", p).Start() }
func selectInExplorer(p string) { fmt.Println("exported:", p) }
func openInBrowser(u string)    { fmt.Println("open:", u) }
func fatal(msg string)          { fmt.Fprintln(os.Stderr, msg); os.Exit(1) }
func setWindowTheme(dark bool)  {}

func protect(b []byte) ([]byte, error)   { return nil, errors.New("unsupported") }
func unprotect(b []byte) ([]byte, error) { return nil, errors.New("unsupported") }
