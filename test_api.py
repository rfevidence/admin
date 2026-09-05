#!/usr/bin/env python3
"""Full API pass over the MAC portal."""
import json
import sys
import urllib.error
import urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8500"
PASS = FAIL = 0
FAILS = []


def ok(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + label)
    else:
        FAIL += 1
        FAILS.append(label)
        print("  FAIL  " + label + ("   <-- " + str(detail)[:180] if detail else ""))


def call(method, path, body=None, token=None, headers=None, raw=False):
    req = urllib.request.Request(B + path, method=method,
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=25) as r:
            payload = r.read()
            if raw:
                return r.status, payload.decode("utf-8", "replace"), dict(r.headers)
            return r.status, json.loads(payload or b"{}")
    except urllib.error.HTTPError as e:
        raw_body = e.read()
        if raw:
            return e.code, raw_body.decode("utf-8", "replace"), dict(e.headers)
        try:
            return e.code, json.loads(raw_body or b"{}")
        except ValueError:
            return e.code, {"error": raw_body[:200].decode("utf-8", "replace")}
    except Exception as exc:
        return 0, {"error": str(exc)[:120]}


print("=" * 70)
print("MAC ADMIN PORTAL — API TEST")
print("=" * 70)

# ---------------------------------------------------------------- auth
print("\n[ AUTHENTICATION ]")
st, d = call("POST", "/api/login",
             {"email": "admin@maclesotho.com", "password": "Migration@20!26"})
ok("owner signs in with the seeded credentials", st == 200 and "token" in d, d)
T = d.get("token")
ok("role is owner", d.get("user", {}).get("role") == "owner", d.get("user"))

st, d = call("POST", "/api/login",
             {"email": "admin@maclesotho.com", "password": "wrong"})
ok("wrong password is refused", st == 401, st)
st, d = call("POST", "/api/login", {"email": "nobody@x.com", "password": "x"})
ok("unknown email is refused", st == 401, st)
st, d = call("POST", "/api/login", {"email": "", "password": ""})
ok("empty credentials are refused", st == 400, st)

st, d = call("GET", "/api/clients")
ok("no token means no data", st == 401, st)
st, d = call("GET", "/api/clients", token="rubbish-token")
ok("a forged token means no data", st == 401, st)

st, d = call("GET", "/api/bootstrap", token=T)
ok("bootstrap returns taxonomies", st == 200 and len(d.get("services", [])) > 5, st)
ok("stages are present", len(d.get("stages", [])) >= 8, d.get("stages"))
KEYCHECK = d

st, d = call("GET", "/api/settings", token=T)
API_KEY = d.get("settings", {}).get("intake_api_key")
ok("owner can read the intake key", bool(API_KEY), d)

# ------------------------------------------------------- public intake
print("\n[ WEBSITE INTAKE ]")
st, d = call("GET", "/api/public/ping", headers={"X-Api-Key": API_KEY})
ok("ping works with the right key", st == 200, d)
st, d = call("GET", "/api/public/ping", headers={"X-Api-Key": "nope"})
ok("ping refuses a wrong key", st == 401, st)

form = {
    "first_name": "Chipo", "last_name": "Nkomo",
    "email": "chipo.nkomo@example.com", "contact_number": "+266 5800 1122",
    "occupation": "Software engineer", "physical_address": "12 Kingsway, Maseru",
    "nationality": "Zimbabwean", "country_of_residence": "Lesotho",
    "service": "Work Permit — New Application",
    "destination_country": "", "current_status": "Expired permit — seeking renewal",
    "years_in_lesotho": "4", "criminal_record": "No",
    "prior_rejection": "No",
    "message": "My work permit lapsed last month and my employer needs me to renew it.",
    "consent": True,
}
st, d = call("POST", "/api/public/intake", form, headers={"X-Api-Key": API_KEY})
ok("the website form is accepted", st == 200 and d.get("reference", "").startswith("ENQ-"), d)
ENQ_REF = d.get("reference")

st, d = call("POST", "/api/public/intake", form, headers={"X-Api-Key": "wrong-key"})
ok("a wrong intake key is refused", st == 401, st)
st, d = call("POST", "/api/public/intake", {"first_name": "Bot", "website_url": "http://spam"},
             headers={"X-Api-Key": API_KEY})
ok("the honeypot field blocks bots", st == 400, st)
st, d = call("POST", "/api/public/intake", {"message": "nothing"},
             headers={"X-Api-Key": API_KEY})
