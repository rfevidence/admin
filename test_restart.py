#!/usr/bin/env python3
"""Phase 2 of the restart test: verify everything written before the restart survived."""
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import os

PW = os.environ.get("ADMIN_PASSWORD", "TestOnly#2026")

B = sys.argv[1]
PASS = FAIL = 0


def call(m, p, b=None, t=None):
    r = urllib.request.Request(B + p, method=m,
                               headers={"Content-Type": "application/json"})
    if t:
        r.add_header("Authorization", "Bearer " + t)
    try:
        with urllib.request.urlopen(
                r, json.dumps(b).encode() if b is not None else None, timeout=30) as x:
            return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
    except Exception as e:
        return 0, {"error": str(e)[:110]}


def ok(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + label)
    else:
        FAIL += 1
        print("  FAIL  " + label + ("   <-- " + str(detail)[:170] if detail else ""))


print("[ EVERYTHING SURVIVED THE RESTART ]")
st, d = call("POST", "/api/login",
             {"email": "admin@maclesotho.com", "password": PW})
ok("the owner still signs in", st == 200, d)
T = d.get("token")

st, d = call("GET", "/api/clients?q=phiri", None, T)
ok("the client written before the restart is still there",
   len(d.get("clients", [])) == 1, d)

st, d = call("GET", "/api/enquiries?status=all", None, T)
ok("website enquiries survived",
   any(e["last_name"] == "Test" for e in d.get("enquiries", [])),
   len(d.get("enquiries", [])))

st, d = call("GET", "/api/payments?from=2000-01-01&to=2030-01-01", None, T)
ok("payments survived",
   any(abs(p["amount"] - 3000) < 0.01 for p in d.get("payments", [])), d.get("total"))

st, d = call("GET", "/api/cases", None, T)
ok("cases and their references survived",
   any(c["ref"].startswith("CS-") for c in d.get("cases", [])), len(d.get("cases", [])))

st, k = call("GET", "/api/settings", None, T)
ok("the intake key is unchanged, so the website keeps working",
   k.get("settings", {}).get("intake_api_key", "").startswith("mac_live_"), k)

st, d = call("GET", "/api/audit", None, T)
ok("the activity log kept its history", any(a["action"] == "client.created" for a in d.get("audit", [])), [a["action"] for a in d.get("audit", [])])

print("\n[ THE DATABASE CONNECTION IS CUT UNDERNEATH US ]")


def drop():
    subprocess.run(
        ["su", "postgres", "-c",
         "/usr/lib/postgresql/16/bin/psql -h /tmp -p 5433 -d postgres -c "
         "\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
         "WHERE datname='maccrm';\""], capture_output=True)


cases = [
    ("signing in", lambda: call("POST", "/api/login",
                                {"email": "admin@maclesotho.com",
                                 "password": PW})),
    ("listing clients", lambda: call("GET", "/api/clients", None, T)),
    ("loading the dashboard", lambda: call("GET", "/api/dashboard", None, T)),
    ("recording a payment", lambda: call("POST", "/api/payments",
                                         {"client_id": 1, "amount": 50}, T)),
    ("running a report", lambda: call(
        "GET", "/api/reports/cases?from=2000-01-01&to=2030-01-01", None, T)),
]
for label, fn in cases:
    drop()
    time.sleep(0.3)
    st, d = fn()
    ok("%s works on the first attempt after the connection is cut" % label, st == 200, d)

results = []


def worker():
    st, _ = call("GET", "/api/clients", None, T)
    results.append(st)


threads = [threading.Thread(target=worker) for _ in range(12)]
for i, th in enumerate(threads):
    th.start()
    if i in (2, 7):
        drop()
for th in threads:
    th.join()
ok("12 concurrent requests with the database cut twice mid-flight all succeed",
   all(r == 200 for r in results), results)

print("\nPASS %d  FAIL %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
