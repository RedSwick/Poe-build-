#!/usr/bin/env bash
#
# Installe le moteur de calcul Path of Building Community Fork et ses
# dépendances Lua.
#
# Le dépôt PoB pèse ~1.1 Go : il est cloné dans vendor/ et ignoré par git.
# On ne recode aucune formule de dégâts/défense — PoB est la source de vérité.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
POB="$VENDOR/PathOfBuilding"
POB_REPO="https://github.com/PathOfBuildingCommunity/PathOfBuilding.git"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m/!\\\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31merreur:\033[0m %s\n' "$1" >&2; exit 1; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 && SUDO="sudo"
fi

# --- 1. LuaJIT ---------------------------------------------------------------
if command -v luajit >/dev/null 2>&1; then
  info "LuaJIT déjà présent : $(luajit -v 2>&1 | head -1)"
else
  info "Installation de LuaJIT…"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -qq
    $SUDO apt-get install -y luajit
  elif command -v brew >/dev/null 2>&1; then
    brew install luajit
  else
    die "Ni apt-get ni brew trouvés. Installe LuaJIT manuellement."
  fi
fi

# --- 2. lua-utf8 -------------------------------------------------------------
# PoB exige le module natif lua-utf8 (cf. son propre Dockerfile).
# Sans lui, Modules/Common.lua plante au démarrage.
if luajit -e "require('lua-utf8')" >/dev/null 2>&1; then
  info "lua-utf8 déjà présent."
else
  info "Installation de lua-utf8 (module natif requis par PoB)…"
  if ! command -v luarocks >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      $SUDO apt-get install -y luarocks liblua5.1-0-dev
    elif command -v brew >/dev/null 2>&1; then
      brew install luarocks
    else
      die "luarocks introuvable. Installe-le puis relance ce script."
    fi
  fi
  $SUDO luarocks install luautf8 0.1.6-1
fi

# --- 3. Dépôt PoB ------------------------------------------------------------
mkdir -p "$VENDOR"
if [ -d "$POB/.git" ]; then
  info "Path of Building déjà cloné, mise à jour…"
  git -C "$POB" fetch --depth 1 origin dev
  git -C "$POB" reset --hard origin/dev
else
  info "Clonage de Path of Building Community Fork (~1.1 Go, patience)…"
  git clone --depth 1 "$POB_REPO" "$POB"
fi

# --- 4. Vérification ---------------------------------------------------------
POB_VERSION="$(grep -oP '(?<=<Version number=")[^"]+' "$POB/manifest.xml" 2>/dev/null | head -1 || echo inconnue)"
info "Version PoB : $POB_VERSION"

if ls "$POB/src/TreeData" 2>/dev/null | grep -q '^3_29$'; then
  info "Données d'arbre 3.29 présentes."
else
  warn "Arbre 3.29 introuvable dans $POB/src/TreeData — le fork n'est peut-être"
  warn "pas à jour pour la ligue Curse of the Allflame. Vérifie son changelog."
fi

info "Test du moteur en headless…"
cat > /tmp/pba-smoke.lua <<'EOF'
dofile("HeadlessWrapper.lua")
newBuild()
if build and build.calcsTab then print("PBA_SMOKE_OK") end
EOF
if (cd "$POB/src" && \
    LUA_PATH="$POB/runtime/lua/?.lua;$POB/runtime/lua/?/init.lua;./?.lua;;" \
    LUA_CPATH="/usr/local/lib/lua/5.1/?.so;;" \
    luajit /tmp/pba-smoke.lua 2>&1 | grep -q PBA_SMOKE_OK); then
  info "Moteur PoB opérationnel."
else
  die "Le moteur PoB n'a pas démarré. Relance avec la sortie complète pour diagnostiquer."
fi

rm -f /tmp/pba-smoke.lua
info "Setup terminé."
