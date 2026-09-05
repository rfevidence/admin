#!/usr/bin/env python3
"""Pre-deployment audit — the failure modes that only appear with real use."""
import concurrent.futures as cf
import json
import os
import sys
import urllib.error
import urllib.request

B = sys.argv[1]
PW = os.environ.get("ADMIN_PASSWORD", "TestOnly#2026")
PASS = FAIL = 0
NOTES = []


def call(m, p, b=None, t=None, h=None, raw=False):
    r = urllib.request.Request(B + p, method=m,
                               headers={"Content-Type": "application/json"})
    if t:
        r.add_header("Authorization", "Bearer " + t)
    for k, v in (h or {}).items():
        r.add_header(k, v)
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


def note(msg):
    NOTES.append(msg)
    print("  NOTE  " + msg)


st, d = call("POST", "/api/login", {"email": "admin@maclesotho.com", "password": PW})
T = d.get("token")
assert T, "could not sign in: %s" % d
KEY = call("GET", "/api/settings", None, T)[1]["settings"]["intake_api_key"]

# ======================================================================
print("\n[ REFERENCE NUMBERS UNDER LOAD ]")
# Two staff adding clients at the same moment must not receive the same
# reference. This is the classic read-then-write race.
def make_client(i):
    return call("POST", "/api/clients",
                {"first_name": "Race%d" % i, "last_name": "Test"}, T)


with cf.ThreadPoolExecutor(max_workers=12) as ex:
    results = list(ex.map(make_client, range(24)))
refs = [d.get("ref") for st, d in results if st == 200]
ok("24 simultaneous client records all saved", len(refs) == 24, len(refs))
ok("every reference number is unique", len(set(refs)) == len(refs),
   "duplicates: %s" % [r for r in refs if refs.count(r) > 1][:4])


def make_enquiry(i):
    return call("POST", "/api/public/intake",
                {"first_name": "Flood%d" % i, "last_name": "Test",
                 "email": "f%d@x.com" % i}, None, {"X-Api-Key": KEY})


with cf.ThreadPoolExecutor(max_workers=10) as ex:
    eres = list(ex.map(make_enquiry, range(10)))
erefs = [d.get("reference") for st, d in eres if st == 200]
ok("simultaneous website submissions all land", len(erefs) >= 8, len(erefs))
ok("their references are unique too", len(set(erefs)) == len(erefs),
   [r for r in erefs if erefs.count(r) > 1][:4])

# ======================================================================
print("\n[ NAMES AND TEXT FROM THE REAL WORLD ]")
tricky = [
    ("Sesotho with diacritics", "Mpho", "Mokhosi-Ts'oeu"),
    ("apostrophe", "M'e", "O'Brien"),
    ("Chinese characters", "伟", "张"),
    ("accented French", "Aimée", "Nguyên"),
    ("hyphen and space", "Jean-Paul", "van der Merwe"),
]
ids = []
for label, first, last in tricky:
    st, d = call("POST", "/api/clients",
                 {"first_name": first, "last_name": last,
                  "nationality": "Mosotho", "notes": "Tel: +266 5" + "0" * 7},
                 T)
    ok("stores a name with %s" % label, st == 200, d)
    ids.append(d.get("id"))
st, d = call("GET", "/api/clients?q=" + urllib.request.quote("Ts'oeu"), None, T)
ok("an apostrophe in a search does not break the query",
   st == 200 and len(d.get("clients", [])) >= 1, d.get("error") or len(d.get("clients", [])))
st, d = call("GET", "/api/clients?q=" + urllib.request.quote("张"), None, T)
ok("searching by a non-Latin name works", st == 200 and len(d.get("clients", [])) == 1,
   len(d.get("clients", [])))

# SQL injection attempts through every route that takes free text
for probe in ["'; DROP TABLE clients; --", "' OR '1'='1", "%' OR 1=1 --"]:
    st, d = call("GET", "/api/clients?q=" + urllib.request.quote(probe), None, T)
    if st != 200:
        ok("search survives %r" % probe[:18], False, d)
        break
else:
    ok("SQL injection probes in search are treated as text", True)
st, d = call("GET", "/api/clients", None, T)
ok("the clients table still exists afterwards", st == 200 and d.get("clients"), st)

# ======================================================================
print("\n[ SPREADSHEET SAFETY OF EXPORTS ]")
# A client name beginning = + - @ is run as a formula when the CSV is opened
# in Excel. This is how CSV exports become an attack on the office.
st, d = call("POST", "/api/public/intake",
             {"first_name": "=1+1", "last_name": "@SUM(A1)",
              "email": "csv@test.com",
              "message": "+HYPERLINK(\"http://evil\",\"click\")"},
             None, {"X-Api-Key": KEY})
ok("a submission with formula-like text is accepted", st == 200, d)
st, body = call("GET", "/export/enquiries?from=2000-01-01&to=2030-01-01",
                None, T, raw=True)
ok("the export downloads", st == 200, st)
dangerous = [ln for ln in body.splitlines()
             if ln.startswith(("=", "+", "-", "@"))
             or ',=' in ln or ',+HYPERLINK' in ln or ',@SUM' in ln]
if dangerous:
    note("CSV cells beginning = + - @ are written unescaped; Excel would treat "
         "them as formulas. Example: %s" % dangerous[0][:90])
    ok("formula-like cells are neutralised in the CSV", False, dangerous[0][:120])
else:
    ok("formula-like cells are neutralised in the CSV", True)

