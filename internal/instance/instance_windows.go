//go:build windows

package instance

import "golang.org/x/sys/windows"

const mutexName = "Local\\OpenHarness"

var held windows.Handle

func acquire() bool {
	name, err := windows.UTF16PtrFromString(mutexName)
	if err != nil {
		return true
	}
	h, err := windows.CreateMutex(nil, false, name)
	if err == windows.ERROR_ALREADY_EXISTS {
		if h != 0 {
			_ = windows.CloseHandle(h)
		}
		notifyRunning()
		return false
	}
	if err != nil {
		return true
	}
	held = h
	return true
}

func notifyRunning() {
	caption, _ := windows.UTF16PtrFromString("OpenHarness")
	text, _ := windows.UTF16PtrFromString("O OpenHarness já está em execução.")
	_, _ = windows.MessageBox(0, text, caption, windows.MB_OK|windows.MB_ICONINFORMATION)
}
