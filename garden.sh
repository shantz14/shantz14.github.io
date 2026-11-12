#!/bin/bash
# Publishes every Obsidian note tagged `public` into garden/ (flat, by file name).
# Notes without the tag never leave the vault, except that the citation metadata (never the body)
# of a source note cited by a public note goes to garden/sources/. Run with --watch to resync on every vault change.
set -euo pipefail

VAULT="${VAULT:-$HOME/Dev/vault67}"
DEST="$(cd "$(dirname "$0")" && pwd)/garden"

# Prints the note's frontmatter tags, one per line, from either `tags: [a, b]` or a `- a` list.
tags_of() {
    awk '
        NR == 1 { if ($0 != "---") exit; next }
        /^---[[:space:]]*$/ { exit }
        /^tags:/ {
            intags = 1
            sub(/^tags:[[:space:]]*/, "")
            if ($0 ~ /^\[/) { gsub(/[\[\]"'\'']/, ""); n = split($0, a, ","); for (i = 1; i <= n; i++) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", a[i]); print a[i] }; intags = 0 }
            else if ($0 != "") { print; intags = 0 }
            next
        }
        intags && /^[[:space:]]*-[[:space:]]*/ { sub(/^[[:space:]]*-[[:space:]]*/, ""); gsub(/["'\'']/, ""); print; next }
        intags { intags = 0 }
    ' "$1"
}

# Prints only the citation fields of a source note's frontmatter. Its body (reading notes,
# highlights) and every other field stay in the vault.
citation_of() {
    awk '
        NR == 1 { if ($0 != "---") exit; print; next }
        /^---[[:space:]]*$/ { print; exit }
        /^[^[:space:]-][^:]*:/ { key = $0; sub(/:.*/, "", key); keep = (key ~ /^(citekey|type|title|author|issued|container-title|publisher|doi|isbn|url)$/) }
        keep { print }
    ' "$1"
}

sync() {
    local tmp
    tmp="$(mktemp -d)"
    while IFS= read -r -d '' note; do
        tags_of "$note" | grep -qx 'public' || continue
        local name
        name="$(basename "$note")"
        if [[ -e "$tmp/$name" ]]; then
            echo "garden: duplicate note name $name, skipping $note" >&2
            continue
        fi
        cp "$note" "$tmp/$name"
        # Publish the citation metadata of every work the note cites ([[@citekey]]) to sources/.
        grep -oE '\[\[([^]|#]*/)?@[^]|#/]+' "$note" | sed 's/.*@//' | sort -u | while IFS= read -r key; do
            local cited
            cited="$(find "$VAULT" -path "$VAULT/.git" -prune -o -name "@$key.md" -type f -print -quit)"
            if [[ -n "$cited" ]]; then
                mkdir -p "$tmp/sources"
                citation_of "$cited" > "$tmp/sources/@$key.md"
            fi
        done || true
        # Copy embedded attachments (![[file.png]]) that exist somewhere in the vault.
        grep -oE '!\[\[[^]|#]+\.(png|jpe?g|gif|svg|webp)' "$note" | sed 's/^!\[\[//' | while IFS= read -r att; do
            local src
            src="$(find "$VAULT" -path "$VAULT/.git" -prune -o -name "$(basename "$att")" -type f -print -quit)"
            [[ -n "$src" ]] && cp "$src" "$tmp/"
        done || true
    done < <(find "$VAULT" \( -path "$VAULT/.git" -o -path "$VAULT/.obsidian" -o -path "$VAULT/Templates" -o -path "$VAULT/.trash" \) -prune -o -name '*.md' -type f -print0)

    mkdir -p "$DEST"
    rsync -a --delete --checksum "$tmp/" "$DEST/"
    rm -rf "$tmp"
    echo "garden: $(find "$DEST" -maxdepth 1 -name '*.md' | wc -l) public notes, $(find "$DEST/sources" -name '*.md' 2>/dev/null | wc -l) cited sources"
}

sync
if [[ "${1:-}" == "--watch" ]]; then
    while true; do
        inotifywait -qq -r -e modify,create,delete,move --exclude '/\.(git|obsidian)/' "$VAULT" || true
        sleep 1 # debounce: wait for a burst of saves to settle
        sync
    done
fi