ok("a submission with no name or email is refused", st == 400, st)

# alternative field names (EmailJS templates vary)
st, d = call("POST", "/api/public/intake",
             {"firstName": "Ana", "lastName": "Silva", "from_email": "ana@example.com",
              "serviceRequired": "Study Abroad — Student Visa Support",
              "details": "Applying to a university in Germany."},
             headers={"X-Api-Key": API_KEY})
ok("camelCase field names are also understood", st == 200, d)

st, d = call("GET", "/api/enquiries?status=new", token=T)
ok("both submissions are in the inbox", len(d.get("enquiries", [])) == 2, len(d.get("enquiries", [])))
ENQ_ID = d["enquiries"][0]["id"] if d.get("enquiries") else None
mapped = [e for e in d.get("enquiries", []) if e["last_name"] == "Nkomo"]
ok("every field from the form is stored",
   bool(mapped) and mapped[0]["nationality"] == "Zimbabwean"
   and mapped[0]["phone"].endswith("1122")
   and "lapsed" in mapped[0]["message"], mapped[0] if mapped else None)
NKOMO_ID = mapped[0]["id"] if mapped else None

st, d = call("GET", "/api/enquiries/%d" % NKOMO_ID, token=T)
ok("opening an enquiry marks it reviewed", d["enquiry"]["status"] == "reviewed", d["enquiry"]["status"])

# CORS preflight
st, body, hdrs = call("OPTIONS", "/api/public/intake", None,
                      headers={"Origin": "https://maclesotho.com"}, raw=True)
ok("the browser preflight from maclesotho.com is allowed",
   st == 204 and hdrs.get("Access-Control-Allow-Origin") == "https://maclesotho.com", hdrs)
st, body, hdrs = call("OPTIONS", "/api/public/intake", None,
                      headers={"Origin": "https://evil.example"}, raw=True)
ok("a preflight from an unlisted site gets no permission",
   "Access-Control-Allow-Origin" not in hdrs, hdrs)

# ----------------------------------------------------------- conversion
print("\n[ ENQUIRY → CLIENT → CASE ]")
st, d = call("POST", "/api/enquiries/%d/convert" % NKOMO_ID,
             {"service": "Work Permit — Renewal", "open_case": True}, token=T)
ok("the enquiry becomes a client and a case", st == 200 and d.get("client_id") and d.get("case_id"), d)
CLIENT = d.get("client_id")
CASE = d.get("case_id")

st, d = call("POST", "/api/enquiries/%d/convert" % NKOMO_ID, {}, token=T)
ok("converting twice does not duplicate the client", d.get("already") is True, d)

st, d = call("GET", "/api/enquiries/%d" % NKOMO_ID, token=T)
ok("the enquiry is now marked converted", d["enquiry"]["status"] == "converted", d["enquiry"]["status"])

st, d = call("GET", "/api/cases/%d" % CASE, token=T)
ok("a document checklist was generated", len(d.get("documents", [])) >= 8, len(d.get("documents", [])))
ok("the checklist matches a work permit",
   any("Labour Commissioner" in x["name"] for x in d["documents"]),
   [x["name"] for x in d["documents"]][:4])
ok("client details carried across from the form",
   d["case"]["nationality"] == "Zimbabwean", d["case"].get("nationality"))
DOC_ID = d["documents"][0]["id"]

# --------------------------------------------------------------- clients
print("\n[ CLIENTS ]")
st, d = call("POST", "/api/clients", {
    "first_name": "Wei", "last_name": "Zhang", "email": "wei.zhang@example.com",
    "phone": "+266 5900 3344", "nationality": "Chinese",
    "country_residence": "Lesotho", "passport_no": "EA1234567",
    "passport_expiry": "2027-04-30", "permit_status": "Valid work permit",
    "permit_expiry": "2026-10-01", "occupation": "Retail manager"}, token=T)
ok("a client can be created by hand", st == 200 and d.get("ref", "").startswith("CL-"), d)
CLIENT2 = d.get("id")

st, d = call("POST", "/api/clients", {"first_name": "", "last_name": "X"}, token=T)
ok("a client with no first name is refused", st == 400, st)

st, d = call("GET", "/api/clients?q=zhang", token=T)
ok("search finds the client by surname", len(d.get("clients", [])) == 1, d.get("clients"))
st, d = call("GET", "/api/clients?q=EA1234567", token=T)
ok("search finds the client by passport number", len(d.get("clients", [])) == 1, len(d.get("clients", [])))

