// Package harnessproxy forwards HTTP and WebSocket traffic to the local
// `dsh web` listener with its browser session already authenticated.
//
// dsh web >= 0.2 gates every request on a SameSite=Strict cookie minted from
// the launch token in its URL (`?token=`). A browser that reaches the harness
// from another site (the Wails shell's iframe, the Remote tunnel) cannot keep
// that cookie, so the proxy redeems the token once and attaches the cookie to
// every forwarded request. Whoever can reach the proxy has the harness's full
// authority: each caller must gate it (a secret path, an access cookie).
package harnessproxy

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

// cookiePrefix is the name prefix of dsh web's signed browser-session cookie.
const cookiePrefix = "dsh-auth-"

// New builds a reverse proxy to target, the harness URL as `dsh web` printed
// it (with or without `?token=`). Forwarded requests carry the harness's own
// Host and Origin and its session cookie; paths are forwarded unchanged.
func New(target string) (*httputil.ReverseProxy, *url.URL, error) {
	parsed, err := url.Parse(target)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, nil, fmt.Errorf("URL do harness inválida")
	}
	cookies := redeemLaunchToken(parsed)
	upstream := &url.URL{Scheme: parsed.Scheme, Host: parsed.Host}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		director(req)
		req.Host = upstream.Host
		req.Header.Set("Origin", upstream.Scheme+"://"+upstream.Host)
		req.Header.Del("Referer")
		attachCookies(req, cookies)
	}
	return proxy, upstream, nil
}

// redeemLaunchToken trades the URL's `token` query for the session cookie the
// harness mints on `GET /?token=...`. A harness without browser auth (no token
// in its URL, or no cookie in the reply) yields nil and requests pass as-is.
func redeemLaunchToken(target *url.URL) []*http.Cookie {
	if target.Query().Get("token") == "" {
		return nil
	}
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	redeem := *target
	redeem.Path = "/"
	res, err := client.Get(redeem.String())
	if err != nil {
		return nil
	}
	_ = res.Body.Close()
	var out []*http.Cookie
	for _, c := range res.Cookies() {
		if strings.HasPrefix(c.Name, cookiePrefix) {
			out = append(out, &http.Cookie{Name: c.Name, Value: c.Value})
		}
	}
	return out
}

// attachCookies replaces any same-named cookie the browser sent and appends
// the harness session cookies to the forwarded request.
func attachCookies(req *http.Request, cookies []*http.Cookie) {
	if len(cookies) == 0 {
		return
	}
	kept := make([]string, 0, 4)
	for _, c := range req.Cookies() {
		if strings.HasPrefix(c.Name, cookiePrefix) {
			continue
		}
		kept = append(kept, c.String())
	}
	for _, c := range cookies {
		kept = append(kept, c.String())
	}
	req.Header.Set("Cookie", strings.Join(kept, "; "))
}
