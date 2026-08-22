//go:build windows

package sidecar

import (
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// winJob agrupa o sidecar e os descendentes. KILL_ON_JOB_CLOSE faz a árvore
// morrer quando o handle fecha — inclusive se o exe cair sem OnShutdown.
type winJob struct {
	handle windows.Handle
}

// prepareSidecarCmd nasce suspenso e fora do job do Wails/WebView2, para o
// AssignProcessToJobObject acontecer antes de qualquer fork do Node.
func prepareSidecarCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NO_WINDOW | windows.CREATE_SUSPENDED | windows.CREATE_BREAKAWAY_FROM_JOB,
	}
}

func resumeSidecar(p *os.Process) {
	if p == nil {
		return
	}
	resumeProcessThreads(uint32(p.Pid))
}

func attachSidecarJob(p *os.Process) sidecarJob {
	if p == nil {
		return nil
	}
	h, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		slog.Warn("sidecar: CreateJobObject", "err", err)
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
		slog.Warn("sidecar: SetInformationJobObject", "err", err)
		_ = windows.CloseHandle(h)
		return nil
	}
	proc, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(p.Pid),
	)
	if err != nil {
		slog.Warn("sidecar: OpenProcess para job", "pid", p.Pid, "err", err)
		_ = windows.CloseHandle(h)
		return nil
	}
	err = windows.AssignProcessToJobObject(h, proc)
	_ = windows.CloseHandle(proc)
	if err != nil {
		slog.Warn("sidecar: AssignProcessToJobObject", "pid", p.Pid, "err", err)
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

func resumeProcessThreads(pid uint32) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
	if err != nil {
		return
	}
	defer windows.CloseHandle(snap)
	var te windows.ThreadEntry32
	te.Size = uint32(unsafe.Sizeof(te))
	for err := windows.Thread32First(snap, &te); err == nil; err = windows.Thread32Next(snap, &te) {
		if te.OwnerProcessID != pid {
			continue
		}
		th, err := windows.OpenThread(windows.THREAD_SUSPEND_RESUME, false, te.ThreadID)
		if err != nil {
			continue
		}
		_, _ = windows.ResumeThread(th)
		_ = windows.CloseHandle(th)
	}
}

func terminatePID(pid uint32) {
	if pid == 0 || pid == 4 || pid == uint32(os.Getpid()) {
		return
	}
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, pid)
	if err != nil {
		return
	}
	_ = windows.TerminateProcess(h, 1)
	_ = windows.CloseHandle(h)
}

func processParents() map[uint32]uint32 {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	out := make(map[uint32]uint32)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	for err := windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		out[pe.ProcessID] = pe.ParentProcessID
	}
	return out
}

func descendantsOf(root uint32) []uint32 {
	parentOf := processParents()
	if len(parentOf) == 0 {
		return nil
	}
	children := make(map[uint32][]uint32)
	for pid, parent := range parentOf {
		if pid == 0 || pid == parent {
			continue
		}
		children[parent] = append(children[parent], pid)
	}
	var out []uint32
	var walk func(uint32)
	walk = func(pid uint32) {
		for _, child := range children[pid] {
			out = append(out, child)
			walk(child)
		}
	}
	walk(root)
	return out
}

// killProcessTree mata o pid e os descendentes (shell, git, workers).
func killProcessTree(pid int) {
	if pid <= 0 {
		return
	}
	root := uint32(pid)
	for _, child := range descendantsOf(root) {
		terminatePID(child)
	}
	terminatePID(root)
}

func processImagePath(pid uint32) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, 32768)
	n := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &n); err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:n])
}

func pathUnderRoot(path, root string) bool {
	if path == "" || root == "" {
		return false
	}
	p := strings.ToLower(filepath.Clean(path))
	r := strings.ToLower(filepath.Clean(root))
	if p == r {
		return true
	}
	if !strings.HasSuffix(r, string(os.PathSeparator)) {
		r += string(os.PathSeparator)
	}
	return strings.HasPrefix(p, r)
}

// killSidecarNodes encerra qualquer processo cujo executável vive sob Root
// (node.exe do runtime e helpers extraídos). Sem isso o overlay/unlink do
// libvips falha com Access is denied, e o fechar da janela deixa órfãos.
func killSidecarNodes(root string) {
	if root == "" {
		return
	}
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return
	}
	defer windows.CloseHandle(snap)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	for err := windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		if pathUnderRoot(processImagePath(pe.ProcessID), root) {
			terminatePID(pe.ProcessID)
		}
	}
}
