package main

import (
	"cmp"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// sourcesDir is the garden subdirectory holding the citation metadata of cited works, one
// "@citekey.md" per work. garden.sh writes only their frontmatter there, never the note body.
const sourcesDir = "sources"

// Source is a cited work: a paper, book, article or video. A note cites it with [[@citekey]].
type Source struct {
	Key       string
	Type      string
	Title     string
	Authors   []string // "Last, First", or a single name such as a channel or organisation
	Year      string
	Container string // journal, proceedings or site the work appeared in
	Publisher string
	DOI       string
	ISBN      string
	URL       string
}

// citeKey returns the citekey a wikilink target names ("@key" or "Sources/@key"), or "".
func citeKey(target string) string {
	target = strings.TrimSpace(target)
	if key, ok := strings.CutPrefix(target[strings.LastIndex(target, "/")+1:], "@"); ok {
		return key
	}
	return ""
}

// loadSources reads the cited works in dir, keyed by lowercased citekey. A missing dir is no sources.
func loadSources(dir string) (map[string]*Source, error) {
	sources := map[string]*Source{}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return sources, nil
		}
		return nil, err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		src, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		fm, _ := parseFrontmatter(string(src))
		one := func(k string) string { return strings.Join(fm[k], " ") }
		s := &Source{
			Key:       cmp.Or(one("citekey"), strings.TrimPrefix(strings.TrimSuffix(e.Name(), ".md"), "@")),
			Type:      one("type"),
			Title:     one("title"),
			Authors:   fm["author"],
			Year:      one("issued"),
			Container: one("container-title"),
			Publisher: one("publisher"),
			DOI:       strings.TrimPrefix(one("doi"), "https://doi.org/"),
			ISBN:      one("isbn"),
			URL:       one("url"),
		}
		s.Title = cmp.Or(s.Title, s.Key)
		sources[strings.ToLower(s.Key)] = s
	}
	return sources, nil
}

// ID is the anchor of the work's entry in a note's reference list.
func (s *Source) ID() string { return "ref-" + slugify(s.Key) }

// Link is where the work can be read: its DOI if it has one, otherwise its URL.
func (s *Source) Link() string {
	if s.DOI != "" {
		return "https://doi.org/" + s.DOI
	}
	if strings.HasPrefix(s.URL, "https://") || strings.HasPrefix(s.URL, "http://") {
		return s.URL
	}
	return ""
}

// Cite is the in-text citation: "(Ongaro & Ousterhout, 2014)", "(DeCandia et al., 2007)".
func (s *Source) Cite() string {
	last := func(a string) string {
		l, _, _ := strings.Cut(a, ",")
		return strings.TrimSpace(l)
	}
	var who string
	switch len(s.Authors) {
	case 0:
		who = s.Title
	case 1:
		who = last(s.Authors[0])
	case 2:
		who = last(s.Authors[0]) + " & " + last(s.Authors[1])
	default:
		who = last(s.Authors[0]) + " et al."
	}
	return "(" + who + ", " + s.YearOrND() + ")"
}

// YearOrND is the year of publication, or "n.d." when it isn't known.
func (s *Source) YearOrND() string { return cmp.Or(s.Year, "n.d.") }

// AuthorList writes the authors for the reference list with first names as initials:
// "Ongaro, D., & Ousterhout, J.".
func (s *Source) AuthorList() string {
	names := make([]string, len(s.Authors))
	for i, a := range s.Authors {
		last, first, _ := strings.Cut(a, ",")
		names[i] = strings.TrimSpace(last)
		for j, part := range strings.Fields(first) {
			if j == 0 {
				names[i] += ","
			}
			names[i] += " " + string([]rune(part)[:1]) + "."
		}
	}
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + ", & " + names[len(names)-1]
}

// sortSources orders a reference list by author, then year, then title.
func sortSources(refs []*Source) {
	key := func(s *Source) string { return strings.ToLower(cmp.Or(s.AuthorList(), s.Title)) }
	slices.SortFunc(refs, func(a, b *Source) int {
		return cmp.Or(cmp.Compare(key(a), key(b)), cmp.Compare(a.Year, b.Year), cmp.Compare(a.Title, b.Title))
	})
}

// dot ends s with a full stop unless it already ends a sentence.
func dot(s string) string {
	if s == "" || strings.ContainsRune(".?!", rune(s[len(s)-1])) {
		return s
	}
	return s + "."
}
