package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	sessionCookie = "gc_session"
	stateCookie   = "gc_oauth_state"
	sessionTTL    = 30 * 24 * time.Hour
)

type GitHubEndpoints struct {
	AuthorizeURL string
	TokenURL     string
	UserURL      string
}

var defaultGitHub = GitHubEndpoints{
	AuthorizeURL: "https://github.com/login/oauth/authorize",
	TokenURL:     "https://github.com/login/oauth/access_token",
	UserURL:      "https://api.github.com/user",
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// safeReturn only allows same-origin absolute paths.
func safeReturn(p string) string {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.HasPrefix(p, "/\\") {
		return "/"
	}
	return p
}

func (s *Server) secureCookies() bool { return s.baseURL.Scheme == "https" }

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	state := randomHex(16)
	ret := safeReturn(r.URL.Query().Get("return"))
	http.SetCookie(w, &http.Cookie{
		Name:     stateCookie,
		Value:    state + ":" + url.QueryEscape(ret),
		Path:     "/auth",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   s.secureCookies(),
		SameSite: http.SameSiteLaxMode,
	})
	q := url.Values{
		"client_id":    {s.clientID},
		"redirect_uri": {s.baseURL.String() + "/auth/callback"},
		"state":        {state},
	}
	http.Redirect(w, r, s.github.AuthorizeURL+"?"+q.Encode(), http.StatusFound)
}

func (s *Server) handleCallback(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(stateCookie)
	if err != nil {
		http.Error(w, "missing login state, try signing in again", http.StatusBadRequest)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Path: "/auth", MaxAge: -1})

	state, retEsc, _ := strings.Cut(c.Value, ":")
	got := r.URL.Query().Get("state")
	if got == "" || subtle.ConstantTimeCompare([]byte(state), []byte(got)) != 1 {
		http.Error(w, "invalid login state", http.StatusBadRequest)
		return
	}
	ret, _ := url.QueryUnescape(retEsc)
	ret = safeReturn(ret)

	code := r.URL.Query().Get("code")
	if code == "" {
		// The user declined authorization.
		http.Redirect(w, r, ret, http.StatusFound)
		return
	}

	user, err := s.fetchGitHubUser(r.Context(), code)
	if err != nil {
		log.Printf("github login: %v", err)
		http.Error(w, "GitHub sign-in failed", http.StatusBadGateway)
		return
	}
	if err := s.store.UpsertUser(*user); err != nil {
		s.serverError(w, err)
		return
	}

	token := randomHex(32)
	if err := s.store.CreateSession(hashToken(token), user.ID, time.Now().Add(sessionTTL)); err != nil {
		s.serverError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(sessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.secureCookies(),
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, ret, http.StatusFound)
}

func (s *Server) fetchGitHubUser(ctx context.Context, code string) (*User, error) {
	form := url.Values{
		"client_id":     {s.clientID},
		"client_secret": {s.clientSecret},
		"code":          {code},
		"redirect_uri":  {s.baseURL.String() + "/auth/callback"},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, s.github.TokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error_description"`
	}
	if err := s.doJSON(req, &tok); err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("token exchange: %s", tok.Error)
	}

	req, _ = http.NewRequestWithContext(ctx, http.MethodGet, s.github.UserURL, nil)
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	var gh struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		AvatarURL string `json:"avatar_url"`
		HTMLURL   string `json:"html_url"`
	}
	if err := s.doJSON(req, &gh); err != nil {
		return nil, fmt.Errorf("fetch user: %w", err)
	}
	if gh.ID == 0 || gh.Login == "" {
		return nil, errors.New("fetch user: empty profile")
	}
	return &User{ID: gh.ID, Login: gh.Login, AvatarURL: gh.AvatarURL, URL: gh.HTMLURL}, nil
}

func (s *Server) doJSON(req *http.Request, v any) error {
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: status %d", req.URL, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		if err := s.store.DeleteSession(hashToken(c.Value)); err != nil {
			s.serverError(w, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

// viewer returns the signed-in user, or nil.
func (s *Server) viewer(r *http.Request) *User {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil
	}
	u, err := s.store.SessionUser(hashToken(c.Value))
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			log.Printf("session lookup: %v", err)
		}
		return nil
	}
	return u
}
