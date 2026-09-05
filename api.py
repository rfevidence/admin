"""Every API route for the MAC admin portal."""
import csv
import io
import json
import re
import time

import core
import db
from core import ApiError, now, today, days_until, parse_date

ROUTES = []            # (method, compiled_pattern, handler, needs_auth)


def route(method, pattern, auth=True):
    rx = re.compile("^" + pattern + "$")

    def deco(fn):
        ROUTES.append((method, rx, fn, auth))
        return fn
    return deco


class Ctx:
    """Everything a handler needs: connection, user, parsed body, query."""

    def __init__(self, conn, user, body, qs, ip, headers):
        self.conn = conn
        self.user = user
        self.body = body or {}
        self.qs = qs or {}
        self.ip = ip
        self.headers = headers

    # body accessors ------------------------------------------------------
    def s(self, key, default="", max_len=4000):
        v = self.body.get(key, default)
        if v is None:
            return ""
        return str(v).strip()[:max_len]

    def req(self, key, label=None):
        v = self.s(key)
        if not v:
            raise ApiError(400, f"{label or key.replace('_', ' ').capitalize()} is required.")
        return v

    def i(self, key, default=None):
        v = self.body.get(key, default)
        if v in (None, ""):
            return default
        try:
            return int(v)
        except (TypeError, ValueError):
            raise ApiError(400, f"{key} must be a number.")

    def f(self, key, default=0.0):
        v = self.body.get(key, default)
        if v in (None, ""):
            return default
        try:
            return float(v)
        except (TypeError, ValueError):
            raise ApiError(400, f"{key} must be an amount.")

    def b(self, key, default=False):
        v = self.body.get(key, default)
        return str(v).lower() in ("1", "true", "yes", "on")

    # query accessors -----------------------------------------------------
    def q(self, key, default=""):
        v = self.qs.get(key, [default])
        return (v[0] if isinstance(v, list) else v) or default

    def qi(self, key, default=0):
        try:
            return int(self.q(key, default))
        except (TypeError, ValueError):
            return default


def need_admin(ctx):
    if not ctx.user:
        raise ApiError(401, "Sign in to continue.")


def need_owner(ctx):
    need_admin(ctx)
    if ctx.user["role"] != "owner":
        raise ApiError(403, "Only the account owner can do that.")


# ==========================================================================
# AUTH
# ==========================================================================
@route("POST", "/api/login", auth=False)
def login(ctx):
    email = ctx.s("email").lower()
    password = ctx.body.get("password") or ""
    if not email or not password:
        raise ApiError(400, "Enter your email and password.")

    u = ctx.conn.one("SELECT * FROM users WHERE email = ?", (email,))
    generic = "That email and password combination doesn't match an account."
    if not u:
        time.sleep(0.4)
        raise ApiError(401, generic)

    locked = u.get("locked_until") or ""
    if locked and locked > now():
        raise ApiError(423, "Too many failed attempts. Try again in a few minutes.")

    if not u.get("active"):
        raise ApiError(403, "This account has been deactivated.")

    if not core.verify_password(password, u["password_hash"]):
        fails = int(u.get("failed_logins") or 0) + 1
        lock = ""
        if fails >= core.MAX_FAILED_LOGINS:
            lock = core.days_from_now(0)
            import datetime as _dt
            lock = (_dt.datetime.utcnow() + _dt.timedelta(
                minutes=core.LOCKOUT_MINUTES)).strftime("%Y-%m-%d %H:%M:%S")
        ctx.conn.execute(
            "UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?",
            (fails, lock, u["id"]))
        core.audit(ctx.conn, u, "login.failed", f"attempt {fails}", ctx.ip)
        ctx.conn.commit()
        time.sleep(0.4)
        raise ApiError(401, generic)

    token, expires = core.new_session(ctx.conn, u, ctx.ip)
    ctx.conn.execute(
        "UPDATE users SET last_login = ?, failed_logins = 0, locked_until = '' "
        "WHERE id = ?", (now(), u["id"]))
    core.audit(ctx.conn, u, "login", "", ctx.ip)
    ctx.conn.commit()
    return {"token": token, "expires_at": expires, "user": core.public_user(u)}