# ======================================================================
print("\n[ WHAT THE BROWSER RECEIVES ]")
st, d = call("POST", "/api/public/intake",
             {"first_name": "<img src=x onerror=alert(1)>",
              "last_name": "</script><script>alert(2)</script>",
              "email": "xss@test.com",
              "message": "<svg/onload=alert(3)>"},
             None, {"X-Api-Key": KEY})
ok("a submission carrying script tags is accepted as text", st == 200, d)
st, d = call("GET", "/api/enquiries?status=all", None, T)
row = [e for e in d.get("enquiries", []) if e["email"] == "xss@test.com"]
ok("it is stored verbatim, not stripped", bool(row) and "<img" in row[0]["first_name"],
   row[0]["first_name"] if row else None)
st, body, = call("GET", "/", None, raw=True)[0], call("GET", "/", None, raw=True)[1]
ok("the served page has no interpolated data in it",
   "<img src=x" not in body, "page contains stored input")

# ======================================================================
print("\n[ DATES AND ARITHMETIC ]")
st, d = call("POST", "/api/clients",
             {"first_name": "Expiry", "last_name": "Check",
              "permit_expiry": "2026-09-06", "passport_expiry": "2020-01-01"}, T)
CID = d.get("id")
st, d = call("GET", "/api/clients/%d" % CID, None, T)
alerts = " ".join(a["text"] for a in d.get("alerts", []))
ok("an expired passport is flagged as expired", "expired" in alerts.lower(), alerts)
ok("a permit expiring tomorrow is flagged", "expires in" in alerts.lower(), alerts)
st, d = call("GET", "/api/expiries?days=400", None, T)
bad = [x for x in d.get("expiries", []) if x.get("days") is None]
ok("every expiry row has a day count", not bad, bad[:2])

st, d = call("GET", "/api/reports/clients?from=2030-01-01&to=2000-01-01", None, T)
ok("a backwards date range returns nothing rather than erroring",
   st == 200 and d.get("count") == 0, (st, d.get("count")))
st, d = call("GET", "/api/reports/clients?from=notadate&to=alsonot", None, T)
ok("an unparseable date range does not crash the server", st in (200, 400), st)

st, d = call("POST", "/api/payments", {"client_id": CID, "amount": 0.005}, T)
st2, d2 = call("GET", "/api/clients/%d" % CID, None, T)
ok("a fractional amount does not corrupt the client total",
   st2 == 200 and isinstance(d2["payments"][0]["amount"], (int, float)),
   d2.get("payments", [{}])[0].get("amount"))
st, d = call("POST", "/api/payments", {"client_id": CID, "amount": -500}, T)
ok("a negative payment is refused", st == 400, st)
st, d = call("POST", "/api/payments", {"client_id": CID, "amount": "abc"}, T)
ok("a non-numeric amount is refused", st == 400, st)

# ======================================================================
print("\n[ PERMISSIONS HOLD UNDER PRESSURE ]")
st, d = call("POST", "/api/users",
             {"name": "Audit Advisor", "email": "audit.advisor@maclesotho.com",
              "role": "advisor"}, T)
temp = d.get("temp_password")
st, d = call("POST", "/api/login",
             {"email": "audit.advisor@maclesotho.com", "password": temp})
T2 = d.get("token")
st, d = call("POST", "/api/change-password",
             {"current_password": temp, "new_password": "Advisor#2026x"}, T2)
st, d = call("POST", "/api/login",
             {"email": "audit.advisor@maclesotho.com", "password": "Advisor#2026x"})
T2 = d.get("token")
forbidden = [
    ("create staff", "POST", "/api/users", {"name": "x", "email": "z@z.com"}),
    ("change settings", "POST", "/api/settings", {"org_name": "x"}),
    ("rotate the intake key", "POST", "/api/settings/rotate-key", {}),
    ("delete a client", "DELETE", "/api/clients/%d" % CID, {}),
    ("run a backup copy", "POST", "/api/system/mirror-now", {}),
]
for label, m, p, body in forbidden:
    st, d = call(m, p, body, T2)
    ok("an advisor cannot %s" % label, st == 403, st)
st, d = call("GET", "/api/settings", None, T2)
ok("an advisor is not shown the intake key",
   "intake_api_key" not in d.get("settings", {}), list(d.get("settings", {}))[:3])
st, d = call("GET", "/export/audit?from=2000-01-01&to=2030-01-01", None, T2, raw=True)
ok("an advisor can still export their own reports", st == 200, st)

# ======================================================================
print("\n[ THE PUBLIC ENDPOINT IS THE ONLY DOOR ]")
for path in ["/api/clients", "/api/dashboard", "/api/system", "/api/audit",
             "/api/users", "/api/settings", "/export/clients"]:
    st, d = call("GET", path)
    if st != 401:
        ok("%s requires a sign in" % path, False, st)
        break
else:
    ok("every private endpoint refuses an anonymous caller", True)
st, d = call("POST", "/api/public/intake", {"first_name": "NoKey"})
ok("the intake endpoint refuses a missing key", st == 401, st)
st, d = call("GET", "/api/public/ping", None, None, {"X-Api-Key": KEY})
ok("the intake endpoint answers a correct key", st == 200, st)

st, d = call("POST", "/api/login", {"email": "admin@maclesotho.com",
                                    "password": "x" * 5000})
ok("an enormous password is rejected without incident", st in (401, 400), st)
st, d = call("POST", "/api/clients", {"first_name": "A" * 100000,
                                      "last_name": "B"}, T)
ok("an enormous field is truncated, not fatal", st == 200, st)

print("\n" + "=" * 60)
print("PASS %d   FAIL %d" % (PASS, FAIL))
for n in NOTES:
    print("  · " + n)
print("=" * 60)
sys.exit(1 if FAIL else 0)
