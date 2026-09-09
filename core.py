"""Auth, settings, reference numbers, audit trail and first-run seeding."""
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
import time

import db

VERSION = "v1.0"
APP_NAME = "MAC Admin Portal"

SEED_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@maclesotho.com").strip().lower()
# No default password lives in the source. If ADMIN_PASSWORD is not set, a
# strong one is generated at first boot and printed once to the service log,
# and the account is required to change it on first sign in.
SEED_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "").strip()
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

# Countries, so nobody types "Zim", "zimbabwe" and "Zimbabwe " into the same
# field. Lesotho and its neighbours sit at the top because that is most of the
# casework; the rest follow alphabetically.
COUNTRIES_COMMON = [
    "Lesotho", "South Africa", "Zimbabwe", "Mozambique", "Botswana",
    "Eswatini", "Namibia", "Zambia", "Malawi",
]
COUNTRIES_REST = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola",
    "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria",
    "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus",
    "Belgium", "Belize", "Benin", "Bhutan", "Bolivia",
    "Bosnia and Herzegovina", "Brazil", "Brunei", "Bulgaria", "Burkina Faso",
    "Burundi", "Cambodia", "Cameroon", "Canada", "Cape Verde",
    "Central African Republic", "Chad", "Chile", "China", "Colombia",
    "Comoros", "Congo (Brazzaville)", "Congo (Kinshasa)", "Costa Rica",
    "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominica",
    "Dominican Republic", "Ecuador", "Egypt", "El Salvador",
    "Equatorial Guinea", "Eritrea", "Estonia", "Ethiopia", "Fiji", "Finland",
    "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece",
    "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti",
    "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq",
    "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan",
    "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan",
    "Laos", "Latvia", "Lebanon", "Liberia", "Libya", "Liechtenstein",
    "Lithuania", "Luxembourg", "Madagascar", "Malaysia", "Maldives", "Mali",
    "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico",
    "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
    "Myanmar", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua",
    "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman",
    "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea",
    "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
    "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
    "Saint Vincent and the Grenadines", "Samoa", "San Marino",
    "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia",
    "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia",
    "Solomon Islands", "Somalia", "South Korea", "South Sudan", "Spain",
    "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
    "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo",
    "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan",
    "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
    "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City",
    "Venezuela", "Vietnam", "Yemen",
]
COUNTRIES = COUNTRIES_COMMON + sorted(COUNTRIES_REST)

# Nationalities are asked for separately on the form, but the country list is
# what people actually pick from, so keep one list and let the field label do
# the work.

