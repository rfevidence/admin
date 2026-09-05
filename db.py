"""
Database layer for the MAC CRM.

One SQL dialect is written throughout the app (SQLite flavour, `?` placeholders).
This module translates it to PostgreSQL when DATABASE_URL is set, so the same
code runs locally on SQLite and on Neon in production.

  DATABASE_URL         Neon  -> primary. Every read and write goes here.
  MIRROR_DATABASE_URL  Supabase -> backup. Receives a full copy on a timer.
"""
import os
import re
import sqlite3
import threading
import time
import traceback

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
MIRROR_DATABASE_URL = os.environ.get("MIRROR_DATABASE_URL", "").strip()
DB_PATH = os.environ.get("DB_PATH", "maccrm.db")
MIRROR_EVERY_MIN = int(os.environ.get("MIRROR_EVERY_MIN", "30") or 30)

IS_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))
HAS_MIRROR = bool(MIRROR_DATABASE_URL)


def _psycopg():
    try:
        import psycopg  # noqa
        return psycopg
    except ImportError:
        raise SystemExit(
            "DATABASE_URL is set but the PostgreSQL driver is missing.\n"
            "Add  psycopg[binary]  to requirements.txt and redeploy."
        )


# --------------------------------------------------------------------------
# SQL translation:  ?  ->  %s   (leaving quoted string literals alone)
# --------------------------------------------------------------------------
def translate(sql):
    out, in_str, quote = [], False, ""
    for ch in sql:
        if in_str:
            out.append(ch)
            if ch == quote:
                in_str = False
            continue
        if ch in ("'", '"'):
            in_str, quote = True, ch
            out.append(ch)
            continue
        out.append("%s" if ch == "?" else ch)
    return "".join(out)


class Conn:
    """Thin wrapper giving both engines one identical interface."""

    def __init__(self, raw, is_pg):
        self.raw = raw
        self.is_pg = is_pg

    # -- low level ---------------------------------------------------------
    def execute(self, sql, params=()):
        cur = self.raw.cursor()
        cur.execute(translate(sql) if self.is_pg else sql, tuple(params))
        return cur

    def query(self, sql, params=()):
        cur = self.execute(sql, params)
        rows = cur.fetchall()
        cur.close()
        return [dict(r) for r in rows]

    def one(self, sql, params=()):
        cur = self.execute(sql, params)
        row = cur.fetchone()
        cur.close()
        return dict(row) if row is not None else None

    def scalar(self, sql, params=(), default=0):
        r = self.one(sql, params)
        if not r:
            return default
        v = list(r.values())[0]
        return default if v is None else v

    def insert(self, sql, params=()):
        """INSERT returning the new row id."""
        if self.is_pg:
            cur = self.raw.cursor()
            cur.execute(translate(sql) + " RETURNING id", tuple(params))
            new_id = cur.fetchone()["id"]
            cur.close()
            return new_id
        cur = self.raw.cursor()
        cur.execute(sql, tuple(params))
        new_id = cur.lastrowid
        cur.close()
        return new_id

    def commit(self):
        self.raw.commit()

    def rollback(self):
        try:
            self.raw.rollback()
        except Exception:
            pass

    def close(self):
        try:
            self.raw.close()
        except Exception:
            pass


def _open_pg(dsn):
    psycopg = _psycopg()
    from psycopg.rows import dict_row
    raw = psycopg.connect(dsn, row_factory=dict_row, autocommit=False,
                          connect_timeout=15)
    return Conn(raw, True)


def _open_sqlite(path):
    raw = sqlite3.connect(path, timeout=20)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys=ON")
    raw.execute("PRAGMA journal_mode=WAL")
    return Conn(raw, False)


def connect(dsn=None):
    """Open a connection to the primary (or to an explicit dsn)."""
    target = dsn if dsn is not None else DATABASE_URL
    if target:
        last = None
        for attempt in range(3):
            try:
                return _open_pg(target)
            except Exception as exc:          # cold Neon branch / dropped socket
                last = exc
                time.sleep(0.6 * (attempt + 1))
        raise last
    return _open_sqlite(DB_PATH)


# ==========================================================================
# SCHEMA
# ==========================================================================
PK = "SERIAL PRIMARY KEY" if IS_PG else "INTEGER PRIMARY KEY AUTOINCREMENT"

