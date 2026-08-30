package sidecar

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

// trailingComma matches a comma immediately before a closing object or array.
// Node rejects that JSON (ERR_INVALID_PACKAGE_CONFIG) even though some
// staging tools leave it behind after stripping a trailing key such as
// devDependencies.
var trailingComma = regexp.MustCompile(`,(\s*[}\]])`)

func stripJSONTrailingCommas(s string) string {
	for {
		n := trailingComma.ReplaceAllString(s, "$1")
		if n == s {
			return n
		}
		s = n
	}
}

// sanitizeRuntimeManifest rewrites dsh-runtime/package.json when it is not
// valid JSON but becomes valid after dropping trailing commas. A tree that
// already parses is left untouched so a matching stamp stays a fast path.
func sanitizeRuntimeManifest(runtimeDir string) error {
	path := filepath.Join(runtimeDir, "dsh-runtime", "package.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("runtime package.json: %w", err)
	}
	if json.Valid(raw) {
		return nil
	}
	fixed := []byte(stripJSONTrailingCommas(string(raw)))
	if !json.Valid(fixed) {
		return fmt.Errorf("runtime package.json inválido em %s", path)
	}
	if err := os.WriteFile(path, fixed, 0o644); err != nil {
		return fmt.Errorf("corrigir runtime package.json: %w", err)
	}
	return nil
}
