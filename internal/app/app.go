// Package app é a raiz de composição do shell desktop: sobe o sidecar do
// DeepSeek Harness e expõe a URL ao frontend Wails.
package app

import (
	"context"
	"fmt"
	"log/slog"

	"openharness/internal/remote"
	"openharness/internal/sidecar"
	"openharness/internal/update"
)

type App struct {
	ctx     context.Context
	manager *sidecar.Manager
	remote  remote.Server
	url     string
	err     string
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
	go func() {
		url, err := a.manager.Start(ctx)
		if err != nil {
			slog.Error("sidecar falhou", "err", err)
			a.err = err.Error()
			return
		}
		a.url = url
		slog.Info("harness pronto", "url", url)
	}()
}

func (a *App) Shutdown(ctx context.Context) {
	a.remote.Stop()
	a.manager.Stop()
}

// HarnessState retorna {url} quando o harness está pronto, ou {error};
// enquanto isso, {phase} informa "extracting" ou "starting".
func (a *App) HarnessState() map[string]string {
	if a.err != "" {
		return map[string]string{"error": a.err}
	}
	if a.url != "" {
		return map[string]string{"url": a.url}
	}
	if phase, ok := a.manager.Phase.Load().(string); ok && phase != "" {
		return map[string]string{"phase": phase}
	}
	return map[string]string{}
}

// RestartHarness reinicia o sidecar (após falha).
func (a *App) RestartHarness() error {
	if a.ctx == nil {
		return fmt.Errorf("app ainda não iniciado")
	}
	a.manager.Stop()
	a.remote.Stop()
	a.err = ""
	a.url = ""
	m, err := sidecar.NewManager()
	if err != nil {
		return err
	}
	a.manager = m
	go func() {
		url, err := a.manager.Start(a.ctx)
		if err != nil {
			a.err = err.Error()
			return
		}
		a.url = url
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
	if a.url == "" {
		return remote.Access{}, fmt.Errorf("harness ainda não está pronto")
	}
	return a.remote.Start(a.url)
}

// DisableRemote closes the public tunnel and the local proxy.
func (a *App) DisableRemote() {
	a.remote.Stop()
}