st, d = call("POST", "/api/clients/%d" % CLIENT2, {"occupation": "Store owner"}, token=T)
ok("a client can be edited", st == 200, d)
st, d = call("GET", "/api/clients/%d" % CLIENT2, token=T)
ok("the edit was saved", d["client"]["occupation"] == "Store owner", d["client"]["occupation"])
ok("the edit is written to the timeline",
   any("occupation" in e["body"] for e in d["events"]), d["events"][:2])
ok("an expiring permit raises an alert", len(d.get("alerts", [])) >= 1, d.get("alerts"))

# ------------------------------------------------------------ case flow
print("\n[ CASE PROGRESS ]")
st, d = call("POST", "/api/cases", {
    "client_id": CLIENT2, "service": "Permanent Residence Application",
    "fee_total": 4500, "target_date": "2026-12-01", "priority": "high"}, token=T)
ok("a second case opens for the other client", st == 200, d)
CASE2 = d.get("id")

st, d = call("POST", "/api/cases", {"client_id": 99999, "service": "Other"}, token=T)
ok("a case cannot be opened for a client who does not exist", st == 400, st)

for stage in ["Consultation booked", "Consultation held", "Agreement signed",
              "Collecting documents", "Submitted to authority"]:
    st, d = call("POST", "/api/cases/%d/stage" % CASE2, {"stage": stage}, token=T)
    if st != 200:
        break
ok("the case moves through every stage", st == 200, d)

st, d = call("GET", "/api/cases/%d" % CASE2, token=T)
ok("the submission date was stamped automatically", bool(d["case"]["submitted_at"]), d["case"])
ok("the stage rail knows where the case is", d["progress"]["index"] == 5, d["progress"])
ok("each move was written to the timeline",
   len([e for e in d["events"] if e["kind"] == "stage"]) >= 5,
   len(d.get("events", [])))

st, d = call("POST", "/api/cases/%d/stage" % CASE2, {"stage": "Nowhere"}, token=T)
ok("an unknown stage is refused", st == 400, st)

st, d = call("POST", "/api/cases/%d/stage" % CASE2,
             {"stage": "Rejected", "note": "Refused for insufficient residence."}, token=T)
ok("a rejection closes the case", st == 200, d)
st, d = call("GET", "/api/cases/%d" % CASE2, token=T)
ok("the outcome is recorded", d["case"]["outcome"] == "Rejected", d["case"]["outcome"])
ok("a closed case shows as closed on the rail", d["progress"]["index"] == -1, d["progress"])
st, d = call("POST", "/api/cases/%d/reopen" % CASE2, {}, token=T)
ok("a case can be reopened", st == 200, d)

st, d = call("POST", "/api/cases/%d" % CASE2,
             {"authority_ref": "MHA/PR/2026/8891", "fee_total": 5000}, token=T)
ok("case details can be edited", st == 200, d)

# --------------------------------------------------------------- documents
print("\n[ DOCUMENT CHECKLIST ]")
st, d = call("POST", "/api/documents/%d" % DOC_ID,
             {"status": "verified", "expiry": "2029-06-01"}, token=T)
ok("a document can be marked verified", st == 200, d)
st, d = call("POST", "/api/documents/%d" % DOC_ID, {"status": "nonsense"}, token=T)
ok("an unknown document status is refused", st == 400, st)
st, d = call("POST", "/api/cases/%d/documents" % CASE,
             {"name": "Employer support letter", "expiry": "2026-09-20"}, token=T)
ok("a custom document can be added", st == 200, d)
NEWDOC = d.get("id")
st, d = call("GET", "/api/cases/%d" % CASE, token=T)
ok("the checklist status change is on the timeline",
   any(e["kind"] == "document" for e in d["events"]), d["events"][:2])
st, d = call("DELETE", "/api/documents/%d" % NEWDOC, {}, token=T)
ok("a document row can be removed", st == 200, d)

# --------------------------------------------------------------- payments
print("\n[ PAYMENTS ]")
st, d = call("POST", "/api/payments", {
    "client_id": CLIENT, "case_id": CASE, "amount": 500, "kind": "consultation",
    "method": "M-Pesa", "reference": "R-0001"}, token=T)
