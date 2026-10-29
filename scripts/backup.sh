#!/usr/bin/env bash
# Back up the M&N FieldOps database and private file storage.
#
#   ENV_FILE=.env scripts/backup.sh [output-dir]     # default output-dir: ./backups
#
# Writes <output-dir>/fieldops-<UTC timestamp>/ containing database.dump
# (pg_dump custom format), storage.tar.gz (local storage) or storage/ (R2 via
# rclone), manifest.txt, and SHA256SUMS. Needs a PostgreSQL 16+ client.
# Backups contain private project data: keep them encrypted and off the VPS.
set -euo pipefail

if [[ -n "${ENV_FILE:-}" ]]; then set -a; . "$ENV_FILE"; set +a; fi
DB_URL="${DIRECT_DATABASE_URL:-${DATABASE_URL:?DATABASE_URL or DIRECT_DATABASE_URL is required}}"
OUT="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="$OUT/fieldops-$STAMP"
umask 077
mkdir -p "$DIR"

echo "[backup] database -> $DIR/database.dump"
pg_dump --format=custom --no-owner --no-privileges --file "$DIR/database.dump" "$DB_URL"

case "${STORAGE_DRIVER:-local}" in
  local)
    SRC="${LOCAL_STORAGE_DIR:-./.data/storage}"
    echo "[backup] local storage $SRC -> $DIR/storage.tar.gz"
    if [[ -d "$SRC" ]]; then tar -C "$SRC" -czf "$DIR/storage.tar.gz" .; else tar -czf "$DIR/storage.tar.gz" -T /dev/null; fi
    ;;
  r2)
    if command -v rclone >/dev/null && [[ -n "${RCLONE_REMOTE:-}" ]]; then
      echo "[backup] R2 bucket ${R2_BUCKET} -> $DIR/storage (rclone remote ${RCLONE_REMOTE})"
      rclone copy "${RCLONE_REMOTE}:${R2_BUCKET}" "$DIR/storage"
    else
      echo "[backup] WARNING: R2 objects were not copied. Set RCLONE_REMOTE to an rclone remote for the bucket, or rely on R2 bucket versioning/replication." >&2
      echo "r2-not-copied" > "$DIR/STORAGE_NOT_COPIED"
    fi
    ;;
esac

{
  echo "created_utc=$STAMP"
  echo "storage_driver=${STORAGE_DRIVER:-local}"
  echo "pg_dump=$(pg_dump --version)"
  echo "latest_migration=$(ls prisma/migrations | grep -v migration_lock | sort | tail -1)"
} > "$DIR/manifest.txt"
(cd "$DIR" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
echo "[backup] done: $DIR"
