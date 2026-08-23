package remote

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"time"
)

const cloudflaredVersion = "2026.8.2"

// openPublicTunnel publishes origin on the public internet and returns the
// https base URL plus a stopper. Tests replace this so they never download
// cloudflared or talk to Cloudflare.
var openPublicTunnel = startCloudflareTunnel

var trycloudflareRe = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

func startCloudflareTunnel(origin string) (string, func(), error) {
	bin, err := ensureCloudflared()
	if err != nil {
		return "", nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, bin, "tunnel", "--url", origin, "--no-autoupdate")
	hideWindow(cmd)
	r, w, err := os.Pipe()
	if err != nil {
		cancel()
		return "", nil, err
	}
	cmd.Stdout = w
	cmd.Stderr = w
	if err := cmd.Start(); err != nil {
		_ = r.Close()
		_ = w.Close()
		cancel()
		return "", nil, fmt.Errorf("não foi possível iniciar o túnel: %w", err)
	}
	_ = w.Close()

	found := make(chan string, 1)
	go watchTunnelOutput(r, found)

	timeout := time.NewTimer(45 * time.Second)
	defer timeout.Stop()
	select {
	case base := <-found:
		if base == "" {
			cancel()
			_ = cmd.Wait()
			return "", nil, fmt.Errorf("túnel encerrado antes de publicar um endereço")
		}
		stop := func() {
			cancel()
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			_ = cmd.Wait()
		}
		return base, stop, nil
	case <-timeout.C:
		cancel()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
		return "", nil, fmt.Errorf("tempo esgotado ao abrir o acesso pela internet")
	}
}

func watchTunnelOutput(r io.Reader, found chan<- string) {
	if c, ok := r.(io.Closer); ok {
		defer c.Close()
	}
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	sent := false
	for s.Scan() {
		if sent {
			continue
		}
		if m := trycloudflareURL(s.Text()); m != "" {
			sendFound(found, m)
			sent = true
		}
	}
	if !sent {
		sendFound(found, "")
	}
}

func sendFound(found chan<- string, v string) {
	select {
	case found <- v:
	default:
	}
}

func trycloudflareURL(line string) string {
	return trycloudflareRe.FindString(line)
}

func cloudflaredAsset() (name, sha string, err error) {
	if runtime.GOOS == "windows" && runtime.GOARCH == "amd64" {
		return "cloudflared-windows-amd64.exe",
			"c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5",
			nil
	}
	return "", "", fmt.Errorf("túnel remoto não suportado neste sistema (%s/%s)", runtime.GOOS, runtime.GOARCH)
}

func ensureCloudflared() (string, error) {
	name, wantSHA, err := cloudflaredAsset()
	if err != nil {
		return "", err
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(cache, "openharness", "cloudflared", cloudflaredVersion)
	dest := filepath.Join(dir, "cloudflared.exe")
	if runtime.GOOS != "windows" {
		dest = filepath.Join(dir, "cloudflared")
	}
	if fileSHA256Eq(dest, wantSHA) {
		return dest, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	url := "https://github.com/cloudflare/cloudflared/releases/download/" + cloudflaredVersion + "/" + name
	part := dest + ".part"
	if err := downloadFile(url, part); err != nil {
		_ = os.Remove(part)
		return "", fmt.Errorf("não foi possível baixar o túnel: %w", err)
	}
	if !fileSHA256Eq(part, wantSHA) {
		_ = os.Remove(part)
		return "", fmt.Errorf("túnel baixado com checksum inválido")
	}
	_ = os.Remove(dest)
	if err := os.Rename(part, dest); err != nil {
		_ = os.Remove(part)
		return "", err
	}
	return dest, nil
}

func fileSHA256Eq(path, wantHex string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return false
	}
	return hex.EncodeToString(h.Sum(nil)) == wantHex
}

func downloadFile(url, dest string) error {
	client := &http.Client{Timeout: 3 * time.Minute}
	res, err := client.Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, res.Body)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