# Nationality is asked as a demonym ("Zimbabwean"), which is what the website
# form already collects, so the two stay compatible. Countries are a separate
# list for residence and destination.
NATIONALITIES_COMMON = [
    "Mosotho", "South African", "Zimbabwean", "Mozambican", "Motswana",
    "Liswati", "Namibian", "Zambian", "Malawian",
]
NATIONALITIES_REST = [
    "Afghan", "Albanian", "Algerian", "American", "Andorran", "Angolan",
    "Antiguan", "Argentine", "Armenian", "Australian", "Austrian",
    "Azerbaijani", "Bahamian", "Bahraini", "Bangladeshi", "Barbadian",
    "Belarusian", "Belgian", "Belizean", "Beninese", "Bhutanese", "Bolivian",
    "Bosnian", "Brazilian", "British", "Bruneian", "Bulgarian", "Burkinabe",
    "Burmese", "Burundian", "Cambodian", "Cameroonian", "Canadian",
    "Cape Verdean", "Central African", "Chadian", "Chilean", "Chinese",
    "Colombian", "Comoran", "Congolese", "Costa Rican", "Croatian", "Cuban",
    "Cypriot", "Czech", "Danish", "Djiboutian", "Dominican", "Dutch",
    "Ecuadorian", "Egyptian", "Emirati", "Equatorial Guinean", "Eritrean",
    "Estonian", "Ethiopian", "Fijian", "Filipino", "Finnish", "French",
    "Gabonese", "Gambian", "Georgian", "German", "Ghanaian", "Greek",
    "Grenadian", "Guatemalan", "Guinean", "Guyanese", "Haitian", "Honduran",
    "Hungarian", "Icelandic", "Indian", "Indonesian", "Iranian", "Iraqi",
    "Irish", "Israeli", "Italian", "Ivorian", "Jamaican", "Japanese",
    "Jordanian", "Kazakh", "Kenyan", "Kittitian", "Kosovar", "Kuwaiti",
    "Kyrgyz", "Laotian", "Latvian", "Lebanese", "Liberian", "Libyan",
    "Liechtensteiner", "Lithuanian", "Luxembourgish", "Macedonian",
    "Malagasy", "Malaysian", "Maldivian", "Malian", "Maltese", "Marshallese",
    "Mauritanian", "Mauritian", "Mexican", "Micronesian", "Moldovan",
    "Monacan", "Mongolian", "Montenegrin", "Moroccan", "Nauruan", "Nepali",
    "New Zealander", "Nicaraguan", "Nigerian", "Nigerien", "North Korean",
    "Norwegian", "Omani", "Pakistani", "Palauan", "Palestinian", "Panamanian",
    "Papua New Guinean", "Paraguayan", "Peruvian", "Polish", "Portuguese",
    "Qatari", "Romanian", "Russian", "Rwandan", "Saint Lucian", "Salvadoran",
    "Sammarinese", "Samoan", "Sao Tomean", "Saudi", "Senegalese", "Serbian",
    "Seychellois", "Sierra Leonean", "Singaporean", "Slovak", "Slovenian",
    "Solomon Islander", "Somali", "South Korean", "South Sudanese", "Spanish",
    "Sri Lankan", "Sudanese", "Surinamese", "Swedish", "Swiss", "Syrian",
    "Taiwanese", "Tajik", "Tanzanian", "Thai", "Timorese", "Togolese",
    "Tongan", "Trinidadian", "Tunisian", "Turkish", "Turkmen", "Tuvaluan",
    "Ugandan", "Ukrainian", "Uruguayan", "Uzbek", "Vanuatuan", "Vatican",
    "Venezuelan", "Vietnamese", "Vincentian", "Yemeni",
]
NATIONALITIES = NATIONALITIES_COMMON + sorted(NATIONALITIES_REST)

# With this as the current status there is nothing to expire, so the expiry
# field is switched off and reads "n/a". A blank status means "not stated yet",
# which is not the same thing — a date typed there is kept, not discarded.
NO_PERMIT_STATUSES = {"No current permit"}


def permit_expiry_applies(status):
    return str(status or "").strip() not in NO_PERMIT_STATUSES


EMAIL_RE = __import__("re").compile(
    r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


def email_problem(value, required=False):
    """None when the address is acceptable, otherwise what is wrong with it."""
    v = str(value or "").strip()
    if not v:
        return "An email address is required." if required else None
    if len(v) > 200:
        return "That email address is too long."
    if not EMAIL_RE.match(v):
        return "That email address does not look right — check for a typo."
    return None


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
    "tracking_enabled": "1",
    "smtp_host": "smtp.zoho.com",
    "smtp_port": "465",
    "smtp_user": "",
    "smtp_pass": "",
    "smtp_from": "",
    "reminders_enabled": "0",
    "reminder_minutes": "30",
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
# ==========================================================================
# TWO-STEP SIGN IN  (TOTP, the standard behind Google Authenticator and Authy)
# ==========================================================================
import base64 as _b64
import hmac as _hmac
import struct as _struct

TOTP_STEP = 30          # seconds per code, as every authenticator app expects
TOTP_DIGITS = 6
TOTP_DRIFT = 1          # accept the code either side, for slow clocks


def new_totp_secret():
    """A base32 secret, the format authenticator apps read."""
    return _b64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_at(secret, counter):
    key = _b64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = _hmac.new(key, _struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = _struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10 ** TOTP_DIGITS)).zfill(TOTP_DIGITS)


