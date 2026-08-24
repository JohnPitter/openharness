// Package sidecar extrai o runtime embutido do DeepSeek Harness (node.exe +
// árvore node_modules buildada) e o executa como processo local (`dsh web`),
// expondo a URL HTTP local para o shell Wails.
package sidecar

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// stampFile marks a complete extraction so a later launch can skip unzip.
const (
	stampFile    = ".openharness-stamp"
	stampVersion = "v2:"
)

// sidecarJob é a cerca de processo do sidecar (job object no Windows, pgid no POSIX).
type sidecarJob interface {
	killAndClose()
}

// Manager gerencia a extração e o processo do harness.
type Manager struct {
	Root    string // %LOCALAPPDATA%\openharness
	cmd     *exec.Cmd
	job     sidecarJob
	mu      sync.Mutex
	stopped bool
	URL     string
	Phase   atomic.Value // string: "extracting" | "starting" | ""
}

func NewManager() (*Manager, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	return &Manager{Root: filepath.Join(base, "openharness")}, nil
}

// ensureExtracted coloca node.exe + o zip em Root/runtime, reusando a pasta
// quando o conteúdo embutido (CRC dos arquivos + node.exe) é o mesmo. Rezipar
// o runtime sem mudar arquivos não força extração de novo; só uma árvore
// diferente ou um node.exe novo substitui o cache.
//
// Substituição nunca começa com RemoveAll da árvore viva: no Windows o
// libvips/sharp fica mapeado no node.exe antigo e o unlink falha com
// Access is denied. Overlay ignora arquivos cujo CRC já bate; se mesmo
// assim a escrita falhar, extrai para um sibling runtime-<stamp>.
func (m *Manager) ensureExtracted() (string, error) {
	stamp, err := contentStamp(nodeExe, runtimeZip)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(m.Root, "runtime")
	if m.adoptRuntime(dir, stamp) {
		m.pruneStaleRuntimes(dir)
		return dir, nil
	}
	if alt, ok := m.adoptHashedRuntime(stamp); ok {
		m.pruneStaleRuntimes(alt)
		return alt, nil
	}
	killSidecarNodes(m.Root)
	if err := m.installRuntime(dir, stamp); err == nil {
		m.pruneStaleRuntimes(dir)
		return dir, nil
	}
	alt := filepath.Join(m.Root, "runtime-"+shortStamp(stamp))
	if err := m.installRuntime(alt, stamp); err != nil {
		return "", err
	}
	m.pruneStaleRuntimes(alt)
	return alt, nil
}

func shortStamp(stamp string) string {
	if len(stamp) > 12 {
		return stamp[:12]
	}
	return stamp
}

func (m *Manager) installRuntime(dir, stamp string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	m.Phase.Store("extracting")
	defer m.Phase.Store("starting")
	if err := writeFileIfUnchanged(filepath.Join(dir, "node.exe"), nodeExe, 0o755); err != nil {
		return err
	}
	if err := unzipRuntime(runtimeZip, dir); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, stampFile), []byte(stampVersion+stamp+"\n"), 0o644); err != nil {
		return err
	}
	if !runtimeReady(dir, stamp) {
		return fmt.Errorf("runtime incompleto em %s", dir)
	}
	return nil
}

func writeFileIfUnchanged(path string, body []byte, mode os.FileMode) error {
	if fi, err := os.Stat(path); err == nil && fi.Size() == int64(len(body)) {
		got, err := fileCRC(path)
		if err == nil && got == crc32.ChecksumIEEE(body) {
			return nil
		}
	}
	return os.WriteFile(path, body, mode)
}

func (m *Manager) adoptRuntime(dir, stamp string) bool {
	_ = flattenNestedRuntime(dir)
	if runtimeReady(dir, stamp) {
		return true
	}
	return m.installRuntime(dir, stamp) == nil
}

func (m *Manager) adoptHashedRuntime(stamp string) (string, bool) {
	entries, err := os.ReadDir(m.Root)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), "runtime-") {
			continue
		}
		cand := filepath.Join(m.Root, e.Name())
		_ = flattenNestedRuntime(cand)
		if runtimeReady(cand, stamp) {
			return cand, true
		}
		if err := m.installRuntime(cand, stamp); err == nil {
			return cand, true
		}
	}
	return "", false
}

