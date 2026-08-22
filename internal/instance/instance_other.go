//go:build !windows

package instance

func acquire() bool { return true }