def totp_verify(secret, code, at=None):
    """True when the code matches now, or one step either side."""
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if not secret or len(code) != TOTP_DIGITS:
        return False
    counter = int((at if at is not None else time.time()) // TOTP_STEP)
    for drift in range(-TOTP_DRIFT, TOTP_DRIFT + 1):
        if _hmac.compare_digest(totp_at(secret, counter + drift), code):
            return True
    return False


def otpauth_uri(secret, email, issuer):
    from urllib.parse import quote
    label = quote(f"{issuer}:{email}")
    return (f"otpauth://totp/{label}?secret={secret}"
            f"&issuer={quote(issuer)}&algorithm=SHA1"
            f"&digits={TOTP_DIGITS}&period={TOTP_STEP}")


def qr_svg(data):
    """The pairing code as an SVG, so no image library is needed."""
    import io
    import qrcode
    import qrcode.image.svg
    q = qrcode.QRCode(box_size=9, border=2,
                      error_correction=qrcode.constants.ERROR_CORRECT_M)
    q.add_data(data)
    q.make(fit=True)
    buf = io.BytesIO()
    q.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(buf)
    svg = buf.getvalue().decode("utf-8")
    return svg[svg.index("<svg"):]          # drop the XML declaration


# ---- recovery codes, for the day the phone is lost --------------------
def make_recovery_codes(conn, user_id, count=8):
    conn.execute("DELETE FROM recovery_codes WHERE user_id = ?", (user_id,))
    plain = []
    for _ in range(count):
        raw = secrets.token_hex(4).upper()
        code = raw[:4] + "-" + raw[4:]
        plain.append(code)
        conn.execute(
            "INSERT INTO recovery_codes (user_id, code_hash, created_at) "
            "VALUES (?,?,?)", (user_id, hash_password(code), now()))
    return plain


def use_recovery_code(conn, user_id, code):
    code = str(code or "").strip().upper()
    if not code:
        return False
    for row in conn.query(
            "SELECT id, code_hash FROM recovery_codes "
            "WHERE user_id = ? AND used_at = ''", (user_id,)):
        if verify_password(code, row["code_hash"]):
            conn.execute("UPDATE recovery_codes SET used_at = ? WHERE id = ?",
                         (now(), row["id"]))
            return True
    return False


def recovery_codes_left(conn, user_id):
    return conn.scalar(
        "SELECT COUNT(*) AS n FROM recovery_codes "
        "WHERE user_id = ? AND used_at = ''", (user_id,))


# ==========================================================================
# CONSULTATION REMINDERS BY EMAIL
# ==========================================================================
def send_email(settings, to_addr, subject, body):
    """Send one message over SMTP. Returns None on success, else the reason."""
    import smtplib
    import ssl
    from email.message import EmailMessage

    host = (settings.get("smtp_host") or "").strip()
    user = (settings.get("smtp_user") or "").strip()
    password = settings.get("smtp_pass") or ""
    if not (host and user and password):
        return "Email is not set up: host, username and password are all needed."
    try:
        port = int(settings.get("smtp_port") or 465)
    except ValueError:
        port = 465

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = (settings.get("smtp_from") or user).strip()
    msg["To"] = to_addr
    msg.set_content(body)
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=25,
                                  context=ssl.create_default_context()) as smtp:
                smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=25) as smtp:
                smtp.ehlo()
                if port in (587, 25):
                    try:
                        smtp.starttls(context=ssl.create_default_context())
                        smtp.ehlo()
                    except Exception:
                        pass          # a server that does not offer TLS
                smtp.login(user, password)
                smtp.send_message(msg)
        return None
    except Exception as exc:
        return f"{type(exc).__name__}: {exc}"[:300]


