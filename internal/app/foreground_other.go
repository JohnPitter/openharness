//go:build !windows

package app

func windowIsForeground() bool {
	return true
}
