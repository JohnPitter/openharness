package harnessproxy

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

// Local serves the harness to the Wails shell's iframe from 127.0.0.1 under a
// random path prefix. The shell page (wails.localhost) and the harness
// (127.0.0.1) are different sites, so WebView2 never stores dsh web's
// SameSite=Strict cookie inside the iframe; this proxy authenticates for it.
// The secret prefix is the gate: a web page elsewhere on the machine cannot
// guess it, and requests outside it (or for another Host) get 404.
type Local struct {
	srv    *http.Server
	ln     net.Listener
	prefix string
	// URL is what the iframe loads: http://127.0.0.1:<port>/<secret>/
	URL string
}

// StartLocal proxies target (the `dsh web` URL with its launch token) on a
// fresh loopback port.
func StartLocal(target string) (*Local, error) {
	proxy, _, err := New(target)
	if err != nil {
		return nil, err
	}
	secret, err := randomSecret()
	if err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("não foi possível escutar em loopback: %w", err)
	}
	host := ln.Addr().String()
	l := &Local{ln: ln, prefix: "/" + secret}
	l.URL = "http://" + host + l.prefix + "/"
	proxy.ModifyResponse = func(res *http.Response) error {
		// Keep absolute redirects from the harness inside the prefix.
		if loc := res.Header.Get("Location"); strings.HasPrefix(loc, "/") && !strings.HasPrefix(loc, "//") {
			res.Header.Set("Location", l.prefix+loc)
		}
		return nil
	}
	l.srv = &http.Server{
		Handler:           l.gate(host, proxy),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() { _ = l.srv.Serve(ln) }()
	return l, nil
}

// gate admits only requests for this listener's own Host (DNS-rebinding
// fence) under the secret prefix, and strips the prefix before forwarding.
func (l *Local) gate(host string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != host {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == l.prefix {
			http.Redirect(w, r, l.prefix+"/", http.StatusFound)
			return
		}
		rest, ok := strings.CutPrefix(r.URL.Path, l.prefix+"/")
		if !ok {
			http.NotFound(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + rest
		r2.URL.RawPath = ""
		next.ServeHTTP(w, r2)
	})
}

// Close stops the listener; in-flight connections are dropped.
func (l *Local) Close() {
	if l == nil || l.srv == nil {
		return
	}
	_ = l.srv.Close()
}

func randomSecret() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
