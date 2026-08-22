//go:build windows

package sidecar

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// hideConsole evita que helpers (taskkill legado, testes) abram console.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
}
