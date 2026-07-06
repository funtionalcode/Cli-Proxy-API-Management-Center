#!/usr/bin/env bash
set -euo pipefail

branch="${DEPLOY_BRANCH:-master}"
deploy_mode="${DEPLOY_MODE:-image-stream}"
ssh_host="${DEPLOY_SSH_HOST:-192.168.2.5}"
ssh_user="${DEPLOY_SSH_USER:-root}"
remote_dir="${DEPLOY_REMOTE_DIR:-/data/haogege/gpt/Cli-Proxy-API-Management-Center}"
remote_data_dir="${DEPLOY_REMOTE_DATA_DIR:-/data/haogege/gpt/CLIProxyAPIPlus/cpa-manager-data}"
remote_network="${DEPLOY_REMOTE_NETWORK:-cliproxyapiplus_default}"
container="${DEPLOY_CONTAINER:-cpa-manager}"
compose_file="${DEPLOY_COMPOSE_FILE:-docker-compose.usage.yml}"
service="${DEPLOY_SERVICE:-cpa-manager}"
build_network="${DEPLOY_BUILD_NETWORK:-host}"
go_builder_image="${DEPLOY_GO_BUILDER_IMAGE:-golang:1.26-alpine}"
image="${DEPLOY_IMAGE:-seakee/cpa-manager:latest}"
platform="${DEPLOY_PLATFORM:-linux/amd64}"
dockerfile="${DEPLOY_DOCKERFILE:-Dockerfile.usage-service}"
host_port="${DEPLOY_HOST_PORT:-18317}"
container_port="${DEPLOY_CONTAINER_PORT:-18317}"
health_url="${DEPLOY_HEALTH_URL:-http://127.0.0.1:18317/health}"
stale_container="${DEPLOY_STALE_CONTAINER:-cli-proxy-api-management-center-cpa-manager-1}"
keep_backup="${DEPLOY_KEEP_BACKUP:-true}"

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

shell_quote() {
  printf "%q" "$1"
}

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

sync_remote_git() {
  run_remote \
    "DEPLOY_BRANCH=$(shell_quote "${branch}") DEPLOY_REMOTE_DIR=$(shell_quote "${remote_dir}") bash -s" <<'REMOTE'
set -euo pipefail

cd "${DEPLOY_REMOTE_DIR}"

echo "-- remote git --"
git fetch origin "${DEPLOY_BRANCH}"
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"
git rev-parse --short HEAD
git status --short
REMOTE
}

build_local_image() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required for local image deployment." >&2
    exit 1
  fi

  local short_head versioned_image
  short_head="$(git rev-parse --short HEAD)"
  versioned_image="${DEPLOY_VERSIONED_IMAGE:-${image%:*}:${short_head}}"

  local build_args=()
  if [[ -n "${DEPLOY_BUILD_PROXY:-}" ]]; then
    build_args+=(
      --build-arg "HTTP_PROXY=${DEPLOY_BUILD_PROXY}"
      --build-arg "HTTPS_PROXY=${DEPLOY_BUILD_PROXY}"
      --build-arg "ALL_PROXY=${DEPLOY_BUILD_PROXY}"
      --build-arg "http_proxy=${DEPLOY_BUILD_PROXY}"
      --build-arg "https_proxy=${DEPLOY_BUILD_PROXY}"
      --build-arg "all_proxy=${DEPLOY_BUILD_PROXY}"
      --build-arg "NO_PROXY=${DEPLOY_NO_PROXY:-localhost,127.0.0.1,::1}"
      --build-arg "no_proxy=${DEPLOY_NO_PROXY:-localhost,127.0.0.1,::1}"
    )
  fi

  echo "-- local image build --"
  docker buildx build \
    --platform "${platform}" \
    -f "${dockerfile}" \
    -t "${image}" \
    -t "${versioned_image}" \
    --load \
    "${build_args[@]}" \
    .

  docker image inspect "${image}" --format 'local-image={{.Id}} arch={{.Architecture}}'
}

load_image_remote() {
  echo "-- remote image load --"
  docker save "${image}" | gzip -1 | run_remote 'gzip -dc | docker load'
}

build_remote_image() {
  run_remote \
    "DEPLOY_REMOTE_DIR=$(shell_quote "${remote_dir}") DEPLOY_COMPOSE_FILE=$(shell_quote "${compose_file}") DEPLOY_SERVICE=$(shell_quote "${service}") DEPLOY_IMAGE=$(shell_quote "${image}") DEPLOY_BUILD_NETWORK=$(shell_quote "${build_network}") GO_BUILDER_IMAGE=$(shell_quote "${go_builder_image}") DEPLOY_BUILD_PROXY=$(shell_quote "${DEPLOY_BUILD_PROXY:-}") DEPLOY_NO_PROXY=$(shell_quote "${DEPLOY_NO_PROXY:-localhost,127.0.0.1,::1}") bash -s" <<'REMOTE'
set -euo pipefail

cd "${DEPLOY_REMOTE_DIR}"

if [[ -n "${DEPLOY_BUILD_PROXY}" ]]; then
  export HTTP_PROXY="${DEPLOY_BUILD_PROXY}"
  export HTTPS_PROXY="${DEPLOY_BUILD_PROXY}"
  export ALL_PROXY="${DEPLOY_BUILD_PROXY}"
  export http_proxy="${DEPLOY_BUILD_PROXY}"
  export https_proxy="${DEPLOY_BUILD_PROXY}"
  export all_proxy="${DEPLOY_BUILD_PROXY}"
  export NO_PROXY="${DEPLOY_NO_PROXY}"
  export no_proxy="${DEPLOY_NO_PROXY}"
fi
export DEPLOY_BUILD_NETWORK
export GO_BUILDER_IMAGE

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose -f "${DEPLOY_COMPOSE_FILE}")
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose -f "${DEPLOY_COMPOSE_FILE}")
else
  echo "Neither docker compose nor docker-compose is available on remote host." >&2
  exit 1
