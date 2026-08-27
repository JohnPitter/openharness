//go:build windows

package app

import (
	"os"
	"testing"
)

func TestPidBelongsToUsSelf(t *testing.T) {
	if !pidBelongsToUs(uint32(os.Getpid())) {
		t.Fatal("this process must belong to itself")
	}
	if pidBelongsToUs(0) {
		t.Fatal("pid 0 is not this process")
	}
}

func TestWindowIsForegroundDoesNotPanic(t *testing.T) {
	_ = windowIsForeground()
}

func TestPlayTaskSoundDoesNotPanic(t *testing.T) {
	playTaskSound()
}

func TestNotifyTaskCompleteWithoutCtx(t *testing.T) {
	a := &App{}
	a.NotifyTaskComplete("teste")
}
