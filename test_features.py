#!/usr/bin/env python3
"""Two-step sign in, and the requirements-and-fees catalogue."""
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402

B = sys.argv[1]
PW = os.environ.get("ADMIN_PASSWORD", "TestOnly#2026")
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
        try:
            return e.code, json.loads(e.read() or b"{}")
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
        print("  FAIL  " + label + ("   <-- " + str(detail)[:190] if detail else ""))


def code_for(secret, drift=0):
    return core.totp_at(secret, int(time.time() // core.TOTP_STEP) + drift)


# ======================================================================
print("[ SETTING UP TWO-STEP SIGN IN ]")
st, d = call("POST", "/api/login", {"email": "admin@maclesotho.com", "password": PW})
ok("signing in works before it is switched on", st == 200 and d.get("token"), d)
T = d.get("token")

st, d = call("GET", "/api/2fa/status", None, T)
ok("it starts switched off", st == 200 and d.get("enabled") is False, d)

st, d = call("POST", "/api/2fa/setup", {}, T)
ok("setup returns a secret", st == 200 and len(d.get("secret", "")) >= 16, d)
SECRET = d.get("secret")
ok("  and a pairing link an authenticator app understands",
   d.get("uri", "").startswith("otpauth://totp/") and "secret=" in d["uri"],
   d.get("uri"))
ok("  and a QR code drawn as an image",
   d.get("qr_svg", "").startswith("<svg") and len(d["qr_svg"]) > 500,
   len(d.get("qr_svg", "")))
ok("  the link names the practice, so the app labels it clearly",
   "Migration" in d.get("uri", "") or "MAC" in d.get("uri", ""), d.get("uri"))

st, d = call("POST", "/api/2fa/enable", {"code": "000000"}, T)
ok("a wrong code will not switch it on", st == 400, st)
st, d = call("GET", "/api/2fa/status", None, T)
ok("  and it is still off", d.get("enabled") is False, d)

st, d = call("POST", "/api/2fa/enable", {"code": code_for(SECRET)}, T)
ok("the right code switches it on", st == 200, d)
CODES = d.get("recovery_codes", [])
ok("  and hands over recovery codes", len(CODES) == 8, len(CODES))
ok("  which look like codes, not passwords",
   all("-" in c and len(c) == 9 for c in CODES), CODES[:2])

st, d = call("POST", "/api/2fa/enable", {"code": code_for(SECRET)}, T)
ok("it cannot be switched on twice", st == 400, st)

# ======================================================================
print("\n[ SIGNING IN WITH IT ON ]")
st, d = call("POST", "/api/login", {"email": "admin@maclesotho.com", "password": PW})
ok("the password alone no longer returns a session",
   st == 200 and d.get("twofa_required") is True and "token" not in d, d)
CHALLENGE = d.get("challenge")
ok("  a challenge is handed back instead", bool(CHALLENGE), d)
ok("  and it says recovery codes exist", d.get("recovery_available") is True, d)

st, d = call("GET", "/api/clients", None, CHALLENGE)
ok("the challenge cannot be used as a session", st == 401, st)

st, d = call("POST", "/api/login/verify", {"challenge": CHALLENGE, "code": "111111"})
ok("a wrong code is refused", st == 401, st)

st, d = call("POST", "/api/login/verify",
             {"challenge": CHALLENGE, "code": code_for(SECRET)})
ok("the right code completes the sign in", st == 200 and d.get("token"), d)
T2 = d.get("token")
st, d = call("GET", "/api/clients", None, T2)
ok("  and that session works", st == 200, st)
ok("  the account knows two-step is on",
   call("GET", "/api/bootstrap", None, T2)[1]["user"].get("totp_enabled") is True)

st, d = call("POST", "/api/login/verify",
             {"challenge": CHALLENGE, "code": code_for(SECRET)})
ok("a challenge cannot be spent twice", st == 401, st)
st, d = call("POST", "/api/login/verify", {"challenge": "made-up", "code": "123456"})
ok("an invented challenge is refused", st == 401, st)

# a code from the previous half-minute still works, for slow clocks
st, d = call("POST", "/api/login", {"email": "admin@maclesotho.com", "password": PW})
st, d = call("POST", "/api/login/verify",
             {"challenge": d["challenge"], "code": code_for(SECRET, -1)})
ok("a code from the step before is accepted, for slow clocks", st == 200, d)
st, d = call("POST", "/api/login", {"email": "admin@maclesotho.com", "password": PW})
st, d = call("POST", "/api/login/verify",
             {"challenge": d["challenge"], "code": code_for(SECRET, -5)})
ok("a long-expired code is not", st == 401, st)

st, d = call("POST", "/api/login",
             {"email": "admin@maclesotho.com", "password": "wrong-password"})
ok("a wrong password never reaches the code step", st == 401, st)

# ======================================================================
print("\n[ LOSING THE PHONE ]")
st, d = call("POST", "/api/login", {"email": "admin@maclesotho.com", "password": PW})
st, d = call("POST", "/api/login/verify",
             {"challenge": d["challenge"], "code": CODES[0]})
ok("a recovery code signs you in", st == 200 and d.get("token"), d)
ok("  and warns how many are left", "remain" in (d.get("notice") or ""), d.get("notice"))
T3 = d.get("token")
st, d = call("POST", "/api/login", {"email": "admin@maclesotho.com", "password": PW})
st, d = call("POST", "/api/login/verify",
             {"challenge": d["challenge"], "code": CODES[0]})
ok("the same recovery code cannot be reused", st == 401, st)
st, d = call("GET", "/api/2fa/status", None, T3)
ok("  seven codes remain", d.get("recovery_left") == 7, d)

# ======================================================================
print("\n[ SWITCHING IT OFF ]")
st, d = call("POST", "/api/2fa/disable", {"password": "wrong", "code": code_for(SECRET)}, T3)
ok("the wrong password will not switch it off", st == 400, st)
st, d = call("POST", "/api/2fa/disable", {"password": PW, "code": "000000"}, T3)
ok("the wrong code will not either", st == 400, st)
st, d = call("POST", "/api/2fa/disable", {"password": PW, "code": code_for(SECRET)}, T3)
ok("both together switch it off", st == 200, d)
st, d = call("POST", "/api/login", {"email": "admin@maclesotho.com", "password": PW})
ok("signing in is one step again", st == 200 and d.get("token"), d)
T = d.get("token")
st, d = call("GET", "/api/2fa/status", None, T)
ok("  and no recovery codes are left behind", d.get("recovery_left") == 0, d)

# an owner can rescue a staff member who lost their phone
st, d = call("POST", "/api/users", {"name": "Locked Out",
                                    "email": "locked@maclesotho.com",
                                    "role": "advisor"}, T)
SUID, temp = d.get("id"), d.get("temp_password")
st, d = call("POST", "/api/login", {"email": "locked@maclesotho.com", "password": temp})
T4 = d.get("token")
call("POST", "/api/change-password",
     {"current_password": temp, "new_password": "Advisor#2026x"}, T4)
st, d = call("POST", "/api/login",
             {"email": "locked@maclesotho.com", "password": "Advisor#2026x"})
T4 = d.get("token")
st, d = call("POST", "/api/2fa/setup", {}, T4)
call("POST", "/api/2fa/enable", {"code": code_for(d["secret"])}, T4)
st, d = call("POST", "/api/login",
             {"email": "locked@maclesotho.com", "password": "Advisor#2026x"})
ok("the advisor now needs a code too", d.get("twofa_required") is True, d)
st, d = call("POST", "/api/users/%d/reset-2fa" % SUID, {}, T)
ok("the owner can clear it for them", st == 200, d)
st, d = call("POST", "/api/login",
             {"email": "locked@maclesotho.com", "password": "Advisor#2026x"})
ok("  and they can sign in with the password alone again",
   st == 200 and d.get("token"), d)
st, d = call("POST", "/api/users/%d/reset-2fa" % SUID, {}, d.get("token"))
ok("an advisor cannot clear it for anyone", st == 403, st)

# ======================================================================
print("\n[ WHAT EACH SERVICE NEEDS AND COSTS ]")
st, d = call("GET", "/api/services", None, T)
ok("every service is listed", st == 200 and len(d.get("services", [])) >= 10,
   len(d.get("services", [])))
SERVICE = d["services"][0]["service"]

st, d = call("GET", "/api/services/detail?service=" + urllib.request.quote(SERVICE),
             None, T)
ok("opening one fills it from the built-in checklist",
   st == 200 and len(d.get("requirements", [])) > 0, d)
ok("  and it starts with no fees", d.get("fees") == [], d.get("fees"))
FIRST = d["requirements"][0]["id"]

st, d = call("POST", "/api/services/requirements",
             {"service": SERVICE, "item": "Original birth certificate",
              "detail": "Certified copy, not older than three months"}, T)
ok("a requirement can be added", st == 200, d)
RID = d.get("id")
st, d = call("POST", "/api/services/requirements/%d" % RID,
             {"item": "Birth certificate", "required": False}, T)
ok("a requirement can be edited", st == 200, d)
st, d = call("GET", "/api/services/detail?service=" + urllib.request.quote(SERVICE),
             None, T)
row = [r for r in d["requirements"] if r["id"] == RID][0]
ok("  the edit is saved", row["item"] == "Birth certificate" and not row["required"], row)
ok("  and the detail is kept", "three months" in (row["detail"] or ""), row)

st, d = call("POST", "/api/services/fees",
             {"service": SERVICE, "label": "Consultation", "amount": 350,
              "payable": "Before the first meeting"}, T)
ok("a fee can be added", st == 200, d)
FID = d.get("id")
call("POST", "/api/services/fees",
     {"service": SERVICE, "label": "On commencement", "amount": 2250}, T)
call("POST", "/api/services/fees",
     {"service": SERVICE, "label": "On submission", "amount": 2250}, T)
st, d = call("GET", "/api/services/detail?service=" + urllib.request.quote(SERVICE),
             None, T)
ok("all three fees are listed", len(d["fees"]) == 3, len(d["fees"]))
ok("  and the total is added up", abs(d["total"] - 4850) < 0.01, d["total"])
ok("  in the office currency", d["fees"][0]["currency"] == d["currency"], d["fees"][0])

st, d = call("POST", "/api/services/fees/%d" % FID, {"amount": 400}, T)
ok("a fee can be corrected", st == 200, d)
st, d = call("GET", "/api/services/detail?service=" + urllib.request.quote(SERVICE),
             None, T)
ok("  and the total follows", abs(d["total"] - 4900) < 0.01, d["total"])
st, d = call("POST", "/api/services/fees", {"service": SERVICE, "label": "Bad",
                                            "amount": -50}, T)
ok("a negative fee is refused", st == 400, st)
st, d = call("POST", "/api/services/requirements",
             {"service": "Not A Real Service", "item": "x"}, T)
ok("an unknown service is refused", st == 400, st)
st, d = call("GET", "/api/services/detail?service=Nope", None, T)
ok("  and cannot be opened", st == 404, st)

# the catalogue is what a new case asks for
st, d = call("POST", "/api/clients", {"first_name": "Cata", "last_name": "Logue"}, T)
CID = d.get("id")
st, d = call("POST", "/api/cases", {"client_id": CID, "service": SERVICE}, T)
KID = d.get("id")
st, d = call("GET", "/api/cases/%d" % KID, None, T)
names = [x["name"] for x in d["documents"]]
ok("a new case uses the catalogue, not the built-in list",
   "Birth certificate" in names, names[:4])
ok("  and carries across which items are optional",
   any(x["name"] == "Birth certificate" and not x["required"] for x in d["documents"]))

st, d = call("DELETE", "/api/services/requirements/%d" % RID, {}, T)
ok("a requirement can be removed", st == 200, d)
st, d = call("DELETE", "/api/services/fees/%d" % FID, {}, T)
ok("a fee can be removed", st == 200, d)
st, d = call("GET", "/api/services/detail?service=" + urllib.request.quote(SERVICE),
             None, T)
ok("  and both are gone", len(d["fees"]) == 2 and
   not any(r["id"] == RID for r in d["requirements"]), (len(d["fees"])))
ok("  the existing case keeps its own checklist",
   "Birth certificate" in [x["name"] for x in
                           call("GET", "/api/cases/%d" % KID, None, T)[1]["documents"]])

st, d = call("GET", "/api/services", None, None)
ok("the catalogue needs a sign in", st == 401, st)

print("\n" + "=" * 60)
print("PASS %d   FAIL %d" % (PASS, FAIL))
print("=" * 60)
sys.exit(1 if FAIL else 0)
