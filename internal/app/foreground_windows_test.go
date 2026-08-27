//go:build windows

package app

import "testing"

func TestWindowIsForegroundDoesNotPanic(t *testing.T) {
	_ = windowIsForeground()
}
