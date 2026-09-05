"""Auth, settings, reference numbers, audit trail and first-run seeding."""
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets

import db

VERSION = "v1.0"
APP_NAME = "MAC Admin Portal"

SEED_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@maclesotho.com").strip().lower()
SEED_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Migration@20!26")
SEED_ADMIN_NAME = os.environ.get("ADMIN_NAME", "MAC Administrator")

SESSION_HOURS = int(os.environ.get("SESSION_HOURS", "12") or 12)
MAX_FAILED_LOGINS = 6
LOCKOUT_MINUTES = 15

# ---------------------------------------------------------------- taxonomies
SERVICES = [
    "Visa Advisory — Tourist / Business / Transit / Family Visit",
    "Temporary Residence Permit — New Application",
    "Temporary Residence Permit — Renewal",
    "Permanent Residence Application",
    "Citizenship Application",
    "Work Permit — New Application",
    "Work Permit — Renewal",
    "Study Abroad — Student Visa Support",
    "Document Verification — Police Clearance / Notarisation / Translation",
    "Pre-departure Orientation",
    "General Immigration Advice",
    "Other",
]

STAGES = [
    "Enquiry",
    "Consultation booked",
    "Consultation held",
    "Agreement signed",
    "Collecting documents",
    "Submitted to authority",
    "Decision pending",
    "Approved",
]
CLOSED_OUTCOMES = ["Approved", "Rejected", "Withdrawn", "Referred out"]

PERMIT_STATUSES = [
    "No current permit",
    "Valid temporary residence permit",
    "Expired permit — seeking renewal",
    "Valid work permit",
    "Student visa holder",
    "Tourist / visitor visa",
    "Permanent resident",
    "Other",
]

PAYMENT_KINDS = [
    ("consultation", "Consultation fee"),
    ("commencement", "50% on commencement"),
    ("final", "50% on submission"),
    ("disbursement", "Disbursement / government fee"),
    ("other", "Other"),
]

EVENT_KINDS = ["note", "call", "email", "whatsapp", "meeting",
               "document", "stage", "payment", "system"]

# Document checklists suggested per service family.
DOC_TEMPLATES = {
    "residence": ["Passport (certified copy)", "Passport photographs (2)",
                  "Police clearance — country of origin",
                  "Police clearance — Lesotho", "Proof of address",
                  "Employment contract or business registration",
                  "Medical certificate", "Bank statements (3 months)",
                  "Completed application form", "Application fee receipt"],
    "work": ["Passport (certified copy)", "Passport photographs (2)",
             "Employment contract", "Employer registration certificate",
             "Qualification certificates (certified)", "CV",
             "Police clearance", "Labour Commissioner clearance",
             "Completed work permit form", "Application fee receipt"],
    "citizenship": ["Passport (certified copy)", "Birth certificate",
                    "Marriage certificate (if applicable)",
                    "Proof of continuous residence",
                    "Police clearance — Lesotho",
                    "Police clearance — country of origin",
                    "Two referee letters", "Renunciation declaration",
                    "Completed application form"],
    "study": ["Passport (certified copy)", "Academic transcripts",
              "Certified certificates", "University admission letter",
              "Proof of funds / sponsorship letter",
              "Medical certificate", "Police clearance",
              "Student visa application form"],
    "visa": ["Passport (valid 6+ months)", "Passport photographs (2)",
             "Completed visa application form", "Proof of accommodation",
             "Return ticket / itinerary", "Bank statements (3 months)",
             "Invitation letter (if applicable)", "Travel insurance"],
    "verification": ["Original document(s)", "Passport (certified copy)",
                     "Proof of payment", "Translation source document"],
    "default": ["Passport (certified copy)", "Passport photographs (2)",
                "Proof of address", "Completed application form",
                "Application fee receipt"],
}


def docs_for_service(service):
    s = (service or "").lower()
    if "citizen" in s:
        return DOC_TEMPLATES["citizenship"]
    if "work permit" in s:
        return DOC_TEMPLATES["work"]
    if "study" in s or "student" in s:
        return DOC_TEMPLATES["study"]
    if "residence" in s:
        return DOC_TEMPLATES["residence"]
    if "verification" in s:
        return DOC_TEMPLATES["verification"]
    if "visa" in s:
        return DOC_TEMPLATES["visa"]
    return DOC_TEMPLATES["default"]


# ---------------------------------------------------------------- time
def now():
    return dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def today():
    return dt.datetime.utcnow().strftime("%Y-%m-%d")


def days_from_now(n):
    return (dt.datetime.utcnow() + dt.timedelta(days=n)).strftime("%Y-%m-%d")


def parse_date(s):
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M",
                "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y"):
        try:
            return dt.datetime.strptime(str(s)[:len(fmt) + 2].strip()[:19], fmt)
        except ValueError:
            continue
    return None


def days_until(datestr):
    d = parse_date(datestr)
    if not d:
        return None
    return (d.date() - dt.date.today()).days


# ---------------------------------------------------------------- passwords
def hash_password(password, salt=None, rounds=120_000):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), rounds)
    return f"pbkdf2${rounds}${salt}${base64.b64encode(dk).decode()}"


