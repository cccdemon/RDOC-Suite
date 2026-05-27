#!/usr/bin/env bash
set -euo pipefail

# Render livekit.yaml from environment variables (reads .env if present).
# Usage: run from repo root: ./scripts/generate-livekit-config.sh

if [ -f .env ]; then
  # export variables from .env
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

if command -v envsubst >/dev/null 2>&1; then
  envsubst < livekit.yaml > livekit.yaml.generated
else
  # fallback to Python replacement (safer for special chars)
  python - <<'PY'
import os
tpl = open('livekit.yaml').read()
tpl = tpl.replace('${LIVEKIT_API_KEY}', os.environ.get('LIVEKIT_API_KEY',''))
tpl = tpl.replace('${LIVEKIT_API_SECRET}', os.environ.get('LIVEKIT_API_SECRET',''))
open('livekit.yaml.generated','w').write(tpl)
PY
fi

mv livekit.yaml.generated livekit.yaml
echo "Rendered livekit.yaml from environment"
