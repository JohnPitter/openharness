//go:build windows

package sidecar

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func startSuspended(t *testing.T, name string, args ...string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(name, args...)
	prepareSidecarCmd(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _, _ = cmd.Process.Wait() })
	return cmd
}

func TestKillOnCloseJobKillsProcess(t *testing.T) {
	cmd := startSuspended(t, "ping", "-n", "30", "127.0.0.1")
	job := attachSidecarJob(cmd.Process)
	if job == nil {
		t.Fatal("não criou o job object")
	}
	resumeSidecar(cmd.Process)
	job.killAndClose()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("processo sobreviveu ao job")
	}
}

func TestJobKillsGrandchild(t *testing.T) {
	cmd := startSuspended(t, "cmd.exe", "/c", "ping", "-n", "30", "127.0.0.1")
	job := attachSidecarJob(cmd.Process)
	if job == nil {
		t.Fatal("não criou o job object")
	}
	resumeSidecar(cmd.Process)
	time.Sleep(400 * time.Millisecond)
	job.killAndClose()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("árvore sobreviveu ao job")
	}
}

func TestKillSidecarNodesByPath(t *testing.T) {
	root := t.TempDir()
	dst := filepath.Join(root, "runtime", "node.exe")
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		t.Fatal(err)
	}
	src, err := exec.LookPath("ping.exe")
	if err != nil {
		t.Skip("ping.exe ausente")
	}
	in, err := os.Open(src)
	if err != nil {
		t.Fatal(err)
	}
	out, err := os.Create(dst)
	if err != nil {
		in.Close()
		t.Fatal(err)
	}
	_, err = io.Copy(out, in)
	in.Close()
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(dst, "-n", "30", "127.0.0.1")
	hideConsole(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _, _ = cmd.Process.Wait() })
	killSidecarNodes(root)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("node copiado sobreviveu a killSidecarNodes")
	}
}

func TestKillProcessTreeIsIdempotent(t *testing.T) {
	killProcessTree(0)
	killProcessTree(-1)
	killProcessTree(1 << 30)
}

func TestPathUnderRoot(t *testing.T) {
	root := `C:\Users\x\AppData\Local\openharness`
	if !pathUnderRoot(`C:\Users\x\AppData\Local\openharness\runtime\node.exe`, root) {
		t.Fatal("deveria casar o node do runtime")
	}
	if pathUnderRoot(`C:\Program Files\nodejs\node.exe`, root) {
		t.Fatal("não deveria casar node de outro lugar")
	}
}