def verify_password(password, stored):
    try:
        algo, rounds, salt, _ = stored.split("$", 3)
        if algo != "pbkdf2":
            return False
        return hmac.compare_digest(hash_password(password, salt, int(rounds)),
                                   stored)
    except Exception:
        return False


def password_problem(pw):
    if not pw or len(pw) < 10:
        return "Use at least 10 characters."
    if pw.isalpha() or pw.isdigit():
        return "Mix letters with numbers or symbols."
    return None


# ---------------------------------------------------------------- settings
DEFAULT_SETTINGS = {
    "org_name": "Migration Advisory Centre",
    "org_parent": "A Division of Right Fit Evidence Pty Ltd",
    "org_email": "info@maclesotho.com",
    "org_phone": "+266 6250 5116",
    "org_phone_alt": "+266 6272 2040",
    "org_address": "Maseru East, Maseru 100, Lesotho",
    "currency": "LSL",
    "consultation_fee": "0",
    "expiry_warn_days": "60",
    "task_overdue_grace": "0",
    "intake_api_key": "",
    "allowed_origins": "https://maclesotho.com,https://www.maclesotho.com",
}


def get_settings(conn):
    rows = conn.query("SELECT key, value FROM settings")
    s = dict(DEFAULT_SETTINGS)
    s.update({r["key"]: r["value"] for r in rows})
    return s


def set_setting(conn, key, value):
    exists = conn.one("SELECT key FROM settings WHERE key = ?", (key,))
    if exists:
        conn.execute("UPDATE settings SET value = ? WHERE key = ?", (str(value), key))
    else:
        conn.execute("INSERT INTO settings (key, value) VALUES (?, ?)",
                     (key, str(value)))


# ---------------------------------------------------------------- references
def next_ref(conn, table, prefix):
    year = dt.date.today().year
    like = f"{prefix}-{year}-%"
    row = conn.one(
        f"SELECT ref FROM {table} WHERE ref LIKE ? ORDER BY ref DESC LIMIT 1",
        (like,))
    n = 1
    if row and row["ref"]:
        try:
            n = int(str(row["ref"]).rsplit("-", 1)[-1]) + 1
        except ValueError:
            n = 1
    return f"{prefix}-{year}-{n:04d}"


# ---------------------------------------------------------------- audit
def audit(conn, user, action, detail="", ip=""):
    conn.execute(
        "INSERT INTO audit (user_id, user_email, action, detail, ip, created_at) "
        "VALUES (?,?,?,?,?,?)",
        ((user or {}).get("id"), (user or {}).get("email", ""), action,
         str(detail)[:500], ip or "", now()))


def log_event(conn, user, kind, body, client_id=None, case_id=None,
              from_stage="", to_stage=""):
    conn.execute(
        "INSERT INTO events (client_id, case_id, kind, body, from_stage, "
        "to_stage, user_id, user_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (client_id, case_id, kind, str(body)[:2000], from_stage, to_stage,
         (user or {}).get("id"), (user or {}).get("name", "System"), now()))


# ---------------------------------------------------------------- sessions
def new_session(conn, user, ip=""):
    token = secrets.token_urlsafe(32)
    expires = (dt.datetime.utcnow() + dt.timedelta(hours=SESSION_HOURS)
               ).strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "INSERT INTO sessions (token, user_id, ip, created_at, expires_at) "
        "VALUES (?,?,?,?,?)", (token, user["id"], ip, now(), expires))
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now(),))
    return token, expires


def user_for_token(conn, token):
    if not token:
        return None
    row = conn.one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ? AND s.expires_at > ?", (token, now()))
    if not row or not row.get("active"):
        return None
    return row


def public_user(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"],
            "role": u["role"], "phone": u.get("phone", ""),
            "must_change": bool(u.get("must_change")),
            "last_login": u.get("last_login", "")}


# ---------------------------------------------------------------- seeding
def seed(conn):
    create_admin = not conn.one("SELECT id FROM users LIMIT 1")
    if create_admin:
        conn.execute(
            "INSERT INTO users (email, name, role, password_hash, must_change, "
            "active, created_at) VALUES (?,?,?,?,?,?,?)",
            (SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, "owner",
             hash_password(SEED_ADMIN_PASSWORD), 0, 1, now()))

    s = get_settings(conn)
    for k, v in DEFAULT_SETTINGS.items():
        if k not in s or s.get(k) is None:
            set_setting(conn, k, v)
    if not s.get("intake_api_key"):
        key = os.environ.get("INTAKE_API_KEY", "").strip() or \
            "mac_live_" + secrets.token_hex(16)
        set_setting(conn, "intake_api_key", key)
    elif os.environ.get("INTAKE_API_KEY", "").strip():
        set_setting(conn, "intake_api_key", os.environ["INTAKE_API_KEY"].strip())
    conn.commit()
    return create_admin


def allowed_origins(conn):
    raw = get_settings(conn).get("allowed_origins", "")
    extra = os.environ.get("ALLOWED_ORIGINS", "")
    out = []
    for part in (raw + "," + extra).split(","):
        p = part.strip().rstrip("/")
        if p and p not in out:
            out.append(p)
    return out


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def jdump(obj):
    return json.dumps(obj, default=str)
