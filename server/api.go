package main

import (
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	maxBodyChars   = 65536
	maxRequestSize = 1 << 18
	maxThreadLen   = 512
)

// GitHub's reaction set, keyed by its GraphQL ReactionContent names.
var reactionContents = map[string]bool{
	"THUMBS_UP": true, "THUMBS_DOWN": true, "LAUGH": true, "HOORAY": true,
	"CONFUSED": true, "HEART": true, "ROCKET": true, "EYES": true,
}

// upvote is stored as a reaction but only allowed on top-level comments.
const upvote = "UPVOTE"

// normalizeThread maps a page path to a thread key so "/" and "/index.html" share a thread.
func normalizeThread(raw string) (string, bool) {
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	if !strings.HasPrefix(raw, "/") || len(raw) > maxThreadLen {
		return "", false
	}
	p := path.Clean(raw)
	if path.Base(p) == "index.html" {
		p = path.Dir(p)
	}
	return p, true
}

// threadExists reports whether the thread key corresponds to a page the site serves.
func (s *Server) threadExists(key string) bool {
	for _, candidate := range []string{key, path.Join(key, "index.html")} {
		if hiddenPath(candidate) {
			continue
		}
		fi, err := os.Stat(filepath.Join(s.staticDir, filepath.FromSlash(candidate)))
		if err == nil && !fi.IsDir() && strings.HasSuffix(candidate, ".html") {
			return true
		}
	}
	return false
}

type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[int64][]time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, hits: map[int64][]time.Time{}}
}

func (l *rateLimiter) Allow(userID int64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	recent := l.hits[userID][:0]
	for _, t := range l.hits[userID] {
		if now.Sub(t) < l.window {
			recent = append(recent, t)
		}
	}
	if len(recent) >= l.limit {
		l.hits[userID] = recent
		return false
	}
	l.hits[userID] = append(recent, now)
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) serverError(w http.ResponseWriter, err error) {
	log.Printf("internal error: %v", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestSize)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

// guard rejects cross-site writes: the request must be JSON and come from our own origin.
func (s *Server) guard(next http.HandlerFunc) http.HandlerFunc {
	origin := s.baseURL.Scheme + "://" + s.baseURL.Host
	return func(w http.ResponseWriter, r *http.Request) {
		if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
			writeError(w, http.StatusUnsupportedMediaType, "expected application/json")
			return
		}
		if o := r.Header.Get("Origin"); o != "" {
			if o != origin {
				writeError(w, http.StatusForbidden, "cross-origin request rejected")
				return
			}
		} else if r.Header.Get("Sec-Fetch-Site") != "same-origin" {
			writeError(w, http.StatusForbidden, "cross-origin request rejected")
			return
		}
		next(w, r)
	}
}

// requireViewer wraps handlers that need a signed-in user.
func (s *Server) requireViewer(next func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v := s.viewer(r)
		if v == nil {
			writeError(w, http.StatusUnauthorized, "sign in required")
			return
		}
		next(w, r, v)
	}
}

func (s *Server) isOwner(u User) bool { return strings.EqualFold(u.Login, s.ownerLogin) }

type commentJSON struct {
	ID                int64                     `json:"id"`
	Author            User                      `json:"author"`
	AuthorAssociation string                    `json:"authorAssociation"`
	CreatedAt         string                    `json:"createdAt"`
	LastEditedAt      *string                   `json:"lastEditedAt"`
	DeletedAt         *string                   `json:"deletedAt"`
	BodyHTML          string                    `json:"bodyHTML"`
	BodyMarkdown      string                    `json:"bodyMarkdown,omitempty"`
	ViewerDidAuthor   bool                      `json:"viewerDidAuthor"`
	ViewerCanDelete   bool                      `json:"viewerCanDelete"`
	UpvoteCount       int                       `json:"upvoteCount"`
	ViewerHasUpvoted  bool                      `json:"viewerHasUpvoted"`
	Reactions         map[string]*ReactionGroup `json:"reactions"`
	ReplyCount        int                       `json:"replyCount"`
	Replies           []*commentJSON            `json:"replies,omitempty"`
}