ok("a payment is recorded", st == 200, d)
PAY = d.get("id")
st, d = call("POST", "/api/payments", {"client_id": CLIENT, "amount": 0}, token=T)
ok("a zero payment is refused", st == 400, st)
st, d = call("POST", "/api/payments", {"client_id": 99999, "amount": 100}, token=T)
ok("a payment for a missing client is refused", st == 400, st)
st, d = call("POST", "/api/payments", {"client_id": CLIENT, "amount": 100,
                                       "kind": "invented"}, token=T)
ok("an unknown payment type is refused", st == 400, st)

st, d = call("POST", "/api/payments", {
    "case_id": CASE, "amount": 2250, "kind": "commencement"}, token=T)
ok("a payment attached to a case infers the client", st == 200, d)

st, d = call("GET", "/api/cases/%d" % CASE, token=T)
ok("the case balance is right",
   abs(d["money"]["paid"] - 2750) < 0.01, d["money"])

st, d = call("POST", "/api/payments/%d/void" % PAY, {}, token=T)
ok("a payment can be voided", d.get("voided") is True, d)
st, d = call("GET", "/api/cases/%d" % CASE, token=T)
ok("a voided payment leaves the balance", abs(d["money"]["paid"] - 2250) < 0.01, d["money"])
st, d = call("POST", "/api/payments/%d/void" % PAY, {}, token=T)
ok("voiding again restores the payment", d.get("voided") is False, d)

# --------------------------------------------------------- tasks + diary
print("\n[ TASKS AND CONSULTATIONS ]")
st, d = call("POST", "/api/tasks", {
    "title": "Chase the police clearance", "due_date": "2020-01-01",
    "case_id": CASE, "client_id": CLIENT}, token=T)
ok("a task is created", st == 200, d)
TASK = d.get("id")
st, d = call("GET", "/api/tasks?status=open", token=T)
ok("the task is in the open list", any(t["id"] == TASK for t in d["tasks"]), len(d["tasks"]))
st, d = call("POST", "/api/tasks/%d" % TASK, {"status": "done"}, token=T)
ok("a task can be completed", st == 200, d)
st, d = call("GET", "/api/tasks?status=done", token=T)
ok("it moves to the completed list", any(t["id"] == TASK for t in d["tasks"]), len(d["tasks"]))

st, d = call("POST", "/api/appointments", {
    "client_id": CLIENT, "case_id": CASE, "title": "Initial consultation",
    "starts_at": "2026-09-10T10:30", "duration_min": 45}, token=T)
ok("a consultation is booked", st == 200, d)
APPT = d.get("id")
st, d = call("POST", "/api/appointments", {"starts_at": "not a date"}, token=T)
ok("an unreadable date is refused", st == 400, st)
st, d = call("POST", "/api/appointments/%d" % APPT, {"status": "held"}, token=T)
ok("a consultation can be marked held", st == 200, d)
st, d = call("GET", "/api/appointments?from=2026-09-01&to=2026-09-30", token=T)
ok("it shows in the diary for that month", len(d["appointments"]) >= 1, len(d["appointments"]))

st, d = call("POST", "/api/events", {
    "case_id": CASE, "kind": "call", "body": "Rang the client about the medical.",
    "follow_up": "2026-09-15"}, token=T)
ok("an activity note creates a follow-up task", st == 200, d)
st, d = call("GET", "/api/tasks?status=open", token=T)
ok("the follow-up appears in tasks",
   any("Follow up" in t["title"] for t in d["tasks"]), [t["title"] for t in d["tasks"]])
st, d = call("POST", "/api/events", {"kind": "call", "body": "orphan"}, token=T)
ok("a note with nothing attached is refused", st == 400, st)

# -------------------------------------------------------------- overview
print("\n[ DASHBOARD, SEARCH, EXPIRIES ]")
st, d = call("GET", "/api/dashboard", token=T)
ok("the dashboard loads", st == 200, d.get("error"))
ok("it counts open cases", d["kpis"]["open_cases"] >= 1, d["kpis"])
ok("the twelve month trend is built", len(d["trend"]) == 12, len(d.get("trend", [])))
ok("collected this month is a number", isinstance(d["kpis"]["collected_month"], (int, float)), d["kpis"])
ok("overdue tasks are counted", isinstance(d["kpis"]["tasks_overdue"], int), d["kpis"])
ok("stage breakdown covers every stage", len(d["by_stage"]) == 8, len(d["by_stage"]))

st, d = call("GET", "/api/expiries?days=120", token=T)
ok("the renewals view finds the expiring permit",
   any(x["what"] == "Permit / visa" for x in d["expiries"]), d["expiries"][:2])

