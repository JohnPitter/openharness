//go:build !windows

package sidecar

import (
	"os"
	"os/exec"
	"syscall"
)

type pgidJob struct{ pid int }

func prepareSidecarCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func resumeSidecar(_ *os.Process) {}

func attachSidecarJob(p *os.Process) sidecarJob {
	if p == nil {
		return nil
	}
	return &pgidJob{pid: p.Pid}
}

func (j *pgidJob) killAndClose() {
	if j == nil || j.pid <= 0 {
		return
	}
	killProcessTree(j.pid)
	j.pid = 0
}

func killProcessTree(pid int) {
	if pid <= 0 {
		return
	}
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	_ = syscall.Kill(pid, syscall.SIGKILL)
}
