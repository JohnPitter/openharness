//go:build windows

package sidecar

import (
	"os/exec"
	"testing"
	"time"
)

func TestKillOnCloseJobKillsProcess(t *testing.T) {
	cmd := exec.Command("ping", "-n", "30", "127.0.0.1")
	hideConsole(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	job := attachSidecarJob(cmd.Process)
	if job == nil {
		_ = cmd.Process.Kill()
		t.Fatal("não criou o job object")
	}
	job.killAndClose()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("processo sobreviveu ao job")
	}
}

func TestKillProcessTreeIsIdempotent(t *testing.T) {
	killProcessTree(0)
	killProcessTree(-1)
	killProcessTree(1 << 30)
}