@route("POST", "/api/logout")
def logout(ctx):
    need_admin(ctx)
    tok = (ctx.headers.get("Authorization") or "").replace("Bearer ", "").strip()
    ctx.conn.execute("DELETE FROM sessions WHERE token = ?", (tok,))
    core.audit(ctx.conn, ctx.user, "logout", "", ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


@route("GET", "/api/bootstrap")
def bootstrap(ctx):
    need_admin(ctx)
    s = core.get_settings(ctx.conn)
    return {
        "user": core.public_user(ctx.user),
        "version": core.VERSION,
        "org": {k: s.get(k, "") for k in
                ("org_name", "org_parent", "org_email", "org_phone",
                 "org_phone_alt", "org_address", "currency")},
        "services": core.SERVICES,
        "stages": core.STAGES,
        "outcomes": core.CLOSED_OUTCOMES,
        "permit_statuses": core.PERMIT_STATUSES,
        "payment_kinds": [{"key": k, "label": v} for k, v in core.PAYMENT_KINDS],
        "event_kinds": core.EVENT_KINDS,
        "advisors": ctx.conn.query(
            "SELECT id, name, email, role FROM users WHERE active = 1 ORDER BY name"),
        "unread": ctx.conn.scalar(
            "SELECT COUNT(*) AS n FROM enquiries WHERE status = 'new'"),
    }


@route("POST", "/api/change-password")
def change_password(ctx):
    need_admin(ctx)
    current = ctx.body.get("current_password") or ""
    new = ctx.body.get("new_password") or ""
    if not core.verify_password(current, ctx.user["password_hash"]):
        raise ApiError(400, "Your current password is not correct.")
    problem = core.password_problem(new)
    if problem:
        raise ApiError(400, problem)
    ctx.conn.execute(
        "UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?",
        (core.hash_password(new), ctx.user["id"]))
    ctx.conn.execute("DELETE FROM sessions WHERE user_id = ? AND token <> ?",
                     (ctx.user["id"],
                      (ctx.headers.get("Authorization") or "").replace("Bearer ", "").strip()))
    core.audit(ctx.conn, ctx.user, "password.changed", "", ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


@route("POST", "/api/profile")
def update_profile(ctx):
    need_admin(ctx)
    name = ctx.req("name", "Name")
    ctx.conn.execute("UPDATE users SET name = ?, phone = ? WHERE id = ?",
                     (name, ctx.s("phone"), ctx.user["id"]))
    core.audit(ctx.conn, ctx.user, "profile.updated", "", ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


# ==========================================================================
# PUBLIC INTAKE  (the website posts here)
# ==========================================================================
FIELD_MAP = {
    "first_name": ["first_name", "firstName", "first", "from_first_name"],
    "last_name": ["last_name", "lastName", "last", "surname", "from_last_name"],
    "email": ["email", "email_address", "from_email", "reply_to"],
    "phone": ["phone", "contact_number", "contactNumber", "tel", "mobile"],
    "occupation": ["occupation", "job", "profession"],
    "address": ["address", "physical_address", "physicalAddress"],
    "nationality": ["nationality", "citizenship"],
    "country_residence": ["country_residence", "country_of_residence",
                          "countryOfResidence", "residence"],
    "service": ["service", "service_required", "immigration_service",
                "serviceRequired"],
    "destination": ["destination", "destination_country", "destinationCountry"],
    "permit_status": ["permit_status", "current_status", "visa_status",
                      "currentPermitStatus"],
    "years_in_lesotho": ["years_in_lesotho", "years_lesotho", "years",
                         "yearsInLesotho"],
    "criminal_record": ["criminal_record", "criminal_charges", "criminal",
                        "convictions"],
    "prior_rejection": ["prior_rejection", "visa_rejection",
                        "previous_rejection", "rejected"],
    "message": ["message", "situation", "details", "additional_information",
                "additional_info", "notes", "description"],
}


def pick(payload, names):
    for n in names:
        for key in (n, n.lower()):
            if key in payload and str(payload[key]).strip():
                return str(payload[key]).strip()
    return ""


@route("POST", "/api/public/intake", auth=False)
def public_intake(ctx):
    s = core.get_settings(ctx.conn)
    key = (ctx.headers.get("X-Api-Key") or ctx.headers.get("X-API-Key")
           or ctx.body.get("api_key") or "").strip()

    def refuse(reason, status=401):
        ctx.conn.execute(
            "INSERT INTO ingest_log (ok, reason, ip, payload, created_at) "
            "VALUES (?,?,?,?,?)",
            (0, reason, ctx.ip, json.dumps(ctx.body)[:1500], now()))
        ctx.conn.commit()
        raise ApiError(status, reason)

    if not key or key != s.get("intake_api_key"):
        refuse("Invalid intake key.")

    # honeypot: real people leave this hidden field empty
    if str(ctx.body.get("website_url") or ctx.body.get("_gotcha") or "").strip():
        refuse("Rejected as automated submission.", 400)

    # simple flood guard: 12 submissions per IP per hour
    recent = ctx.conn.scalar(
        "SELECT COUNT(*) AS n FROM enquiries WHERE ip = ? AND created_at > ?",
        (ctx.ip, (__import__("datetime").datetime.utcnow()
                  - __import__("datetime").timedelta(hours=1)
                  ).strftime("%Y-%m-%d %H:%M:%S")), 0)
    if recent >= 12:
        refuse("Too many submissions from this address. Try again later.", 429)

    vals = {k: pick(ctx.body, names) for k, names in FIELD_MAP.items()}
    if not (vals["first_name"] or vals["last_name"] or vals["email"]):
        refuse("A name or email address is required.", 400)

    ref, _ = core.insert_with_ref(ctx.conn, "enquiries", "ENQ", lambda ref: (
        "INSERT INTO enquiries (ref, first_name, last_name, email, phone, "
        "occupation, address, nationality, country_residence, service, "
        "destination, permit_status, years_in_lesotho, criminal_record, "
        "prior_rejection, message, consent, source, status, ip, user_agent, "
        "created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (ref, vals["first_name"][:120], vals["last_name"][:120],
         vals["email"][:200], vals["phone"][:60], vals["occupation"][:160],
         vals["address"][:400], vals["nationality"][:120],
         vals["country_residence"][:120], vals["service"][:200],
         vals["destination"][:120], vals["permit_status"][:160],
         vals["years_in_lesotho"][:40], vals["criminal_record"][:160],
         vals["prior_rejection"][:160], vals["message"][:4000],
         1 if (ctx.body.get("consent") or ctx.body.get("if_consent")) else 0,
         (ctx.s("source") or "website")[:60], "new", ctx.ip,
         (ctx.headers.get("User-Agent") or "")[:300], now())))
    ctx.conn.execute(
        "INSERT INTO ingest_log (ok, reason, ip, payload, created_at) "
        "VALUES (?,?,?,?,?)", (1, ref, ctx.ip, "", now()))
    ctx.conn.commit()
    return {"ok": True, "reference": ref}


@route("GET", "/api/public/ping", auth=False)
def public_ping(ctx):
    s = core.get_settings(ctx.conn)
    key = (ctx.headers.get("X-Api-Key") or ctx.headers.get("X-API-Key") or "").strip()
    if key != s.get("intake_api_key"):
        raise ApiError(401, "Invalid intake key.")
    return {"ok": True, "org": s.get("org_name"), "time": now()}


# ==========================================================================
# ENQUIRIES  (website submissions inbox)
# ==========================================================================
@route("GET", "/api/enquiries")
def list_enquiries(ctx):
    need_admin(ctx)
    where, params = [], []
    status = ctx.q("status")
    if status and status != "all":
        where.append("status = ?")
        params.append(status)
    search = ctx.q("q")
    if search:
        where.append("(LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? "
                     "OR LOWER(email) LIKE ? OR LOWER(ref) LIKE ? "
                     "OR LOWER(phone) LIKE ? OR LOWER(nationality) LIKE ?)")
        params += ["%" + search.lower() + "%"] * 6
    service = ctx.q("service")
    if service:
        where.append("service = ?")
        params.append(service)
    sql = "SELECT * FROM enquiries"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC, id DESC LIMIT 400"
    rows = ctx.conn.query(sql, params)
    counts = {r["status"]: r["n"] for r in ctx.conn.query(
        "SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status")}
    return {"enquiries": rows, "counts": counts,
            "total": ctx.conn.scalar("SELECT COUNT(*) AS n FROM enquiries")}


@route("GET", r"/api/enquiries/(\d+)")
def get_enquiry(ctx, eid):
    need_admin(ctx)
    e = ctx.conn.one("SELECT * FROM enquiries WHERE id = ?", (int(eid),))
    if not e:
        raise ApiError(404, "That enquiry no longer exists.")
    if e["status"] == "new":
        ctx.conn.execute(
            "UPDATE enquiries SET status = 'reviewed', reviewed_at = ?, "
            "assigned_to = ? WHERE id = ?", (now(), ctx.user["id"], e["id"]))
        ctx.conn.commit()
        e["status"] = "reviewed"
    return {"enquiry": e}


@route("POST", r"/api/enquiries/(\d+)/status")
def set_enquiry_status(ctx, eid):
    need_admin(ctx)
    status = ctx.req("status")
    if status not in ("new", "reviewed", "converted", "archived", "spam"):
        raise ApiError(400, "Unknown status.")
    ctx.conn.execute("UPDATE enquiries SET status = ? WHERE id = ?",
                     (status, int(eid)))
    core.audit(ctx.conn, ctx.user, "enquiry.status", f"#{eid} -> {status}", ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


@route("POST", r"/api/enquiries/(\d+)/convert")
def convert_enquiry(ctx, eid):
    """Turn a website submission into a client, and optionally open a case."""
    need_admin(ctx)
    e = ctx.conn.one("SELECT * FROM enquiries WHERE id = ?", (int(eid),))
    if not e:
        raise ApiError(404, "That enquiry no longer exists.")
    if e.get("client_id"):
        return {"ok": True, "client_id": e["client_id"], "already": True}

    first = (e["first_name"] or "Unknown").strip()
    last = (e["last_name"] or "-").strip()
    ref, client_id = core.insert_with_ref(ctx.conn, "clients", "CL", lambda ref: (
        "INSERT INTO clients (ref, first_name, last_name, email, phone, "
        "occupation, address, nationality, country_residence, permit_status, "
        "years_in_lesotho, notes, status, enquiry_id, created_by, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (ref, first, last, e["email"], e["phone"], e["occupation"],
         e["address"], e["nationality"], e["country_residence"],
         e["permit_status"], e["years_in_lesotho"],
         (e["message"] or "")[:2000], "active", e["id"], ctx.user["id"], now())))

    case_id = None
    if ctx.b("open_case", True):
        case_id = _create_case(
            ctx, client_id, ctx.s("service") or e["service"] or "General Immigration Advice",
            ctx.s("destination") or e["destination"],
            advisor_id=ctx.i("advisor_id") or ctx.user["id"])

    ctx.conn.execute(
        "UPDATE enquiries SET status = 'converted', client_id = ? WHERE id = ?",
        (client_id, e["id"]))
    core.log_event(ctx.conn, ctx.user, "system",
                   f"Created from website enquiry {e['ref']}.",
                   client_id=client_id, case_id=case_id)
    core.audit(ctx.conn, ctx.user, "enquiry.converted",
               f"{e['ref']} -> {ref}", ctx.ip)
    ctx.conn.commit()
    return {"ok": True, "client_id": client_id, "case_id": case_id, "ref": ref}


# ==========================================================================
# CLIENTS
# ==========================================================================
CLIENT_FIELDS = ["first_name", "last_name", "email", "phone", "alt_phone",
                 "occupation", "address", "nationality", "country_residence",
                 "date_of_birth", "gender", "passport_no", "passport_expiry",
                 "permit_status", "permit_expiry", "years_in_lesotho",
                 "notes", "status"]


@route("GET", "/api/clients")
def list_clients(ctx):
    need_admin(ctx)
    where, params = [], []
    search = ctx.q("q")
    if search:
        where.append("(LOWER(c.first_name) LIKE ? OR LOWER(c.last_name) LIKE ? "
                     "OR LOWER(c.email) LIKE ? OR LOWER(c.ref) LIKE ? "
                     "OR LOWER(c.phone) LIKE ? OR LOWER(c.passport_no) LIKE ? "
                     "OR LOWER(c.nationality) LIKE ?)")
        params += ["%" + search.lower() + "%"] * 7
    status = ctx.q("status")
    if status and status != "all":
        where.append("c.status = ?")
        params.append(status)
    nat = ctx.q("nationality")
    if nat:
        where.append("c.nationality = ?")
        params.append(nat)

    sql = ("SELECT c.*, "
           "(SELECT COUNT(*) FROM cases k WHERE k.client_id = c.id) AS case_count, "
           "(SELECT COUNT(*) FROM cases k WHERE k.client_id = c.id AND k.closed = 0) AS open_cases, "
           "(SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.client_id = c.id AND p.voided = 0) AS paid "
           "FROM clients c")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY c.created_at DESC, c.id DESC LIMIT 500"
    return {"clients": ctx.conn.query(sql, params),
            "nationalities": [r["nationality"] for r in ctx.conn.query(
                "SELECT DISTINCT nationality FROM clients "
                "WHERE nationality <> '' ORDER BY nationality")]}


@route("POST", "/api/clients")
def create_client(ctx):
    need_admin(ctx)
    first = ctx.req("first_name", "First name")
    last = ctx.req("last_name", "Last name")
    rest = [ctx.s(f) for f in CLIENT_FIELDS[2:-1]]
    ref, cid = core.insert_with_ref(ctx.conn, "clients", "CL", lambda ref: (
        "INSERT INTO clients (ref, first_name, last_name, email, phone, "
        "alt_phone, occupation, address, nationality, country_residence, "
        "date_of_birth, gender, passport_no, passport_expiry, permit_status, "
        "permit_expiry, years_in_lesotho, notes, status, created_by, created_at) "
        "VALUES (" + ",".join(["?"] * 21) + ")",
        [ref, first, last] + rest + ["active", ctx.user["id"], now()]))
    core.log_event(ctx.conn, ctx.user, "system", "Client record created.",
                   client_id=cid)
    core.audit(ctx.conn, ctx.user, "client.created", ref, ctx.ip)
    ctx.conn.commit()
    return {"ok": True, "id": cid, "ref": ref}


@route("GET", r"/api/clients/(\d+)")
def get_client(ctx, cid):
    need_admin(ctx)
    cid = int(cid)
    c = ctx.conn.one("SELECT * FROM clients WHERE id = ?", (cid,))
    if not c:
        raise ApiError(404, "That client no longer exists.")
    cases = ctx.conn.query(
        "SELECT k.*, u.name AS advisor_name, "
        "(SELECT COALESCE(SUM(p.amount),0) FROM payments p "
        " WHERE p.case_id = k.id AND p.voided = 0) AS paid "
        "FROM cases k LEFT JOIN users u ON u.id = k.advisor_id "
        "WHERE k.client_id = ? ORDER BY k.opened_at DESC", (cid,))
    payments = ctx.conn.query(
        "SELECT * FROM payments WHERE client_id = ? ORDER BY paid_on DESC, id DESC",
        (cid,))
    events = ctx.conn.query(
        "SELECT * FROM events WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT 200",
        (cid,))
    appts = ctx.conn.query(
        "SELECT * FROM appointments WHERE client_id = ? ORDER BY starts_at DESC",
        (cid,))
    tasks = ctx.conn.query(
        "SELECT * FROM tasks WHERE client_id = ? ORDER BY status, due_date", (cid,))
    return {"client": c, "cases": cases, "payments": payments,
            "events": events, "appointments": appts, "tasks": tasks,
            "alerts": _client_alerts(c)}


def _client_alerts(c):
    out = []
    warn = 90
    for label, field in (("Passport", "passport_expiry"),
                         ("Permit / visa", "permit_expiry")):
        d = days_until(c.get(field))
        if d is None:
            continue
        if d < 0:
            out.append({"level": "critical",
                        "text": f"{label} expired {abs(d)} days ago."})
        elif d <= warn:
            out.append({"level": "warn" if d > 30 else "critical",
                        "text": f"{label} expires in {d} days."})
    return out


@route("POST", r"/api/clients/(\d+)")
def update_client(ctx, cid):
    need_admin(ctx)
    cid = int(cid)
    c = ctx.conn.one("SELECT * FROM clients WHERE id = ?", (cid,))
    if not c:
        raise ApiError(404, "That client no longer exists.")
    sets, params, changed = [], [], []
    for f in CLIENT_FIELDS:
        if f in ctx.body:
            v = ctx.s(f)
            if f in ("first_name", "last_name") and not v:
                raise ApiError(400, "Names cannot be blank.")
            if str(c.get(f) or "") != v:
                changed.append(f.replace("_", " "))
            sets.append(f"{f} = ?")
            params.append(v)
    if not sets:
        return {"ok": True}
    params += [now(), cid]
    ctx.conn.execute(
        f"UPDATE clients SET {', '.join(sets)}, updated_at = ? WHERE id = ?",
        params)
    if changed:
        core.log_event(ctx.conn, ctx.user, "system",
                       "Updated " + ", ".join(changed[:8]) + ".", client_id=cid)
    core.audit(ctx.conn, ctx.user, "client.updated", c["ref"], ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


@route("DELETE", r"/api/clients/(\d+)")
def delete_client(ctx, cid):
    need_owner(ctx)
    cid = int(cid)
    c = ctx.conn.one("SELECT * FROM clients WHERE id = ?", (cid,))
    if not c:
        raise ApiError(404, "That client no longer exists.")
    for t in ("case_documents",):
        ctx.conn.execute(
            f"DELETE FROM {t} WHERE case_id IN (SELECT id FROM cases WHERE client_id = ?)",
            (cid,))
    for t in ("cases", "payments", "appointments", "tasks", "events"):
        ctx.conn.execute(f"DELETE FROM {t} WHERE client_id = ?", (cid,))
    ctx.conn.execute("DELETE FROM clients WHERE id = ?", (cid,))
    core.audit(ctx.conn, ctx.user, "client.deleted", c["ref"], ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


# ==========================================================================
# CASES
# ==========================================================================
def _create_case(ctx, client_id, service, destination="", advisor_id=None,
                 fee_total=0.0, target_date="", priority="normal", notes=""):
    s = core.get_settings(ctx.conn)
    ref, case_id = core.insert_with_ref(ctx.conn, "cases", "CS", lambda ref: (
        "INSERT INTO cases (ref, client_id, service, destination, stage, "
        "priority, advisor_id, fee_total, currency, target_date, notes, "
        "opened_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (ref, client_id, service, destination, core.STAGES[0], priority,
         advisor_id, fee_total, s.get("currency", "LSL"), target_date,
         notes, now())))
    for name in core.docs_for_service(service):
        ctx.conn.execute(
            "INSERT INTO case_documents (case_id, name, required, status) "
            "VALUES (?,?,?,?)", (case_id, name, 1, "pending"))
    core.log_event(ctx.conn, ctx.user, "stage", f"Case opened: {service}",
                   client_id=client_id, case_id=case_id,
                   to_stage=core.STAGES[0])
    return case_id


@route("GET", "/api/cases")
def list_cases(ctx):
    need_admin(ctx)
    where, params = [], []
    stage = ctx.q("stage")
    if stage and stage != "all":
        where.append("k.stage = ?")
        params.append(stage)
    if ctx.q("open") == "1":
        where.append("k.closed = 0")
    if ctx.q("closed") == "1":
        where.append("k.closed = 1")
    service = ctx.q("service")
    if service:
        where.append("k.service = ?")
        params.append(service)
    advisor = ctx.qi("advisor_id")
    if advisor:
        where.append("k.advisor_id = ?")
        params.append(advisor)
    search = ctx.q("q")
    if search:
        where.append("(LOWER(k.ref) LIKE ? OR LOWER(c.first_name) LIKE ? "
                     "OR LOWER(c.last_name) LIKE ? OR LOWER(k.authority_ref) LIKE ?)")
        params += ["%" + search.lower() + "%"] * 4

    sql = ("SELECT k.*, c.first_name, c.last_name, c.ref AS client_ref, "
           "c.nationality, u.name AS advisor_name, "
           "(SELECT COALESCE(SUM(p.amount),0) FROM payments p "
           " WHERE p.case_id = k.id AND p.voided = 0) AS paid, "
           "(SELECT COUNT(*) FROM case_documents d WHERE d.case_id = k.id) AS doc_total, "
           "(SELECT COUNT(*) FROM case_documents d WHERE d.case_id = k.id "
           " AND d.status IN ('received','verified')) AS doc_done "
           "FROM cases k JOIN clients c ON c.id = k.client_id "
           "LEFT JOIN users u ON u.id = k.advisor_id")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY k.closed, k.opened_at DESC LIMIT 500"
    rows = ctx.conn.query(sql, params)
    by_stage = {r["stage"]: r["n"] for r in ctx.conn.query(
        "SELECT stage, COUNT(*) AS n FROM cases WHERE closed = 0 GROUP BY stage")}
    return {"cases": rows, "by_stage": by_stage}


@route("POST", "/api/cases")
def create_case(ctx):
    need_admin(ctx)
    client_id = ctx.i("client_id")
    if not client_id or not ctx.conn.one("SELECT id FROM clients WHERE id = ?",
                                         (client_id,)):
        raise ApiError(400, "Pick an existing client for this case.")
    case_id = _create_case(
        ctx, client_id, ctx.req("service", "Service"), ctx.s("destination"),
        ctx.i("advisor_id") or ctx.user["id"], ctx.f("fee_total"),
        ctx.s("target_date"), ctx.s("priority") or "normal", ctx.s("notes"))
    core.audit(ctx.conn, ctx.user, "case.created", f"#{case_id}", ctx.ip)
    ctx.conn.commit()
    return {"ok": True, "id": case_id}


@route("GET", r"/api/cases/(\d+)")
def get_case(ctx, kid):
    need_admin(ctx)
    kid = int(kid)
    k = ctx.conn.one(
        "SELECT k.*, c.first_name, c.last_name, c.ref AS client_ref, "
        "c.email, c.phone, c.nationality, c.passport_no, c.passport_expiry, "
        "c.permit_expiry, u.name AS advisor_name "
        "FROM cases k JOIN clients c ON c.id = k.client_id "
        "LEFT JOIN users u ON u.id = k.advisor_id WHERE k.id = ?", (kid,))
    if not k:
        raise ApiError(404, "That case no longer exists.")
    docs = ctx.conn.query(
        "SELECT * FROM case_documents WHERE case_id = ? ORDER BY id", (kid,))
    payments = ctx.conn.query(
        "SELECT * FROM payments WHERE case_id = ? ORDER BY paid_on DESC, id DESC",
        (kid,))
    events = ctx.conn.query(
        "SELECT * FROM events WHERE case_id = ? ORDER BY created_at DESC, id DESC",
        (kid,))
    tasks = ctx.conn.query(
        "SELECT * FROM tasks WHERE case_id = ? ORDER BY status, due_date", (kid,))
    appts = ctx.conn.query(
        "SELECT * FROM appointments WHERE case_id = ? ORDER BY starts_at DESC",
        (kid,))
    paid = sum(p["amount"] for p in payments if not p["voided"])
    return {"case": k, "documents": docs, "payments": payments,
            "events": events, "tasks": tasks, "appointments": appts,
            "progress": _progress(k),
            "money": {"fee_total": k["fee_total"], "paid": paid,
                      "balance": round((k["fee_total"] or 0) - paid, 2)}}


def _progress(k):
    stage = k["stage"]
    if k.get("closed") and k.get("outcome") and k["outcome"] != "Approved":
        return {"pipeline": core.STAGES, "index": -1, "closed": True,
                "outcome": k["outcome"]}
    try:
        idx = core.STAGES.index(stage)
    except ValueError:
        idx = 0
    return {"pipeline": core.STAGES, "index": idx,
            "closed": bool(k.get("closed")), "outcome": k.get("outcome") or ""}


CASE_FIELDS = ["service", "destination", "priority", "fee_total", "currency",
               "authority_ref", "target_date", "submitted_at", "decision_at",
               "notes"]


@route("POST", r"/api/cases/(\d+)")
def update_case(ctx, kid):
    need_admin(ctx)
    kid = int(kid)
    k = ctx.conn.one("SELECT * FROM cases WHERE id = ?", (kid,))
    if not k:
        raise ApiError(404, "That case no longer exists.")
    sets, params = [], []
    for f in CASE_FIELDS:
        if f in ctx.body:
            sets.append(f"{f} = ?")
            params.append(ctx.f(f) if f == "fee_total" else ctx.s(f))
    if "advisor_id" in ctx.body:
        sets.append("advisor_id = ?")
        params.append(ctx.i("advisor_id"))
    if not sets:
        return {"ok": True}
    params += [now(), kid]
    ctx.conn.execute(
        f"UPDATE cases SET {', '.join(sets)}, updated_at = ? WHERE id = ?", params)
    core.audit(ctx.conn, ctx.user, "case.updated", k["ref"], ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


@route("POST", r"/api/cases/(\d+)/stage")
def move_stage(ctx, kid):
    need_admin(ctx)
    kid = int(kid)
    k = ctx.conn.one("SELECT * FROM cases WHERE id = ?", (kid,))
    if not k:
        raise ApiError(404, "That case no longer exists.")
    stage = ctx.req("stage", "Stage")
    if stage not in core.STAGES and stage not in core.CLOSED_OUTCOMES:
        raise ApiError(400, "Unknown stage.")

    closed = 1 if stage in core.CLOSED_OUTCOMES else 0
    outcome = stage if closed else ""
    new_stage = stage if not closed else (
        "Approved" if stage == "Approved" else k["stage"])
    extra, params = "", []
    if stage == "Submitted to authority" and not k.get("submitted_at"):
        extra += ", submitted_at = ?"
        params.append(today())
    if closed:
        extra += ", decision_at = ?"
        params.append(today())

    ctx.conn.execute(
        f"UPDATE cases SET stage = ?, closed = ?, outcome = ?{extra}, "
        f"updated_at = ? WHERE id = ?",
        [new_stage, closed, outcome] + params + [now(), kid])
    core.log_event(ctx.conn, ctx.user, "stage",
                   ctx.s("note") or f"Moved to {stage}.",
                   client_id=k["client_id"], case_id=kid,
                   from_stage=k["stage"], to_stage=stage)
    core.audit(ctx.conn, ctx.user, "case.stage", f"{k['ref']} -> {stage}", ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


@route("POST", r"/api/cases/(\d+)/reopen")
def reopen_case(ctx, kid):
    need_admin(ctx)
    kid = int(kid)
    k = ctx.conn.one("SELECT * FROM cases WHERE id = ?", (kid,))
    if not k:
        raise ApiError(404, "That case no longer exists.")
    ctx.conn.execute(
        "UPDATE cases SET closed = 0, outcome = '', decision_at = '', "
        "updated_at = ? WHERE id = ?", (now(), kid))
    core.log_event(ctx.conn, ctx.user, "stage", "Case reopened.",
                   client_id=k["client_id"], case_id=kid)
    ctx.conn.commit()
    return {"ok": True}


@route("DELETE", r"/api/cases/(\d+)")
def delete_case(ctx, kid):
    need_owner(ctx)
    kid = int(kid)
    k = ctx.conn.one("SELECT * FROM cases WHERE id = ?", (kid,))
    if not k:
        raise ApiError(404, "That case no longer exists.")
    ctx.conn.execute("DELETE FROM case_documents WHERE case_id = ?", (kid,))
    ctx.conn.execute("UPDATE payments SET case_id = NULL WHERE case_id = ?", (kid,))
    ctx.conn.execute("DELETE FROM tasks WHERE case_id = ?", (kid,))
    ctx.conn.execute("DELETE FROM appointments WHERE case_id = ?", (kid,))
    ctx.conn.execute("DELETE FROM events WHERE case_id = ?", (kid,))
    ctx.conn.execute("DELETE FROM cases WHERE id = ?", (kid,))
    core.audit(ctx.conn, ctx.user, "case.deleted", k["ref"], ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


# ==========================================================================
# CASE DOCUMENTS
# ==========================================================================
@route("POST", r"/api/cases/(\d+)/documents")
def add_document(ctx, kid):
    need_admin(ctx)
    kid = int(kid)
    if not ctx.conn.one("SELECT id FROM cases WHERE id = ?", (kid,)):
        raise ApiError(404, "That case no longer exists.")
    did = ctx.conn.insert(
        "INSERT INTO case_documents (case_id, name, required, status, expiry, "
        "link, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (kid, ctx.req("name", "Document name"), 1 if ctx.b("required", True) else 0,
         "pending", ctx.s("expiry"), ctx.s("link"), ctx.s("note"),
         ctx.user["id"], now()))
    ctx.conn.commit()
    return {"ok": True, "id": did}


@route("POST", r"/api/documents/(\d+)")
def update_document(ctx, did):
    need_admin(ctx)
    did = int(did)
    d = ctx.conn.one("SELECT * FROM case_documents WHERE id = ?", (did,))
    if not d:
        raise ApiError(404, "That document row no longer exists.")
    status = ctx.s("status") or d["status"]
    if status not in ("pending", "received", "verified", "rejected", "waived"):
        raise ApiError(400, "Unknown document status.")
    ctx.conn.execute(
        "UPDATE case_documents SET status = ?, expiry = ?, link = ?, note = ?, "
        "required = ?, updated_by = ?, updated_at = ? WHERE id = ?",
        (status, ctx.s("expiry") if "expiry" in ctx.body else d["expiry"],
         ctx.s("link") if "link" in ctx.body else d["link"],
         ctx.s("note") if "note" in ctx.body else d["note"],
         (1 if ctx.b("required") else 0) if "required" in ctx.body else d["required"],
         ctx.user["id"], now(), did))
    if status != d["status"]:
        k = ctx.conn.one("SELECT client_id FROM cases WHERE id = ?", (d["case_id"],))
        core.log_event(ctx.conn, ctx.user, "document",
                       f"{d['name']}: {d['status']} → {status}",
                       client_id=(k or {}).get("client_id"), case_id=d["case_id"])
    ctx.conn.commit()
    return {"ok": True}


@route("DELETE", r"/api/documents/(\d+)")
def delete_document(ctx, did):
    need_admin(ctx)
    ctx.conn.execute("DELETE FROM case_documents WHERE id = ?", (int(did),))
    ctx.conn.commit()
    return {"ok": True}


# ==========================================================================
# EVENTS / TIMELINE
# ==========================================================================
@route("POST", "/api/events")
def add_event(ctx):
    need_admin(ctx)
    kind = ctx.s("kind") or "note"
    if kind not in core.EVENT_KINDS:
        raise ApiError(400, "Unknown activity type.")
    body = ctx.req("body", "Note")
    client_id, case_id = ctx.i("client_id"), ctx.i("case_id")
    if case_id and not client_id:
        k = ctx.conn.one("SELECT client_id FROM cases WHERE id = ?", (case_id,))
        client_id = (k or {}).get("client_id")
    if not client_id and not case_id:
        raise ApiError(400, "Attach the note to a client or a case.")
    core.log_event(ctx.conn, ctx.user, kind, body, client_id, case_id)

    follow = ctx.s("follow_up")
    if follow:
        ctx.conn.execute(
            "INSERT INTO tasks (title, detail, due_date, client_id, case_id, "
            "assigned_to, priority, status, created_by, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (ctx.s("follow_up_title") or "Follow up", body[:400], follow,
             client_id, case_id, ctx.user["id"], "normal", "open",
             ctx.user["id"], now()))
    ctx.conn.commit()
    return {"ok": True}


# ==========================================================================
# PAYMENTS
# ==========================================================================
@route("GET", "/api/payments")
def list_payments(ctx):
    need_admin(ctx)
    where, params = [], []
    if ctx.q("from"):
        where.append("p.paid_on >= ?")
        params.append(ctx.q("from"))
    if ctx.q("to"):
        where.append("p.paid_on <= ?")
        params.append(ctx.q("to"))
    if ctx.q("kind"):
        where.append("p.kind = ?")
        params.append(ctx.q("kind"))
    sql = ("SELECT p.*, c.first_name, c.last_name, c.ref AS client_ref, "
           "k.ref AS case_ref FROM payments p "
           "JOIN clients c ON c.id = p.client_id "
           "LEFT JOIN cases k ON k.id = p.case_id")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY p.paid_on DESC, p.id DESC LIMIT 500"
    rows = ctx.conn.query(sql, params)
    total = sum(r["amount"] for r in rows if not r["voided"])
    return {"payments": rows, "total": round(total, 2)}


@route("POST", "/api/payments")
def create_payment(ctx):
    need_admin(ctx)
    amount = ctx.f("amount")
    if amount <= 0:
        raise ApiError(400, "Enter an amount greater than zero.")
    client_id = ctx.i("client_id")
    case_id = ctx.i("case_id")
    if case_id and not client_id:
        k = ctx.conn.one("SELECT client_id FROM cases WHERE id = ?", (case_id,))
        client_id = (k or {}).get("client_id")
    if not client_id or not ctx.conn.one("SELECT id FROM clients WHERE id = ?",
                                         (client_id,)):
        raise ApiError(400, "Pick the client this payment belongs to.")
    kind = ctx.s("kind") or "consultation"
    if kind not in [k for k, _ in core.PAYMENT_KINDS]:
        raise ApiError(400, "Unknown payment type.")
    s = core.get_settings(ctx.conn)
    pid = ctx.conn.insert(
        "INSERT INTO payments (client_id, case_id, amount, currency, kind, "
        "method, reference, paid_on, note, recorded_by, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (client_id, case_id, amount, ctx.s("currency") or s.get("currency", "LSL"),
         kind, ctx.s("method"), ctx.s("reference"), ctx.s("paid_on") or today(),
         ctx.s("note"), ctx.user["id"], now()))
    core.log_event(ctx.conn, ctx.user, "payment",
                   f"Received {amount:,.2f} ({kind}).", client_id, case_id)
    core.audit(ctx.conn, ctx.user, "payment.created", f"#{pid} {amount}", ctx.ip)
    ctx.conn.commit()
    return {"ok": True, "id": pid}


@route("POST", r"/api/payments/(\d+)/void")
def void_payment(ctx, pid):
    need_admin(ctx)
    pid = int(pid)
    p = ctx.conn.one("SELECT * FROM payments WHERE id = ?", (pid,))
    if not p:
        raise ApiError(404, "That payment no longer exists.")
    new = 0 if p["voided"] else 1
    ctx.conn.execute("UPDATE payments SET voided = ? WHERE id = ?", (new, pid))
    core.log_event(ctx.conn, ctx.user, "payment",
                   ("Voided" if new else "Restored") + f" payment of {p['amount']:,.2f}.",
                   p["client_id"], p["case_id"])
    core.audit(ctx.conn, ctx.user,
               "payment.voided" if new else "payment.restored", f"#{pid}", ctx.ip)
    ctx.conn.commit()
    return {"ok": True, "voided": bool(new)}


# ==========================================================================
# TASKS
# ==========================================================================
@route("GET", "/api/tasks")
def list_tasks(ctx):
    need_admin(ctx)
    where, params = [], []
    status = ctx.q("status", "open")
    if status != "all":
        where.append("t.status = ?")
        params.append(status)
    if ctx.q("mine") == "1":
        where.append("t.assigned_to = ?")
        params.append(ctx.user["id"])
    sql = ("SELECT t.*, c.first_name, c.last_name, k.ref AS case_ref, "
           "u.name AS assignee FROM tasks t "
           "LEFT JOIN clients c ON c.id = t.client_id "
           "LEFT JOIN cases k ON k.id = t.case_id "
           "LEFT JOIN users u ON u.id = t.assigned_to")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY t.status, (t.due_date = '') , t.due_date, t.id DESC LIMIT 400"
    return {"tasks": ctx.conn.query(sql, params), "today": today()}


@route("POST", "/api/tasks")
def create_task(ctx):
    need_admin(ctx)
    tid = ctx.conn.insert(
        "INSERT INTO tasks (title, detail, due_date, client_id, case_id, "
        "assigned_to, priority, status, created_by, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (ctx.req("title", "Task"), ctx.s("detail"), ctx.s("due_date"),
         ctx.i("client_id"), ctx.i("case_id"),
         ctx.i("assigned_to") or ctx.user["id"], ctx.s("priority") or "normal",
         "open", ctx.user["id"], now()))
    ctx.conn.commit()
    return {"ok": True, "id": tid}


@route("POST", r"/api/tasks/(\d+)")
def update_task(ctx, tid):
    need_admin(ctx)
    tid = int(tid)
    t = ctx.conn.one("SELECT * FROM tasks WHERE id = ?", (tid,))
    if not t:
        raise ApiError(404, "That task no longer exists.")
    status = ctx.s("status") or t["status"]
    if status not in ("open", "done", "cancelled"):
        raise ApiError(400, "Unknown task status.")
    ctx.conn.execute(
        "UPDATE tasks SET title = ?, detail = ?, due_date = ?, priority = ?, "
        "assigned_to = ?, status = ?, done_at = ? WHERE id = ?",
        (ctx.s("title") or t["title"],
         ctx.s("detail") if "detail" in ctx.body else t["detail"],
         ctx.s("due_date") if "due_date" in ctx.body else t["due_date"],
         ctx.s("priority") or t["priority"],
         ctx.i("assigned_to") or t["assigned_to"], status,
         now() if status == "done" and t["status"] != "done" else t["done_at"],
         tid))
    ctx.conn.commit()
    return {"ok": True}


@route("DELETE", r"/api/tasks/(\d+)")
def delete_task(ctx, tid):
    need_admin(ctx)
    ctx.conn.execute("DELETE FROM tasks WHERE id = ?", (int(tid),))
    ctx.conn.commit()
    return {"ok": True}


# ==========================================================================
# APPOINTMENTS
# ==========================================================================
@route("GET", "/api/appointments")
def list_appointments(ctx):
    need_admin(ctx)
    where, params = [], []
    if ctx.q("from"):
        where.append("a.starts_at >= ?")
        params.append(ctx.q("from"))
    if ctx.q("to"):
        where.append("a.starts_at <= ?")
        params.append(ctx.q("to") + " 23:59")
    if ctx.q("upcoming") == "1":
        where.append("a.starts_at >= ?")
        params.append(now())
    sql = ("SELECT a.*, c.first_name, c.last_name, k.ref AS case_ref, "
           "u.name AS advisor_name FROM appointments a "
           "LEFT JOIN clients c ON c.id = a.client_id "
           "LEFT JOIN cases k ON k.id = a.case_id "
           "LEFT JOIN users u ON u.id = a.advisor_id")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY a.starts_at LIMIT 400"
    return {"appointments": ctx.conn.query(sql, params), "now": now()}


@route("POST", "/api/appointments")
def create_appointment(ctx):
    need_admin(ctx)
    starts = ctx.req("starts_at", "Date and time").replace("T", " ")
    if not parse_date(starts):
        raise ApiError(400, "That date and time could not be read.")
    client_id = ctx.i("client_id")
    case_id = ctx.i("case_id")
    if case_id and not client_id:
        k = ctx.conn.one("SELECT client_id FROM cases WHERE id = ?", (case_id,))
        client_id = (k or {}).get("client_id")
    s = core.get_settings(ctx.conn)
    aid = ctx.conn.insert(
        "INSERT INTO appointments (client_id, case_id, title, starts_at, "
        "duration_min, location, advisor_id, status, note, created_by, "
        "created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (client_id, case_id, ctx.s("title") or "Consultation", starts[:16],
         ctx.i("duration_min", 45) or 45,
         ctx.s("location") or s.get("org_address", ""),
         ctx.i("advisor_id") or ctx.user["id"], "scheduled", ctx.s("note"),
         ctx.user["id"], now()))
    if client_id:
        core.log_event(ctx.conn, ctx.user, "meeting",
                       f"Consultation booked for {starts[:16]}.",
                       client_id, case_id)
    ctx.conn.commit()
    return {"ok": True, "id": aid}


@route("POST", r"/api/appointments/(\d+)")
def update_appointment(ctx, aid):
    need_admin(ctx)
    aid = int(aid)
    a = ctx.conn.one("SELECT * FROM appointments WHERE id = ?", (aid,))
    if not a:
        raise ApiError(404, "That appointment no longer exists.")
    status = ctx.s("status") or a["status"]
    if status not in ("scheduled", "held", "no_show", "cancelled"):
        raise ApiError(400, "Unknown appointment status.")
    ctx.conn.execute(
        "UPDATE appointments SET title = ?, starts_at = ?, duration_min = ?, "
        "location = ?, status = ?, note = ? WHERE id = ?",
        (ctx.s("title") or a["title"],
         (ctx.s("starts_at").replace("T", " ")[:16] or a["starts_at"]),
         ctx.i("duration_min", a["duration_min"]) or a["duration_min"],
         ctx.s("location") if "location" in ctx.body else a["location"],
         status, ctx.s("note") if "note" in ctx.body else a["note"], aid))
    ctx.conn.commit()
    return {"ok": True}


@route("DELETE", r"/api/appointments/(\d+)")
def delete_appointment(ctx, aid):
    need_admin(ctx)
    ctx.conn.execute("DELETE FROM appointments WHERE id = ?", (int(aid),))
    ctx.conn.commit()
    return {"ok": True}


# ==========================================================================
# DASHBOARD
# ==========================================================================
@route("GET", "/api/dashboard")
def dashboard(ctx):
    need_admin(ctx)
    c = ctx.conn
    s = core.get_settings(ctx.conn)
    warn_days = int(s.get("expiry_warn_days") or 60)
    week = core.days_from_now(-7)
    month_start = today()[:8] + "01"

    kpis = {
        "unread_enquiries": c.scalar(
            "SELECT COUNT(*) AS n FROM enquiries WHERE status = 'new'"),
        "enquiries_7d": c.scalar(
            "SELECT COUNT(*) AS n FROM enquiries WHERE created_at >= ?", (week,)),
        "clients": c.scalar("SELECT COUNT(*) AS n FROM clients"),
        "open_cases": c.scalar("SELECT COUNT(*) AS n FROM cases WHERE closed = 0"),
        "approved_month": c.scalar(
            "SELECT COUNT(*) AS n FROM cases WHERE outcome = 'Approved' "
            "AND decision_at >= ?", (month_start,)),
        "collected_month": round(c.scalar(
            "SELECT COALESCE(SUM(amount),0) AS n FROM payments "
            "WHERE voided = 0 AND paid_on >= ?", (month_start,), 0) or 0, 2),
        "outstanding": 0.0,
        "tasks_overdue": c.scalar(
            "SELECT COUNT(*) AS n FROM tasks WHERE status = 'open' "
            "AND due_date <> '' AND due_date < ?", (today(),)),
        "appts_today": c.scalar(
            "SELECT COUNT(*) AS n FROM appointments WHERE status = 'scheduled' "
            "AND starts_at LIKE ?", (today() + "%",)),
    }

    fees = c.scalar("SELECT COALESCE(SUM(fee_total),0) AS n FROM cases "
                    "WHERE closed = 0", (), 0) or 0
    paid_open = c.scalar(
        "SELECT COALESCE(SUM(p.amount),0) AS n FROM payments p "
        "JOIN cases k ON k.id = p.case_id WHERE p.voided = 0 AND k.closed = 0",
        (), 0) or 0
    kpis["outstanding"] = round(max(0.0, fees - paid_open), 2)

    by_stage = [{"stage": st, "n": c.scalar(
        "SELECT COUNT(*) AS n FROM cases WHERE closed = 0 AND stage = ?", (st,))}
        for st in core.STAGES]
    by_service = c.query(
        "SELECT service, COUNT(*) AS n FROM cases GROUP BY service "
        "ORDER BY n DESC LIMIT 8")
    by_nationality = c.query(
        "SELECT nationality, COUNT(*) AS n FROM clients "
        "WHERE nationality <> '' GROUP BY nationality ORDER BY n DESC LIMIT 8")

    # 12-month enquiry trend
    trend = []
    import datetime as _dt
    d = _dt.date.today().replace(day=1)
    months = []
    for _ in range(12):
        months.append(d.strftime("%Y-%m"))
        d = (d - _dt.timedelta(days=1)).replace(day=1)
    for m in reversed(months):
        trend.append({
            "month": m,
            "enquiries": c.scalar(
                "SELECT COUNT(*) AS n FROM enquiries WHERE created_at LIKE ?",
                (m + "%",)),
            "cases": c.scalar(
                "SELECT COUNT(*) AS n FROM cases WHERE opened_at LIKE ?",
                (m + "%",)),
            "collected": round(c.scalar(
                "SELECT COALESCE(SUM(amount),0) AS n FROM payments "
                "WHERE voided = 0 AND paid_on LIKE ?", (m + "%",), 0) or 0, 2),
        })

    return {"kpis": kpis, "by_stage": by_stage, "by_service": by_service,
            "by_nationality": by_nationality, "trend": trend,
            "expiries": _expiries(c, warn_days),
            "recent_enquiries": c.query(
                "SELECT id, ref, first_name, last_name, service, status, "
                "created_at, nationality FROM enquiries "
                "ORDER BY created_at DESC, id DESC LIMIT 8"),
            "upcoming": c.query(
                "SELECT a.*, c.first_name, c.last_name FROM appointments a "
                "LEFT JOIN clients c ON c.id = a.client_id "
                "WHERE a.status = 'scheduled' AND a.starts_at >= ? "
                "ORDER BY a.starts_at LIMIT 6", (today(),)),
            "my_tasks": c.query(
                "SELECT t.*, c.first_name, c.last_name FROM tasks t "
                "LEFT JOIN clients c ON c.id = t.client_id "
                "WHERE t.status = 'open' ORDER BY (t.due_date = ''), "
                "t.due_date LIMIT 8"),
            "currency": s.get("currency", "LSL")}


def _expiries(c, warn_days):
    horizon = core.days_from_now(warn_days)
    out = []
    for label, table, field, ref_field in (
            ("Passport", "clients", "passport_expiry", "ref"),
            ("Permit / visa", "clients", "permit_expiry", "ref")):
        rows = c.query(
            f"SELECT id, {ref_field} AS ref, first_name, last_name, "
            f"{field} AS expires FROM {table} WHERE {field} <> '' "
            f"AND {field} <= ? ORDER BY {field} LIMIT 40", (horizon,))
        for r in rows:
            r["what"] = label
            r["days"] = days_until(r["expires"])
            out.append(r)
    docs = c.query(
        "SELECT d.id, d.name, d.expiry AS expires, k.ref, k.client_id, "
        "cl.first_name, cl.last_name FROM case_documents d "
        "JOIN cases k ON k.id = d.case_id JOIN clients cl ON cl.id = k.client_id "
        "WHERE d.expiry <> '' AND d.expiry <= ? ORDER BY d.expiry LIMIT 40",
        (horizon,))
    for r in docs:
        r["what"] = r.pop("name")
        r["days"] = days_until(r["expires"])
        out.append(r)
    out.sort(key=lambda r: (r["days"] if r["days"] is not None else 9999))
    return out[:25]


@route("GET", "/api/expiries")
def expiries(ctx):
    need_admin(ctx)
    days = ctx.qi("days", 90)
    return {"expiries": _expiries(ctx.conn, days), "days": days}


@route("GET", "/api/search")
def global_search(ctx):
    need_admin(ctx)
    q = "%" + ctx.q("q").lower() + "%"
    if len(q) < 4:
        return {"results": []}
    out = []
    for r in ctx.conn.query(
            "SELECT id, ref, first_name, last_name, nationality FROM clients "
            "WHERE LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? "
            "OR LOWER(ref) LIKE ? OR LOWER(passport_no) LIKE ? "
            "OR LOWER(email) LIKE ? OR LOWER(phone) LIKE ? LIMIT 8",
            [q] * 6):
        out.append({"type": "client", "id": r["id"], "ref": r["ref"],
                    "label": f"{r['first_name']} {r['last_name']}",
                    "sub": r["nationality"]})
    for r in ctx.conn.query(
            "SELECT k.id, k.ref, k.service, c.first_name, c.last_name "
            "FROM cases k JOIN clients c ON c.id = k.client_id "
            "WHERE LOWER(k.ref) LIKE ? OR LOWER(k.authority_ref) LIKE ? LIMIT 6",
            [q] * 2):
        out.append({"type": "case", "id": r["id"], "ref": r["ref"],
                    "label": f"{r['first_name']} {r['last_name']}",
                    "sub": r["service"]})
    for r in ctx.conn.query(
            "SELECT id, ref, first_name, last_name, service FROM enquiries "
            "WHERE LOWER(ref) LIKE ? OR LOWER(email) LIKE ? "
            "OR LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? LIMIT 6",
            [q] * 4):
        out.append({"type": "enquiry", "id": r["id"], "ref": r["ref"],
                    "label": f"{r['first_name']} {r['last_name']}",
                    "sub": r["service"]})
    return {"results": out}


# ==========================================================================
# REPORTS
# ==========================================================================
REPORTS = {
    "enquiries": ("Website enquiries",
                  "SELECT ref, created_at, first_name, last_name, email, phone, "
                  "nationality, country_residence, service, destination, "
                  "permit_status, status FROM enquiries "
                  "WHERE created_at >= ? AND created_at <= ? "
                  "ORDER BY created_at DESC"),
    "clients": ("Client register",
                "SELECT ref, created_at, first_name, last_name, email, phone, "
                "nationality, passport_no, passport_expiry, permit_status, "
                "permit_expiry, status FROM clients "
                "WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC"),
    "cases": ("Case register",
              "SELECT k.ref, k.opened_at, c.first_name, c.last_name, "
              "c.nationality, k.service, k.destination, k.stage, k.outcome, "
              "k.fee_total, k.currency, k.submitted_at, k.decision_at "
              "FROM cases k JOIN clients c ON c.id = k.client_id "
              "WHERE k.opened_at >= ? AND k.opened_at <= ? ORDER BY k.opened_at DESC"),
    "payments": ("Payments received",
                 "SELECT p.paid_on, p.reference, c.ref AS client_ref, "
                 "c.first_name, c.last_name, p.kind, p.method, p.amount, "
                 "p.currency, p.voided FROM payments p "
                 "JOIN clients c ON c.id = p.client_id "
                 "WHERE p.paid_on >= ? AND p.paid_on <= ? ORDER BY p.paid_on DESC"),
    "pipeline": ("Open cases by stage",
                 "SELECT k.stage, k.ref, c.first_name, c.last_name, k.service, "
                 "k.opened_at, k.target_date, k.fee_total FROM cases k "
                 "JOIN clients c ON c.id = k.client_id WHERE k.closed = 0 "
                 "AND k.opened_at >= ? AND k.opened_at <= ? ORDER BY k.stage"),
    "outcomes": ("Decisions and outcomes",
                 "SELECT k.decision_at, k.ref, c.first_name, c.last_name, "
                 "k.service, k.outcome, k.authority_ref FROM cases k "
                 "JOIN clients c ON c.id = k.client_id WHERE k.closed = 1 "
                 "AND k.decision_at >= ? AND k.decision_at <= ? "
                 "ORDER BY k.decision_at DESC"),
    "documents": ("Outstanding documents",
                  "SELECT k.ref, c.first_name, c.last_name, d.name, d.status, "
                  "d.expiry, d.note FROM case_documents d "
                  "JOIN cases k ON k.id = d.case_id "
                  "JOIN clients c ON c.id = k.client_id "
                  "WHERE d.status = 'pending' AND k.closed = 0 "
                  "AND k.opened_at >= ? AND k.opened_at <= ? ORDER BY k.ref"),
    "appointments": ("Consultations",
                     "SELECT a.starts_at, a.title, c.first_name, c.last_name, "
                     "a.status, a.location, a.duration_min FROM appointments a "
                     "LEFT JOIN clients c ON c.id = a.client_id "
                     "WHERE a.starts_at >= ? AND a.starts_at <= ? "
                     "ORDER BY a.starts_at DESC"),
    "audit": ("Activity log",
              "SELECT created_at, user_email, action, detail, ip FROM audit "
              "WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC"),
}


def _report_rows(ctx, key, frm, to):
    if key not in REPORTS:
        raise ApiError(404, "Unknown report.")
    title, sql = REPORTS[key]
    return title, ctx.conn.query(sql, (frm, to + " 23:59:59"))


@route("GET", "/api/reports")
def report_list(ctx):
    need_admin(ctx)
    return {"reports": [{"key": k, "title": v[0]} for k, v in REPORTS.items()]}


@route("GET", r"/api/reports/([a-z_]+)")
def report_run(ctx, key):
    need_admin(ctx)
    frm = ctx.q("from") or "2000-01-01"
    to = ctx.q("to") or today()
    title, rows = _report_rows(ctx, key, frm, to)
    return {"title": title, "rows": rows[:1000], "count": len(rows),
            "columns": list(rows[0].keys()) if rows else [], "from": frm, "to": to}


def csv_safe(value):
    """Stop a spreadsheet treating exported text as a formula.

    Excel and Sheets execute any cell starting = + - @ (or a tab/carriage
    return before one). A client could put that in the website form, and it
    would run on a staff machine when the export is opened. Prefixing an
    apostrophe makes the cell literal text; the leading quote is not shown.
    """
    if value is None:
        return ""
    text = str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def report_csv(ctx, key, frm, to):
    title, rows = _report_rows(ctx, key, frm, to)
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()),
                           extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: csv_safe(v) for k, v in r.items()})
    else:
        buf.write("No rows for this period\n")
    core.audit(ctx.conn, ctx.user, "report.exported", f"{key} {frm}..{to}", ctx.ip)
    ctx.conn.commit()
    return title, buf.getvalue()