func runtimeReady(dir, stamp string) bool {
	got, err := os.ReadFile(filepath.Join(dir, stampFile))
	if err != nil {
		return false
	}
	if strings.TrimSpace(string(got)) != stampVersion+stamp {
		return false
	}
	if _, err := os.Stat(filepath.Join(dir, "node.exe")); err != nil {
		return false
	}
	if _, err := os.Stat(filepath.Join(dir, "dsh-runtime", "lib", "bin.js")); err != nil {
		return false
	}
	return true
}

func fileCRC(path string) (uint32, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	h := crc32.NewIEEE()
	if _, err := io.Copy(h, f); err != nil {
		return 0, err
	}
	return h.Sum32(), nil
}

// flattenNestedRuntime corrige zip extraído para dest/dsh-runtime quando o
// arquivo já vinha com o prefixo dsh-runtime/ (ficava dsh-runtime/dsh-runtime).
func flattenNestedRuntime(dir string) error {
	good := filepath.Join(dir, "dsh-runtime", "lib", "bin.js")
	if _, err := os.Stat(good); err == nil {
		return nil
	}
	nested := filepath.Join(dir, "dsh-runtime", "dsh-runtime")
	if _, err := os.Stat(filepath.Join(nested, "lib", "bin.js")); err != nil {
		return err
	}
	tmp := filepath.Join(dir, ".dsh-runtime-flat")
	_ = os.RemoveAll(tmp)
	if err := os.Rename(nested, tmp); err != nil {
		return err
	}
	if err := os.RemoveAll(filepath.Join(dir, "dsh-runtime")); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, "dsh-runtime"))
}

func zipHasPrefix(zipBytes []byte, prefix string) bool {
	r, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return false
	}
	prefix = strings.ReplaceAll(prefix, "\\", "/")
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	saw := false
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := strings.ReplaceAll(f.Name, "\\", "/")
		if !strings.HasPrefix(name, prefix) {
			return false
		}
		saw = true
	}
	return saw
}

func unzipRuntime(zipBytes []byte, dir string) error {
	dest := filepath.Join(dir, "dsh-runtime")
	if zipHasPrefix(zipBytes, "dsh-runtime/") {
		dest = dir
	}
	return unzip(zipBytes, dest)
}

// contentStamp is stable across re-zips of the same files: it hashes node.exe
// and each zip entry's name, CRC-32, and uncompressed size — not the zip bytes.
func contentStamp(node, zipBytes []byte) (string, error) {
	r, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return "", err
	}
	type row struct {
		name string
		crc  uint32
		size uint64
	}
	rows := make([]row, 0, len(r.File))
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rows = append(rows, row{name: f.Name, crc: f.CRC32, size: f.UncompressedSize64})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].name < rows[j].name })
	h := sha1.New()
	nodeSum := sha1.Sum(node)
	fmt.Fprintf(h, "node %x\n", nodeSum[:])
	for _, row := range rows {
		fmt.Fprintf(h, "%s %08x %d\n", row.name, row.crc, row.size)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// pruneStaleRuntimes remove pastas runtime-<hash> que não são a árvore ativa.
func (m *Manager) pruneStaleRuntimes(keep string) {
	entries, err := os.ReadDir(m.Root)
	if err != nil {
		return
	}
	keep, _ = filepath.Abs(keep)
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), "runtime-") {
			continue
		}
		cand := filepath.Join(m.Root, e.Name())
		abs, err := filepath.Abs(cand)
		if err == nil && abs == keep {
			continue
		}
		_ = os.RemoveAll(cand)
	}
}

func unzip(data []byte, dest string) error {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(filepath.Join(dest, f.Name), 0o755); err != nil {
				return err
			}
		}
	}
	// Extração paralela: milhares de arquivos pequenos são gargalo de I/O no
	// Windows (Defender verifica cada arquivo criado).
	tasks := make(chan *zip.File)
	errCh := make(chan error, 1)
	var wg sync.WaitGroup
	for range min(runtime.NumCPU(), 8) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for f := range tasks {
				if err := extractFile(f, dest); err != nil {
					select {
					case errCh <- err:
					default:
					}
				}
			}
		}()
	}
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		select {
		case err := <-errCh:
			close(tasks)
			wg.Wait()
			return err
		case tasks <- f:
		}
	}
	close(tasks)
	wg.Wait()
	select {
	case err := <-errCh:
		return err
	default:
		return nil
	}
}

func extractFile(f *zip.File, dest string) error {
	p := filepath.Join(dest, f.Name)
	if !strings.HasPrefix(p, filepath.Clean(dest)+string(os.PathSeparator)) {
		return nil // traversal guard
	}
	if zipEntryUnchanged(p, f) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	_, cpyErr := io.Copy(out, rc)
	if err := out.Close(); err != nil {
		return err
	}
	return cpyErr
}

