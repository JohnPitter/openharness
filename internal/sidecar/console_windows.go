//go:build windows

package sidecar

import (
	"os"
	"os/exec"
	"strings"
	"syscall"
)

const createNoWindow = 0x08000000

// hideConsole evita que o sidecar node.exe abra uma janela de console.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
}

// killSidecarNodes encerra node.exe cujo executável vive sob Root (runtime
// extraído). Sem isso o overlay/unlink do libvips falha com Access is denied.
func killSidecarNodes(root string) {
	prefix := root
	if !strings.HasSuffix(prefix, string(os.PathSeparator)) {
		prefix += string(os.PathSeparator)
	}
	script := `
$prefix = $env:OPENHARNESS_SIDECAR_PREFIX
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
  if ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	cmd.Env = append(os.Environ(), "OPENHARNESS_SIDECAR_PREFIX="+prefix)
	hideConsole(cmd)
	_ = cmd.Run()
}
