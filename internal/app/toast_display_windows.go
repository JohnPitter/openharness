//go:build windows

package app

import (
	"log/slog"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

// toastDisplayName is what Action Center shows above the toast. Wails registers
// the AppUserModelId as the exe basename (openharness.exe); without an explicit
// DisplayName override Windows surfaces that basename, extension included.
const toastDisplayName = "OpenHarness"

// fixToastDisplayName overwrites the AUMID DisplayName Wails/go-toast stamped
// with the exe basename. go-toast itself skips writing when the value already
// exists, so a one-shot SetStringValue after InitializeNotifications is required.
func fixToastDisplayName() {
	exe, err := os.Executable()
	if err != nil {
		slog.Warn("toast display name", "err", err)
		return
	}
	appID := filepath.Base(exe)
	key, err := registry.OpenKey(
		registry.CURRENT_USER,
		`Software\Classes\AppUserModelId\`+appID,
		registry.SET_VALUE,
	)
	if err != nil {
		slog.Warn("toast display name: open AUMID", "appID", appID, "err", err)
		return
	}
	defer key.Close()
	if err := key.SetStringValue("DisplayName", toastDisplayName); err != nil {
		slog.Warn("toast display name: set", "err", err)
	}
}
