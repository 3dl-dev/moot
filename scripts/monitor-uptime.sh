#!/usr/bin/env bash
# Uptime + TLS-expiry monitor for moot.pub (moot-1d4).
#
# Exits non-zero when the site is unreachable / returns 5xx, or when the managed
# TLS cert is within CERT_MIN_DAYS of expiry. In CI it runs on a schedule; a
# failed scheduled run emails the repo owner (GitHub's default notification), so
# a non-zero exit *is* the alert. Runs identically on a dev machine — no external
# monitoring service to stand up.
#
#   HOST=moot.pub CERT_MIN_DAYS=14 ./scripts/monitor-uptime.sh
set -euo pipefail

HOST="${HOST:-moot.pub}"
URL="${URL:-https://${HOST}/}"
CERT_MIN_DAYS="${CERT_MIN_DAYS:-14}"   # alert if cert expires within this many days
CURL_TIMEOUT="${CURL_TIMEOUT:-20}"

fail=0

# --- Uptime: DNS + HTTP reachability, reject 5xx --------------------------------
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$URL" 2>/dev/null)" || code="000"
if [ "$code" = "000" ]; then
  echo "DOWN: $URL — no response (DNS failure, timeout, or TLS error)"
  fail=1
elif [ "$code" -ge 500 ]; then
  echo "DOWN: $URL — HTTP $code"
  fail=1
else
  echo "UP:   $URL — HTTP $code"
fi

# --- TLS expiry -----------------------------------------------------------------
end_date="$(echo | openssl s_client -servername "$HOST" -connect "${HOST}:443" 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
if [ -z "$end_date" ]; then
  echo "CERT: could not read certificate for $HOST"
  fail=1
else
  end_epoch="$(date -d "$end_date" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date +%s)"
  days_left=$(( (end_epoch - now_epoch) / 86400 ))
  if [ "$end_epoch" = "0" ]; then
    echo "CERT: could not parse expiry '$end_date'"
    fail=1
  elif [ "$days_left" -lt "$CERT_MIN_DAYS" ]; then
    echo "CERT: EXPIRING in ${days_left}d (${end_date}) — below ${CERT_MIN_DAYS}d threshold"
    fail=1
  else
    echo "CERT: ${days_left}d remaining (${end_date})"
  fi
fi

exit "$fail"