type threadJSON struct {
	Viewer            *User                     `json:"viewer"`
	Thread            string                    `json:"thread"`
	ReactionCount     int                       `json:"reactionCount"`
	Reactions         map[string]*ReactionGroup `json:"reactions"`
	TotalCommentCount int                       `json:"totalCommentCount"`
	TotalReplyCount   int                       `json:"totalReplyCount"`
	Comments          []*commentJSON            `json:"comments"`
}

func isoTime(msec int64) string { return time.UnixMilli(msec).UTC().Format(time.RFC3339Nano) }

func (s *Server) toJSON(c *Comment, viewer *User, groups map[string]*ReactionGroup) *commentJSON {
	out := &commentJSON{
		ID:                c.ID,
		Author:            c.Author,
		AuthorAssociation: "NONE",
		CreatedAt:         isoTime(c.CreatedAt),
		BodyHTML:          c.BodyHTML,
		Reactions:         map[string]*ReactionGroup{},
	}
	if s.isOwner(c.Author) {
		out.AuthorAssociation = "OWNER"
	}
	if c.DeletedAt != nil {
		t := isoTime(*c.DeletedAt)
		out.DeletedAt = &t
	} else if c.UpdatedAt > c.CreatedAt {
		t := isoTime(c.UpdatedAt)
		out.LastEditedAt = &t
	}
	if viewer != nil && c.DeletedAt == nil {
		out.ViewerDidAuthor = viewer.ID == c.Author.ID
		out.ViewerCanDelete = out.ViewerDidAuthor || s.isOwner(*viewer)
		if out.ViewerDidAuthor {
			out.BodyMarkdown = c.BodyMD
		}
	}
	for content, g := range groups {
		if content == upvote {
			out.UpvoteCount = g.Count
			out.ViewerHasUpvoted = g.ViewerHasReacted
		} else {
			out.Reactions[content] = g
		}
	}
	return out
}

