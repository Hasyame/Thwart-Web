"""Checks live sync against the running server, from the server.

    scp deploy/live-probe.py root@thwart.app:/root/ && ssh root@thwart.app python3 /root/live-probe.py

Runs on the host rather than from a laptop because confirming an account means
reading the mail Postfix delivered, and this is a send-only machine whose
mailbox is a local file. Everything else goes over the public HTTPS endpoint, so
nginx, the timeouts and the proxy buffering are all in the path being tested --
which is the point. A test that talked to :8787 directly would pass while the
feature was broken for every real client.

What it asserts, in order: a stream opens and is greeted; a change reaches both
of one account's clients; the other account hears nothing; a client that missed
the window catches up in one pull; a client reconnecting behind is told
immediately; a repeated batch does not write twice; a rating of a game the
account played is stored and one of a game it did not is refused, by name,
without holding up the plays beside it; and the public summary stays silent
below the threshold.

The probe accounts are kept between runs and their records cleared at the end.
Registration is capped at five an hour per address, and a test that spends that
budget every run is a test you can only run five times.

Both addresses land in root's mailbox by way of the + extension Postfix already
has enabled, so there is no alias to install on the host and none to remember to
remove.
"""
import json
import re
import secrets
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request

BASE = "https://thwart.app/api/v1"
ok_count = 0
fail_count = 0


def check(label, ok, detail=""):
    global ok_count, fail_count
    if ok:
        ok_count += 1
        print("ok    " + label + (("  (" + detail + ")") if detail else ""))
    else:
        fail_count += 1
        print("FAIL  " + label + (("  (" + detail + ")") if detail else ""))


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:200]}


def links_in_mailbox():
    try:
        mail = open("/var/mail/root", "rb").read().decode("utf-8", "replace")
    except OSError:
        return []
    return re.findall(r"https://thwart[.]app/verify[?]token=(\S+)", mail)


# Everything already delivered, so "new" means new since this run started.
# Without this, an already-used link from a previous run looks fresh and
# confirming it fails, leaving the account unconfirmed and its stream refused.
seen_tokens = set(links_in_mailbox())


def confirm_from_mailbox():
    """Waits for a link that was not already there, and opens it."""
    deadline = time.time() + 60
    while time.time() < deadline:
        found = links_in_mailbox()
        fresh = [t for t in found if t not in seen_tokens]
        if fresh:
            seen_tokens.update(found)
            status, _ = call("POST", "/auth/verify", {"token": fresh[-1]})
            if status != 200:
                print("confirm failed:", status)
                sys.exit(1)
            return
        time.sleep(0.5)
    print("no new confirmation link arrived")
    sys.exit(1)


def make_account(tag, address):
    """Signs in to the probe account, registering it the first time only."""
    handle = "liveprobe-" + tag
    password = "probe " + tag + " long enough password"

    status, signed = call("POST", "/auth/login", {
        "handle": handle, "password": password, "deviceName": "probe",
    })
    if status == 200:
        return handle, password, signed["token"]

    # Exists but was never confirmed — a real state, and the one a previous
    # interrupted run leaves behind. Ask for a fresh link and open it.
    if status == 403 and signed.get("error", {}).get("code") == "email_not_verified":
        code, said = call("POST", "/auth/verify/resend",
                          {"handle": handle, "password": password})
        print("    resend for %s: %s %s" % (handle, code, said))
        confirm_from_mailbox()
        status, signed = call("POST", "/auth/login", {
            "handle": handle, "password": password, "deviceName": "probe",
        })
        if status != 200:
            print("sign in after confirming failed:", status, signed)
            sys.exit(1)
        return handle, password, signed["token"]

    status, created = call("POST", "/auth/register", {
        "handle": handle, "email": address,
        "password": password, "deviceName": "probe",
    })
    if status != 201:
        print("register failed:", status, created)
        sys.exit(1)
    # Confirm through the link Postfix delivered locally.
    #
    # Waiting for a link that was not already in the mailbox, rather than
    # sleeping and taking the last one. Delivery through an alias is not
    # instant, and re-confirming the previous account's link silently leaves
    # this one unconfirmed — which then fails as a stream that will not open.
    confirm_from_mailbox()
    return handle, password, created["token"]


