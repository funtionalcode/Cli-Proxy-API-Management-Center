#!/usr/bin/env bash
set -euo pipefail

branch="${DEPLOY_BRANCH:-master}"
ssh_host="${DEPLOY_SSH_HOST:-192.168.2.5}"
ssh_user="${DEPLOY_SSH_USER:-root}"
remote_dir="${DEPLOY_REMOTE_DIR:-/data/haogege/gpt/Cli-Proxy-API-Management-Center}"
compose_file="${DEPLOY_COMPOSE_FILE:-docker-compose.usage.yml}"
service="${DEPLOY_SERVICE:-cpa-manager}"
container="${DEPLOY_CONTAINER:-cpa-manager}"
health_url="${DEPLOY_HEALTH_URL:-http://127.0.0.1:18317/health}"

ssh_target="${ssh_user}@${ssh_host}"
ssh_opts=(
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
)

if [[ -z "${DEPLOY_SSH_PASSWORD:-}" ]]; then
  ssh_opts+=(-o BatchMode=yes)
fi

ssh_cmd=(ssh "${ssh_opts[@]}")

if [[ -n "${DEPLOY_SSH_PASSWORD:-}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "DEPLOY_SSH_PASSWORD is set, but sshpass is not installed." >&2
    exit 1
  fi
  export SSHPASS="${DEPLOY_SSH_PASSWORD}"
  ssh_cmd=(sshpass -e "${ssh_cmd[@]}")
fi

run_remote() {
  "${ssh_cmd[@]}" "${ssh_target}" "$@"
}

require_clean_local_branch() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Local git tree has tracked changes. Commit or stash them before deploying." >&2
    exit 1
  fi

  git fetch origin "${branch}" >/dev/null
  local local_head remote_head
  local_head="$(git rev-parse HEAD)"
  remote_head="$(git rev-parse "origin/${branch}")"
  if [[ "${local_head}" != "${remote_head}" ]]; then
    echo "Local HEAD does not match origin/${branch}." >&2
    echo "local : ${local_head}" >&2
    echo "remote: ${remote_head}" >&2
    exit 1
  fi
}

deploy_remote() {
  run_remote "DEPLOY_BRANCH='${branch}' DEPLOY_REMOTE_DIR='${remote_dir}' DEPLOY_COMPOSE_FILE='${compose_file}' DEPLOY_SERVICE='${service}' DEPLOY_CONTAINER='${container}' DEPLOY_HEALTH_URL='${health_url}' bash -s" <<'REMOTE'
set -euo pipefail

cd "${DEPLOY_REMOTE_DIR}"

echo "-- remote git --"
git fetch origin "${DEPLOY_BRANCH}"
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"
git rev-parse --short HEAD
git status --short

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose -f "${DEPLOY_COMPOSE_FILE}")
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose -f "${DEPLOY_COMPOSE_FILE}")
else
  echo "Neither docker compose nor docker-compose is available on remote host." >&2
  exit 1
fi

echo "-- rebuild container --"
"${compose[@]}" build "${DEPLOY_SERVICE}"
"${compose[@]}" up -d "${DEPLOY_SERVICE}"

echo "-- container status --"
docker ps --filter "name=${DEPLOY_CONTAINER}" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

echo "-- health check --"
for _ in $(seq 1 30); do
  if docker exec "${DEPLOY_CONTAINER}" wget -qO- "${DEPLOY_HEALTH_URL}" >/tmp/cpa-manager-health.json 2>/tmp/cpa-manager-health.err; then
    cat /tmp/cpa-manager-health.json
    echo
    exit 0
  fi
  sleep 2
done

echo "Health check failed." >&2
cat /tmp/cpa-manager-health.err >&2 || true
docker logs --tail=120 "${DEPLOY_CONTAINER}" >&2 || true
exit 1
REMOTE
}

main() {
  require_clean_local_branch
  deploy_remote
}

main "$@"
