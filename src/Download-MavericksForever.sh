#!/bin/bash
# Download-only derivative of MavericksForever get.sh by Wowfunhappy (2026-02-09).
# Upstream: https://mavericksforever.com/get.sh
# Thanks to Krackers, Jazzzny and others, and dosdude1 for the donated identifiers.
# App changes: private job directory, partial-download filename, bounded requests,
# validation before publishing InstallESD.dmg. No USB or disk-formatting workflow.
set -euo pipefail
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
export LC_ALL=C LANG=C
umask 077
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 2 ] || die 'Expected the app-created download job directory and cancellation marker path.'
CANCEL_FILE="$2"
case "$CANCEL_FILE" in ''|/*) ;; *) die 'Invalid cancellation marker path.' ;; esac
CURL_PID=''
stop_download() {
    if [ -n "$CURL_PID" ]; then
        kill -TERM "$CURL_PID" 2>/dev/null || true
        wait "$CURL_PID" 2>/dev/null || true
        CURL_PID=''
    fi
}
check_cancelled() {
    if [ -n "$CANCEL_FILE" ] && [ -e "$CANCEL_FILE" ]; then
        stop_download
        die 'Download cancelled. The partial download remains in its workspace folder.'
    fi
}
case "$1" in /*) ;; *) die 'The download directory must be absolute.' ;; esac
[ -d "$1" ] && [ ! -L "$1" ] || die 'Invalid download directory.'
cd -P "$1"
[ -f .mavericks-source-job ] && [ ! -L .mavericks-source-job ] || die 'Missing app job marker.'
[ "$(/usr/bin/stat -f '%u' .)" = "$(/usr/bin/id -u)" ] || die 'Download directory has a different owner.'
for item in key_info InstallESD.dmg InstallESD.dmg.part; do
    [ ! -e "$item" ] && [ ! -L "$item" ] || die "Download job is not new: $item"
done
for utility in curl xxd openssl od awk tr dd; do
    command -v "$utility" >/dev/null || die "Required tool is unavailable: $utility"
done
openssl dgst -sha256 </dev/null >/dev/null 2>&1 || die 'SHA-256 is unavailable.'
trap 'stop_download; exit 129' HUP
trap 'stop_download; exit 130' INT
trap 'stop_download; exit 143' TERM
hex_to_bin() { printf '%s' "$1" | xxd -r -p; }
bin_to_hex() { od -An -tx1 | tr -d ' \n' | tr '[:lower:]' '[:upper:]'; }
CLIENT_ID=$(dd if=/dev/urandom bs=8 count=1 2>/dev/null | bin_to_hex)
check_cancelled
SERVER_ID=$(curl -fsS --connect-timeout 30 --max-time 120 --retry 2 -c - http://osrecovery.apple.com/ | tail -n 1 | awk '{print $NF}')
SERVER_CHALLENGE=$(printf '%s\n' "$SERVER_ID" | awk -F'~' '{print $2}')
case "$SERVER_CHALLENGE" in ''|*[!0-9a-fA-F]*) die 'Apple returned an invalid recovery challenge.' ;; esac
[ $(( ${#SERVER_CHALLENGE} % 2 )) -eq 0 ] || die 'Incomplete recovery challenge.'
BOARD_SERIAL_NUMBER='C0243070168G3M91F'
BOARD_ID='Mac-3CBD00234E554E41'
ROM='003EE1E6AC14'
{
    hex_to_bin "$CLIENT_ID"
    hex_to_bin "$SERVER_CHALLENGE"
    hex_to_bin "$ROM"
    printf '%s' "${BOARD_SERIAL_NUMBER}${BOARD_ID}" | openssl dgst -sha256 -binary
    printf '\314\314\314\314\314\314\314\314\314\314'
} > key_info
KEY=$(openssl dgst -sha256 -binary < key_info | bin_to_hex)
/bin/rm key_info
check_cancelled
INSTALLATION_PAYLOAD=$(curl -fsS --connect-timeout 30 --max-time 120 --retry 2 \
    'http://osrecovery.apple.com/InstallationPayload/OSInstaller' -X POST \
    -H 'Content-Type: text/plain' --cookie "session=$SERVER_ID" \
    -d "cid=$CLIENT_ID
sn=$BOARD_SERIAL_NUMBER
bid=$BOARD_ID
k=$KEY")
ASSET_URL=$(printf '%s\n' "$INSTALLATION_PAYLOAD" | awk -F': ' '/^AU/{print $2}' | tr -d '\r')
ASSET_TOKEN=$(printf '%s\n' "$INSTALLATION_PAYLOAD" | awk -F': ' '/^AT/{print $2}' | tr -d '\r')
[ "$ASSET_URL" = 'http://oscdn.apple.com/content/downloads/33/62/031-10295/gho4r94w66f5v4ujm0sz7k1m0hua68i6oo/OSInstaller/InstallESD.dmg' ] || die 'Apple did not return the expected Mavericks image URL.'
[ -n "$ASSET_TOKEN" ] || die 'Apple returned no download token.'
case "$ASSET_TOKEN" in *$'\n'*) die 'Invalid download token.' ;; esac
printf 'Downloading Mavericks InstallESD.dmg...\n'
check_cancelled
curl -fS --progress-bar --connect-timeout 30 --speed-time 120 --speed-limit 1024 --retry 2 \
    "$ASSET_URL" -H "Cookie: AssetToken=$ASSET_TOKEN" -o InstallESD.dmg.part &
CURL_PID=$!
while kill -0 "$CURL_PID" 2>/dev/null; do
    check_cancelled
    sleep 1
done
wait "$CURL_PID"
CURL_PID=''
check_cancelled
printf 'Checking downloaded Mavericks file...\n'
ACTUAL=$(openssl dgst -sha256 InstallESD.dmg.part | awk '{print $NF}')
check_cancelled
[ "$ACTUAL" = 'c861fd59e82bf777496809a0d2a9b58f66691ee56738031f55874a3fe1d7c3ff' ] || die 'Download checksum mismatch; the incomplete file was retained in this job folder.'
/bin/mv InstallESD.dmg.part InstallESD.dmg
printf 'Verified Mavericks InstallESD.dmg.\n'