func zipEntryUnchanged(path string, f *zip.File) bool {
	fi, err := os.Stat(path)
	if err != nil || uint64(fi.Size()) != f.UncompressedSize64 {
		return false
	}
	got, err := fileCRC(path)
	return err == nil && got == f.CRC32
}

func urlFromLine(line string) (string, bool) {
	i := strings.Index(line, "http://127.0.0.1:")
	if i < 0 {
		return "", false
	}
	rest := strings.TrimSpace(line[i:])
	u, _, _ := strings.Cut(rest, " ")
	return u, strings.HasPrefix(u, "http://127.0.0.1:")
}

func exitWithoutURL(waitErr error, stderr string) string {
	msg := strings.TrimSpace(stderr)
	if len(msg) > 8000 {
		msg = msg[len(msg)-8000:]
	}
	if msg == "" {
		msg = "(sem stderr)"
	}
	if waitErr != nil {
		return fmt.Sprintf("dsh encerrou sem anunciar URL (%v): %s", waitErr, msg)
	}
	return fmt.Sprintf("dsh encerrou sem anunciar URL: %s", msg)
}

// Start extrai (se preciso) e sobe `dsh web` em porta livre, retornando a URL.
func (m *Manager) Start(ctx context.Context) (string, error) {
	m.mu.Lock()
	if m.stopped {
		m.mu.Unlock()
		return "", fmt.Errorf("harness encerrado")
	}
	m.mu.Unlock()
	dir, err := m.ensureExtracted()
	if err != nil {
		return "", fmt.Errorf("extração do runtime: %w", err)
	}
	nodePath := filepath.Join(dir, "node.exe")
	binPath := filepath.Join(dir, "dsh-runtime", "lib", "bin.js")

	m.mu.Lock()
	if m.stopped {
		m.mu.Unlock()
		return "", fmt.Errorf("harness encerrado")
	}
	m.Phase.Store("starting")
	m.cmd = exec.Command(nodePath, binPath, "web", "--no-open", "--host", "127.0.0.1", "--port", "0")
	m.cmd.Dir = filepath.Join(dir, "dsh-runtime")
	prepareSidecarCmd(m.cmd)
	m.cmd.Env = append(os.Environ(),
		"DSH_HOME="+filepath.Join(m.Root, "dsh-home"),
	)
	stdout, err := m.cmd.StdoutPipe()
	if err != nil {
		m.mu.Unlock()
		return "", err
	}
	var stderr bytes.Buffer
	m.cmd.Stderr = &stderr
	if err := m.cmd.Start(); err != nil {
		m.mu.Unlock()
		return "", fmt.Errorf("falha ao iniciar dsh: %w", err)
	}
	m.job = attachSidecarJob(m.cmd.Process)
	resumeSidecar(m.cmd.Process)
	m.mu.Unlock()

	urlCh := make(chan string, 1)
	errCh := make(chan error, 1)
	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 4096), 256*1024)
		for sc.Scan() {
			if url, ok := urlFromLine(sc.Text()); ok {
				urlCh <- url
				return
			}
		}
		waitErr := m.cmd.Wait()
		errCh <- fmt.Errorf("%s", exitWithoutURL(waitErr, stderr.String()))
	}()

	select {
	case url := <-urlCh:
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.stopped {
			m.stopLocked()
			return "", fmt.Errorf("harness encerrado")
		}
		m.URL = url
		return url, nil
	case err := <-errCh:
		return "", err
	case <-time.After(120 * time.Second):
		m.Stop()
		return "", fmt.Errorf("timeout aguardando o harness subir")
	case <-ctx.Done():
		m.Stop()
		return "", ctx.Err()
	}
}

// Stop encerra o sidecar, a árvore de filhos e qualquer processo ainda vivo
// sob o runtime extraído. É idempotente: fechar a janela no meio do boot
// marca stopped para o Start não deixar órfão depois.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopped = true
	m.stopLocked()
}

func (m *Manager) stopLocked() {
	pid := 0
	if m.cmd != nil && m.cmd.Process != nil {
		pid = m.cmd.Process.Pid
	}
	if m.job != nil {
		m.job.killAndClose()
		m.job = nil
	}
	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
		done := make(chan struct{})
		go func() {
			_, _ = m.cmd.Process.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
		}
	}
	if pid > 0 {
		killProcessTree(pid)
	}
	killSidecarNodes(m.Root)
	m.cmd = nil
	m.URL = ""
}
