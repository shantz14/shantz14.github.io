package main

import (
	"bytes"
	"cmp"
	"crypto/sha256"
	"embed"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/microcosm-cc/bluemonday"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
)

// publicTag marks a vault note for publishing. It is a publishing switch, not a topic, so it is never shown.
const publicTag = "public"

// Note is one published Obsidian note.
type Note struct {
	Slug    string
	Title   string
	Tags    []string // without publicTag
	Aliases []string
	Created string
	Source  string
	HTML    template.HTML

	body      string   // markdown after the frontmatter
	related   []string // wikilink targets from the `related:` frontmatter field
	Links     []*Note  // outgoing, resolved, deduplicated
	Backlinks []*Note
}

// Garden is an immutable snapshot of the published notes; reloads swap in a new one.
type Garden struct {
	Notes  []*Note // sorted by title
	bySlug map[string]*Note
	byName map[string]*Note // lowercased title or alias
}

// Note returns the note with the given slug, or nil. Safe on a nil Garden.
func (g *Garden) Note(slug string) *Note {
	if g == nil {
		return nil
	}
	return g.bySlug[slug]
}

func (g *Garden) resolve(target string) *Note {
	return g.byName[strings.ToLower(strings.TrimSpace(target))]
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// slugify turns a note title into a URL path segment: "TLA+ for testing" -> "tla-for-testing".
func slugify(s string) string {
	s = strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(s), "-"), "-")
	if s == "" {
		return "note"
	}
	return s
}

// headingID approximates goldmark's auto heading IDs so [[Note#Heading]] can link to a section.
func headingID(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case r == ' ':
			b.WriteRune('-')
		case r == '-' || r == '_' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r > 127:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// parseFrontmatter splits a note into its YAML frontmatter fields and body. It understands the
// subset Obsidian writes: `key: value`, `key: [a, b]` and `key:` followed by `  - item` lines.
func parseFrontmatter(src string) (map[string][]string, string) {
	src = strings.ReplaceAll(src, "\r\n", "\n")
	fields := map[string][]string{}
	if !strings.HasPrefix(src, "---\n") {
		return fields, src
	}
	end := strings.Index(src[4:], "\n---")
	if end < 0 {
		return fields, src
	}
	head, body := src[4:4+end], src[4+end+4:]
	if i := strings.IndexByte(body, '\n'); i >= 0 && strings.TrimSpace(body[:i]) == "" {
		body = body[i+1:]
	} else if strings.TrimSpace(body) == "" {
		body = ""
	}

	unquote := func(v string) string { return strings.Trim(strings.TrimSpace(v), `"'`) }
	key := ""
	for _, line := range strings.Split(head, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- ") || trimmed == "-" {
			if key != "" {
				if v := unquote(strings.TrimPrefix(trimmed, "-")); v != "" {
					fields[key] = append(fields[key], v)
				}
			}
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok || strings.HasPrefix(line, " ") {
			continue
		}
		key = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		fields[key] = fields[key][:0:0]
		if strings.HasPrefix(v, "[") && strings.HasSuffix(v, "]") && !strings.HasPrefix(v, "[[") {
			for _, item := range strings.Split(v[1:len(v)-1], ",") {
				if item = unquote(item); item != "" {
					fields[key] = append(fields[key], item)
				}
			}
		} else if v = unquote(v); v != "" {
			fields[key] = append(fields[key], v)
		}
	}
	return fields, body
}

// wikilink matches [[target]], [[target|display]], [[target#heading]] and image embeds ![[...]].
var wikilink = regexp.MustCompile(`(!?)\[\[([^\[\]|#]*)(#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]`)

// codeSpans matches fenced code blocks and inline code, which must not have wikilinks rewritten.
var codeSpans = regexp.MustCompile("(?s)(?m:^[ \t]*```.*?^[ \t]*```[ \t]*$)|`[^`\n]+`")

// rewriteWikilinks turns Obsidian wikilinks into markdown links (or plain text for notes that
// aren't published), outside of code. It returns the rewritten markdown and the notes it linked to.
func (g *Garden) rewriteWikilinks(md string) (string, []*Note) {
	var linked []*Note
	replace := func(s string) string {
		return wikilink.ReplaceAllStringFunc(s, func(m string) string {
			p := wikilink.FindStringSubmatch(m)
			embed, target, heading, display := p[1] == "!", strings.TrimSpace(p[2]), strings.TrimPrefix(p[3], "#"), p[4]
			if embed && isImage(target) {
				return fmt.Sprintf("![%s](/notes/files/%s)", escapeMD(cmp.Or(display, target)), pathEscape(target))
			}
			if display == "" {
				switch {
				case target == "":
					display = heading
				case heading != "":
					display = target + " › " + heading
				default:
					display = target
				}
			}
			if target == "" && heading != "" { // [[#Heading]]: a link within the same note
				return fmt.Sprintf("[%s](#%s)", escapeMD(display), headingID(heading))
			}
			n := g.resolve(target)
			if n == nil {
				return `<span class="dead-link">` + template.HTMLEscapeString(display) + `</span>`
			}
			linked = append(linked, n)
			href := "/notes/" + n.Slug
			if heading != "" {
				href += "#" + headingID(heading)
			}
			return fmt.Sprintf("[%s](%s)", escapeMD(display), href)
		})
	}

	var out strings.Builder
	last := 0
	for _, loc := range codeSpans.FindAllStringIndex(md, -1) {
		out.WriteString(replace(md[last:loc[0]]))
		out.WriteString(md[loc[0]:loc[1]])
		last = loc[1]
	}
	out.WriteString(replace(md[last:]))
	return out.String(), linked
}

func isImage(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp":
		return true
	}
	return false
}

