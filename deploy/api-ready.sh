#!/bin/sh
# Sourced by the release and nightly builders, with their git checkout as cwd.
# Match the running process, not merely the binary most recently built on disk.
running_build() {
    curl -fsS --max-time 5 "${API_URL:-http://127.0.0.1:8787/v1}/health" >/dev/null 2>&1 || return 1
    curl -fsS --max-time 5 "${API_URL:-http://127.0.0.1:8787/v1}/version" 2>/dev/null |
        node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const b=JSON.parse(s).build;if(!/^[0-9a-f]{12}$/.test(b))process.exit(1);process.stdout.write(b)}catch{process.exit(1)}})'
}

healthy_at() {
    actual="$(running_build)" || return 1
    [ "$actual" = "$(git rev-parse --short=12 "$1")" ]
}

site_api_ready() {
    [ -f "$BIN/thwart-api.commit" ] || return 1
    confirmed="$(cat "$BIN/thwart-api.commit")"
    healthy_at "$confirmed" && git diff --quiet "$confirmed" "$1" -- ':(top)server'
}
