#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh.
#
#   ENV_FILE=.env.restore scripts/restore.sh backups/fieldops-<timestamp>
#
# Restores into DIRECT_DATABASE_URL (or DATABASE_URL), replacing existing
# FieldOps tables, then applies any newer migrations. Local storage is
# extracted into LOCAL_STORAGE_DIR, which must be empty. Stop the web and
# worker processes first. Verify afterwards with: pnpm backup:verify
set -euo pipefail

if [[ -n "${ENV_FILE:-}" ]]; then set -a; . "$ENV_FILE"; set +a; fi
DIR="${1:?usage: scripts/restore.sh <backup-dir>}"
DB_URL="${DIRECT_DATABASE_URL:-${DATABASE_URL:?DATABASE_URL or DIRECT_DATABASE_URL is required}}"

echo "[restore] verifying checksums"
(cd "$DIR" && sha256sum --check --quiet SHA256SUMS)

echo "[restore] database <- $DIR/database.dump"
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$DB_URL" "$DIR/database.dump"
DATABASE_URL="$DB_URL" DIRECT_DATABASE_URL="$DB_URL" pnpm exec prisma migrate deploy

if [[ -f "$DIR/storage.tar.gz" ]]; then
  DEST="${LOCAL_STORAGE_DIR:-./.data/storage}"
  mkdir -p "$DEST"
  if [[ -n "$(ls -A "$DEST")" && "${FORCE_STORAGE:-}" != "1" ]]; then
    echo "[restore] $DEST is not empty; set FORCE_STORAGE=1 to extract over it" >&2
    exit 1
  fi
  echo "[restore] local storage <- $DIR/storage.tar.gz into $DEST"
  tar -C "$DEST" -xzf "$DIR/storage.tar.gz"
elif [[ -d "$DIR/storage" ]]; then
  echo "[restore] R2 objects are in $DIR/storage; copy them back with: rclone copy $DIR/storage \$RCLONE_REMOTE:\$R2_BUCKET"
fi
echo "[restore] done"
