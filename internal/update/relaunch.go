package update

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// waitPIDEnv tells the replacement exe to wait for this pid before creating
// WebView2, so the old process can release the user-data folder.
const waitPIDEnv = "OPENHARNESS_WAIT_PID"

func pidFromEnv() int {
	n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(waitPIDEnv)))
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

var afterParent = 750 * time.Millisecond

// AwaitPrevious blocks until the previous exe (auto-update) has exited and
// WebView2 has had a moment to drop the profile lock.
func AwaitPrevious() {
	pid := pidFromEnv()
	_ = os.Unsetenv(waitPIDEnv)
	if pid == 0 {
		return
	}
	waitForPID(pid)
	time.Sleep(afterParent)
}