var mdSpecial = strings.NewReplacer(`\`, `\\`, `[`, `\[`, `]`, `\]`, `*`, `\*`, `_`, `\_`, "`", "\\`", `<`, `&lt;`)

func escapeMD(s string) string { return mdSpecial.Replace(s) }

func pathEscape(s string) string { return strings.ReplaceAll(template.URLQueryEscaper(s), "+", "%20") }

// noteRenderer renders note markdown the way Obsidian's reading view does (single newlines are
// line breaks), keeping only the HTML a note page needs.
type noteRenderer struct {
	md     goldmark.Markdown
	policy *bluemonday.Policy
}

func newNoteRenderer() *noteRenderer {
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithParserOptions(parser.WithAutoHeadingID()),
		goldmark.WithRendererOptions(html.WithHardWraps(), html.WithUnsafe()),
	)
	p := bluemonday.UGCPolicy()
	p.RequireNoFollowOnLinks(false) // UGCPolicy sets it for every link; internal links should stay followable.
	p.RequireNoFollowOnFullyQualifiedLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)
	p.AllowAttrs("class").Matching(regexp.MustCompile(`^language-[\w+-]+$`)).OnElements("code")
	p.AllowAttrs("class").Matching(regexp.MustCompile(`^dead-link$`)).OnElements("span")
	p.AllowAttrs("type").Matching(regexp.MustCompile(`^checkbox$`)).OnElements("input")
	p.AllowAttrs("checked", "disabled").OnElements("input")
	return &noteRenderer{md: md, policy: p}
}

func (r *noteRenderer) render(src string) (template.HTML, error) {
	var buf bytes.Buffer
	if err := r.md.Convert([]byte(src), &buf); err != nil {
		return "", err
	}
	return template.HTML(r.policy.Sanitize(buf.String())), nil
}

// LoadGarden reads every .md file directly inside dir. A missing dir is an empty garden.
func LoadGarden(dir string) (*Garden, error) {
	g := &Garden{bySlug: map[string]*Note{}, byName: map[string]*Note{}}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return g, nil
		}
		return nil, err
	}

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		src, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		fm, body := parseFrontmatter(string(src))
		if !slices.Contains(fm["tags"], publicTag) {
			continue // defence in depth: garden.sh only copies public notes
		}
		n := &Note{
			Title:   strings.TrimSuffix(e.Name(), ".md"),
			Aliases: fm["aliases"],
			Created: strings.Join(fm["created_on"], " "),
			Source:  strings.Join(fm["source"], " "),
			body:    body,
		}
		for _, t := range fm["tags"] {
			if t = strings.TrimPrefix(t, "#"); t != publicTag && !slices.Contains(n.Tags, t) {
				n.Tags = append(n.Tags, t)
			}
		}
		for _, rel := range fm["related"] {
			for _, m := range wikilink.FindAllStringSubmatch(rel, -1) {
				n.related = append(n.related, m[2])
			}
		}
		g.Notes = append(g.Notes, n)
	}

	slices.SortFunc(g.Notes, func(a, b *Note) int {
		return cmp.Or(cmp.Compare(strings.ToLower(a.Title), strings.ToLower(b.Title)), cmp.Compare(a.Title, b.Title))
	})
	for _, n := range g.Notes {
		base := slugify(n.Title)
		n.Slug = base
		for i := 2; g.bySlug[n.Slug] != nil; i++ {
			n.Slug = fmt.Sprintf("%s-%d", base, i)
		}
		g.bySlug[n.Slug] = n
		g.byName[strings.ToLower(n.Title)] = n
	}
	for _, n := range g.Notes { // aliases never shadow a real title
		for _, a := range n.Aliases {
			if k := strings.ToLower(a); g.byName[k] == nil {
				g.byName[k] = n
			}
		}
	}

	r := newNoteRenderer()
	for _, n := range g.Notes {
		md, linked := g.rewriteWikilinks(stripTitleHeading(n.body, n.Title))
		for _, rel := range n.related {
			if t := g.resolve(rel); t != nil {
				linked = append(linked, t)
			}
		}
		for _, t := range linked {
			if t != n && !slices.Contains(n.Links, t) {
				n.Links = append(n.Links, t)
				t.Backlinks = append(t.Backlinks, n)
			}
		}
		if n.HTML, err = r.render(md); err != nil {
			return nil, fmt.Errorf("render %s: %w", n.Title, err)
		}
	}
	for _, n := range g.Notes {
		slices.SortFunc(n.Backlinks, func(a, b *Note) int { return cmp.Compare(strings.ToLower(a.Title), strings.ToLower(b.Title)) })
	}
	return g, nil
}

// stripTitleHeading drops a leading "# Title" that repeats the file name, since the page shows it.
func stripTitleHeading(body, title string) string {
	trimmed := strings.TrimLeft(body, "\n")
	line, rest, _ := strings.Cut(trimmed, "\n")
	if h, ok := strings.CutPrefix(line, "# "); ok && strings.EqualFold(strings.TrimSpace(h), title) {
		return rest
	}
	return body
}

// gardenFingerprint changes whenever a file in dir is added, removed or modified.
func gardenFingerprint(dir string) string {
	h := sha256.New()
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			fmt.Fprintf(h, "%s %d %d\n", p, info.Size(), info.ModTime().UnixNano())
		}
		return nil
	})
	return string(h.Sum(nil))
}

// watchGarden reloads the garden whenever its files change. Used for local development.
func (s *Server) watchGarden(done <-chan struct{}) {
	last := gardenFingerprint(s.gardenDir)
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-done:
			return
		case <-t.C:
			if fp := gardenFingerprint(s.gardenDir); fp != last {
				last = fp
				if g, err := LoadGarden(s.gardenDir); err != nil {
					log.Printf("reload garden: %v", err)
				} else {
					s.garden.Store(g)
					log.Printf("garden reloaded: %d notes", len(g.Notes))
				}
			}
		}
	}
}

// ── HTTP ──

//go:embed templates/*.html
var templateFS embed.FS

var gardenTemplates = template.Must(template.New("").Funcs(template.FuncMap{
	"topTag":  topTag,
	"rowTags": rowTags,
}).ParseFS(templateFS, "templates/*.html"))

func topTag(tag string) string {
	top, _, _ := strings.Cut(tag, "/")
	return top
}

// rowTags describes a note's tags on the index relative to its category: under Computer Science,
// "cs" and "cs/linux" read as just "linux".
func rowTags(categoryKey string, tags []string) string {
	var out []string
	for _, t := range tags {
		if t == categoryKey {
			continue
		}
		t = strings.TrimPrefix(t, categoryKey+"/")
		if !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	return strings.Join(out, " · ")
}

type category struct {
	Key, Label string
	Notes      []*Note
}

var categoryLabels = map[string]string{"books": "Books", "cs": "Computer Science", "philosophy": "Philosophy"}

// categorize groups notes for the index: anything tagged books is a book; otherwise a note goes
// under the top level of its first tag. Books come first, then the rest alphabetically.
func categorize(notes []*Note) []category {
	byKey := map[string]*category{}
	var keys []string
	for _, n := range notes {
		key := "misc"
		if slices.Contains(n.Tags, "books") {
			key = "books"
		} else if len(n.Tags) > 0 {
			key = topTag(n.Tags[0])
		}
		c := byKey[key]
		if c == nil {
			label := categoryLabels[key]
			if label == "" {
				label = strings.ToUpper(key[:1]) + key[1:]
			}
			c = &category{Key: key, Label: label}
			byKey[key] = c
			keys = append(keys, key)
		}
		c.Notes = append(c.Notes, n)
	}
	slices.SortFunc(keys, func(a, b string) int {
		if a == "books" || b == "books" {
			return cmp.Compare(b2i(a != "books"), b2i(b != "books"))
		}
		if a == "misc" || b == "misc" {
			return cmp.Compare(b2i(a == "misc"), b2i(b == "misc"))
		}
		return cmp.Compare(byKey[a].Label, byKey[b].Label)
	})
	out := make([]category, len(keys))
	for i, k := range keys {
		out[i] = *byKey[k]
	}
	return out
}

// nonNil keeps empty lists as [] rather than null in JSON.
func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (s *Server) renderTemplate(w http.ResponseWriter, status int, name string, data any) {
	var buf bytes.Buffer
	if err := gardenTemplates.ExecuteTemplate(&buf, name, data); err != nil {
		log.Printf("render %s: %v", name, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	buf.WriteTo(w)
}

func (s *Server) handleGardenIndex(w http.ResponseWriter, r *http.Request) {
	g := s.garden.Load()
	var notes []*Note
	if g != nil {
		notes = g.Notes
	}
	s.renderTemplate(w, http.StatusOK, "index.html", map[string]any{"Categories": categorize(notes), "Count": len(notes)})
}

func (s *Server) handleNote(w http.ResponseWriter, r *http.Request) {
	n := s.garden.Load().Note(r.PathValue("slug"))
	if n == nil {
		s.renderTemplate(w, http.StatusNotFound, "note.html", map[string]any{"Missing": true})
		return
	}
	s.renderTemplate(w, http.StatusOK, "note.html", map[string]any{"Note": n})
}

type gardenNoteJSON struct {
	Slug    string   `json:"slug"`
	Title   string   `json:"title"`
	Aliases []string `json:"aliases"`
	Tags    []string `json:"tags"`
}

type gardenJSON struct {
	Notes []gardenNoteJSON `json:"notes"`
	Links [][2]string      `json:"links"` // undirected, deduplicated slug pairs
}

func (s *Server) handleGardenAPI(w http.ResponseWriter, r *http.Request) {
	out := gardenJSON{Notes: []gardenNoteJSON{}, Links: [][2]string{}}
	if g := s.garden.Load(); g != nil {
		seen := map[[2]string]bool{}
		for _, n := range g.Notes {
			out.Notes = append(out.Notes, gardenNoteJSON{n.Slug, n.Title, nonNil(n.Aliases), nonNil(n.Tags)})
			for _, t := range n.Links {
				pair := [2]string{n.Slug, t.Slug}
				if pair[0] > pair[1] {
					pair[0], pair[1] = pair[1], pair[0]
				}
				if !seen[pair] {
					seen[pair] = true
					out.Links = append(out.Links, pair)
				}
			}
		}
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, out)
}

// handleGardenFile serves image attachments that garden.sh copied next to the notes.
func (s *Server) handleGardenFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !isImage(name) || strings.ContainsAny(name, `/\`) || strings.HasPrefix(name, ".") {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.gardenDir, name))
}

// handleOldPage redirects the pre-garden /page.html?doc=Title URLs to the note.
func (s *Server) handleOldPage(w http.ResponseWriter, r *http.Request) {
	target := "/notes/"
	if doc := r.URL.Query().Get("doc"); doc != "" {
		if n := s.garden.Load().resolveOrNil(doc); n != nil {
			target += n.Slug
		}
	}
	http.Redirect(w, r, target, http.StatusMovedPermanently)
}

func (g *Garden) resolveOrNil(name string) *Note {
	if g == nil {
		return nil
	}
	return g.resolve(name)
}
