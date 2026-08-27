//go:build windows

package app

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                       = windows.NewLazySystemDLL("user32.dll")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
)

func windowIsForeground() bool {
	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd == 0 {
		return false
	}
	var pid uint32
	_, _, _ = procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	return pidBelongsToUs(pid)
}

// pidBelongsToUs is true when pid is this process or a descendant (WebView2
// renderer, GPU, etc.). Comparing only os.Getpid() is always false while the
// user is in the iframe: the foreground HWND belongs to msedgewebview2.exe.
func pidBelongsToUs(pid uint32) bool {
	me := uint32(os.Getpid())
	if pid == 0 {
		return false
	}
	if pid == me {
		return true
	}
	parents := processParents()
	seen := map[uint32]struct{}{}
	for i := 0; i < 16 && pid != 0; i++ {
		if pid == me {
			return true
		}
		if _, dup := seen[pid]; dup {
			return false
		}
		seen[pid] = struct{}{}
		parent, ok := parents[pid]
		if !ok || parent == 0 || parent == pid {
			return false
		}
		pid = parent
	}
	return pid == me
}

func processParents() map[uint32]uint32 {
	out := make(map[uint32]uint32)
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return out
	}
	defer func() { _ = windows.CloseHandle(snap) }()
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return out
	}
	for {
		out[entry.ProcessID] = entry.ParentProcessID
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
		}
	}
	return out
}
