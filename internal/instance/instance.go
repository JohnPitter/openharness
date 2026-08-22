package instance

// Acquire takes the single-instance lock. False means another OpenHarness
// is already running; the caller should exit without creating WebView2.
func Acquire() bool {
	return acquire()
}