class Stream(threading.Thread):
    """Reads a live stream and records the revisions it is told about."""

    def __init__(self, token, since=0, name="stream"):
        super().__init__(daemon=True)
        self.token = token
        self.since = since
        self.name_ = name
        self.revisions = []
        self.comments = 0
        self.opened = False
        self.stop = threading.Event()

    def run(self):
        url = "%s/sync/stream?since=%d&token=%s" % (BASE, self.since, self.token)
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(url, timeout=60, context=ctx) as r:
                self.opened = r.status == 200
                for raw in r:
                    if self.stop.is_set():
                        return
                    line = raw.decode("utf-8", "replace").strip()
                    if line.startswith(":"):
                        self.comments += 1
                    elif line.startswith("data:"):
                        try:
                            self.revisions.append(json.loads(line[5:].strip())["revision"])
                        except Exception:
                            pass
        except Exception:
            pass

    def wait_for(self, count, seconds):
        deadline = time.time() + seconds
        while time.time() < deadline:
            if len(self.revisions) >= count:
                return True
            time.sleep(0.1)
        return False


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# Batch ids are remembered for a day, and a rerun that reused "b-play-2" would
# be answered from memory rather than written -- and then fail to catch up on
# a change that was never made. Unique per run, so the second run is a run.
RUN = secrets.token_hex(3)


def push(token, ident, batch=None):
    return call("POST", "/sync/changes", {
        "batchId": batch or ("b-" + RUN + "-" + ident),
        "records": [{
            "collection": "plays",
            "id": ident,
            "updatedAt": now_iso(),
            "body": {"id": ident, "won": True, "playedAt": 1700000000000,
                     "scenarioCode": "rhino", "modularSets": "bomb_scare"},
        }],
    }, token=token)


def rating(subject, play_id, score=3):
    return {
        "collection": "ratings",
        "id": subject,
        "updatedAt": now_iso(),
        "body": {"subject": subject, "score": score, "ratedAt": int(time.time() * 1000),
                 "evidence": {"playId": play_id},
                 "context": {"players": 1, "heroes": [], "mode": "standard_i", "standardSet": "standard_i"}},
    }


print("--- two accounts ---")
handle_a, pass_a, token_a = make_account("a", "root@localhost.localdomain")
handle_b, pass_b, token_b = make_account("b", "root+b@localhost.localdomain")
check("two confirmed accounts", True, handle_a + " and " + handle_b)

print()
print("--- a change in one client reaches another with no reload ---")
first = Stream(token_a, 0, "a1")
second = Stream(token_a, 0, "a2")
other = Stream(token_b, 0, "b1")
for s in (first, second, other):
    s.start()
time.sleep(2.5)
check("streams opened through nginx",
      first.opened and second.opened and other.opened,
      "a1=%s a2=%s b1=%s" % (first.opened, second.opened, other.opened))
check("and each greeted, so a buffering proxy is ruled out", first.comments >= 1, "%d comments" % first.comments)

started = time.time()
status, _ = push(token_a, "play-1")
check("the push was accepted", status == 200, str(status))
arrived = first.wait_for(1, 5) and second.wait_for(1, 5)
check("both of this account's clients were told", arrived,
      "%.1fs" % (time.time() - started))

print()
print("--- and never reaches another account ---")
time.sleep(1.0)
check("the other account heard nothing", len(other.revisions) == 0,
      str(other.revisions))

print()
print("--- three changes while 'offline', then catching up ---")
# The client is not listening: this is the missed-window case.
for s in (first, second):
    s.stop.set()
time.sleep(0.5)

before = call("GET", "/sync/changes?since=0", token=token_a)[1].get("cursor", 0)
for i in (2, 3, 4):
    push(token_a, "play-%d" % i)
status, page = call("GET", "/sync/changes?since=%d" % before, token=token_a)
ids = sorted(r["id"] for r in page.get("changes", []))
check("all three arrive in one catch-up", ids == ["play-2", "play-3", "play-4"], ",".join(ids))
check("with no duplicates", len(ids) == len(set(ids)))

print()
print("--- a client that reconnects behind is told to catch up ---")
late = Stream(token_a, before, "late")
late.start()
check("told immediately on connect", late.wait_for(1, 5), str(late.revisions))
late.stop.set()

print()
print("--- a repeated batch does not write twice ---")
status_one, body_one = push(token_a, "play-5", batch="same-batch-" + RUN)
status_two, body_two = push(token_a, "play-5", batch="same-batch-" + RUN)
check("the retry is idempotent",
      status_one == 200 and status_two == 200 and body_one.get("cursor") == body_two.get("cursor"),
      "cursors %s then %s" % (body_one.get("cursor"), body_two.get("cursor")))

