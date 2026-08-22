package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"openharness/internal/app"
	"openharness/internal/instance"
	"openharness/internal/update"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	update.AwaitPrevious()
	if !instance.Acquire() {
		return
	}

	application, err := app.New()
	if err != nil {
		log.Fatal(err)
	}

	err = wails.Run(&options.App{
		Title:     "OpenHarness",
		Width:     1440,
		Height:    900,
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 18, G: 18, B: 24, A: 1},
		OnStartup:        application.Startup,
		OnShutdown:       application.Shutdown,
		Bind: []any{
			application,
		},
		Windows: &windows.Options{
			WebviewUserDataPath: webviewDataDir(),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

func webviewDataDir() string {
	base, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "openharness", "webview")
}