# ==========================================================================
# USERS  (MAC staff only)
# ==========================================================================
@route("GET", "/api/users")
def list_users(ctx):
    need_admin(ctx)
    return {"users": ctx.conn.query(
        "SELECT id, email, name, role, phone, active, must_change, last_login, "
        "created_at FROM users ORDER BY name")}


@route("POST", "/api/users")
def create_user(ctx):
    need_owner(ctx)
    email = ctx.req("email", "Email").lower()
    if "@" not in email:
        raise ApiError(400, "That email address doesn't look right.")
    if ctx.conn.one("SELECT id FROM users WHERE email = ?", (email,)):
        raise ApiError(400, "Someone already uses that email address.")
    role = ctx.s("role") or "admin"
    if role not in ("owner", "admin", "advisor"):
        raise ApiError(400, "Unknown role.")
    import secrets as _s
    temp = "MAC-" + _s.token_urlsafe(9)
    uid = ctx.conn.insert(
        "INSERT INTO users (email, name, role, phone, password_hash, "
        "must_change, active, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (email, ctx.req("name", "Name"), role, ctx.s("phone"),
         core.hash_password(temp), 1, 1, now()))
    core.audit(ctx.conn, ctx.user, "user.created", email, ctx.ip)
    ctx.conn.commit()
    return {"ok": True, "id": uid, "temp_password": temp}