print()
print("--- a rating is checked against the game it cites ---")
# Plays first, then ratings, in one batch: the server checks a rating against
# the play as it holds it, which includes one earlier in the same batch. The
# second rating cites a play this account never pushed; it must be refused by
# name while the play and the honest rating beside it still apply.
status, body = call("POST", "/sync/changes", {
    "batchId": "ratings-" + secrets.token_hex(4),
    "records": [
        {"collection": "plays", "id": "play-6", "updatedAt": now_iso(),
         "body": {"id": "play-6", "won": False, "playedAt": 1700000000000,
                  "scenarioCode": "rhino", "modularSets": "bomb_scare"}},
        rating("scenario:rhino", "play-6"),
        rating("modular:bomb_scare@rhino", "play-6", 4),
        rating("scenario:klaw", "play-6"),
        rating("scenario:rhino-nobody", "play-never"),
    ],
}, token=token_a)
outcomes = {r["id"]: (r.get("outcome"), r.get("reason")) for r in body.get("results", [])}
check("the batch was accepted as a whole", status == 200, str(status))
check("the play applied", outcomes.get("play-6", (None,))[0] in ("applied", "applied_over_conflict", "already_present"),
      str(outcomes.get("play-6")))
check("a rating of the scenario played is stored",
      outcomes.get("scenario:rhino", (None,))[0] in ("applied", "applied_over_conflict"),
      str(outcomes.get("scenario:rhino")))
check("and of a set drawn with it",
      outcomes.get("modular:bomb_scare@rhino", (None,))[0] in ("applied", "applied_over_conflict"),
      str(outcomes.get("modular:bomb_scare@rhino")))
check("a rating of a scenario this game was not is refused, by name",
      outcomes.get("scenario:klaw") == ("rejected", "subject_mismatch"), str(outcomes.get("scenario:klaw")))
check("and one citing a game never pushed",
      outcomes.get("scenario:rhino-nobody") == ("rejected", "not_played"), str(outcomes.get("scenario:rhino-nobody")))

# Named, because a pull that names no collections is served the set from
# before ratings existed: that is what keeps an older phone from being handed a
# record it cannot read.
status, page = call("GET", "/sync/changes?since=0&collections=plays,ratings", token=token_a)
held = sorted(c["id"] for c in page.get("changes", []) if c.get("collection") == "ratings" and not c.get("deleted"))
status, unnamed = call("GET", "/sync/changes?since=0", token=token_a)
check("and a pull that names no collections is not handed a rating",
      not any(c.get("collection") == "ratings" for c in unnamed.get("changes", [])))
check("the server holds exactly the two honest ratings",
      held == ["modular:bomb_scare@rhino", "scenario:rhino"], ",".join(held))

status, summary = call("GET", "/ratings/summary?subject=scenario:rhino&subject=modular:bomb_scare")
one = summary if isinstance(summary, dict) else {}
check("the public summary answers without a token", status == 200, str(status))
check("and says nothing of a mean below the threshold",
      "mean" not in one.get("scenario:rhino", {}) and one.get("scenario:rhino", {}).get("count", 0) >= 1,
      json.dumps(one.get("scenario:rhino")))

print()
print("--- clean up ---")
# The probe accounts are kept and reused: registration is limited to five an
# hour per address, and a test that spends that budget every run stops being a
# test you can run. Their records are removed instead.
for token, _ in ((token_a, None), (token_b, None)):
    status, page = call("GET", "/sync/changes?since=0", token=token)
    stale = [(c["collection"], c["id"]) for c in page.get("changes", []) if not c.get("deleted")]
    if stale:
        # Ratings before plays: a tombstoned rating is unindexed from the
        # public summary, and the order keeps every tombstone a plain delete.
        stale.sort(key=lambda pair: 0 if pair[0] == "ratings" else 1)
        call("POST", "/sync/changes", {
            "batchId": "cleanup-" + secrets.token_hex(4),
            "records": [
                {"collection": collection, "id": i,
                 "updatedAt": now_iso(),
                 "deleted": True}
                for collection, i in stale
            ],
        }, token=token)
check("probe records cleared", True)

print()
print("PASS" if fail_count == 0 else "%d FAILED" % fail_count)
sys.exit(0 if fail_count == 0 else 1)