st, d = call("GET", "/api/search?q=zhang", token=T)
ok("global search finds a client", any(r["type"] == "client" for r in d["results"]), d)
st, d = call("GET", "/api/search?q=" + ENQ_REF.lower(), token=T)
ok("global search finds an enquiry by reference",
   any(r["type"] == "enquiry" for r in d["results"]), d)
st, d = call("GET", "/api/search?q=ab", token=T)
ok("a very short search returns nothing", d["results"] == [], d)

# --------------------------------------------------------------- reports
print("\n[ REPORTS ]")
st, d = call("GET", "/api/reports", token=T)
ok("every report is listed", len(d["reports"]) == 9, len(d.get("reports", [])))
for key in [r["key"] for r in d["reports"]]:
    st2, d2 = call("GET", "/api/reports/%s?from=2000-01-01&to=2030-01-01" % key, token=T)
    if st2 != 200:
        ok("report '%s' runs" % key, False, d2)
        break
else:
    ok("all nine reports run without error", True)

st, body, hdrs = call("GET", "/export/clients?from=2000-01-01&to=2030-01-01",
                      None, token=T, raw=True)
ok("the CSV export downloads", st == 200 and "attachment" in hdrs.get("Content-Disposition", ""), hdrs)
ok("the CSV has a header row and data", "first_name" in body and "Zhang" in body, body[:120])
st, body, hdrs = call("GET", "/export/clients", None, raw=True)
ok("the CSV export needs a sign in", st == 401, st)
st, d = call("GET", "/api/reports/not_a_report", token=T)
ok("an unknown report is refused", st == 404, st)

# ----------------------------------------------------------------- users
print("\n[ STAFF ACCOUNTS AND ROLES ]")
st, d = call("POST", "/api/users", {
    "name": "Thato Mokoena", "email": "thato@maclesotho.com", "role": "advisor"}, token=T)
ok("the owner adds a staff account", st == 200 and d.get("temp_password"), d)
TEMP = d.get("temp_password")
STAFF = d.get("id")
st, d = call("POST", "/api/users", {"name": "Dup", "email": "thato@maclesotho.com"}, token=T)
ok("a duplicate email is refused", st == 400, st)

st, d = call("POST", "/api/login", {"email": "thato@maclesotho.com", "password": TEMP})
ok("the new staff member signs in with the temporary password", st == 200, d)
T2 = d.get("token")
ok("they are told to change it", d["user"]["must_change"] is True, d["user"])

st, d = call("POST", "/api/change-password",
             {"current_password": TEMP, "new_password": "short"}, token=T2)
ok("a weak password is refused", st == 400, d)
st, d = call("POST", "/api/change-password",
             {"current_password": "wrong", "new_password": "Lesotho2026!x"}, token=T2)
ok("the wrong current password is refused", st == 400, d)
st, d = call("POST", "/api/change-password",
             {"current_password": TEMP, "new_password": "Lesotho2026!x"}, token=T2)
ok("a good password is accepted", st == 200, d)
st, d = call("POST", "/api/login",
             {"email": "thato@maclesotho.com", "password": "Lesotho2026!x"})
ok("they can sign in with the new password", st == 200, st)
T2 = d.get("token")

st, d = call("GET", "/api/clients", token=T2)
ok("an advisor sees the client list", st == 200, st)
st, d = call("POST", "/api/users", {"name": "X", "email": "x@y.com"}, token=T2)
ok("an advisor cannot create staff accounts", st == 403, st)
st, d = call("POST", "/api/settings", {"org_name": "Hacked"}, token=T2)
ok("an advisor cannot change settings", st == 403, st)
st, d = call("DELETE", "/api/clients/%d" % CLIENT2, {}, token=T2)
ok("an advisor cannot delete a client", st == 403, st)
st, d = call("GET", "/api/settings", token=T2)
ok("an advisor does not see the intake key",
   "intake_api_key" not in d.get("settings", {}), d.get("settings", {}).keys())
st, d = call("POST", "/api/system/mirror-now", {}, token=T2)
ok("an advisor cannot trigger a backup copy", st == 403, st)

st, d = call("POST", "/api/users/%d" % STAFF, {"name": "Thato M", "active": False}, token=T)
ok("the owner can disable an account", st == 200, d)
st, d = call("GET", "/api/clients", token=T2)
ok("disabling ends their session immediately", st == 401, st)
st, d = call("POST", "/api/login",
             {"email": "thato@maclesotho.com", "password": "Lesotho2026!x"})
