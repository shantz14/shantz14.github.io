package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

type testEnv struct {
	t      *testing.T
	srv    *httptest.Server
	server *Server
}

// newTestEnv starts the server against a temp DB and static dir, with a fake GitHub whose
// OAuth code is the login of the user to sign in as.
func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>home</html>"), 0o644)

	store, err := OpenStore(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	ids := map[string]int64{"shantz14": 1, "alice": 2, "bob": 3}
	gh := http.NewServeMux()
	gh.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		json.NewEncoder(w).Encode(map[string]string{"access_token": r.Form.Get("code")})
	})
	gh.HandleFunc("GET /user", func(w http.ResponseWriter, r *http.Request) {
		login := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		json.NewEncoder(w).Encode(map[string]any{
			"id": ids[login], "login": login,
			"avatar_url": "https://avatars.example/" + login, "html_url": "https://github.com/" + login,
		})
	})
	ghSrv := httptest.NewServer(gh)
	t.Cleanup(ghSrv.Close)

	s := &Server{
		store:      store,
		md:         NewMarkdown(),
		limiter:    newRateLimiter(100, time.Minute),
		http:       ghSrv.Client(),
		github:     GitHubEndpoints{AuthorizeURL: ghSrv.URL + "/authorize", TokenURL: ghSrv.URL + "/token", UserURL: ghSrv.URL + "/user"},
		clientID:   "id",
		ownerLogin: "shantz14",
		staticDir:  dir,
	}
	srv := httptest.NewUnstartedServer(nil)
	s.baseURL, _ = url.Parse("http://" + srv.Listener.Addr().String())
	srv.Config.Handler = s.Handler()
	srv.Start()
	t.Cleanup(srv.Close)
	return &testEnv{t: t, srv: srv, server: s}
}

type client struct {
	env *testEnv
	c   *http.Client
}

func (e *testEnv) anon() *client {
	jar, _ := cookiejar.New(nil)
	return &client{env: e, c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}}
}

// login runs the OAuth flow by hand: /auth/login, then the callback GitHub would redirect to.
func (e *testEnv) login(login string) *client {
	cl := e.anon()
	resp := cl.do("GET", "/auth/login?return=/index.html", nil, nil)
	loc, _ := url.Parse(resp.Header.Get("Location"))
	state := loc.Query().Get("state")
	resp = cl.do("GET", "/auth/callback?code="+login+"&state="+state, nil, nil)
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != "/index.html" {
		e.t.Fatalf("callback: %d %s", resp.StatusCode, resp.Header.Get("Location"))
	}
	return cl
}

