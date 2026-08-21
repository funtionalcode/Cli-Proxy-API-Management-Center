#!/usr/bin/env bash

set -euo pipefail

strict_mode="${TELEGRAM_STRICT:-false}"
case "${strict_mode}" in
  true|false) ;;
  *)
    echo "TELEGRAM_STRICT must be true or false." >&2
    exit 1
    ;;
esac

write_summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "Telegram status: $1" >> "${GITHUB_STEP_SUMMARY}"
  fi
}

stop_delivery() {
  local status="$1"
  local message="$2"
  echo "::warning::${message}"
  write_summary "${status}"
  if [ "${strict_mode}" = "true" ]; then
    exit 1
  fi
  exit 0
}

: "${RELEASE_TAG:?RELEASE_TAG is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

release_post="${RELEASE_POST_PATH:-docs/release-posts/${RELEASE_TAG}-telegram.html}"
github_server_url="${GITHUB_SERVER_URL:-https://github.com}"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  stop_delivery \
    "skipped-config" \
    "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured; Telegram notification skipped."
fi

if [ ! -s "${release_post}" ]; then
  stop_delivery \
    "skipped-missing-post" \
    "Telegram release post ${release_post} was not found; notification skipped."
fi

if [ -n "${TELEGRAM_MESSAGE_THREAD_ID:-}" ] &&
  ! [[ "${TELEGRAM_MESSAGE_THREAD_ID}" =~ ^[0-9]+$ ]]; then
  stop_delivery \
    "skipped-invalid-thread" \
    "TELEGRAM_MESSAGE_THREAD_ID must be numeric; Telegram notification skipped."
fi

release_url="${github_server_url}/${GITHUB_REPOSITORY}/releases/tag/${RELEASE_TAG}"
reply_markup="$(python3 - "${release_url}" <<'PY'
import json
import sys

print(json.dumps({
    "inline_keyboard": [[{"text": "查看 Release", "url": sys.argv[1]}]],
}, ensure_ascii=False, separators=(",", ":")))
PY
)"

response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT
curl_args=(
  --silent
  --show-error
  --connect-timeout 10
  --max-time 30
  --output "${response_file}"
  --write-out "%{http_code}"
  --request POST
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}"
  --data-urlencode "text@${release_post}"
  --data-urlencode "parse_mode=HTML"
  --data-urlencode "disable_web_page_preview=true"
  --data-urlencode "reply_markup=${reply_markup}"
)

if [ -n "${TELEGRAM_MESSAGE_THREAD_ID:-}" ]; then
  curl_args+=(--data-urlencode "message_thread_id=${TELEGRAM_MESSAGE_THREAD_ID}")
fi

set +e
http_code="$(curl "${curl_args[@]}")"
curl_status=$?
set -e

if [ "${curl_status}" -ne 0 ] || ! [[ "${http_code}" =~ ^2[0-9][0-9]$ ]]; then
  stop_delivery \
    "failed-delivery" \
    "Telegram API delivery failed; GitHub Release remains successful."
fi

if ! python3 - "${response_file}" <<'PY'
import json
import sys
from pathlib import Path

try:
    response = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except (OSError, UnicodeDecodeError, json.JSONDecodeError):
    raise SystemExit(1)

raise SystemExit(0 if response.get("ok") is True else 1)
PY
then
  stop_delivery \
    "failed-delivery" \
    "Telegram API did not confirm message delivery; GitHub Release remains successful."
fi

echo "Telegram release notification sent successfully."
write_summary "sent"
