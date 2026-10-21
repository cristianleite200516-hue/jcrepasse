#!/bin/bash
set -euo pipefail

# Backup do banco (via sqlite3 .backup, seguro mesmo com o servidor rodando) e da pasta
# uploads (fotos/documentos dos leads). Mantém os últimos 14 backups, apaga o resto.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
DEST="backups/$STAMP"
mkdir -p "$DEST"

sqlite3 prisma/dev.db ".backup '$DEST/dev.db'"

if [ -d uploads ] && [ "$(ls -A uploads 2>/dev/null)" ]; then
  cp -R uploads "$DEST/uploads"
fi

echo "Backup salvo em $DEST"

# Mantém só os 14 backups mais recentes
cd backups
ls -1t | tail -n +15 | xargs -r rm -rf