func (cl *client) do(method, path string, body any, headers map[string]string) *http.Response {
	cl.env.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = strings.NewReader(string(b))
	}
	req, _ := http.NewRequest(method, cl.env.srv.URL+path, r)
	if method != "GET" {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", cl.env.srv.URL)
	}
	for k, v := range headers {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	resp, err := cl.c.Do(req)
	if err != nil {
		cl.env.t.Fatal(err)
	}
	cl.env.t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func (cl *client) expect(status int, method, path string, body any) *http.Response {
	cl.env.t.Helper()
	resp := cl.do(method, path, body, nil)
	if resp.StatusCode != status {
		b, _ := io.ReadAll(resp.Body)
		cl.env.t.Fatalf("%s %s: got %d, want %d: %s", method, path, resp.StatusCode, status, b)
	}
	return resp
}

func (cl *client) thread() threadJSON {
	cl.env.t.Helper()
	var out threadJSON
	json.NewDecoder(cl.expect(200, "GET", "/api/thread?key=/", nil).Body).Decode(&out)
	return out
}

func (cl *client) post(parent *int64, body string) int64 {
	cl.env.t.Helper()
	var out struct{ ID int64 }
	json.NewDecoder(cl.expect(201, "POST", "/api/comments",
		map[string]any{"thread": "/index.html", "parentId": parent, "body": body}).Body).Decode(&out)
	return out.ID
}

func TestCommentLifecycle(t *testing.T) {
	e := newTestEnv(t)
	alice, bob, owner := e.login("alice"), e.login("bob"), e.login("shantz14")

	c1 := alice.post(nil, "hello **world**")
	r1 := bob.post(&c1, "a reply")
	r2 := alice.post(&r1, "reply to a reply") // flattens onto c1
	owner.post(nil, "owner here")

	th := bob.thread()
	if th.Viewer == nil || th.Viewer.Login != "bob" {
		t.Fatalf("viewer = %+v", th.Viewer)
	}
	if th.TotalCommentCount != 2 || th.TotalReplyCount != 2 {
		t.Fatalf("counts = %d comments, %d replies", th.TotalCommentCount, th.TotalReplyCount)
	}
	first := th.Comments[0]
	if first.ID != c1 || !strings.Contains(first.BodyHTML, "<strong>world</strong>") || first.ViewerDidAuthor {
		t.Fatalf("first comment = %+v", first)
	}
	if len(first.Replies) != 2 || first.Replies[0].ID != r1 || first.Replies[1].ID != r2 || !first.Replies[0].ViewerDidAuthor {
		t.Fatalf("replies = %+v", first.Replies)
	}
	if th.Comments[1].AuthorAssociation != "OWNER" || first.AuthorAssociation != "NONE" {
		t.Fatal("owner badge wrong")
	}

	// Edit: only the author, and it shows as edited.
	bob.expect(403, "PATCH", fmt.Sprintf("/api/comments/%d", c1), map[string]string{"body": "hijack"})
	alice.expect(204, "PATCH", fmt.Sprintf("/api/comments/%d", c1), map[string]string{"body": "edited body"})
	th = alice.thread()
	if th.Comments[0].LastEditedAt == nil || th.Comments[0].BodyMarkdown != "edited body" {
		t.Fatalf("edit not applied: %+v", th.Comments[0])
	}

	// Delete a comment with replies: it stays as a placeholder.
	bob.expect(403, "DELETE", fmt.Sprintf("/api/comments/%d", c1), nil)
	alice.expect(204, "DELETE", fmt.Sprintf("/api/comments/%d", c1), nil)
	th = bob.thread()
	if th.Comments[0].DeletedAt == nil || th.Comments[0].BodyHTML != "" || len(th.Comments[0].Replies) != 2 {
		t.Fatalf("placeholder = %+v", th.Comments[0])
	}
	bob.expect(400, "POST", "/api/comments", map[string]any{"thread": "/", "parentId": c1, "body": "x"})

	// Once its replies are gone (owner may delete anyone's), the placeholder disappears too.
	owner.expect(204, "DELETE", fmt.Sprintf("/api/comments/%d", r1), nil)
	alice.expect(204, "DELETE", fmt.Sprintf("/api/comments/%d", r2), nil)
	th = bob.thread()
	if th.TotalCommentCount != 1 || th.TotalReplyCount != 0 {
		t.Fatalf("after deletes: %+v", th)
	}
	alice.expect(404, "DELETE", fmt.Sprintf("/api/comments/%d", r2), nil)

	// Anonymous viewers can read but not write.
	anon := e.anon()
	if th := anon.thread(); th.Viewer != nil || th.TotalCommentCount != 1 {
		t.Fatalf("anon thread = %+v", th)
	}
	anon.expect(401, "POST", "/api/comments", map[string]any{"thread": "/", "body": "hi"})
}

func TestReactions(t *testing.T) {
	e := newTestEnv(t)
	alice, bob := e.login("alice"), e.login("bob")
	c := alice.post(nil, "react to me")
	r := bob.post(&c, "reply")
	cid, rid := strconv.FormatInt(c, 10), strconv.FormatInt(r, 10)

	alice.expect(204, "POST", "/api/reactions", map[string]string{"targetType": "thread", "targetId": "/", "content": "HEART"})
	bob.expect(204, "POST", "/api/reactions", map[string]string{"targetType": "thread", "targetId": "/index.html", "content": "HEART"})
	bob.expect(204, "POST", "/api/reactions", map[string]string{"targetType": "comment", "targetId": cid, "content": "ROCKET"})
	bob.expect(204, "POST", "/api/reactions", map[string]string{"targetType": "comment", "targetId": cid, "content": "UPVOTE"})
	alice.expect(204, "POST", "/api/reactions", map[string]string{"targetType": "comment", "targetId": rid, "content": "EYES"})

	th := bob.thread()
	if th.ReactionCount != 2 || th.Reactions["HEART"].Count != 2 || !th.Reactions["HEART"].ViewerHasReacted {
		t.Fatalf("thread reactions = %+v", th.Reactions)
	}
	cm := th.Comments[0]
	if cm.Reactions["ROCKET"].Count != 1 || !cm.Reactions["ROCKET"].ViewerHasReacted || cm.UpvoteCount != 1 || !cm.ViewerHasUpvoted {
		t.Fatalf("comment reactions = %+v upvotes=%d", cm.Reactions, cm.UpvoteCount)
	}
	if g := cm.Replies[0].Reactions["EYES"]; g.Count != 1 || g.ViewerHasReacted {
		t.Fatalf("reply reactions = %+v", cm.Replies[0].Reactions)
	}

	// Toggling again removes it.
	bob.expect(204, "POST", "/api/reactions", map[string]string{"targetType": "comment", "targetId": cid, "content": "ROCKET"})
	if _, ok := bob.thread().Comments[0].Reactions["ROCKET"]; ok {
		t.Fatal("reaction not removed")
	}

	for _, bad := range []map[string]string{
		{"targetType": "comment", "targetId": cid, "content": "SKULL"},
		{"targetType": "comment", "targetId": rid, "content": "UPVOTE"},
		{"targetType": "thread", "targetId": "/", "content": "UPVOTE"},
		{"targetType": "thread", "targetId": "/nope.html", "content": "HEART"},
		{"targetType": "user", "targetId": "1", "content": "HEART"},
	} {
		bob.expect(400, "POST", "/api/reactions", bad)
	}
	bob.expect(404, "POST", "/api/reactions", map[string]string{"targetType": "comment", "targetId": "999", "content": "HEART"})
}

func TestCSRFGuard(t *testing.T) {
	e := newTestEnv(t)
	alice := e.login("alice")
	body := map[string]any{"thread": "/", "body": "hi"}

	cases := []struct {
		name    string
		headers map[string]string
	}{
		{"foreign origin", map[string]string{"Origin": "https://evil.example"}},
		{"no origin, cross-site", map[string]string{"Origin": "", "Sec-Fetch-Site": "cross-site"}},
		{"form content type", map[string]string{"Content-Type": "application/x-www-form-urlencoded"}},
	}
	for _, tc := range cases {
		if resp := alice.do("POST", "/api/comments", body, tc.headers); resp.StatusCode < 400 {
			t.Errorf("%s: got %d", tc.name, resp.StatusCode)
		}
	}
	if resp := alice.do("POST", "/api/comments", body, map[string]string{"Origin": "", "Sec-Fetch-Site": "same-origin"}); resp.StatusCode != 201 {
		t.Errorf("same-origin without Origin header: got %d", resp.StatusCode)
	}
}

func TestLoginLogout(t *testing.T) {
	e := newTestEnv(t)
	cl := e.anon()

	// Open redirects are neutralized.
	resp := cl.do("GET", "/auth/login?return=//evil.example", nil, nil)
	loc, _ := url.Parse(resp.Header.Get("Location"))
	resp = cl.do("GET", "/auth/callback?code=alice&state="+loc.Query().Get("state"), nil, nil)
	if got := resp.Header.Get("Location"); got != "/" {
		t.Fatalf("return redirect = %q", got)
	}
	if cl.thread().Viewer == nil {
		t.Fatal("not signed in after callback")
	}

	bad := e.anon()
	bad.do("GET", "/auth/login", nil, nil)
	if resp := bad.do("GET", "/auth/callback?code=alice&state=forged", nil, nil); resp.StatusCode != 400 {
		t.Fatalf("forged state: got %d", resp.StatusCode)
	}

	cl.expect(204, "POST", "/auth/logout", nil)
	if cl.thread().Viewer != nil {
		t.Fatal("still signed in after logout")
	}
}

func TestValidation(t *testing.T) {
	e := newTestEnv(t)
	alice := e.login("alice")
	alice.expect(400, "POST", "/api/comments", map[string]any{"thread": "/", "body": "   "})
	alice.expect(400, "POST", "/api/comments", map[string]any{"thread": "/missing.html", "body": "hi"})
	alice.expect(400, "POST", "/api/comments", map[string]any{"thread": "/.git/config", "body": "hi"})
	alice.expect(413, "POST", "/api/comments", map[string]any{"thread": "/", "body": strings.Repeat("é", maxBodyChars+1)})

	e.server.limiter = newRateLimiter(2, time.Minute)
	alice.post(nil, "one")
	alice.post(nil, "two")
	alice.expect(429, "POST", "/api/comments", map[string]any{"thread": "/", "body": "three"})
}

func TestNormalizeThread(t *testing.T) {
	for in, want := range map[string]string{
		"/":                 "/",
		"/index.html":       "/",
		"/index.html?x=1#c": "/",
		"/docs/index.html":  "/docs",
		"/books.html":       "/books.html",
		"/a/../b.html":      "/b.html",
	} {
		if got, ok := normalizeThread(in); !ok || got != want {
			t.Errorf("normalizeThread(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
	for _, in := range []string{"", "index.html", "https://x/", "/" + strings.Repeat("a", maxThreadLen)} {
		if _, ok := normalizeThread(in); ok {
			t.Errorf("normalizeThread(%q) accepted", in)
		}
	}
}

func TestMarkdownSanitized(t *testing.T) {
	md := NewMarkdown()
	out, _ := md.Render("hi <script>alert(1)</script> <img src=x onerror=alert(1)>\n[link](javascript:alert(1)) https://example.com :rocket:\n- [x] done")
	for _, bad := range []string{"<script", "onerror", "javascript:"} {
		if strings.Contains(out, bad) {
			t.Errorf("output contains %q: %s", bad, out)
		}
	}
	for _, good := range []string{`href="https://example.com"`, `rel="nofollow`, "🚀", `type="checkbox"`, "<br"} {
		if !strings.Contains(out, good) {
			t.Errorf("output missing %q: %s", good, out)
		}
	}
}

func TestStaticHidesPrivateFiles(t *testing.T) {
	e := newTestEnv(t)
	os.MkdirAll(filepath.Join(e.server.staticDir, ".git"), 0o755)
	os.WriteFile(filepath.Join(e.server.staticDir, ".git", "config"), []byte("secret"), 0o644)
	cl := e.anon()
	cl.expect(200, "GET", "/", nil)
	cl.expect(404, "GET", "/.git/config", nil)
	cl.expect(404, "GET", "/test.db", nil)
}
