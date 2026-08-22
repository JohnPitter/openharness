//go:build windows

package sidecar

import (
	"os"
	"os/exec"
	"strconv"
	"unsafe"

	"golang.org/x/sys/windows"
)

// winJob agrupa o sidecar e os descendentes. KILL_ON_JOB_CLOSE faz a árvore
// morrer quando o handle fecha — inclusive se o exe cair sem OnShutdown.
type winJob struct {
	handle windows.Handle
}

func attachSidecarJob(p *os.Process) sidecarJob {
	if p == nil {
		return nil
	}
	h, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(
		h,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		_ = windows.CloseHandle(h)
		return nil
	}
	proc, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(p.Pid),
	)
	if err != nil {
		_ = windows.CloseHandle(h)
		return nil
	}
	err = windows.AssignProcessToJobObject(h, proc)
	_ = windows.CloseHandle(proc)
	if err != nil {
		_ = windows.CloseHandle(h)
		return nil
	}
	return &winJob{handle: h}
}

func (j *winJob) killAndClose() {
	if j == nil || j.handle == 0 {
		return
	}
	_ = windows.TerminateJobObject(j.handle, 1)
	_ = windows.CloseHandle(j.handle)
	j.handle = 0
}

// killProcessTree mata o pid e os descendentes (shell, git, workers).
func killProcessTree(pid int) {
	if pid <= 0 {
		return
	}
	cmd := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
	hideConsole(cmd)
	_ = cmd.Run()
}