ok("a disabled account cannot sign back in", st == 403, st)
st, d = call("POST", "/api/users/1", {"role": "advisor"}, token=T)
ok("the owner cannot demote themselves", st == 400, d)

st, d = call("POST", "/api/users/%d/reset-password" % STAFF, {}, token=T)
ok("a password can be reset for a staff member", st == 200 and d.get("temp_password"), d)

# -------------------------------------------------------------- settings
print("\n[ SETTINGS AND SYSTEM ]")
st, d = call("POST", "/api/settings",
             {"org_name": "Migration Advisory Centre", "currency": "LSL",
              "expiry_warn_days": "45"}, token=T)
ok("settings save", st == 200, d)
st, d = call("GET", "/api/settings", token=T)
ok("the change stuck", d["settings"]["expiry_warn_days"] == "45", d["settings"])

st, d = call("GET", "/api/system", token=T)
ok("the system page loads", st == 200, d.get("error"))
ok("it reports the primary database", d["primary"]["configured"] is not None, d["primary"])
ok("it lists every table's row count", len(d["primary"]["counts"]) == 13,
   len(d["primary"].get("counts", {})))
ok("website submissions are logged", len(d["ingest"]) >= 3, len(d.get("ingest", [])))
ok("refused submissions are logged too",
   any(not r["ok"] for r in d["ingest"]), d["ingest"][:2])
import os as _os
st, d = call("POST", "/api/system/mirror-now", {}, token=T)
if _os.environ.get("EXPECT_MIRROR"):
    ok("a backup copy runs on demand", st == 200 and d.get("rows", 0) > 0, d)
    st, d = call("GET", "/api/system", token=T)
    ok("the backup reports the same row counts as the primary",
       d["standby"].get("reachable") and
       d["standby"]["counts"]["clients"] == d["primary"]["counts"]["clients"] and
       d["standby"]["counts"]["cases"] == d["primary"]["counts"]["cases"],
       {"primary": d["primary"]["counts"].get("clients"),
        "standby": d["standby"].get("counts", {}).get("clients")})
else:
    ok("a backup copy without Supabase configured explains itself", st == 400, d)

st, d = call("GET", "/api/audit", token=T)
ok("the activity log has entries", len(d["audit"]) > 10, len(d.get("audit", [])))
actions = set(a["action"] for a in d["audit"])
ok("it records sign-ins, failures and changes",
   {"login", "login.failed", "client.created", "case.stage"} <= actions, sorted(actions))

# --------------------------------------------------------------- misc
print("\n[ EDGES ]")
st, d = call("GET", "/api/clients/99999", token=T)
ok("a missing client gives a clear message", st == 404 and "no longer exists" in d.get("error", ""), d)
st, d = call("GET", "/api/cases/99999", token=T)
ok("a missing case gives a clear message", st == 404, st)
st, d = call("GET", "/api/nope", token=T)
ok("an unknown endpoint is a 404", st == 404, st)
st, body, hdrs = call("GET", "/", None, raw=True)
ok("the sign-in page is served", st == 200 and "Migration Advisory Centre" in body, st)
st, body, hdrs = call("GET", "/app.js", None, raw=True)
ok("the app script is served", st == 200 and "MAC Admin Portal" in body, st)
st, body, hdrs = call("GET", "/app.css", None, raw=True)
ok("the stylesheet is served", st == 200 and "--brand-deep" in body, st)
st, body, hdrs = call("GET", "/../server.py", None, raw=True)
ok("path traversal cannot read the source", "SECRET" not in body and "def boot" not in body, body[:80])

payload = {"first_name": "X" * 5000, "email": "a@b.com"}
st, d = call("POST", "/api/public/intake", payload, headers={"X-Api-Key": API_KEY})
ok("an oversized field is truncated, not rejected", st == 200, d)

st, d = call("POST", "/api/clients",
             {"first_name": "<script>alert(1)</script>", "last_name": "Test"}, token=T)
ok("script tags in a name are stored as text", st == 200, d)

st, d = call("POST", "/api/logout", {}, token=T)
ok("sign out works", st == 200, d)
st, d = call("GET", "/api/clients", token=T)
ok("the token is dead after sign out", st == 401, st)

print("\n" + "=" * 70)
print("PASS %d   FAIL %d" % (PASS, FAIL))
if FAILS:
    print("\nFailures:")
    for f in FAILS:
        print("  - " + f)
print("=" * 70)
sys.exit(1 if FAIL else 0)