fi

echo "-- remote image build --"
"${compose[@]}" build "${DEPLOY_SERVICE}"
docker image inspect "${DEPLOY_IMAGE}" --format 'remote-image={{.Id}} arch={{.Architecture}}'
REMOTE
}

recreate_remote_container() {
  run_remote \
    "DEPLOY_CONTAINER=$(shell_quote "${container}") DEPLOY_IMAGE=$(shell_quote "${image}") DEPLOY_REMOTE_DATA_DIR=$(shell_quote "${remote_data_dir}") DEPLOY_REMOTE_NETWORK=$(shell_quote "${remote_network}") DEPLOY_HOST_PORT=$(shell_quote "${host_port}") DEPLOY_CONTAINER_PORT=$(shell_quote "${container_port}") DEPLOY_HEALTH_URL=$(shell_quote "${health_url}") DEPLOY_STALE_CONTAINER=$(shell_quote "${stale_container}") DEPLOY_KEEP_BACKUP=$(shell_quote "${keep_backup}") bash -s" <<'REMOTE'
set -euo pipefail

echo "-- cleanup stale container --"
if [[ -n "${DEPLOY_STALE_CONTAINER}" ]]; then
  docker rm -f "${DEPLOY_STALE_CONTAINER}" >/dev/null 2>&1 || true
fi

echo "-- preflight --"
docker image inspect "${DEPLOY_IMAGE}" --format 'remote-image={{.Id}} arch={{.Architecture}}'
test -d "${DEPLOY_REMOTE_DATA_DIR}"
docker network inspect "${DEPLOY_REMOTE_NETWORK}" >/dev/null

backup_container=""
if docker ps -a --format '{{.Names}}' | grep -qx "${DEPLOY_CONTAINER}"; then
  backup_container="${DEPLOY_CONTAINER}-backup-$(date +%Y%m%d%H%M%S)"
  echo "-- backup old container --"
  docker stop "${DEPLOY_CONTAINER}" >/dev/null
  docker rename "${DEPLOY_CONTAINER}" "${backup_container}"
  echo "backup=${backup_container}"
fi

rollback() {
  echo "-- rollback --" >&2
  docker rm -f "${DEPLOY_CONTAINER}" >/dev/null 2>&1 || true
  if [[ -n "${backup_container}" ]] && docker ps -a --format '{{.Names}}' | grep -qx "${backup_container}"; then
    docker rename "${backup_container}" "${DEPLOY_CONTAINER}"
    docker start "${DEPLOY_CONTAINER}" >/dev/null
  fi
}
trap 'rollback' ERR

echo "-- start new container --"
docker run -d \
  --name "${DEPLOY_CONTAINER}" \
  --restart unless-stopped \
  --network "${DEPLOY_REMOTE_NETWORK}" \
  -p "${DEPLOY_HOST_PORT}:${DEPLOY_CONTAINER_PORT}" \
  -e "HTTP_ADDR=0.0.0.0:${DEPLOY_CONTAINER_PORT}" \
  -v "${DEPLOY_REMOTE_DATA_DIR}:/data" \
  "${DEPLOY_IMAGE}" >/dev/null

echo "-- health check --"
for _ in $(seq 1 30); do
  if docker exec "${DEPLOY_CONTAINER}" wget -qO- "${DEPLOY_HEALTH_URL}" >/tmp/cpa-manager-health.json 2>/tmp/cpa-manager-health.err; then
    cat /tmp/cpa-manager-health.json
    echo
    trap - ERR
    echo "-- container status --"
    docker ps --filter "name=${DEPLOY_CONTAINER}" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
    docker inspect "${DEPLOY_CONTAINER}" --format 'container-image={{.Image}}'
    docker image inspect "${DEPLOY_IMAGE}" --format 'latest-image={{.Id}} arch={{.Architecture}}'
    if [[ "${DEPLOY_KEEP_BACKUP}" != "true" && -n "${backup_container}" ]]; then
      docker rm "${backup_container}" >/dev/null
    elif [[ -n "${backup_container}" ]]; then
      echo "backup-retained=${backup_container}"
    fi
    exit 0
  fi
  sleep 2
done

echo "Health check failed." >&2
cat /tmp/cpa-manager-health.err >&2 || true
docker logs --tail=120 "${DEPLOY_CONTAINER}" >&2 || true
false
REMOTE
}

main() {
  require_clean_local_branch
  sync_remote_git
  case "${deploy_mode}" in
    image-stream)
      build_local_image
      load_image_remote
      ;;
    remote-build)
      build_remote_image
      ;;
    *)
      echo "Unsupported DEPLOY_MODE: ${deploy_mode}" >&2
      echo "Supported modes: image-stream, remote-build" >&2
      exit 1
      ;;
  esac
  recreate_remote_container
}

main "$@"