TABLES = [
    ("users", f"""
        id            {PK},
        email         TEXT UNIQUE NOT NULL,
        name          TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'admin',
        phone         TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        must_change   INTEGER NOT NULL DEFAULT 0,
        active        INTEGER NOT NULL DEFAULT 1,
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until  TEXT DEFAULT '',
        last_login    TEXT DEFAULT '',
        created_at    TEXT NOT NULL
    """),
    ("sessions", f"""
        id         {PK},
        token      TEXT UNIQUE NOT NULL,
        user_id    INTEGER NOT NULL,
        ip         TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    """),
    ("enquiries", f"""
        id                {PK},
        ref               TEXT UNIQUE NOT NULL,
        first_name        TEXT DEFAULT '',
        last_name         TEXT DEFAULT '',
        email             TEXT DEFAULT '',
        phone             TEXT DEFAULT '',
        occupation        TEXT DEFAULT '',
        address           TEXT DEFAULT '',
        nationality       TEXT DEFAULT '',
        country_residence TEXT DEFAULT '',
        service           TEXT DEFAULT '',
        destination       TEXT DEFAULT '',
        permit_status     TEXT DEFAULT '',
        years_in_lesotho  TEXT DEFAULT '',
        criminal_record   TEXT DEFAULT '',
        prior_rejection   TEXT DEFAULT '',
        message           TEXT DEFAULT '',
        consent           INTEGER NOT NULL DEFAULT 0,
        source            TEXT DEFAULT 'website',
        status            TEXT NOT NULL DEFAULT 'new',
        client_id         INTEGER,
        assigned_to       INTEGER,
        ip                TEXT DEFAULT '',
        user_agent        TEXT DEFAULT '',
        created_at        TEXT NOT NULL,
        reviewed_at       TEXT DEFAULT ''
    """),
    ("clients", f"""
        id                {PK},
        ref               TEXT UNIQUE NOT NULL,
        first_name        TEXT NOT NULL,
        last_name         TEXT NOT NULL,
        email             TEXT DEFAULT '',
        phone             TEXT DEFAULT '',
        alt_phone         TEXT DEFAULT '',
        occupation        TEXT DEFAULT '',
        address           TEXT DEFAULT '',
        nationality       TEXT DEFAULT '',
        country_residence TEXT DEFAULT '',
        date_of_birth     TEXT DEFAULT '',
        gender            TEXT DEFAULT '',
        passport_no       TEXT DEFAULT '',
        passport_expiry   TEXT DEFAULT '',
        permit_status     TEXT DEFAULT '',
        permit_expiry     TEXT DEFAULT '',
        years_in_lesotho  TEXT DEFAULT '',
        notes             TEXT DEFAULT '',
        status            TEXT NOT NULL DEFAULT 'active',
        enquiry_id        INTEGER,
        created_by        INTEGER,
        created_at        TEXT NOT NULL,
        updated_at        TEXT DEFAULT ''
    """),
    ("cases", f"""
        id            {PK},
        ref           TEXT UNIQUE NOT NULL,
        client_id     INTEGER NOT NULL,
        service       TEXT NOT NULL,
        destination   TEXT DEFAULT '',
        stage         TEXT NOT NULL DEFAULT 'Enquiry',
        outcome       TEXT DEFAULT '',
        priority      TEXT NOT NULL DEFAULT 'normal',
        advisor_id    INTEGER,
        fee_total     REAL NOT NULL DEFAULT 0,
        currency      TEXT NOT NULL DEFAULT 'LSL',
        authority_ref TEXT DEFAULT '',
        target_date   TEXT DEFAULT '',
        submitted_at  TEXT DEFAULT '',
        decision_at   TEXT DEFAULT '',
        closed        INTEGER NOT NULL DEFAULT 0,
        notes         TEXT DEFAULT '',
        opened_at     TEXT NOT NULL,
        updated_at    TEXT DEFAULT ''
    """),
    ("case_documents", f"""
        id         {PK},
        case_id    INTEGER NOT NULL,
        name       TEXT NOT NULL,
        required   INTEGER NOT NULL DEFAULT 1,
        status     TEXT NOT NULL DEFAULT 'pending',
        expiry     TEXT DEFAULT '',
        link       TEXT DEFAULT '',
        note       TEXT DEFAULT '',
        updated_by INTEGER,
        updated_at TEXT DEFAULT ''
    """),
    ("payments", f"""
        id          {PK},
        client_id   INTEGER NOT NULL,
        case_id     INTEGER,
        amount      REAL NOT NULL,
        currency    TEXT NOT NULL DEFAULT 'LSL',
        kind        TEXT NOT NULL DEFAULT 'consultation',
        method      TEXT DEFAULT '',
        reference   TEXT DEFAULT '',
        paid_on     TEXT NOT NULL,
        note        TEXT DEFAULT '',
        voided      INTEGER NOT NULL DEFAULT 0,
        recorded_by INTEGER,
        created_at  TEXT NOT NULL
    """),
    ("appointments", f"""
        id           {PK},
        client_id    INTEGER,
        case_id      INTEGER,
        title        TEXT NOT NULL,
        starts_at    TEXT NOT NULL,
        duration_min INTEGER NOT NULL DEFAULT 45,
        location     TEXT DEFAULT 'MAC office, Maseru East',
        advisor_id   INTEGER,
        status       TEXT NOT NULL DEFAULT 'scheduled',
        note         TEXT DEFAULT '',
        created_by   INTEGER,
        created_at   TEXT NOT NULL
    """),
    ("tasks", f"""
        id          {PK},
        title       TEXT NOT NULL,
        detail      TEXT DEFAULT '',
        due_date    TEXT DEFAULT '',
        client_id   INTEGER,
        case_id     INTEGER,
        assigned_to INTEGER,
        priority    TEXT NOT NULL DEFAULT 'normal',
        status      TEXT NOT NULL DEFAULT 'open',
        created_by  INTEGER,
        created_at  TEXT NOT NULL,
        done_at     TEXT DEFAULT ''
    """),
    ("events", f"""
        id         {PK},
        client_id  INTEGER,
        case_id    INTEGER,
        kind       TEXT NOT NULL DEFAULT 'note',
        body       TEXT DEFAULT '',
        from_stage TEXT DEFAULT '',
        to_stage   TEXT DEFAULT '',
        user_id    INTEGER,
        user_name  TEXT DEFAULT '',
        created_at TEXT NOT NULL
    """),
    ("audit", f"""
        id         {PK},
        user_id    INTEGER,
        user_email TEXT DEFAULT '',
        action     TEXT NOT NULL,
        detail     TEXT DEFAULT '',
        ip         TEXT DEFAULT '',
        created_at TEXT NOT NULL
    """),
    ("settings", """
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
    """),
    ("ingest_log", f"""
        id         {PK},
        ok         INTEGER NOT NULL DEFAULT 1,
        reason     TEXT DEFAULT '',
        ip         TEXT DEFAULT '',
        payload    TEXT DEFAULT '',
        created_at TEXT NOT NULL
    """),
    ("counters", """
        name  TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
    """),
]

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_sess_token   ON sessions(token)",
    "CREATE INDEX IF NOT EXISTS ix_enq_status   ON enquiries(status)",
    "CREATE INDEX IF NOT EXISTS ix_enq_created  ON enquiries(created_at)",
    "CREATE INDEX IF NOT EXISTS ix_cli_name     ON clients(last_name, first_name)",
    "CREATE INDEX IF NOT EXISTS ix_case_client  ON cases(client_id)",
    "CREATE INDEX IF NOT EXISTS ix_case_stage   ON cases(stage)",
    "CREATE INDEX IF NOT EXISTS ix_doc_case     ON case_documents(case_id)",
    "CREATE INDEX IF NOT EXISTS ix_pay_client   ON payments(client_id)",
    "CREATE INDEX IF NOT EXISTS ix_pay_case     ON payments(case_id)",
    "CREATE INDEX IF NOT EXISTS ix_task_status  ON tasks(status, due_date)",
    "CREATE INDEX IF NOT EXISTS ix_ev_client    ON events(client_id)",
    "CREATE INDEX IF NOT EXISTS ix_ev_case      ON events(case_id)",
    "CREATE INDEX IF NOT EXISTS ix_appt_start   ON appointments(starts_at)",
    "CREATE INDEX IF NOT EXISTS ix_audit_time   ON audit(created_at)",
]

