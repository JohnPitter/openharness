//go:build windows

package update

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

func startRelaunch(exe string) error {
	cmd := exec.Command(exe)
	cmd.Dir = filepath.Dir(exe)
	cmd.Env = append(os.Environ(), fmt.Sprintf("%s=%d", waitPIDEnv, os.Getpid()))
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_BREAKAWAY_FROM_JOB,
	}
	return cmd.Start()
}

func waitForPID(pid int) {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)
	const timeout = 30 * time.Second
	_, _ = windows.WaitForSingleObject(h, uint32(timeout.Milliseconds()))
}
