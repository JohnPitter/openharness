package sidecar

import "testing"

func TestStopWithoutStartIsIdempotent(t *testing.T) {
	m := &Manager{Root: t.TempDir()}
	m.Stop()
	m.Stop()
	if !m.stopped {
		t.Fatal("Stop não marcou stopped")
	}
	if _, err := m.Start(t.Context()); err == nil {
		t.Fatal("Start após Stop deveria recusar")
	}
}