def due_reminders(conn, minutes_before, window=6):
    """Consultations starting in about `minutes_before` minutes.

    A window either side, because the sweep runs every few minutes rather than
    continuously. The sent flag stops anything going twice.
    """
    start = (dt.datetime.utcnow() + dt.timedelta(minutes=minutes_before - window)
             ).strftime("%Y-%m-%d %H:%M")
    end = (dt.datetime.utcnow() + dt.timedelta(minutes=minutes_before + window)
           ).strftime("%Y-%m-%d %H:%M")
    return conn.query(
        "SELECT a.*, c.first_name, c.last_name, c.phone, k.ref AS case_ref, "
        "u.name AS advisor_name FROM appointments a "
        "LEFT JOIN clients c ON c.id = a.client_id "
        "LEFT JOIN cases k ON k.id = a.case_id "
        "LEFT JOIN users u ON u.id = a.advisor_id "
        "WHERE a.status = 'scheduled' AND a.reminder_sent = '' "
        "AND a.starts_at >= ? AND a.starts_at <= ?", (start, end))


def reminder_text(appt, settings):
    who = ((appt.get("first_name") or "") + " " + (appt.get("last_name") or "")).strip()
    when = str(appt.get("starts_at") or "")
    lines = [
        f"A consultation starts at {when[11:16]} today.",
        "",
        f"  Client   : {who or 'no client attached'}",
        f"  About    : {appt.get('title') or 'Consultation'}",
        f"  Where    : {appt.get('location') or settings.get('org_address', '')}",
        f"  Minutes  : {appt.get('duration_min') or 45}",
    ]
    if appt.get("case_ref"):
        lines.append(f"  Case     : {appt['case_ref']}")
    if appt.get("advisor_name"):
        lines.append(f"  Advisor  : {appt['advisor_name']}")
    if appt.get("phone"):
        lines.append(f"  Telephone: {appt['phone']}")
    if appt.get("note"):
        lines += ["", str(appt["note"])]
    lines += ["", "— " + (settings.get("org_name") or APP_NAME) + " admin portal"]
    return "\n".join(lines)


def send_due_reminders(conn):
    """One sweep. Returns how many went out and anything that went wrong."""
    s = get_settings(conn)
    if s.get("reminders_enabled") != "1":
        return {"sent": 0, "skipped": "reminders are switched off"}
    to_addr = (s.get("org_email") or "").strip()
    if not to_addr:
        return {"sent": 0, "skipped": "no office email address is set"}
    try:
        minutes = int(s.get("reminder_minutes") or 30)
    except ValueError:
        minutes = 30

    sent, errors = 0, []
    for appt in due_reminders(conn, minutes):
        who = ((appt.get("first_name") or "") + " " + (appt.get("last_name") or "")).strip()
        subject = f"Consultation in {minutes} minutes" + (f" — {who}" if who else "")
        problem = send_email(s, to_addr, subject, reminder_text(appt, s))
        if problem:
            errors.append(problem)
            break                      # the next will fail the same way
        conn.execute("UPDATE appointments SET reminder_sent = ? WHERE id = ?",
                     (now(), appt["id"]))
        conn.commit()
        sent += 1
    return {"sent": sent, "errors": errors}


def is_duplicate_ref(exc):
    """True when an insert failed because the reference was already taken."""
    name = type(exc).__name__.lower()
    text = str(exc).lower()
    return ("integrityerror" in name or "uniqueviolation" in name
            or "unique constraint" in text or "duplicate key" in text)


def insert_with_ref(conn, table, prefix, build, attempts=10):
    """Insert a row carrying a generated reference, retrying on collision.

    Reference numbers are read-then-written, so two staff saving at the same
    moment — or two visitors submitting the website form together — can compute
    the same number. One insert wins and the other is rejected by the unique
    index. Retrying with a freshly read number turns that into a brief pause
    instead of a lost record.

    `build(ref)` returns the (sql, params) pair for the insert.
    """
    last = None
    for _ in range(attempts):
        ref = next_ref(conn, table, prefix)
        sql, params = build(ref)
        try:
            return ref, conn.insert(sql, params)
        except Exception as exc:
            if not is_duplicate_ref(exc):
                raise
            last = exc
            conn.rollback()      # Postgres aborts the whole transaction
    raise ApiError(503, "The system is unusually busy. Please try again.")


