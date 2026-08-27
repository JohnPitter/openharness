//go:build !windows

package app

// DefaultTaskCompleteSound matches the Windows default preference id.
const DefaultTaskCompleteSound = "notify-email"

func playTaskSound(id string) {}
