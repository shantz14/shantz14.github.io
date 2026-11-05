package main

import (
	"bytes"
	"regexp"

	"github.com/microcosm-cc/bluemonday"
	"github.com/yuin/goldmark"
	emoji "github.com/yuin/goldmark-emoji"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

// Markdown renders GitHub-flavored comment markdown to sanitized HTML.
type Markdown struct {
	md     goldmark.Markdown
	policy *bluemonday.Policy
}

func NewMarkdown() *Markdown {
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM, emoji.Emoji),
		// GitHub comments treat single newlines as line breaks.
		goldmark.WithRendererOptions(html.WithHardWraps()),
	)

	p := bluemonday.UGCPolicy()
	p.RequireNoFollowOnLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)
	p.AllowAttrs("class").Matching(regexp.MustCompile(`^language-[\w-]+$`)).OnElements("code")
	// GFM task lists.
	p.AllowAttrs("type").Matching(regexp.MustCompile(`^checkbox$`)).OnElements("input")
	p.AllowAttrs("checked", "disabled").OnElements("input")

	return &Markdown{md: md, policy: p}
}

func (m *Markdown) Render(src string) (string, error) {
	var buf bytes.Buffer
	if err := m.md.Convert([]byte(src), &buf); err != nil {
		return "", err
	}
	return m.policy.Sanitize(buf.String()), nil
}