@route("POST", r"/api/users/(\d+)")
def update_user(ctx, uid):
    need_owner(ctx)
    uid = int(uid)
    u = ctx.conn.one("SELECT * FROM users WHERE id = ?", (uid,))
    if not u:
        raise ApiError(404, "That user no longer exists.")
    active = 1 if ctx.b("active", bool(u["active"])) else 0
    role = ctx.s("role") or u["role"]
    if role not in ("owner", "admin", "advisor"):
        raise ApiError(400, "Unknown role.")
    if u["id"] == ctx.user["id"] and (not active or role != "owner"):
        raise ApiError(400, "You cannot remove your own access.")
    if u["role"] == "owner" and role != "owner":
        owners = ctx.conn.scalar(
            "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1")
        if owners <= 1:
            raise ApiError(400, "Keep at least one owner on the account.")
    ctx.conn.execute(
        "UPDATE users SET name = ?, role = ?, phone = ?, active = ? WHERE id = ?",
        (ctx.s("name") or u["name"], role,
         ctx.s("phone") if "phone" in ctx.body else u["phone"], active, uid))
    if not active:
        ctx.conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    core.audit(ctx.conn, ctx.user, "user.updated", u["email"], ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


@route("POST", r"/api/users/(\d+)/reset-password")
def reset_password(ctx, uid):
    need_owner(ctx)
    uid = int(uid)
    u = ctx.conn.one("SELECT * FROM users WHERE id = ?", (uid,))
    if not u:
        raise ApiError(404, "That user no longer exists.")
    import secrets as _s
    temp = "MAC-" + _s.token_urlsafe(9)
    ctx.conn.execute(
        "UPDATE users SET password_hash = ?, must_change = 1, failed_logins = 0, "
        "locked_until = '' WHERE id = ?", (core.hash_password(temp), uid))
    ctx.conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    core.audit(ctx.conn, ctx.user, "user.password_reset", u["email"], ctx.ip)
    ctx.conn.commit()
    return {"ok": True, "temp_password": temp}


# ==========================================================================
# SETTINGS + SYSTEM
# ==========================================================================
EDITABLE_SETTINGS = ["org_name", "org_parent", "org_email", "org_phone",
                     "org_phone_alt", "org_address", "currency",
                     "consultation_fee", "expiry_warn_days", "allowed_origins"]


@route("GET", "/api/settings")
def get_settings_api(ctx):
    need_admin(ctx)
    s = core.get_settings(ctx.conn)
    out = {k: s.get(k, "") for k in EDITABLE_SETTINGS}
    if ctx.user["role"] == "owner":
        out["intake_api_key"] = s.get("intake_api_key", "")
    return {"settings": out, "services": core.SERVICES, "stages": core.STAGES}


@route("POST", "/api/settings")
def save_settings(ctx):
    need_owner(ctx)
    for k in EDITABLE_SETTINGS:
        if k in ctx.body:
            core.set_setting(ctx.conn, k, ctx.s(k))
    core.audit(ctx.conn, ctx.user, "settings.updated", "", ctx.ip)
    ctx.conn.commit()
    return {"ok": True}


@route("POST", "/api/settings/rotate-key")
def rotate_key(ctx):
    need_owner(ctx)
    import secrets as _s
    key = "mac_live_" + _s.token_hex(16)
    core.set_setting(ctx.conn, "intake_api_key", key)
    core.audit(ctx.conn, ctx.user, "intake_key.rotated", "", ctx.ip)
    ctx.conn.commit()
    return {"ok": True, "intake_api_key": key}


@route("GET", "/api/audit")
def audit_log(ctx):
    need_admin(ctx)
    return {"audit": ctx.conn.query(
        "SELECT * FROM audit ORDER BY created_at DESC, id DESC LIMIT 300")}


@route("GET", "/api/system")
def system(ctx):
    need_admin(ctx)
    counts = {}
    for t in db.TABLE_NAMES:
        try:
            counts[t] = ctx.conn.scalar(f"SELECT COUNT(*) AS n FROM {t}")
        except Exception:
            ctx.conn.rollback()
            counts[t] = None

    primary = {"configured": bool(db.DATABASE_URL),
               "engine": "PostgreSQL (Neon)" if db.IS_PG else "SQLite (local file)",
               "host": db.host_of(db.DATABASE_URL), "reachable": True,
               "counts": counts}
    if db.IS_PG:
        try:
            size = ctx.conn.scalar(
                "SELECT pg_database_size(current_database()) AS s", (), 0)
            primary["used_mb"] = round((size or 0) / 1048576.0, 2)
            primary["quota_mb"] = 512 * 1024 * 0.0 or 512  # Neon free ~0.5 GB
        except Exception:
            ctx.conn.rollback()

    standby = db.probe(db.MIRROR_DATABASE_URL) if db.HAS_MIRROR \
        else {"configured": False}
    return {"primary": primary, "standby": standby,
            "mirror": db.mirror_state(),
            "mirror_every_min": db.MIRROR_EVERY_MIN,
            "version": core.VERSION,
            "ingest": ctx.conn.query(
                "SELECT * FROM ingest_log ORDER BY created_at DESC, id DESC LIMIT 25")}


@route("POST", "/api/system/mirror-now")
def mirror_now(ctx):
    need_owner(ctx)
    if not db.HAS_MIRROR:
        raise ApiError(400, "No backup database is configured. Set "
                            "MIRROR_DATABASE_URL to your Supabase connection string.")
    res = db.run_mirror()
    core.audit(ctx.conn, ctx.user, "mirror.run", core.jdump(res)[:200], ctx.ip)
    ctx.conn.commit()
    if not res.get("ok"):
        raise ApiError(500, res.get("error", "The copy did not finish."))
    return res
