#!/bin/bash
VAULT="/home/isaac/Dev/vault67/website notes"
DEST="/home/isaac/Dev/shantz14.github.io/docs"

while true; do
    inotifywait -r -e modify,create,delete,move "$VAULT" 2>/dev/null
    sleep 1  # debounce: wait for burst of saves to settle
    rsync -a --delete "$VAULT/" "$DEST/"
done
