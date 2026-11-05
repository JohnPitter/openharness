package sidecar

import (
	"strings"
	"testing"
)

func TestTailBufferKeepsOnlyTheLastBytes(t *testing.T) {
	tb := newTailBuffer(8)
	_, _ = tb.Write([]byte("hello "))
	_, _ = tb.Write([]byte("world!"))
	if got := tb.String(); got != "o world!" {
		t.Fatalf("tail = %q", got)
	}
	_, _ = tb.Write([]byte(strings.Repeat("x", 100)))
	if got := tb.String(); got != strings.Repeat("x", 8) {
		t.Fatalf("tail after overflow = %q", got)
	}
}
