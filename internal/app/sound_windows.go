//go:build windows

package app

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	winmm           = windows.NewLazySystemDLL("winmm.dll")
	procPlaySoundW  = winmm.NewProc("PlaySoundW")
	procMessageBeep = user32.NewProc("MessageBeep")
)

const (
	sndAsync       = 0x0001
	sndNoDefault   = 0x0002
	sndAlias       = 0x00010000
	mbIconAsterisk = 0x00000040
)

func playTaskSound() {
	alias, err := windows.UTF16PtrFromString("Notification.Default")
	if err == nil {
		r, _, _ := procPlaySoundW.Call(uintptr(unsafe.Pointer(alias)), 0, sndAlias|sndAsync|sndNoDefault)
		if r != 0 {
			return
		}
	}
	alias, err = windows.UTF16PtrFromString("SystemAsterisk")
	if err == nil {
		r, _, _ := procPlaySoundW.Call(uintptr(unsafe.Pointer(alias)), 0, sndAlias|sndAsync|sndNoDefault)
		if r != 0 {
			return
		}
	}
	_, _, _ = procMessageBeep.Call(mbIconAsterisk)
}