def next_ref(conn, table, prefix):
    """Allocate the next reference for the year, atomically.

    Reading the highest existing reference and adding one is a race: two
    requests arriving together read the same number and one insert is then
    rejected. Instead each prefix and year owns a row in `counters` which is
    incremented in a single statement, so concurrent callers are handed
    different numbers by the database itself.
    """
    year = dt.date.today().year
    key = f"{prefix}-{year}"

    # Seed from any references that already exist — this also carries an
    # existing database over the first time the counter is used.
    if not conn.one("SELECT name FROM counters WHERE name = ?", (key,)):
        row = conn.one(
            f"SELECT ref FROM {table} WHERE ref LIKE ? ORDER BY ref DESC LIMIT 1",
            (key + "-%",))
        start = 0
        if row and row["ref"]:
            try:
                start = int(str(row["ref"]).rsplit("-", 1)[-1])
            except ValueError:
                start = 0
        try:
            conn.execute("INSERT INTO counters (name, value) VALUES (?, ?)",
                         (key, start))
        except Exception:
            conn.rollback()      # another request seeded it a moment before

    n = conn.scalar(
        "UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value",
        (key,), None)
    if n is None:                # SQLite before 3.35 has no RETURNING
        conn.execute("UPDATE counters SET value = value + 1 WHERE name = ?", (key,))
        n = conn.scalar("SELECT value AS n FROM counters WHERE name = ?", (key,), 1)
    return f"{prefix}-{year}-{int(n):04d}"


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
def new_session(conn, user, ip="", pending=False):
    """Create a session.

    A pending session means the password was right but the six-digit code is
    still owed. It carries no access at all — user_for_token ignores it — and
    lives only a few minutes.
    """
    token = secrets.token_urlsafe(32)
    minutes = 5 if pending else SESSION_HOURS * 60
    expires = (dt.datetime.utcnow() + dt.timedelta(minutes=minutes)
               ).strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "INSERT INTO sessions (token, user_id, ip, created_at, expires_at, "
        "pending) VALUES (?,?,?,?,?,?)",
        (token, user["id"], ip, now(), expires, 1 if pending else 0))
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now(),))
    return token, expires


def user_for_token(conn, token):
    if not token:
        return None
    row = conn.one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ? AND s.expires_at > ? AND s.pending = 0",
        (token, now()))
    if not row or not row.get("active"):
        return None
    return row


def pending_session_user(conn, token):
    """The user behind a half-finished sign in, awaiting their code."""
    if not token:
        return None
    return conn.one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ? AND s.expires_at > ? AND s.pending = 1",
        (token, now()))


def public_user(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"],
            "role": u["role"], "phone": u.get("phone", ""),
            "must_change": bool(u.get("must_change")),
            "totp_enabled": bool(u.get("totp_enabled")),
            "last_login": u.get("last_login", "")}


# ---------------------------------------------------------------- seeding
GENERATED_PASSWORD = None


def seed(conn):
    global GENERATED_PASSWORD
    create_admin = not conn.one("SELECT id FROM users LIMIT 1")
    if create_admin:
        password = SEED_ADMIN_PASSWORD
        must_change = 0
        if not password:
            import secrets as _s
            password = "MAC-" + _s.token_urlsafe(12)
            GENERATED_PASSWORD = password
            must_change = 1
        conn.execute(
            "INSERT INTO users (email, name, role, password_hash, must_change, "
            "active, created_at) VALUES (?,?,?,?,?,?,?)",
            (SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, "owner",
             hash_password(password), must_change, 1, now()))

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
