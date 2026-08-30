package update

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestCompareSemver(t *testing.T) {
	if compareSemver("0.2.0", "0.1.9") <= 0 {
		t.Fatal("expected 0.2.0 > 0.1.9")
	}
	if compareSemver("v0.1.0", "0.1.0") != 0 {
		t.Fatal("v prefix should be ignored")
	}
	if compareSemver("0.1.0", "0.1.1") >= 0 {
		t.Fatal("expected 0.1.0 < 0.1.1")
	}
}

func TestCheckLatest(t *testing.T) {
	rel := ghRelease{
		TagName: "v0.2.0",
		Body:    "fixes",
		Assets: []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			URL                string `json:"url"`
		}{
			{Name: AssetName, BrowserDownloadURL: "https://example.test/openharness.exe", URL: "https://api.example.test/asset"},
		},
	}
	payload, err := json.Marshal(rel)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/JohnPitter/openharness/releases/latest" {
			http.NotFound(w, r)
			return
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("unexpected authorization %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	}))
	t.Cleanup(srv.Close)

	c := &Checker{Client: srv.Client(), API: srv.URL, Repo: "JohnPitter/openharness"}
	info, err := c.Check("0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if !info.Available || info.Latest != "0.2.0" || info.AssetURL == "" {
		t.Fatalf("%+v", info)
	}
	same, err := c.Check("0.2.0")
	if err != nil {
		t.Fatal(err)
	}
	if same.Available {
		t.Fatal("same version should not be available")
	}
}

func TestPidFromEnv(t *testing.T) {
	t.Setenv(waitPIDEnv, " 4321 ")
	if pidFromEnv() != 4321 {
		t.Fatalf("got %d", pidFromEnv())
	}
	t.Setenv(waitPIDEnv, "nope")
	if pidFromEnv() != 0 {
		t.Fatal("invalid pid should be 0")
	}
	t.Setenv(waitPIDEnv, "")
	if pidFromEnv() != 0 {
		t.Fatal("empty pid should be 0")
	}
}

func TestAwaitPreviousUnsetsEnv(t *testing.T) {
	prev := afterParent
	afterParent = 0
	t.Cleanup(func() { afterParent = prev })
	t.Setenv(waitPIDEnv, "2147483647")
	AwaitPrevious()
	if os.Getenv(waitPIDEnv) != "" {
		t.Fatal("wait pid env should be cleared")
	}
}

func TestCheckMissingAssetIsNotAvailable(t *testing.T) {
	rel := ghRelease{TagName: "v0.2.0"}
	payload, err := json.Marshal(rel)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	}))
	t.Cleanup(srv.Close)

	c := &Checker{Client: srv.Client(), API: srv.URL, Repo: "JohnPitter/openharness"}
	info, err := c.Check("0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if info.Available {
		t.Fatalf("empty asset list must not offer an update: %+v", info)
	}
	if info.Latest != "0.2.0" {
		t.Fatalf("latest: %+v", info)
	}
}

func TestCheckNotFoundIsQuiet(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	c := &Checker{Client: srv.Client(), API: srv.URL, Repo: "JohnPitter/openharness"}
	info, err := c.Check("0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if info.Available {
		t.Fatalf("%+v", info)
	}
}

// TestDownloadOutlivesCheckTimeout proves the release-check timeout can no
// longer cut off a still-progressing download: a shared http.Client.Timeout
// used to bound both operations, so a body slower than the check budget
// failed with "context deadline exceeded (Client.Timeout or context
// cancellation while reading body)" even though the transfer was still
// making progress. download() now runs under its own, longer deadline.
func TestDownloadOutlivesCheckTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("first-chunk-"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		// Outlives a tight check-sized budget but stays under the longer
		// download-sized one below.
		time.Sleep(80 * time.Millisecond)
		_, _ = w.Write([]byte("second-chunk"))
	}))
	t.Cleanup(srv.Close)

	c := &Checker{
		Client:          srv.Client(),
		CheckTimeout:    20 * time.Millisecond,
		DownloadTimeout: 2 * time.Second,
	}
	bin, err := c.download(srv.URL)
	if err != nil {
		t.Fatalf("download should outlive the tight check timeout: %v", err)
	}
	if string(bin) != "first-chunk-second-chunk" {
		t.Fatalf("unexpected body: %q", bin)
	}
}

// TestDownloadRespectsItsOwnTimeout confirms download() is still bounded by
// its own deadline — a stalled body still fails, just against the right
// (longer) budget instead of check's short one.
func TestDownloadRespectsItsOwnTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("chunk"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		time.Sleep(200 * time.Millisecond)
	}))
	t.Cleanup(srv.Close)

	c := &Checker{Client: srv.Client(), DownloadTimeout: 20 * time.Millisecond}
	if _, err := c.download(srv.URL); err == nil {
		t.Fatal("expected the download's own timeout to fire")
	}
}
