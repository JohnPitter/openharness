package sidecar

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func zipWith(t *testing.T, files map[string][]byte, mod time.Time) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, body := range files {
		hdr := &zip.FileHeader{Name: name, Method: zip.Deflate}
		hdr.SetModTime(mod)
		fw, err := w.CreateHeader(hdr)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fw.Write(body); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestContentStampStableAcrossRezip(t *testing.T) {
	files := map[string][]byte{
		"lib/bin.js": []byte("console.log('ok')"),
		"a.txt":      []byte("hello"),
	}
	node := []byte("fake-node")
	a, err := contentStamp(node, zipWith(t, files, time.Unix(1_700_000_000, 0)))
	if err != nil {
		t.Fatal(err)
	}
	b, err := contentStamp(node, zipWith(t, files, time.Unix(1_800_000_000, 0)))
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatalf("rezip with new timestamps changed stamp:\n%s\n%s", a, b)
	}
	c, err := contentStamp(node, zipWith(t, map[string][]byte{
		"lib/bin.js": []byte("console.log('changed')"),
		"a.txt":      []byte("hello"),
	}, time.Unix(1_700_000_000, 0)))
	if err != nil {
		t.Fatal(err)
	}
	if a == c {
		t.Fatal("changed zip contents kept the same stamp")
	}
	d, err := contentStamp([]byte("other-node"), zipWith(t, files, time.Unix(1_700_000_000, 0)))
	if err != nil {
		t.Fatal(err)
	}
	if a == d {
		t.Fatal("changed node.exe kept the same stamp")
	}
}

func TestRuntimeReady(t *testing.T) {
	dir := t.TempDir()
	if runtimeReady(dir, "abc") {
		t.Fatal("empty dir reported ready")
	}
	if err := os.WriteFile(filepath.Join(dir, stampFile), []byte("abc\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if runtimeReady(dir, "abc") {
		t.Fatal("stamp-only dir reported ready")
	}
	if err := os.WriteFile(filepath.Join(dir, "node.exe"), []byte("n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "dsh-runtime", "lib"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "dsh-runtime", "lib", "bin.js"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !runtimeReady(dir, "abc") {
		t.Fatal("complete extraction not ready")
	}
	if runtimeReady(dir, "other") {
		t.Fatal("mismatched stamp reported ready")
	}
}

func TestUnzipRuntimeStripsPrefix(t *testing.T) {
	data := zipWith(t, map[string][]byte{
		"dsh-runtime/lib/bin.js":     []byte("ok"),
		"dsh-runtime/package.json":   []byte(`{"name":"dsh"}`),
		"dsh-runtime/node_modules/x": []byte("m"),
	}, time.Unix(1, 0))
	if !zipHasPrefix(data, "dsh-runtime/") {
		t.Fatal("expected zip prefix")
	}
	dir := t.TempDir()
	if err := unzipRuntime(data, dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "dsh-runtime", "lib", "bin.js")); err != nil {
		t.Fatalf("expected flat layout: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "dsh-runtime", "dsh-runtime", "lib", "bin.js")); err == nil {
		t.Fatal("still nested after unzip")
	}
}

func TestUnzipRuntimeWithoutPrefix(t *testing.T) {
	data := zipWith(t, map[string][]byte{
		"lib/bin.js":   []byte("ok"),
		"package.json": []byte(`{}`),
	}, time.Unix(1, 0))
	dir := t.TempDir()
	if err := unzipRuntime(data, dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "dsh-runtime", "lib", "bin.js")); err != nil {
		t.Fatal(err)
	}
}

func TestFlattenNestedRuntime(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "dsh-runtime", "dsh-runtime", "lib")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "bin.js"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := flattenNestedRuntime(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "dsh-runtime", "lib", "bin.js")); err != nil {
		t.Fatal(err)
	}
}

func TestUrlFromLine(t *testing.T) {
	u, ok := urlFromLine("dsh web: http://127.0.0.1:4123 (LAN: http://10.0.0.2:4123)")
	if !ok || u != "http://127.0.0.1:4123" {
		t.Fatalf("got %q ok=%v", u, ok)
	}
	if _, ok := urlFromLine("listening"); ok {
		t.Fatal("expected no url")
	}
}

func TestZipEntryUnchangedSkipsRewrite(t *testing.T) {
	data := zipWith(t, map[string][]byte{
		"dsh-runtime/lib/bin.js":   []byte("ok"),
		"dsh-runtime/package.json": []byte(`{"name":"dsh"}`),
	}, time.Unix(1, 0))
	dir := t.TempDir()
	if err := unzipRuntime(data, dir); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(dir, "dsh-runtime", "lib", "bin.js")
	before, err := os.Stat(bin)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(15 * time.Millisecond)
	if err := unzipRuntime(data, dir); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(bin)
	if err != nil {
		t.Fatal(err)
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatal("matching CRC file was rewritten")
	}
}

func TestUnzipRuntimeOverlaysChangedFile(t *testing.T) {
	dir := t.TempDir()
	if err := unzipRuntime(zipWith(t, map[string][]byte{
		"dsh-runtime/lib/bin.js":   []byte("old"),
		"dsh-runtime/package.json": []byte(`{}`),
	}, time.Unix(1, 0)), dir); err != nil {
		t.Fatal(err)
	}
	if err := unzipRuntime(zipWith(t, map[string][]byte{
		"dsh-runtime/lib/bin.js":   []byte("new-body"),
		"dsh-runtime/package.json": []byte(`{}`),
	}, time.Unix(2, 0)), dir); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dir, "dsh-runtime", "lib", "bin.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new-body" {
		t.Fatalf("got %q", got)
	}
}

func TestWriteFileIfUnchanged(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "node.exe")
	body := []byte("node-bytes")
	if err := writeFileIfUnchanged(path, body, 0o755); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(15 * time.Millisecond)
	if err := writeFileIfUnchanged(path, body, 0o755); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatal("identical node.exe was rewritten")
	}
	if err := writeFileIfUnchanged(path, []byte("other-node"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "other-node" {
		t.Fatalf("got %q", got)
	}
}

func TestShortStamp(t *testing.T) {
	if got := shortStamp("abcdefghijklmnop"); got != "abcdefghijkl" {
		t.Fatalf("got %q", got)
	}
	if got := shortStamp("abc"); got != "abc" {
		t.Fatalf("got %q", got)
	}
}

func TestOnDiskMatchesEmbed(t *testing.T) {
	files := map[string][]byte{
		"dsh-runtime/lib/bin.js":   []byte("bin-body"),
		"dsh-runtime/package.json": []byte(`{"name":"dsh"}`),
	}
	z := zipWith(t, files, time.Unix(1, 0))
	node := []byte("node-bytes")
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "node.exe"), node, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := unzipRuntime(z, dir); err != nil {
		t.Fatal(err)
	}
	if !onDiskMatchesEmbed(dir, z, node) {
		t.Fatal("complete extract should match zip")
	}
	if onDiskMatchesEmbed(dir, z, []byte("other-node-bytes!!")) {
		t.Fatal("node size mismatch should not match")
	}
}
