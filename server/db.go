package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id         INTEGER PRIMARY KEY, -- GitHub user id
	login      TEXT NOT NULL,
	avatar_url TEXT NOT NULL,
	html_url   TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id    INTEGER NOT NULL REFERENCES users(id),
	expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	thread     TEXT NOT NULL,
	parent_id  INTEGER REFERENCES comments(id),
	user_id    INTEGER NOT NULL REFERENCES users(id),
	body_md    TEXT NOT NULL,
	body_html  TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS comments_thread ON comments(thread, created_at);

CREATE TABLE IF NOT EXISTS reactions (
	target_type TEXT NOT NULL, -- 'thread' or 'comment'
	target_id   TEXT NOT NULL,
	user_id     INTEGER NOT NULL REFERENCES users(id),
	content     TEXT NOT NULL,
	PRIMARY KEY (target_type, target_id, user_id, content)
);
`

type Store struct {
	db *sql.DB
}

func OpenStore(path string) (*Store, error) {
	// SQLite creates the file but not its directory.
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// A single connection serializes writes and avoids SQLITE_BUSY.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func ms(t time.Time) int64 { return t.UnixMilli() }

type User struct {
	ID        int64  `json:"-"`
	Login     string `json:"login"`
	AvatarURL string `json:"avatarUrl"`
	URL       string `json:"url"`
}

func (s *Store) UpsertUser(u User) error {
	_, err := s.db.Exec(`
		INSERT INTO users (id, login, avatar_url, html_url, updated_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET login = excluded.login, avatar_url = excluded.avatar_url,
			html_url = excluded.html_url, updated_at = excluded.updated_at`,
		u.ID, u.Login, u.AvatarURL, u.URL, ms(time.Now()))
	return err
}

func (s *Store) CreateSession(tokenHash string, userID int64, expires time.Time) error {
	_, err := s.db.Exec(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
		tokenHash, userID, ms(expires))
	return err
}

func (s *Store) SessionUser(tokenHash string) (*User, error) {
	var u User
	err := s.db.QueryRow(`
		SELECT u.id, u.login, u.avatar_url, u.html_url FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, ms(time.Now())).
		Scan(&u.ID, &u.Login, &u.AvatarURL, &u.URL)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

func (s *Store) DeleteSession(tokenHash string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (s *Store) DeleteExpiredSessions() error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, ms(time.Now()))
	return err
}

type Comment struct {
	ID        int64
	Thread    string
	ParentID  *int64
	Author    User
	BodyMD    string
	BodyHTML  string
	CreatedAt int64
	UpdatedAt int64
	DeletedAt *int64
}

const commentCols = `c.id, c.thread, c.parent_id, c.body_md, c.body_html, c.created_at, c.updated_at, c.deleted_at,
	u.id, u.login, u.avatar_url, u.html_url`

func scanComment(row interface{ Scan(...any) error }) (*Comment, error) {
	var c Comment
	err := row.Scan(&c.ID, &c.Thread, &c.ParentID, &c.BodyMD, &c.BodyHTML, &c.CreatedAt, &c.UpdatedAt, &c.DeletedAt,
		&c.Author.ID, &c.Author.Login, &c.Author.AvatarURL, &c.Author.URL)
	return &c, err
}

func (s *Store) GetComment(id int64) (*Comment, error) {
	c, err := scanComment(s.db.QueryRow(`SELECT `+commentCols+`
		FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// ThreadComments returns every comment in a thread, oldest first, including deleted ones.
func (s *Store) ThreadComments(thread string) ([]*Comment, error) {
	rows, err := s.db.Query(`SELECT `+commentCols+`
		FROM comments c JOIN users u ON u.id = c.user_id
		WHERE c.thread = ? ORDER BY c.created_at, c.id`, thread)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Comment
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) CreateComment(thread string, parentID *int64, userID int64, bodyMD, bodyHTML string) (int64, error) {
	now := ms(time.Now())
	res, err := s.db.Exec(`
		INSERT INTO comments (thread, parent_id, user_id, body_md, body_html, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, thread, parentID, userID, bodyMD, bodyHTML, now, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateComment(id int64, bodyMD, bodyHTML string) error {
	_, err := s.db.Exec(`UPDATE comments SET body_md = ?, body_html = ?, updated_at = ? WHERE id = ?`,
		bodyMD, bodyHTML, ms(time.Now()), id)
	return err
}

// DeleteComment soft-deletes a comment and clears its body.
func (s *Store) DeleteComment(id int64) error {
	_, err := s.db.Exec(`UPDATE comments SET body_md = '', body_html = '', deleted_at = ? WHERE id = ?`,
		ms(time.Now()), id)
	return err
}

// ToggleReaction adds the reaction if absent and removes it if present.
func (s *Store) ToggleReaction(targetType, targetID string, userID int64, content string) error {
	res, err := s.db.Exec(`DELETE FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ? AND content = ?`,
		targetType, targetID, userID, content)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return nil
	}
	_, err = s.db.Exec(`INSERT INTO reactions (target_type, target_id, user_id, content) VALUES (?, ?, ?, ?)`,
		targetType, targetID, userID, content)
	return err
}

type ReactionGroup struct {
	Count            int  `json:"count"`
	ViewerHasReacted bool `json:"viewerHasReacted"`
}

// ThreadReactions returns reaction groups for the thread itself (key "") and for each of its comments
// (keyed by comment id).
func (s *Store) ThreadReactions(thread string, viewerID int64) (map[string]map[string]*ReactionGroup, error) {
	rows, err := s.db.Query(`
		SELECT r.target_type, r.target_id, r.content, COUNT(*), MAX(r.user_id = ?)
		FROM reactions r
		WHERE (r.target_type = 'thread' AND r.target_id = ?)
		   OR (r.target_type = 'comment' AND r.target_id IN (SELECT CAST(id AS TEXT) FROM comments WHERE thread = ?))
		GROUP BY r.target_type, r.target_id, r.content`, viewerID, thread, thread)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[string]*ReactionGroup{}
	for rows.Next() {
		var typ, id, content string
		var g ReactionGroup
		if err := rows.Scan(&typ, &id, &content, &g.Count, &g.ViewerHasReacted); err != nil {
			return nil, err
		}
		key := id
		if typ == "thread" {
			key = ""
		}
		if out[key] == nil {
			out[key] = map[string]*ReactionGroup{}
		}
		out[key][content] = &g
	}
	return out, rows.Err()
}

func commentKey(id int64) string { return strconv.FormatInt(id, 10) }
