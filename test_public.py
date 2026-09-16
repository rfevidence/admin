#!/usr/bin/env python3
"""Public case tracking, and consultation reminders by email."""
import asyncio
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request

B = sys.argv[1]
PW = os.environ.get("ADMIN_PASSWORD", "TestOnly#2026")
PASS = FAIL = 0


def call(m, p, b=None, t=None, raw=False):
    r = urllib.request.Request(B + p, method=m,
                               headers={"Content-Type": "application/json"})
    if t:
        r.add_header("Authorization", "Bearer " + t)
    try:
        with urllib.request.urlopen(
                r, json.dumps(b).encode() if b is not None else None, timeout=30) as x:
            data = x.read()
            return x.status, (data.decode("utf-8", "replace") if raw
                              else json.loads(data or b"{}"))
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, (data.decode("utf-8", "replace") if raw
                            else json.loads(data or b"{}"))
        except ValueError:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)[:120]}


def ok(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + label)
    else:
        FAIL += 1
        print("  FAIL  " + label + ("   <-- " + str(detail)[:200] if detail else ""))


T = call("POST", "/api/login",
         {"email": "admin@maclesotho.com", "password": PW})[1]["token"]

# ======================================================================
print("[ SETTING UP A FILE TO LOOK UP ]")
st, d = call("POST", "/api/clients", {
    "first_name": "Thabo", "last_name": "Mokoena", "nationality": "Mosotho",
    "passport_no": "LS 998877", "email": "thabo@example.com",
    "phone": "+266 5800 1234", "notes": "Sensitive internal note"}, T)
CID = d.get("id")
ok("a client with a passport number exists", st == 200, d)
st, d = call("POST", "/api/cases", {
    "client_id": CID, "service": "Work Permit — New Application",
    "destination": "South Africa", "fee_total": 5000}, T)
KID = d.get("id")
call("POST", "/api/payments", {"client_id": CID, "amount": 2500,
                               "kind": "commencement"}, T)

# a second client, to prove one cannot be reached with the other's surname
st, d = call("POST", "/api/clients", {
    "first_name": "Other", "last_name": "Person", "passport_no": "LS 111222"}, T)
call("POST", "/api/cases", {"client_id": d.get("id"), "service": "Study Abroad — Student Visa Support"}, T)

# ======================================================================
print("\n[ A CLIENT CHECKS THEIR OWN PROGRESS ]")
st, body, = call("GET", "/track", None, None, raw=True)[0], call("GET", "/track", None, None, raw=True)[1]
ok("the tracking page is public", st == 200 and "Track your" in body, st)
ok("  and asks for both facts",
   "Passport number" in body and "Surname" in body)

st, d = call("POST", "/api/public/track",
             {"passport_no": "LS998877", "last_name": "Mokoena"})
ok("the right pair finds the file", st == 200 and len(d.get("cases", [])) == 1, d)
case = d["cases"][0] if d.get("cases") else {}
ok("  spacing in the passport number does not matter", bool(case), d)
ok("  the reference is shown", case.get("reference", "").startswith("CS-"), case)
ok("  the stage is shown", bool(case.get("stage")), case)
ok("  with plain words about what happens next",
   len(case.get("what_happens_now", "")) > 20, case.get("what_happens_now"))
ok("  and how many documents are still owed",
   isinstance(case.get("documents_outstanding"), int), case)

print("\n[ WHAT IT MUST NOT REVEAL ]")
flat = json.dumps(d).lower()
for secret, why in [("thabo", "the client's first name"),
                    ("mokoena", "the client's surname"),
                    ("thabo@example.com", "their email address"),
                    ("5800 1234", "their telephone number"),
                    ("sensitive internal note", "internal notes"),
                    ("2500", "what they have paid"),
                    ("5000", "the fee"),
                    ("998877", "the passport number back again")]:
    ok("it never returns %s" % why, secret not in flat, secret)
ok("  and nothing about any other client's case",
   "study abroad" not in flat, flat[:120])

print("\n[ GUESSING IS NOT ENOUGH ]")
st, d = call("POST", "/api/public/track",
             {"passport_no": "LS998877", "last_name": "Person"})
ok("the right passport with the wrong surname is refused", st == 404, st)
st, d = call("POST", "/api/public/track",
             {"passport_no": "NOSUCHTHING", "last_name": "Mokoena"})
ok("an unknown passport is refused", st == 404, st)
wrong_pair = call("POST", "/api/public/track",
                  {"passport_no": "LS998877", "last_name": "Person"})[1]
unknown = call("POST", "/api/public/track",
               {"passport_no": "ZZZZZZ", "last_name": "Nobody"})[1]
ok("  both give the same answer, so a real passport cannot be confirmed",
   wrong_pair.get("error") == unknown.get("error"),
   (wrong_pair.get("error"), unknown.get("error")))
st, d = call("POST", "/api/public/track", {"passport_no": "LS998877"})
ok("a passport alone is not accepted", st == 400, st)
st, d = call("POST", "/api/public/track", {"last_name": "Mokoena"})
ok("a surname alone is not accepted", st == 400, st)

print("\n[ REPEATED GUESSING IS THROTTLED ]")
codes = [call("POST", "/api/public/track",
              {"passport_no": "GUESS%d" % i, "last_name": "Nobody"})[0]
         for i in range(14)]
ok("the lookups are capped per connection", 429 in codes,
   sorted(set(codes)))
st, d = call("GET", "/api/system", None, T)
ok("  and every attempt is on the record",
   any("track:" in (r.get("reason") or "") for r in d.get("ingest", [])),
   [r.get("reason") for r in d.get("ingest", [])][:3])

