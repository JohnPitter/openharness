//go:build windows

package app

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows/registry"
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

func TestFixToastDisplayNameSetsOpenHarness(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	appID := filepath.Base(exe)
	keyPath := `Software\Classes\AppUserModelId\` + appID
	key, _, err := registry.CreateKey(registry.CURRENT_USER, keyPath, registry.ALL_ACCESS)
	if err != nil {
		t.Fatal(err)
	}
	if err := key.SetStringValue("DisplayName", appID); err != nil {
		key.Close()
		t.Fatal(err)
	}
	key.Close()
	t.Cleanup(func() {
		_ = registry.DeleteKey(registry.CURRENT_USER, keyPath)
	})

	fixToastDisplayName()

	key, err = registry.OpenKey(registry.CURRENT_USER, keyPath, registry.QUERY_VALUE)
	if err != nil {
		t.Fatal(err)
	}
	defer key.Close()
	got, _, err := key.GetStringValue("DisplayName")
	if err != nil {
		t.Fatal(err)
	}
	if got != toastDisplayName {
		t.Fatalf("DisplayName = %q, want %q", got, toastDisplayName)
	}
}

func TestNotifyTaskCompleteWithoutCtx(t *testing.T) {
	a := &App{}
	a.NotifyTaskComplete("teste")
}
