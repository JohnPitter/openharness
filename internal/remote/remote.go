// Package remote exposes the local harness UI on the public internet behind
// an unguessable cookie, so a phone can scan a QR from any network while
// this PC has OpenHarness open.
package remote

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync"
	"time"
)

const cookieName = "oh_remote"

// Access is what the UI shows after the user opts in.
type Access struct {
	URL       string `json:"url"`
	QRDataURL string `json:"qrDataUrl"`
	Active    bool   `json:"active"`
}

// Server is a reverse proxy in front of the loopback harness, published
// through an outbound internet tunnel.
type Server struct {
	mu         sync.Mutex
	http       *http.Server
	ln         net.Listener
	token      string
	url        string
	qr         string
	stopTunnel func()
	active     bool
}

// Start binds 127.0.0.1, gates on a random token cookie, proxies to target,
// and publishes a public HTTPS URL through openPublicTunnel.
func (s *Server) Start(target string) (Access, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active {
		return Access{URL: s.url, QRDataURL: s.qr, Active: true}, nil
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return Access{}, fmt.Errorf("URL do harness inválida")
	}
	token, err := randomToken()
	if err != nil {
		return Access{}, err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return Access{}, fmt.Errorf("não foi possível escutar em loopback: %w", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	origin := fmt.Sprintf("http://127.0.0.1:%d", port)
	base, stopTunnel, err := openPublicTunnel(origin)
	if err != nil {
		_ = ln.Close()
		return Access{}, err
	}
	public := fmt.Sprintf("%s/?access=%s", trimSlash(base), token)
	qr, err := qrDataURL(public)
	if err != nil {
		stopTunnel()
		_ = ln.Close()
		return Access{}, err
	}
	proxy := httputil.NewSingleHostReverseProxy(parsed)
	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		director(req)
		req.Host = parsed.Host
		req.Header.Set("Origin", parsed.Scheme+"://"+parsed.Host)
		req.Header.Del("Referer")
	}
	mux := http.NewServeMux()
	mux.Handle("/", gate(token, proxy))
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	s.http = srv
	s.ln = ln
	s.token = token
	s.url = public
	s.qr = qr
	s.stopTunnel = stopTunnel
	s.active = true
	go func() { _ = srv.Serve(ln) }()
	return Access{URL: public, QRDataURL: qr, Active: true}, nil
}

// Stop closes the local listener and the internet tunnel.
func (s *Server) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

func (s *Server) stopLocked() {
	if s.stopTunnel != nil {
		s.stopTunnel()
	}
	s.stopTunnel = nil
	if s.http != nil {
		_ = s.http.Close()
	}
	s.http = nil
	s.ln = nil
	s.token = ""
	s.url = ""
	s.qr = ""
	s.active = false
}

// Snapshot returns the current public URL without starting anything.
func (s *Server) Snapshot() Access {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Access{URL: s.url, QRDataURL: s.qr, Active: s.active}
}

func gate(token string, next http.Handler) http.Handler {
	want := []byte(token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if q := r.URL.Query().Get("access"); q != "" {
			if subtle.ConstantTimeCompare([]byte(q), want) != 1 {
				http.NotFound(w, r)
				return
			}
			http.SetCookie(w, &http.Cookie{
				Name:     cookieName,
				Value:    token,
				Path:     "/",
				HttpOnly: true,
				Secure:   forwardedHTTPS(r),
				SameSite: http.SameSiteLaxMode,
			})
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		c, err := r.Cookie(cookieName)
		if err != nil || subtle.ConstantTimeCompare([]byte(c.Value), want) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func forwardedHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

func randomToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func trimSlash(s string) string {
	if len(s) > 0 && s[len(s)-1] == '/' {
		return s[:len(s)-1]
	}
	return s
}

func qrDataURL(content string) (string, error) {
	png, err := encodeQR(content)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}
