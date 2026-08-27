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

// taskSoundFiles maps preference ids to Windows\Media wav basenames.
// Keep in sync with deepseek-harness ui-conversation desktop-sound-settings.
var taskSoundFiles = map[string]string{
	"notify":           "Windows Notify.wav",
	"notify-email":     "Windows Notify Email.wav",
	"notify-messaging": "Windows Notify Messaging.wav",
	"notify-calendar":  "Windows Notify Calendar.wav",
	"ding":             "Windows Ding.wav",
	"chimes":           "chimes.wav",
	"chord":            "chord.wav",
	"tada":             "tada.wav",
	"nudge":            "Windows Message Nudge.wav",
	"default":          "Windows Default.wav",
	"print":            "Windows Print complete.wav",
	"generic":          "Windows Notify System Generic.wav",
}

// DefaultTaskCompleteSound is used when the iframe omits or sends an unknown id.
const DefaultTaskCompleteSound = "notify-email"

func playTaskSound(id string) {
	if id == "silent" {
		return
	}
	if id == "" {
		id = DefaultTaskCompleteSound
	}
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	media := filepath.Join(root, "Media")
	if file, ok := taskSoundFiles[id]; ok {
		if playSoundPath(filepath.Join(media, file)) {
			return
		}
	}
	// Fall through to a short curated list, then aliases.
	for _, name := range []string{
		taskSoundFiles[DefaultTaskCompleteSound],
		"Windows Notify.wav",
		"Notify.wav",
	} {
		if name == "" {
			continue
		}
		if playSoundPath(filepath.Join(media, name)) {
			return
		}
	}
	if playSoundAlias("Notification.Default", sndAlias|sndSystem|sndAsync) {
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
