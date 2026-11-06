// Package app é a raiz de composição do shell desktop: sobe o sidecar do
// DeepSeek Harness e expõe a URL ao frontend Wails.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"openharness/internal/harnessproxy"
	"openharness/internal/remote"
	"openharness/internal/sidecar"
	"openharness/internal/update"
)

type App struct {
	ctx     context.Context
	manager *sidecar.Manager
	remote  remote.Server
	// mu guards url/err/manager/frame: the boot goroutine writes them while
	// the frontend polls HarnessState from Wails' binding goroutines.
	mu  sync.Mutex
	url string // dsh web URL with its launch token (Remote proxies it)
	err string
	// frame serves the harness to the shell's iframe: the iframe is another
	// site than the Wails page, so dsh web's SameSite cookie never sticks there.
	frame *harnessproxy.Local
}

func (a *App) setResult(url string, err error) {
	var frame *harnessproxy.Local
	if err == nil {
		frame, err = harnessproxy.StartLocal(url)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err != nil {
		a.err = err.Error()
		return
	}
	a.url = url
	a.frame = frame
}

// closeFrameLocked drops the iframe proxy; the caller holds a.mu.
func (a *App) closeFrameLocked() {
	a.frame.Close()
	a.frame = nil
}

func (a *App) harnessURL() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.url
}

func New() (*App, error) {
	m, err := sidecar.NewManager()
	if err != nil {
		return nil, err
	}
	update.CleanupOld()
	return &App{manager: m}, nil
}

// Startup dispara a subida do harness em background; o frontend consulta
// HarnessURL até receber a URL.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	a.initNotifications()
	m := a.manager
	go func() {
		url, err := m.Start(ctx)
		if err != nil {
			slog.Error("sidecar falhou", "err", err)
		} else {
			slog.Info("harness pronto")
		}
		a.setResult(url, err)
	}()
}

func (a *App) Shutdown(ctx context.Context) {
	a.remote.Stop()
	a.mu.Lock()
	m := a.manager
	a.closeFrameLocked()
	a.mu.Unlock()
	m.Stop()
}

// HarnessState retorna {url} quando o harness está pronto, ou {error};
// enquanto isso, {phase} informa "extracting" ou "starting".
func (a *App) HarnessState() map[string]string {
	a.mu.Lock()
	errMsg, frame, m := a.err, a.frame, a.manager
	a.mu.Unlock()
	if errMsg != "" {
		return map[string]string{"error": errMsg}
	}
	if frame != nil {
		return map[string]string{"url": frame.URL}
	}
	if phase, ok := m.Phase.Load().(string); ok && phase != "" {
		return map[string]string{"phase": phase}
	}
	return map[string]string{}
}

// RestartHarness reinicia o sidecar (após falha).
func (a *App) RestartHarness() error {
	if a.ctx == nil {
		return fmt.Errorf("app ainda não iniciado")
	}
	a.remote.Stop()
	m, err := sidecar.NewManager()
	if err != nil {
		return err
	}
	a.mu.Lock()
	old := a.manager
	a.manager = m
	a.err = ""
	a.url = ""
	a.closeFrameLocked()
	a.mu.Unlock()
	old.Stop()
	go func() {
		url, err := m.Start(a.ctx)
		a.setResult(url, err)
	}()
	return nil
}

// AppVersion is the exe's own semver (no leading v).
func (a *App) AppVersion() string {
	return update.Version
}

// CheckForUpdate asks GitHub Releases whether a newer tag exists.
func (a *App) CheckForUpdate() (update.Info, error) {
	return update.Check()
}

// ApplyUpdate downloads the latest exe, swaps it, and relaunches.
func (a *App) ApplyUpdate() error {
	return update.Apply()
}

// EnableRemote publishes the harness on the public internet behind a random URL and QR.
func (a *App) EnableRemote() (remote.Access, error) {
	url := a.harnessURL()
	if url == "" {
		return remote.Access{}, fmt.Errorf("harness ainda não está pronto")
	}
	return a.remote.Start(url)
}

// DisableRemote closes the public tunnel and the local proxy.
func (a *App) DisableRemote() {
	a.remote.Stop()
}

// WindowIsForeground is true when this process owns the OS foreground window
// (the Wails frame or its WebView2 child). An iframe click still counts —
// the user is in OpenHarness. Another app in front, or a minimized window,
// does not.
func (a *App) WindowIsForeground() bool {
	return windowIsForeground()
}
