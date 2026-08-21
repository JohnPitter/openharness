package update

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Errorf("authorization %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	}))
	t.Cleanup(srv.Close)

	c := &Checker{Client: srv.Client(), API: srv.URL, Repo: "JohnPitter/openharness", Token: "secret"}
	info, err := c.Check("0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if !info.Available || info.Latest != "0.2.0" || info.AssetAPIURL == "" {
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

func TestCheckPrivateWithoutToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	c := &Checker{Client: srv.Client(), API: srv.URL, Repo: "JohnPitter/openharness"}
	info, err := c.Check("0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if !info.NeedsToken || info.Available {
		t.Fatalf("%+v", info)
	}
}
