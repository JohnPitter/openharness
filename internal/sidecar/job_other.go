//go:build !windows

package sidecar

import (
	"os"
	"syscall"
)

type pgidJob struct{ pid int }

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
