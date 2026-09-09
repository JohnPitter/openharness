package sidecar

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSidecarEnvPrependsBinAndDropsPathDupes(t *testing.T) {
	bin := filepath.FromSlash("C:/extracted/dsh-runtime/node_modules/.bin")
	got := sidecarEnv([]string{
		"PATHEXT=.COM;.EXE;.BAT;.CMD",
		"Path=C:\\Windows\\System32",
		"USERNAME=joao",
		"PATH=C:\\Windows",
		"DSH_HOME=C:\\dsh",
	}, bin)

	var pathVal string
	pathCount := 0
	hasPathLower := false
	hasPathext := false
	hasUser := false
	hasHome := false
	for _, kv := range got {
		key, val, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		switch {
		case key == "PATH":
			pathCount++
			pathVal = val
		case key == "Path":
			hasPathLower = true
		case key == "PATHEXT":
			hasPathext = true
		case key == "USERNAME":
			hasUser = true
		case key == "DSH_HOME":
			hasHome = true
		}
	}
	if pathCount != 1 {
		t.Fatalf("want exactly one PATH=, got %d in %v", pathCount, got)
	}
	if hasPathLower {
		t.Fatalf("left a Path= entry: %v", got)
	}
	if !hasPathext {
		t.Fatal("dropped PATHEXT")
	}
	if !hasUser || !hasHome {
		t.Fatalf("dropped unrelated env: %v", got)
	}
	wantPrefix := bin + string(os.PathListSeparator)
	if !strings.HasPrefix(pathVal, wantPrefix) {
		t.Fatalf("PATH=%q does not start with %q", pathVal, wantPrefix)
	}
	if !strings.Contains(pathVal, `C:\Windows\System32`) {
		t.Fatalf("PATH lost the first original value: %q", pathVal)
	}
}

func TestSidecarEnvEmptyOldPath(t *testing.T) {
	got := sidecarEnv([]string{"FOO=1"}, `C:\runtime\dsh-runtime\node_modules\.bin`)
	found := false
	for _, kv := range got {
		if kv == `PATH=C:\runtime\dsh-runtime\node_modules\.bin` {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("want PATH=binDir alone, got %v", got)
	}
}

func TestIsPathEnvKeyIgnoresPathext(t *testing.T) {
	if isPathEnvKey("PATHEXT") {
		t.Fatal("PATHEXT must not be treated as PATH")
	}
	if !isPathEnvKey("PATH") {
		t.Fatal("PATH must match")
	}
	if runtime.GOOS == "windows" {
		if !isPathEnvKey("Path") {
			t.Fatal("Path must match on Windows")
		}
		return
	}
	if isPathEnvKey("Path") {
		t.Fatal("Path must not match on Unix")
	}
}
