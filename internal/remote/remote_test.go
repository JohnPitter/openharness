package remote

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func stubTunnel(t *testing.T) {
	t.Helper()
	prev := openPublicTunnel
	openPublicTunnel = func(origin string) (string, func(), error) {
		return origin, func() {}, nil
	}
	t.Cleanup(func() { openPublicTunnel = prev })
}

func TestGateRejectsMissingAndWrongToken(t *testing.T) {
	stubTunnel(t)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Origin"), "127.0.0.1") {
			t.Errorf("origin not rewritten: %q", r.Header.Get("Origin"))
		}
		_, _ = io.WriteString(w, "ok-"+r.URL.Path)
	}))
	t.Cleanup(backend.Close)

	var s Server
	access, err := s.Start(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Stop)
	if !access.Active || access.URL == "" || !strings.HasPrefix(access.QRDataURL, "data:image/png;base64,") {
		t.Fatalf("%+v", access)
	}

	parsed, err := url.Parse(access.URL)
	if err != nil {
		t.Fatal(err)
	}
	base := parsed.Scheme + "://" + parsed.Host

	res, err := http.Get(base + "/")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("open /: %d", res.StatusCode)
	}

	res, err = http.Get(base + "/?access=nope")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("bad token: %d", res.StatusCode)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}
	res, err = client.Get(access.URL)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("authed: %d %s", res.StatusCode, body)
	}
	if string(body) != "ok-/" {
		t.Fatalf("body %q", body)
	}
}

func TestStartAdvertisesTunnelURL(t *testing.T) {
	prev := openPublicTunnel
	var captured string
	stopped := false
	openPublicTunnel = func(origin string) (string, func(), error) {
		captured = origin
		return "https://demo-words.trycloudflare.com", func() { stopped = true }, nil
	}
	t.Cleanup(func() { openPublicTunnel = prev })

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	t.Cleanup(backend.Close)

	var s Server
	access, err := s.Start(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(access.URL, "https://demo-words.trycloudflare.com/?access=") {
		t.Fatalf("advertised %s", access.URL)
	}
	if !strings.HasPrefix(captured, "http://127.0.0.1:") {
		t.Fatalf("origin %s", captured)
	}

	s.Stop()
	if !stopped {
		t.Fatal("tunnel not stopped")
	}
}

func TestStartFailsWhenTunnelFails(t *testing.T) {
	prev := openPublicTunnel
	openPublicTunnel = func(origin string) (string, func(), error) {
		return "", nil, errTunnelDown
	}
	t.Cleanup(func() { openPublicTunnel = prev })

	backend := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	t.Cleanup(backend.Close)

	var s Server
	_, err := s.Start(backend.URL)
	if err == nil || !strings.Contains(err.Error(), "túnel indisponível") {
		t.Fatalf("err %v", err)
	}
}

func TestEncodeQRIsPNG(t *testing.T) {
	png, err := encodeQR("https://demo.trycloudflare.com/?access=x")
	if err != nil {
		t.Fatal(err)
	}
	if len(png) < 8 || string(png[:8]) != "\x89PNG\r\n\x1a\n" {
		t.Fatalf("not a png (%d bytes)", len(png))
	}
}

func TestTrycloudflareURL(t *testing.T) {
	line := `INF |  https://random-words-here.trycloudflare.com                                               |`
	if got := trycloudflareURL(line); got != "https://random-words-here.trycloudflare.com" {
		t.Fatalf("%q", got)
	}
	jsonLine := `{"level":"info","msg":"Visit it at https://abc-def.trycloudflare.com"}`
	if got := trycloudflareURL(jsonLine); got != "https://abc-def.trycloudflare.com" {
		t.Fatalf("%q", got)
	}
	if trycloudflareURL("no url here") != "" {
		t.Fatal("expected empty")
	}
}

func TestFileSHA256Eq(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "bin")
	if err := os.WriteFile(p, []byte("abc"), 0o644); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("abc"))
	if !fileSHA256Eq(p, hex.EncodeToString(sum[:])) {
		t.Fatal("expected match")
	}
	if fileSHA256Eq(p, "00") || fileSHA256Eq(filepath.Join(dir, "missing"), hex.EncodeToString(sum[:])) {
		t.Fatal("expected mismatch")
	}
}

func TestForwardedHTTPS(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if forwardedHTTPS(r) {
		t.Fatal("plain http")
	}
	r.Header.Set("X-Forwarded-Proto", "https")
	if !forwardedHTTPS(r) {
		t.Fatal("forwarded https")
	}
}

func TestTrimSlash(t *testing.T) {
	if trimSlash("https://x.trycloudflare.com/") != "https://x.trycloudflare.com" {
		t.Fatal()
	}
	if trimSlash("https://x.trycloudflare.com") != "https://x.trycloudflare.com" {
		t.Fatal()
	}
}

func TestWatchTunnelOutputFindsThenDrains(t *testing.T) {
	pr, pw := io.Pipe()
	found := make(chan string, 1)
	go watchTunnelOutput(pr, found)
	_, _ = io.WriteString(pw, "noise\nhttps://zz.trycloudflare.com extra\nmore\n")
	_ = pw.Close()
	if got := <-found; got != "https://zz.trycloudflare.com" {
		t.Fatalf("%q", got)
	}
}

type constError string

func (e constError) Error() string { return string(e) }

const errTunnelDown = constError("túnel indisponível")
