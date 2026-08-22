//go:build !windows

package update

func startRelaunch(_ string) error { return nil }

func waitForPID(_ int) {}
