package app

import (
	"fmt"
	"log/slog"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// NotifyTaskComplete plays the completion sound and, when the window is not
// the OS foreground, a Windows toast. The iframe cannot do either reliably:
// WebView2 suspends AudioContext without a gesture, and its HWND belongs to
// msedgewebview2.exe, so a PID-only focus check always looked "away".
func (a *App) NotifyTaskComplete(title string) {
	playTaskSound()
	away := !windowIsForeground()
	if a.ctx != nil && wailsRuntime.WindowIsMinimised(a.ctx) {
		away = true
	}
	slog.Info("task complete", "title", title, "away", away)
	if !away {
		return
	}
	a.pushTaskToast(title)
}

func (a *App) pushTaskToast(title string) {
	if a.ctx == nil {
		return
	}
	body := "Tarefa concluída"
	if t := strings.TrimSpace(title); t != "" {
		body = "Tarefa concluída: " + t
	}
	err := wailsRuntime.SendNotification(a.ctx, wailsRuntime.NotificationOptions{
		ID:    fmt.Sprintf("task-complete-%d", time.Now().UnixNano()),
		Title: "OpenHarness",
		Body:  body,
		Data:  map[string]any{"kind": "task-complete"},
	})
	if err != nil {
		slog.Warn("toast da tarefa falhou", "err", err)
	}
}

func (a *App) initNotifications() {
	if a.ctx == nil {
		return
	}
	if err := wailsRuntime.InitializeNotifications(a.ctx); err != nil {
		slog.Warn("notificações", "err", err)
		return
	}
	wailsRuntime.OnNotificationResponse(a.ctx, func(wailsRuntime.NotificationResult) {
		if a.ctx == nil {
			return
		}
		wailsRuntime.WindowUnminimise(a.ctx)
		wailsRuntime.WindowShow(a.ctx)
	})
}
