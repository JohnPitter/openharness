package harnessproxy

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const launch = "launch-secret"

// fakeHarness mimics dsh web's browser auth: `/?token=` mints the cookie and
// redirects to `./`; everything else needs the cookie.
func fakeHarness(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if tok := r.URL.Query().Get("token"); tok != "" {
			if tok != launch || r.URL.Path != "/" {
				http.Error(w, "bad token", http.StatusForbidden)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "dsh-auth-test", Value: "signed", Path: "/"})
			http.Redirect(w, r, "./", http.StatusFound)
			return
		}
		if c, err := r.Cookie("dsh-auth-test"); err != nil || c.Value != "signed" {
			http.Error(w, "dsh web authentication required", http.StatusUnauthorized)
			return
		}
		if r.Host != strings.TrimPrefix(srvURL(r), "http://") {
			http.Error(w, "host fence", http.StatusForbidden)
			return
		}
		if r.URL.Path == "/moved" {
			http.Redirect(w, r, "/target", http.StatusFound)
			return
		}
		if r.Header.Get("Upgrade") == "websocket" {
			hj := w.(http.Hijacker)
			conn, buf, _ := hj.Hijack()
			defer conn.Close()
			_, _ = buf.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nws-" + r.URL.Path)
			_ = buf.Flush()
			return
		}
		_, _ = io.WriteString(w, "ok-"+r.URL.Path)
	}))
	harnessHost = srv.Listener.Addr().String()
	t.Cleanup(srv.Close)
	return srv
}

var harnessHost string

func srvURL(*http.Request) string { return "http://" + harnessHost }

func get(t *testing.T, client *http.Client, raw string) (int, string, http.Header) {
	t.Helper()
	res, err := client.Get(raw)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(body), res.Header
}

func TestLocalServesTheHarnessUnderTheSecretPrefix(t *testing.T) {
	backend := fakeHarness(t)
	l, err := StartLocal(backend.URL + "/?token=" + launch)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(l.Close)
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	if code, body, _ := get(t, http.DefaultClient, l.URL); code != http.StatusOK || body != "ok-/" {
		t.Fatalf("index: %d %q", code, body)
	}
	if code, body, _ := get(t, http.DefaultClient, l.URL+"api/x"); code != http.StatusOK || body != "ok-/api/x" {
		t.Fatalf("api: %d %q", code, body)
	}
	if code, _, hdr := get(t, noRedirect, l.URL+"moved"); code != http.StatusFound || hdr.Get("Location") != l.prefix+"/target" {
		t.Fatalf("redirect kept outside the prefix: %d %q", code, hdr.Get("Location"))
	}
	if code, _, hdr := get(t, noRedirect, strings.TrimSuffix(l.URL, "/")); code != http.StatusFound || hdr.Get("Location") != l.prefix+"/" {
		t.Fatalf("bare prefix: %d %q", code, hdr.Get("Location"))
	}

	parsed, _ := url.Parse(l.URL)
	root := parsed.Scheme + "://" + parsed.Host
	for _, path := range []string{"/", "/api/x", "/wrong-secret/api/x"} {
		if code, _, _ := get(t, http.DefaultClient, root+path); code != http.StatusNotFound {
			t.Fatalf("%s outside the prefix: %d", path, code)
		}
	}

	// A rebinding page reaches the same socket under its own Host name.
	req, _ := http.NewRequest(http.MethodGet, l.URL, nil)
	req.Host = "evil.example:" + parsed.Port()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("foreign Host: %d", res.StatusCode)
	}
}

func TestLocalForwardsWebSocketUpgradesUnderThePrefix(t *testing.T) {
	backend := fakeHarness(t)
	l, err := StartLocal(backend.URL + "/?token=" + launch)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(l.Close)
	parsed, _ := url.Parse(l.URL)
	conn, err := net.Dial("tcp", parsed.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "GET "+l.prefix+"/api/remote.mux HTTP/1.1\r\nHost: "+parsed.Host+
		"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")
	res, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("upgrade: %d", res.StatusCode)
	}
	rest, _ := io.ReadAll(res.Body)
	_ = rest
}
