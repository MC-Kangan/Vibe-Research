#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${1:-"$project_dir/.env.nas"}
timestamp=$(date +%Y%m%d-%H%M%S)
bundle_dir=${2:-"$project_dir/deploy/output/vibe-research-nas-$timestamp"}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Desktop is required on this Mac." >&2
  exit 1
fi

if [ ! -f "$env_file" ]; then
  echo "Missing environment file: $env_file" >&2
  echo "Copy .env.nas.example to .env.nas and complete it first." >&2
  exit 1
fi

trade_research_token=$(sed -n 's/^TRADE_RESEARCH_API_TOKEN=//p' "$env_file" | tail -n 1)
if [ -z "$trade_research_token" ]; then
  echo "Missing or empty TRADE_RESEARCH_API_TOKEN in $env_file" >&2
  exit 1
fi

if grep -q 'REPLACE_WITH\|TEMPORARY_PLACEHOLDER\|your-tailnet\|your-email' "$env_file"; then
  echo "The environment file still contains a placeholder value: $env_file" >&2
  exit 1
fi

mkdir -p "$bundle_dir/deploy/tailscale"

cd "$project_dir"

echo "Building Vibe Research and TradeAgent for linux/amd64..."
docker compose \
  --env-file "$env_file" \
  -f compose.nas.yaml \
  -f compose.mac-build.yaml \
  build backend frontend research-api

echo "Pulling the linux/amd64 Tailscale image..."
docker compose \
  --env-file "$env_file" \
  -f compose.nas.yaml \
  pull tailscale

echo "Rendering the image-only NAS project..."
docker compose \
  --env-file "$env_file" \
  -f compose.nas.yaml \
  config --quiet

cp compose.nas.yaml "$bundle_dir/compose.yaml"

docker compose \
  --env-file "$env_file" \
  -f compose.nas.yaml \
  config --images | sort -u > "$bundle_dir/images.txt"

set --
while IFS= read -r image_name; do
  [ -n "$image_name" ] || continue
  docker image inspect "$image_name" >/dev/null
  set -- "$@" "$image_name"
done < "$bundle_dir/images.txt"

if [ "$#" -eq 0 ]; then
  echo "Compose did not resolve any images." >&2
  exit 1
fi

echo "Exporting $# linux/amd64 images. This tar file can be several GB..."
docker image save --output "$bundle_dir/images-amd64.tar" "$@"

cp "$env_file" "$bundle_dir/.env"
cp deploy/tailscale/serve.json "$bundle_dir/deploy/tailscale/serve.json"
cp docs/nas-full-stack-deployment.md "$bundle_dir/DEPLOYMENT.md"
chmod 600 "$bundle_dir/.env"

echo "NAS bundle created at:"
echo "$bundle_dir"
echo "It contains credentials. Transfer it securely and never share or commit it."
