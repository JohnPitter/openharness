// Package update consulta GitHub Releases e troca o exe Windows em execução.
package update

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Version is the build's semver without a leading v. Release builds also pass
// -ldflags "-X openharness/internal/update.Version=…".
var Version = "0.1.7"

// Repo is owner/name of the GitHub repository that publishes releases.
var Repo = "JohnPitter/openharness"

// AssetName is the Windows binary attached to each release.
const AssetName = "openharness.exe"

const userAgent = "openharness-updater"

// Info is what the shell shows when a newer tag exists.
type Info struct {
	Current     string `json:"current"`
	Latest      string `json:"latest"`
	Available   bool   `json:"available"`
	Notes       string `json:"notes"`
	AssetURL    string `json:"-"`
}

type ghRelease struct {
	TagName    string `json:"tag_name"`
	Body       string `json:"body"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
		URL                string `json:"url"`
	} `json:"assets"`
}

// Checker talks to the GitHub Releases API.
type Checker struct {
	Client *http.Client
	API    string
	Repo   string
}

func defaultChecker() *Checker {
	return &Checker{
		Client: &http.Client{Timeout: 20 * time.Second},
		Repo:   Repo,
	}
}

func (c *Checker) api() string {
	if c.API != "" {
		return strings.TrimRight(c.API, "/")
	}
	return "https://api.github.com"
}

// Check reports whether GitHub has a newer non-draft release than Version.
func Check() (Info, error) {
	return defaultChecker().Check(Version)
}

// Check compares current against the latest published release.
func (c *Checker) Check(current string) (Info, error) {
	info := Info{Current: normalize(current)}
	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/repos/%s/releases/latest", c.api(), c.Repo), nil)
	if err != nil {
		return info, err
	}
	c.headers(req, "application/vnd.github+json")
	res, err := c.Client.Do(req)
	if err != nil {
		return info, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusNotFound {
		return info, nil
	}
	if res.StatusCode != http.StatusOK {
		return info, fmt.Errorf("github releases: HTTP %d", res.StatusCode)
	}
	var rel ghRelease
	if err := json.Unmarshal(body, &rel); err != nil {
		return info, err
	}
	if rel.Draft || rel.Prerelease {
		return info, nil
	}
	info.Latest = normalize(rel.TagName)
	info.Notes = rel.Body
	info.Available = compareSemver(info.Latest, info.Current) > 0
	if !info.Available {
		return info, nil
	}
	for _, asset := range rel.Assets {
		if strings.EqualFold(asset.Name, AssetName) {
			info.AssetURL = asset.BrowserDownloadURL
			break
		}
	}
	if info.AssetURL == "" {
		info.Available = false
	}
	return info, nil
}

func (c *Checker) headers(req *http.Request, accept string) {
	req.Header.Set("Accept", accept)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
}

// Apply downloads the latest exe and replaces this process's binary.
func Apply() error {
	return defaultChecker().Apply()
}

// Apply downloads and swaps the running executable, then relaunches.
func (c *Checker) Apply() error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("auto-update só está disponível no Windows")
	}
	info, err := c.Check(Version)
	if err != nil {
		return err
	}
	if !info.Available {
		return fmt.Errorf("não há atualização disponível")
	}
	bin, err := c.download(info.AssetURL)
	if err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return err
	}
	next := exe + ".new"
	if err := os.WriteFile(next, bin, 0o755); err != nil {
		return err
	}
	old := exe + ".old"
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		_ = os.Remove(next)
		return fmt.Errorf("não foi possível substituir o exe: %w", err)
	}
	if err := os.Rename(next, exe); err != nil {
		_ = os.Rename(old, exe)
		return err
	}
	if err := startRelaunch(exe); err != nil {
		return err
	}
	os.Exit(0)
	return nil
}

func (c *Checker) download(url string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	c.headers(req, "application/octet-stream")
	res, err := c.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download da release: HTTP %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 400<<20))
}

// CleanupOld removes the previous exe after a successful swap.
func CleanupOld() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	_ = os.Remove(exe + ".old")
}

func normalize(v string) string {
	return strings.TrimPrefix(strings.TrimSpace(v), "v")
}

func compareSemver(a, b string) int {
	as, bs := parseSemver(a), parseSemver(b)
	for i := 0; i < 3; i++ {
		if as[i] != bs[i] {
			return as[i] - bs[i]
		}
	}
	return 0
}

func parseSemver(v string) [3]int {
	var out [3]int
	parts := strings.SplitN(normalize(v), ".", 3)
	for i := 0; i < len(parts) && i < 3; i++ {
		n, _ := strconv.Atoi(strings.TrimRightFunc(parts[i], func(r rune) bool {
			return r < '0' || r > '9'
		}))
		out[i] = n
	}
	return out
}
