// Command server serves the portfolio site and its SQLite-backed comments API.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

type Server struct {
	store        *Store
	md           *Markdown
	limiter      *rateLimiter
	http         *http.Client
	github       GitHubEndpoints
	baseURL      *url.URL
	clientID     string
	clientSecret string
	ownerLogin   string
	staticDir    string
	gardenDir    string
	garden       atomic.Pointer[Garden]
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// hiddenPath reports whether a URL path must never be served from the static directory:
// dotfiles (.git, .claude, ...), SQLite files, and the server's own source.
func hiddenPath(p string) bool {
	segs := strings.Split(strings.Trim(p, "/"), "/")
	for _, seg := range segs {
		if strings.HasPrefix(seg, ".") || strings.Contains(seg, ".db") {
			return true
		}
	}
	switch segs[0] {
	case "server", "Dockerfile", "garden", "garden.sh", "CNAME", "data":
		return true
	}
	return false
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/thread", s.handleThread)
	mux.HandleFunc("POST /api/comments", s.guard(s.requireViewer(s.handleCreateComment)))
	mux.HandleFunc("PATCH /api/comments/{id}", s.guard(s.requireViewer(s.handleEditComment)))
	mux.HandleFunc("DELETE /api/comments/{id}", s.guard(s.requireViewer(s.handleDeleteComment)))
	mux.HandleFunc("POST /api/reactions", s.guard(s.requireViewer(s.handleReaction)))
	mux.HandleFunc("POST /api/markdown", s.guard(s.requireViewer(s.handleMarkdown)))

	mux.HandleFunc("GET /auth/login", s.handleLogin)
	mux.HandleFunc("GET /auth/callback", s.handleCallback)
	mux.HandleFunc("POST /auth/logout", s.guard(s.handleLogout))

	mux.HandleFunc("GET /notes/{$}", s.handleGardenIndex)
	mux.HandleFunc("GET /notes/{slug}", s.handleNote)
	mux.HandleFunc("GET /notes/files/{name}", s.handleGardenFile)
	mux.HandleFunc("GET /notes", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/notes/", http.StatusMovedPermanently)
	})
	mux.HandleFunc("GET /api/garden", s.handleGardenAPI)
	// Pre-garden URLs.
	mux.HandleFunc("GET /books.html", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/notes/#books", http.StatusMovedPermanently)
	})
	mux.HandleFunc("GET /page.html", s.handleOldPage)

	files := http.FileServer(http.Dir(s.staticDir))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if hiddenPath(r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "DENY")
		mux.ServeHTTP(w, r)
	})
}

func main() {
	staticDir := flag.String("static", env("STATIC_DIR", "."), "directory of static site files")
	flag.Parse()
	gardenDir := env("GARDEN_DIR", filepath.Join(*staticDir, "garden"))
	garden, err := LoadGarden(gardenDir)
	if err != nil {
		log.Fatalf("load garden: %v", err)
	}

	base, err := url.Parse(strings.TrimRight(env("BASE_URL", "http://localhost:8080"), "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		log.Fatalf("BASE_URL must be an absolute URL like https://isaacschwarz.dev")
	}
	clientID, clientSecret := os.Getenv("GITHUB_CLIENT_ID"), os.Getenv("GITHUB_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		log.Printf("warning: GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET unset, sign-in will fail")
	}

	store, err := OpenStore(env("DB_PATH", "/data/comments.db"))
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer store.Close()

	s := &Server{
		store:        store,
		md:           NewMarkdown(),
		limiter:      newRateLimiter(5, time.Minute),
		http:         &http.Client{Timeout: 10 * time.Second},
		github:       defaultGitHub,
		baseURL:      base,
		clientID:     clientID,
		clientSecret: clientSecret,
		ownerLogin:   env("OWNER_LOGIN", "shantz14"),
		staticDir:    *staticDir,
		gardenDir:    gardenDir,
	}
	s.garden.Store(garden)
	log.Printf("garden: %d notes from %s", len(garden.Notes), gardenDir)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if os.Getenv("GARDEN_WATCH") != "" {
		go s.watchGarden(ctx.Done())
	}

	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := store.DeleteExpiredSessions(); err != nil {
					log.Printf("clean sessions: %v", err)
				}
			}
		}
	}()

	srv := &http.Server{
		Addr:              env("ADDR", ":8080"),
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("listening on %s (base %s, static %s)", srv.Addr, base, *staticDir)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
