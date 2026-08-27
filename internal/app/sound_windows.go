//go:build windows

package app

import (
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	winmm           = windows.NewLazySystemDLL("winmm.dll")
	procPlaySoundW  = winmm.NewProc("PlaySoundW")
	procMessageBeep = user32.NewProc("MessageBeep")
)

const (
	sndAsync     = 0x0001
	sndNoDefault = 0x0002
	sndAlias     = 0x00010000
	sndFilename  = 0x00020000
	sndSystem    = 0x00200000

	mbIconAsterisk = 0x00000040
)

// Built-in Windows Media chimes preferred over PlaySound aliases: user sound
// schemes often mute or remap Notification.* while these WAVs still play.
var taskSoundWavs = []string{
	"Windows Notify System Generic.wav",
	"Windows Notify.wav",
	"Notify.wav",
}

func playTaskSound() {
	media := filepath.Join(os.Getenv("SystemRoot"), "Media")
	if media == filepath.Join("", "Media") {
		media = filepath.Join(`C:\Windows`, "Media")
	}
	for _, name := range taskSoundWavs {
		if playSoundPath(filepath.Join(media, name)) {
			return
		}
	}
	// SND_SYSTEM targets the Windows notification/system bus; drop
	// SND_NODEFAULT so a missing alias still falls through cleanly.
	if playSoundAlias("Notification.Default", sndAlias|sndSystem|sndAsync) {
		return
	}
	if playSoundAlias("SystemNotification", sndAlias|sndAsync) {
		return
	}
	if playSoundAlias("SystemAsterisk", sndAlias|sndAsync) {
		return
	}
	_, _, _ = procMessageBeep.Call(mbIconAsterisk)
}

func playSoundPath(path string) bool {
	if _, err := os.Stat(path); err != nil {
		return false
	}
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return false
	}
	r, _, _ := procPlaySoundW.Call(uintptr(unsafe.Pointer(ptr)), 0, sndFilename|sndAsync|sndNoDefault)
	return r != 0
}

func playSoundAlias(name string, flags uintptr) bool {
	ptr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return false
	}
	r, _, _ := procPlaySoundW.Call(uintptr(unsafe.Pointer(ptr)), 0, flags)
	return r != 0
}