print("\n[ A REAL CLIENT IS NOT LOCKED OUT BY OTHERS' GUESSING ]")
good = [call("POST", "/api/public/track",
             {"passport_no": "LS998877", "last_name": "Mokoena"})[0]
        for _ in range(6)]
ok("a client can check repeatedly even after failed guesses",
   all(c == 200 for c in good), good)

print("\n[ THE OWNER CAN SWITCH TRACKING OFF ]")
call("POST", "/api/settings", {"tracking_enabled": "0"}, T)
st, d = call("POST", "/api/public/track",
             {"passport_no": "LS998877", "last_name": "Mokoena"})
ok("with it off, nothing is served", st == 404, st)
call("POST", "/api/settings", {"tracking_enabled": "1"}, T)
st, d = call("POST", "/api/public/track",
             {"passport_no": "ls 998877", "last_name": "MOKOENA"})
ok("switching it back on works, and case does not matter", st == 200, st)

# ======================================================================
print("\n[ CONSULTATION REMINDERS ]")
st, d = call("GET", "/api/settings", None, T)
ok("reminders start switched off", d["settings"]["reminders_enabled"] == "0",
   d["settings"]["reminders_enabled"])
ok("  the Zoho host is pre-filled", d["settings"]["smtp_host"] == "smtp.zoho.com",
   d["settings"]["smtp_host"])
ok("  and no password is stored yet", d["settings"]["smtp_pass_set"] == "",
   d["settings"]["smtp_pass_set"])

st, d = call("POST", "/api/reminders/run", {}, T)
ok("nothing is sent while they are off",
   d.get("sent") == 0 and "off" in (d.get("skipped") or ""), d)

st, d = call("POST", "/api/settings/smtp-password", {"password": "app-password"}, T)
ok("a password can be stored", st == 200, d)
st, d = call("GET", "/api/settings", None, T)
ok("  it is never handed back out",
   "smtp_pass" not in d["settings"] and d["settings"]["smtp_pass_set"] == "1",
   d["settings"].get("smtp_pass_set"))

st, d = call("POST", "/api/settings/test-email", {"to": "x@y.com"}, T)
ok("a test to an unreachable server reports the reason rather than hanging",
   st == 400 and len(d.get("error", "")) > 5, (st, d))

print("\n[ THE SWEEP PICKS THE RIGHT MEETINGS ]")
import datetime as _dt
soon = (_dt.datetime.utcnow() + _dt.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M")
later = (_dt.datetime.utcnow() + _dt.timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M")
st, d = call("POST", "/api/appointments",
             {"client_id": CID, "case_id": KID, "title": "Permit review",
              "starts_at": soon}, T)
SOON_ID = d.get("id")
call("POST", "/api/appointments",
     {"client_id": CID, "title": "Much later", "starts_at": later}, T)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db as _db      # noqa: E402
import core as _core  # noqa: E402
conn = _db.connect()
due = _core.due_reminders(conn, 30)
ok("the one in half an hour is due", any(a["id"] == SOON_ID for a in due),
   [a["title"] for a in due])
ok("  the one in six hours is not", not any(a["title"] == "Much later" for a in due),
   [a["title"] for a in due])
text = _core.reminder_text(due[0], _core.get_settings(conn))
ok("the message names the client", "Thabo" in text, text[:90])
ok("  and the case reference", "CS-" in text, text[:200])
ok("  and where it happens", "Where" in text, text[:200])
conn.close()

print("\n[ IT ACTUALLY SENDS ]")
# a throwaway SMTP server, so the whole path is exercised
try:
    from aiosmtpd.controller import Controller
    HAVE_SMTPD = True
except ImportError:
    HAVE_SMTPD = False

if HAVE_SMTPD:
    inbox = []

    class Sink:
        async def handle_DATA(self, server, session, envelope):
            inbox.append((envelope.rcpt_tos, envelope.content.decode("utf-8", "replace")))
            return "250 OK"

    from aiosmtpd.controller import Controller as _C
    try:
        from aiosmtpd.smtp import AuthResult, LoginPassword  # noqa: F401

        def authenticator(server, session, envelope, mechanism, auth_data):
            return AuthResult(success=True)

        ctrl = _C(Sink(), hostname="127.0.0.1", port=8025,
                  authenticator=authenticator, auth_require_tls=False)
    except Exception:
        ctrl = Controller(Sink(), hostname="127.0.0.1", port=8025)
    ctrl.start()
    call("POST", "/api/settings",
         {"smtp_host": "127.0.0.1", "smtp_port": "8025", "smtp_user": "mac",
          "smtp_from": "info@maclesotho.com", "reminders_enabled": "1",
          "org_email": "info@maclesotho.com"}, T)
    call("POST", "/api/settings/smtp-password", {"password": "x"}, T)
    st, d = call("POST", "/api/reminders/run", {}, T)
    ok("the reminder goes out", d.get("sent") == 1, d)
    ok("  addressed to the office", inbox and "info@maclesotho.com" in inbox[0][0],
       inbox[0][0] if inbox else None)
    ok("  carrying the client and the time",
       inbox and "Thabo" in inbox[0][1], inbox[0][1][:140] if inbox else None)
    st, d = call("POST", "/api/reminders/run", {}, T)
    ok("a second sweep does not send it again", d.get("sent") == 0, d)
    st, d = call("POST", "/api/settings/test-email", {"to": "someone@example.com"}, T)
    ok("the test button sends too", st == 200 and len(inbox) == 2, (st, len(inbox)))
    ctrl.stop()
    call("POST", "/api/settings", {"reminders_enabled": "0"}, T)
else:
    print("  SKIP  no local SMTP server available to receive")

print("\n" + "=" * 60)
print("PASS %d   FAIL %d" % (PASS, FAIL))
print("=" * 60)
sys.exit(1 if FAIL else 0)
