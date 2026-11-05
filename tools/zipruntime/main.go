// Command zipruntime packs a staged dsh-runtime directory into the zip the
// sidecar embeds. Entries are sorted, use forward slashes and a fixed
// modification time, so re-staging identical files yields an identical zip
// (and the sidecar's content stamp reuses the extracted runtime).
//
//	go run ./tools/zipruntime -src dsh-runtime -dst internal/sidecar/assets/dsh-runtime.zip
package main

import (
	"archive/zip"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"
)

var fixedTime = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

func main() {
	src := flag.String("src", "dsh-runtime", "staged runtime directory")
	dst := flag.String("dst", filepath.Join("internal", "sidecar", "assets", "dsh-runtime.zip"), "output zip")
	flag.Parse()
	if err := pack(*src, *dst); err != nil {
		fmt.Fprintln(os.Stderr, "zipruntime:", err)
		os.Exit(1)
	}
}

func pack(src, dst string) error {
	var files []string
	err := filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&fs.ModeSymlink != 0 {
			return fmt.Errorf("%s is a symlink; the staged runtime must hold real files", path)
		}
		if !d.IsDir() {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return err
	}
	sort.Strings(files)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(out)
	for _, path := range files {
		if err := addFile(zw, src, path); err != nil {
			_ = zw.Close()
			_ = out.Close()
			_ = os.Remove(tmp)
			return err
		}
	}
	if err := zw.Close(); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	fmt.Printf("zipruntime: %d files -> %s\n", len(files), dst)
	return os.Rename(tmp, dst)
}

func addFile(zw *zip.Writer, root, path string) error {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = filepath.ToSlash(rel)
	header.Method = zip.Deflate
	header.Modified = fixedTime
	w, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(w, f)
	return err
}