func (s *Server) handleThread(w http.ResponseWriter, r *http.Request) {
	key, ok := normalizeThread(r.URL.Query().Get("key"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid thread key")
		return
	}
	viewer := s.viewer(r)
	var viewerID int64
	if viewer != nil {
		viewerID = viewer.ID
	}

	comments, err := s.store.ThreadComments(key)
	if err != nil {
		s.serverError(w, err)
		return
	}
	reactions, err := s.store.ThreadReactions(key, viewerID)
	if err != nil {
		s.serverError(w, err)
		return
	}

	out := threadJSON{Viewer: viewer, Thread: key, Reactions: map[string]*ReactionGroup{}, Comments: []*commentJSON{}}
	for content, g := range reactions[""] {
		out.Reactions[content] = g
		out.ReactionCount += g.Count
	}

	// Comments arrive oldest first, so parents always precede their replies.
	top := map[int64]*commentJSON{}
	var order []*commentJSON
	for _, c := range comments {
		cj := s.toJSON(c, viewer, reactions[commentKey(c.ID)])
		if c.ParentID == nil {
			cj.Replies = []*commentJSON{}
			top[c.ID] = cj
			order = append(order, cj)
			continue
		}
		if parent := top[*c.ParentID]; parent != nil && c.DeletedAt == nil {
			parent.Replies = append(parent.Replies, cj)
			parent.ReplyCount++
		}
	}
	for _, cj := range order {
		// A deleted comment stays only as a placeholder for its replies.
		if cj.DeletedAt != nil && cj.ReplyCount == 0 {
			continue
		}
		out.Comments = append(out.Comments, cj)
		out.TotalReplyCount += cj.ReplyCount
	}
	out.TotalCommentCount = len(out.Comments)
	writeJSON(w, http.StatusOK, out)
}

func validBody(w http.ResponseWriter, body string) (string, bool) {
	body = strings.TrimSpace(body)
	if body == "" {
		writeError(w, http.StatusBadRequest, "comment body is empty")
		return "", false
	}
	if utf8.RuneCountInString(body) > maxBodyChars {
		writeError(w, http.StatusRequestEntityTooLarge, "comment is too long")
		return "", false
	}
	return body, true
}

func (s *Server) handleCreateComment(w http.ResponseWriter, r *http.Request, viewer *User) {
	var req struct {
		Thread   string `json:"thread"`
		ParentID *int64 `json:"parentId"`
		Body     string `json:"body"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	key, ok := normalizeThread(req.Thread)
	if !ok || !s.threadExists(key) {
		writeError(w, http.StatusBadRequest, "unknown thread")
		return
	}
	body, ok := validBody(w, req.Body)
	if !ok {
		return
	}

	parentID := req.ParentID
	if parentID != nil {
		parent, err := s.store.GetComment(*parentID)
		if errors.Is(err, ErrNotFound) || (err == nil && (parent.Thread != key || parent.DeletedAt != nil)) {
			writeError(w, http.StatusBadRequest, "unknown parent comment")
			return
		} else if err != nil {
			s.serverError(w, err)
			return
		}
		// Replies are one level deep: replying to a reply attaches to its top-level comment.
		if parent.ParentID != nil {
			parentID = parent.ParentID
		}
	}

	if !s.limiter.Allow(viewer.ID) {
		writeError(w, http.StatusTooManyRequests, "you're commenting too fast, try again in a minute")
		return
	}
	html, err := s.md.Render(body)
	if err != nil {
		s.serverError(w, err)
		return
	}
	id, err := s.store.CreateComment(key, parentID, viewer.ID, body, html)
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

// ownComment loads the comment named in the URL and checks the viewer may act on it.
func (s *Server) ownComment(w http.ResponseWriter, r *http.Request, viewer *User, allowOwner bool) (*Comment, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "comment not found")
		return nil, false
	}
	c, err := s.store.GetComment(id)
	if errors.Is(err, ErrNotFound) || (err == nil && c.DeletedAt != nil) {
		writeError(w, http.StatusNotFound, "comment not found")
		return nil, false
	} else if err != nil {
		s.serverError(w, err)
		return nil, false
	}
	if c.Author.ID != viewer.ID && !(allowOwner && s.isOwner(*viewer)) {
		writeError(w, http.StatusForbidden, "not your comment")
		return nil, false
	}
	return c, true
}

func (s *Server) handleEditComment(w http.ResponseWriter, r *http.Request, viewer *User) {
	c, ok := s.ownComment(w, r, viewer, false)
	if !ok {
		return
	}
	var req struct {
		Body string `json:"body"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	body, ok := validBody(w, req.Body)
	if !ok {
		return
	}
	html, err := s.md.Render(body)
	if err != nil {
		s.serverError(w, err)
		return
	}
	if err := s.store.UpdateComment(c.ID, body, html); err != nil {
		s.serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request, viewer *User) {
	c, ok := s.ownComment(w, r, viewer, true)
	if !ok {
		return
	}
	if err := s.store.DeleteComment(c.ID); err != nil {
		s.serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleReaction(w http.ResponseWriter, r *http.Request, viewer *User) {
	var req struct {
		TargetType string `json:"targetType"`
		TargetID   string `json:"targetId"`
		Content    string `json:"content"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	targetID := req.TargetID
	switch req.TargetType {
	case "thread":
		key, ok := normalizeThread(req.TargetID)
		if !ok || !s.threadExists(key) || !reactionContents[req.Content] {
			writeError(w, http.StatusBadRequest, "invalid reaction")
			return
		}
		targetID = key
	case "comment":
		id, err := strconv.ParseInt(req.TargetID, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid reaction")
			return
		}
		c, err := s.store.GetComment(id)
		if errors.Is(err, ErrNotFound) || (err == nil && c.DeletedAt != nil) {
			writeError(w, http.StatusNotFound, "comment not found")
			return
		} else if err != nil {
			s.serverError(w, err)
			return
		}
		if !reactionContents[req.Content] && !(req.Content == upvote && c.ParentID == nil) {
			writeError(w, http.StatusBadRequest, "invalid reaction")
			return
		}
		targetID = commentKey(c.ID)
	default:
		writeError(w, http.StatusBadRequest, "invalid reaction")
		return
	}

	if err := s.store.ToggleReaction(req.TargetType, targetID, viewer.ID, req.Content); err != nil {
		s.serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMarkdown(w http.ResponseWriter, r *http.Request, _ *User) {
	var req struct {
		Body string `json:"body"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if utf8.RuneCountInString(req.Body) > maxBodyChars {
		writeError(w, http.StatusRequestEntityTooLarge, "comment is too long")
		return
	}
	html, err := s.md.Render(req.Body)
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"html": html})
}