TABLE_NAMES = [t[0] for t in TABLES]


def create_schema(conn):
    for name, cols in TABLES:
        conn.execute(f"CREATE TABLE IF NOT EXISTS {name} ({cols})")
    for ix in INDEXES:
        conn.execute(ix)
    conn.commit()


# ==========================================================================
# MIRROR  (primary -> Supabase standby)
# ==========================================================================
_mirror_state = {
    "last_run": "", "last_ok": None, "last_error": "",
    "rows": 0, "running": False, "target": "Supabase",
}


def mirror_state():
    return dict(_mirror_state)


def host_of(dsn):
    m = re.search(r"@([^/:?]+)", dsn or "")
    return m.group(1) if m else ""


def run_mirror():
    """Copy every table from the primary into the standby. Full replace."""
    if not HAS_MIRROR:
        return {"ok": False, "error": "MIRROR_DATABASE_URL is not set."}
    if _mirror_state["running"]:
        return {"ok": False, "error": "A copy is already running."}
    _mirror_state["running"] = True
    src = dst = None
    started = time.time()
    try:
        src = connect()
        dst = _open_pg(MIRROR_DATABASE_URL)
        # standby uses the same shape
        pk_backup = "SERIAL PRIMARY KEY"
        for name, cols in TABLES:
            dst.execute(f"CREATE TABLE IF NOT EXISTS {name} "
                        f"({cols.replace(PK, pk_backup)})")
        dst.commit()

        total = 0
        for name in TABLE_NAMES:
            rows = src.query(f"SELECT * FROM {name}")
            dst.execute(f"DELETE FROM {name}")
            if rows:
                cols = list(rows[0].keys())
                ph = ",".join(["?"] * len(cols))
                sql = f"INSERT INTO {name} ({','.join(cols)}) VALUES ({ph})"
                for r in rows:
                    dst.execute(sql, [r[c] for c in cols])
                total += len(rows)
            # keep identity sequences ahead of the copied ids
            if "id" in (rows[0].keys() if rows else []):
                dst.execute(
                    f"SELECT setval(pg_get_serial_sequence('{name}','id'), "
                    f"GREATEST((SELECT COALESCE(MAX(id),1) FROM {name}),1))")
        dst.commit()
        _mirror_state.update(
            last_run=time.strftime("%Y-%m-%d %H:%M:%S"), last_ok=True,
            last_error="", rows=total,
            seconds=round(time.time() - started, 1))
        return {"ok": True, "rows": total,
                "seconds": round(time.time() - started, 1)}
    except Exception as exc:
        msg = f"{type(exc).__name__}: {exc}"[:400]
        if dst:
            dst.rollback()
        _mirror_state.update(last_run=time.strftime("%Y-%m-%d %H:%M:%S"),
                             last_ok=False, last_error=msg)
        return {"ok": False, "error": msg}
    finally:
        _mirror_state["running"] = False
        for c in (src, dst):
            if c:
                c.close()


def start_mirror_thread():
    if not HAS_MIRROR:
        return

    def loop():
        time.sleep(60)                      # let the app finish booting
        while True:
            try:
                run_mirror()
            except Exception:
                traceback.print_exc()
            time.sleep(max(5, MIRROR_EVERY_MIN) * 60)

    threading.Thread(target=loop, daemon=True, name="mirror").start()


def probe(dsn):
    """Is this database reachable, and how big is it?"""
    if not dsn:
        return {"configured": False}
    c = None
    try:
        c = _open_pg(dsn)
        size = c.scalar("SELECT pg_database_size(current_database()) AS s", (), 0)
        counts = {}
        for name in TABLE_NAMES:
            try:
                counts[name] = c.scalar(f"SELECT COUNT(*) AS n FROM {name}", (), 0)
            except Exception:
                c.rollback()
                counts[name] = None
        return {"configured": True, "reachable": True, "host": host_of(dsn),
                "used_mb": round((size or 0) / 1048576.0, 2), "counts": counts}
    except Exception as exc:
        return {"configured": True, "reachable": False, "host": host_of(dsn),
                "error": f"{type(exc).__name__}: {exc}"[:300]}
    finally:
        if c:
            c.close()
