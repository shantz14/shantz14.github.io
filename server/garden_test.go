package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func writeNotes(t *testing.T, dir string, notes map[string]string) {
	t.Helper()
	os.MkdirAll(dir, 0o755)
	for name, body := range notes {
		if err := os.WriteFile(filepath.Join(dir, name+".md"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

const pub = "---\ntags:\n  - public\n  - cs/linux\ncreated_on: 04-20-2026\n---\n"

func testGarden(t *testing.T) *Garden {
	t.Helper()
	dir := t.TempDir()
	writeNotes(t, dir, map[string]string{
		"Docker": pub + "# Docker\nUses [[namespaces]] and [[Cgroup|cgroups]], see [[Namespaces#User Namespace]].\n" +
			"Private: [[HttpGo]]. Same note: [[#Commands]].\n`[[NotALink]]`\n```\n[[AlsoNot]]\n```\n## Commands\n",
		"Namespaces":        pub + "## User Namespace\nlinux\n",
		"Cgroup":            "---\ntags: [public, cs]\naliases:\n  - Control Group\nrelated: \"[[Docker]]\"\n---\nControl Group\n",
		"TLA+":              pub + "tla",
		"TLA- ":             pub + "collides",
		"Secret":            "---\ntags:\n  - personal\n---\nprivate stuff\n",
		"No Frontmatter":    "nothing",
		"Billy Summers":     "---\ntags:\n  - public\n  - books\n---\nbook\n",
		"Notes Underground": "---\ntags:\n  - public\n  - philosophy\n  - books\n---\nbook\n",
	})
	g, err := LoadGarden(dir)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestSlugify(t *testing.T) {
	for in, want := range map[string]string{
		"TLA+ for testing":                      "tla-for-testing",
		"Designing-Data-Intensive-Applications": "designing-data-intensive-applications",
		"Notes From Underground":                "notes-from-underground",
		"+++":                                   "note",
	} {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseFrontmatter(t *testing.T) {
	fm, body := parseFrontmatter("---\ntags:\n  - public\n  - \"cs\"\ncreated_on: 05-01-2026\nrelated:\nother: [a, 'b']\n---\nhello\n")
	if !slices.Equal(fm["tags"], []string{"public", "cs"}) || !slices.Equal(fm["other"], []string{"a", "b"}) ||
		fm["created_on"][0] != "05-01-2026" || len(fm["related"]) != 0 || body != "hello\n" {
		t.Fatalf("got %v %q", fm, body)
	}
	if fm, body := parseFrontmatter("no frontmatter"); len(fm) != 0 || body != "no frontmatter" {
		t.Fatalf("got %v %q", fm, body)
	}
}

func TestLoadGarden(t *testing.T) {
	g := testGarden(t)

	var titles []string
	for _, n := range g.Notes {
		titles = append(titles, n.Title)
	}
	if want := []string{"Billy Summers", "Cgroup", "Docker", "Namespaces", "Notes Underground", "TLA+", "TLA- "}; !slices.Equal(titles, want) {
		t.Fatalf("published %v, want %v", titles, want)
	}
	if g.Note("tla") == nil || g.Note("tla-2") == nil {
		t.Fatalf("slug collision not resolved: %v", g.bySlug)
	}

	d := g.Note("docker")
	html := string(d.HTML)
	for _, want := range []string{
		`<a href="/notes/namespaces">namespaces</a>`,
		`<a href="/notes/cgroup">cgroups</a>`,
		`href="/notes/namespaces#user-namespace"`,
		`<span class="dead-link">HttpGo</span>`,
		`<a href="#commands">Commands</a>`,
		`<code>[[NotALink]]</code>`,
		"[[AlsoNot]]",
		`<h2 id="commands">`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("Docker HTML missing %q:\n%s", want, html)
		}
	}
	if strings.Contains(html, "<h1") {
		t.Errorf("title heading not stripped: %s", html)
	}
	if slices.Contains(d.Tags, publicTag) || d.Created != "04-20-2026" {
		t.Errorf("tags %v created %q", d.Tags, d.Created)
	}
	if !strings.Contains(string(g.Note("namespaces").HTML), `<h2 id="user-namespace">`) {
		t.Errorf("heading id mismatch: %s", g.Note("namespaces").HTML)
	}

	// Links are deduplicated; `related:` counts as a link; backlinks mirror links.
	if got := len(d.Links); got != 2 {
		t.Errorf("Docker links %d, want 2", got)
	}
	cg := g.Note("cgroup")
	if !slices.Contains(cg.Links, d) || !slices.Contains(cg.Backlinks, d) || !slices.Contains(d.Backlinks, cg) {
		t.Errorf("related/backlinks wrong: %v %v", cg.Links, cg.Backlinks)
	}
	if g.resolve("control group") != cg {
		t.Error("alias did not resolve")
	}
}

func TestCategorize(t *testing.T) {
	cats := categorize(testGarden(t).Notes)
	var keys []string
	for _, c := range cats {
		keys = append(keys, c.Key)
	}
	if !slices.Equal(keys, []string{"books", "cs"}) || len(cats[0].Notes) != 2 {
		t.Fatalf("categories %v", keys)
	}
	if got := rowTags("cs", []string{"cs", "cs/linux", "cs/containerization"}); got != "linux · containerization" {
		t.Errorf("rowTags = %q", got)
	}
}

func TestGardenHTTP(t *testing.T) {
	e := newTestEnv(t)
	e.server.gardenDir = filepath.Join(e.server.staticDir, "garden")
	writeNotes(t, e.server.gardenDir, map[string]string{
		"Docker":                 pub + "see [[Namespaces]]",
		"Namespaces":             pub + "ns",
		"Notes From Underground": "---\ntags:\n  - public\n  - books\n---\nbook",
	})
	g, err := LoadGarden(e.server.gardenDir)
	if err != nil {
		t.Fatal(err)
	}
	e.server.garden.Store(g)
	cl := e.anon()

	body := func(path string, status int) string {
		b, _ := io.ReadAll(cl.expect(status, "GET", path, nil).Body)
		return string(b)
	}
	if idx := body("/notes/", 200); !strings.Contains(idx, `href="/notes/notes-from-underground"`) || !strings.Contains(idx, `id="books"`) {
		t.Errorf("index: %s", idx)
	}
	if page := body("/notes/namespaces", 200); !strings.Contains(page, "Linked from") || !strings.Contains(page, `href="/notes/docker"`) {
		t.Errorf("note page missing backlinks: %s", page)
	}
	body("/notes/secret", 404)

	var api gardenJSON
	json.NewDecoder(cl.expect(200, "GET", "/api/garden", nil).Body).Decode(&api)
	if len(api.Notes) != 3 || len(api.Links) != 1 || api.Links[0] != [2]string{"docker", "namespaces"} {
		t.Errorf("api: %+v", api)
	}

	for path, want := range map[string]string{
		"/books.html": "/notes/#books",
		"/page.html?doc=Notes%20From%20Underground": "/notes/notes-from-underground",
		"/page.html?doc=Gone":                       "/notes/",
		"/notes":                                    "/notes/",
	} {
		if got := cl.expect(301, "GET", path, nil).Header.Get("Location"); got != want {
			t.Errorf("%s redirected to %q, want %q", path, got, want)
		}
	}

	// Raw markdown and the sync script are never served as static files.
	os.WriteFile(filepath.Join(e.server.staticDir, "garden.sh"), []byte("#!/bin/sh"), 0o644)
	cl.expect(404, "GET", "/garden/Docker.md", nil)
	cl.expect(404, "GET", "/garden.sh", nil)
	cl.expect(404, "GET", "/notes/files/..%2Fgarden.sh", nil)
}

func TestGardenNilSafe(t *testing.T) {
	e := newTestEnv(t)
	cl := e.anon()
	cl.expect(200, "GET", "/notes/", nil)
	cl.expect(404, "GET", "/notes/anything", nil)
	cl.expect(200, "GET", "/api/garden", nil)
	cl.expect(301, "GET", "/page.html?doc=x", nil)
}
