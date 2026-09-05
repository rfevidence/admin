#!/usr/bin/env python3
"""
MAC Admin Portal — server entry point.

Runs on the Python standard library only (plus psycopg when DATABASE_URL is set),
so it boots in seconds on Render's free instance.

    python3 server.py
"""
import json
import mimetypes
import os
import sys
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import api
import core
import db
from core import ApiError

PORT = int(os.environ.get("PORT", "8500"))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
MAX_BODY = 512 * 1024

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")

_origin_lock = threading.Lock()
_origins_cache = {"list": [], "at": 0}


def cached_origins(conn):
    import time
    with _origin_lock:
        if time.time() - _origins_cache["at"] > 60:
            try:
                _origins_cache["list"] = core.allowed_origins(conn)
                _origins_cache["at"] = time.time()
            except Exception:
                pass
        return _origins_cache["list"]


class Handler(BaseHTTPRequestHandler):
    server_version = "MACPortal"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.client_address[0], fmt % args))

    # ---------------------------------------------------------------- utils
    @property
    def client_ip(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        if fwd:
            return fwd.split(",")[0].strip()[:60]
        return self.client_address[0]

    def send_body(self, status, payload, ctype="application/json",
                  extra_headers=None):
        if isinstance(payload, (dict, list)):
            payload = core.jdump(payload).encode()
        elif isinstance(payload, str):
            payload = payload.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if ctype.startswith("text/html"):
            self.send_header("X-Frame-Options", "SAMEORIGIN")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self._cors_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _cors_headers(self):
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if not origin:
            return
        allowed = getattr(self.server, "origins", [])
        if origin in allowed or "*" in allowed:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers",
                             "Content-Type, X-Api-Key, Authorization")
            self.send_header("Access-Control-Allow-Methods",
                             "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Max-Age", "86400")

    def fail(self, status, message):
        self.send_body(status, {"error": message})

    # ---------------------------------------------------------------- verbs
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_DELETE(self):
        self.dispatch("DELETE")

    # ---------------------------------------------------------------- core
    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ApiError(413, "That request is too large.")
        raw = self.rfile.read(length)
        ctype = (self.headers.get("Content-Type") or "").lower()
        if "application/json" in ctype or raw[:1] in (b"{", b"["):
            try:
                data = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                raise ApiError(400, "The request body was not valid JSON.")
            return data if isinstance(data, dict) else {"value": data}
        parsed = urllib.parse.parse_qs(raw.decode("utf-8", "replace"))
        return {k: v[0] for k, v in parsed.items()}

    def dispatch(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/healthz":
            return self.send_body(200, {"ok": True, "version": core.VERSION})

        if path == "/intake.js":
            return self.serve_intake_js()

        if path.startswith("/api/") or path.startswith("/export/"):
            return self.handle_api(method, path, qs)
        if method == "GET":
            return self.serve_static(path)
        self.fail(405, "Method not allowed.")

    def serve_intake_js(self):
        """The website loads this with a single <script> tag.

        It knows its own address and intake key, finds the consultation form,
        adds its own honeypot field, and posts a copy of every submission here
        without interfering with the site's existing EmailJS send.
        """
        conn = None
        try:
            conn = db.connect()
            key = core.get_settings(conn).get("intake_api_key", "")
        except Exception:
            key = ""
        finally:
            if conn:
                conn.close()

        origin = self.headers.get("Origin") or ""
        host = self.headers.get("Host") or ""
        # Render terminates TLS in front of us and sets this header; locally
        # there is no proxy and the service is plain HTTP.
        proto = self.headers.get("X-Forwarded-Proto")
        if not proto:
            proto = "http" if host.split(":")[0] in ("localhost", "127.0.0.1") else "https"
        base = (proto + "://" + host) if host else ""
        js = INTAKE_JS.replace("__CRM_URL__", base).replace("__CRM_KEY__", key)
        self.send_body(200, js, "application/javascript; charset=utf-8",
                       {"Cache-Control": "public, max-age=300",
                        "Access-Control-Allow-Origin": origin or "*"})

    def handle_api(self, method, path, qs):
        conn = None
        try:
            body = self.read_body() if method in ("POST", "DELETE") else {}
            conn = db.connect()
            self.server.origins = cached_origins(conn)

            token = (self.headers.get("Authorization") or "")
            token = token[7:].strip() if token.startswith("Bearer ") else token.strip()
            user = core.user_for_token(conn, token) if token else None
            ctx = api.Ctx(conn, user, body, qs, self.client_ip, self.headers)

            # CSV export lives outside the JSON routes
            if path.startswith("/export/"):
                if not user:
                    raise ApiError(401, "Sign in to continue.")
                key = path.split("/export/", 1)[1]
                frm = (qs.get("from") or ["2000-01-01"])[0]
                to = (qs.get("to") or [core.today()])[0]
                title, text = api.report_csv(ctx, key, frm, to)
                fname = f"MAC-{key}-{frm}-to-{to}.csv"
                return self.send_body(
                    200, text, "text/csv; charset=utf-8",
                    {"Content-Disposition": f'attachment; filename="{fname}"'})

            for rmethod, rx, fn, needs_auth in api.ROUTES:
                if rmethod != method:
                    continue
                m = rx.match(path)
                if not m:
                    continue
                if needs_auth and not user:
                    raise ApiError(401, "Sign in to continue.")
                result = fn(ctx, *m.groups())
                return self.send_body(200, result if result is not None else {"ok": True})

            self.fail(404, "That endpoint does not exist.")
        except ApiError as exc:
            if conn:
                conn.rollback()
            self.fail(exc.status, exc.message)
        except BrokenPipeError:
            pass
        except Exception:
            traceback.print_exc()
            if conn:
                conn.rollback()
            self.fail(500, "Something went wrong on the server. "
                           "The details are in the service log.")
        finally:
            if conn:
                conn.close()

    def setup_diagnosis(self):
        """Shown when the interface files are missing.

        The backend is running fine at this point — only static/ is absent,
        which almost always means the folder did not survive the upload to
        GitHub. Rather than a bare 404, say exactly what is where.
        """
        import html as _html
        root = os.path.dirname(os.path.abspath(__file__))
        try:
            at_root = sorted(os.listdir(root))
        except Exception:
            at_root = []
        try:
            in_static = sorted(os.listdir(STATIC))
        except Exception:
            in_static = None

        need = ["index.html", "app.css", "app.js"]
        loose = [f for f in need if f in at_root]
        have = [f for f in (in_static or []) if f in need]
        missing = [f for f in need if f not in (in_static or [])]

        if loose and in_static is None:
            verdict = ("The three interface files were uploaded to the top "
                       "level of the repository instead of into a folder "
                       "called <code>static</code>.")
            fix = ("On GitHub, open each of <code>" + "</code>, <code>".join(loose) +
                   "</code>, click the pencil icon, and change the filename at "
                   "the top to <code>static/" + loose[0] + "</code> (and so on "
                   "for each). Typing the slash creates the folder. Commit each "
                   "change; Render redeploys on its own.")
        elif in_static is None:
            verdict = ("There is no <code>static</code> folder in the "
                       "repository at all.")
            fix = ("On GitHub choose <b>Add file → Upload files</b>, then drag "
                   "in the <b>static folder itself</b> from the package — not "
                   "the three files inside it. Dragging the files individually "
                   "is what usually causes this.")
        else:
            verdict = ("The <code>static</code> folder exists but "
                       "<code>index.html</code> is not in it.")
            fix = ("Upload the missing file" + ("s" if len(missing) > 1 else "") +
                   " — <code>" + "</code>, <code>".join(missing) +
                   "</code> — into the <code>static</code> folder.")

        def lst(items):
            if items is None:
                return "<p class=none>(this folder does not exist)</p>"
            if not items:
                return "<p class=none>(empty)</p>"
            return "<ul>" + "".join(
                "<li>" + _html.escape(i) + "</li>" for i in items) + "</ul>"

        return """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MAC Admin Portal — setup incomplete</title><style>
body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
color:#15202C;background:#F6F7F9;margin:0;padding:32px 20px}
.box{max-width:760px;margin:0 auto;background:#fff;border:1px solid #E3E7ED;
border-radius:12px;padding:28px 32px}
h1{font-size:20px;margin:0 0 6px}h2{font-size:15px;margin:26px 0 8px}
.sub{color:#64738A;margin:0 0 20px}
.ok{background:#E6F4EC;color:#1E7F4F;border:1px solid #C4E3D2;padding:9px 12px;
border-radius:6px;font-size:14px}
.what{background:#FBF0DC;color:#A9700A;border:1px solid #EDD6A7;padding:12px 14px;
border-radius:6px;margin:16px 0}
.fix{background:#E8F0FB;color:#1B5FB0;border:1px solid #C6DAF3;padding:12px 14px;
border-radius:6px}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;
background:#F2F4F7;border:1px solid #E3E7ED;border-radius:4px;padding:1px 5px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:620px){.cols{grid-template-columns:1fr}}
ul{margin:6px 0;padding-left:20px}li{font-family:ui-monospace,Menlo,monospace;
font-size:13px}.none{color:#64738A;font-style:italic;font-size:13px}
.foot{color:#64738A;font-size:13px;margin-top:24px;border-top:1px solid #E3E7ED;
padding-top:16px}
</style></head><body><div class="box">
<h1>The portal is running, but its interface files are missing</h1>
<p class="sub">Migration Advisory Centre — admin portal</p>
<p class="ok"><b>Good news:</b> the server, the database and the website intake
endpoint are all working. Only the pages are absent, and that is a file layout
problem in the repository, not a fault in the deployment.</p>
<div class="what"><b>What is wrong.</b> """ + verdict + """</div>
<div class="fix"><b>How to fix it.</b> """ + fix + """</div>
<h2>What the server can actually see</h2>
<div class="cols">
<div><b>At the top level</b>""" + lst(at_root) + """</div>
<div><b>Inside <code>static</code></b>""" + lst(in_static) + """</div>
</div>
<p class="foot">The portal expects exactly three files in a folder named
<code>static</code>: <code>index.html</code>, <code>app.css</code> and
<code>app.js</code>. Once they are there, refresh this page and the sign-in
screen appears. Nothing else needs redeploying by hand.</p>
</div></body></html>"""

    ASSET_EXT = (".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".ico")

    def serve_static(self, path):
        rel = "index.html" if path == "/" else path.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC):
            return self.fail(403, "Forbidden.")

        # Images such as logo.png are commonly committed to the repository root
        # rather than into static/. Serve them from either place so the file
        # works wherever it was put.
        if not os.path.isfile(full) and rel.lower().endswith(self.ASSET_EXT):
            root = os.path.dirname(os.path.abspath(__file__))
            alt = os.path.normpath(os.path.join(root, rel))
            if alt.startswith(root) and os.path.isfile(alt):
                full = alt

        if not os.path.isfile(full):
            if rel.lower().endswith(self.ASSET_EXT):
                return self.fail(404, "Not found.")     # let the page's fallback run
            full = os.path.join(STATIC, "index.html")   # single page app
            if not os.path.isfile(full):
                return self.send_body(500, self.setup_diagnosis(),
                                      "text/html; charset=utf-8")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            data = fh.read()
        cache = "no-cache" if full.endswith("index.html") else "public, max-age=300"
        self.send_body(200, data, ctype, {"Cache-Control": cache})


INTAKE_JS = r"""/* MAC Admin Portal — website intake bridge.
   Loaded by maclesotho.com with a single <script> tag. Sends a copy of each
   consultation form submission to the portal. Never blocks or alters the
   site's own EmailJS send: if this fails, the visitor notices nothing. */
(function () {
  'use strict';
  var URL = '__CRM_URL__', KEY = '__CRM_KEY__';
  var SELECTOR = 'form';

  function collect(form) {
    var out = { source: 'website' }, f = form.querySelectorAll('input,select,textarea');
    for (var i = 0; i < f.length; i++) {
      var el = f[i], k = el.name || el.id;
      if (!k || el.type === 'submit' || el.type === 'button') continue;
      if (el.type === 'checkbox') {
        if (el.checked) out[k] = out[k] ? out[k] + ', ' + (el.value || 'Yes') : (el.value || 'Yes');
        else if (!(k in out)) out[k] = '';
      } else if (el.type === 'radio') {
        if (el.checked) out[k] = el.value;
      } else { out[k] = el.value; }
    }
    return out;
  }

  function send(form) {
    var body;
    try { body = JSON.stringify(collect(form)); } catch (e) { return; }
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    if (ctl) setTimeout(function () { ctl.abort(); }, 9000);
    fetch(URL + '/api/public/intake', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': KEY },
      body: body, signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (!r.ok) console.warn('[MAC] portal declined the enquiry:', r.status);
    }).catch(function () { /* silent: EmailJS is the visitor's guarantee */ });
  }

  function looksLikeIntake(form) {
    var t = (form.textContent || '') + ' ' + form.innerHTML;
    return /nationality|immigration|visa|permit|consultation|enquir/i.test(t) ||
           !!form.querySelector('[name*=nationality i],[name*=service i],[id*=nationality i]');
  }

  function honeypot(form) {
    if (form.querySelector('[name="website_url"]')) return;
    var wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:absolute;left:-9999px;top:-9999px;height:0;overflow:hidden';
    var inp = document.createElement('input');
    inp.type = 'text'; inp.name = 'website_url'; inp.tabIndex = -1;
    inp.setAttribute('autocomplete', 'off');
    wrap.appendChild(inp); form.appendChild(wrap);
  }

  function attach() {
    var forms = document.querySelectorAll(SELECTOR), bound = 0;
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      if (form.getAttribute('data-mac-bound')) continue;
      if (!form.hasAttribute('data-mac-intake') && !looksLikeIntake(form)) continue;
      form.setAttribute('data-mac-bound', '1');
      honeypot(form);
      form.addEventListener('submit', (function (f) {
        return function () {
          // This runs in the capture phase, before the site's own handler, so
          // preventDefault() cannot stop it. That also means it runs before
          // the site validates — so check validity here too, or a half-filled
          // form would reach the portal after the visitor was shown an error.
          if (typeof f.checkValidity === 'function' && !f.checkValidity()) return;
          send(f);
        };
      })(form), true);
      bound++;
    }
    if (!bound && !window.__macBound) console.warn('[MAC] no consultation ' +
      'form found. Add data-mac-intake to your form tag.');
    if (bound) window.__macBound = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else { attach(); }
  window.addEventListener('load', attach);   // catch forms added late
})();
"""


class Server(ThreadingHTTPServer):
    """ThreadingHTTPServer without the reverse-DNS lookup on bind.

    The stock class calls socket.getfqdn(), which blocks for many seconds on
    hosts with no working resolver — Render's containers included.
    """
    daemon_threads = True
    allow_reuse_address = True
    origins = []

    def handle_error(self, request, client_address):
        """Keep the log readable.

        A browser closing a tab, or Render's health checker hanging up, aborts
        the socket mid-request. Python's default is to print a full traceback,
        which makes routine disconnections look like faults in the log. Real
        errors are still caught and reported by the request handler itself.
        """
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError,
                            ConnectionAbortedError, TimeoutError)):
            return
        import traceback as _tb
        _tb.print_exc()

    def server_bind(self):
        import socketserver
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = str(host)
        self.server_port = port


def boot():
    conn = db.connect()
    db.create_schema(conn)
    fresh = core.seed(conn)
    s = core.get_settings(conn)
    origins = core.allowed_origins(conn)
    conn.close()

    print("=" * 64)
    print(f"  {core.APP_NAME} {core.VERSION}")
    print(f"  Storage : {'PostgreSQL — ' + db.host_of(db.DATABASE_URL) if db.IS_PG else 'SQLite file ' + db.DB_PATH}")
    print(f"  Backup  : {'Supabase — ' + db.host_of(db.MIRROR_DATABASE_URL) + f' (every {db.MIRROR_EVERY_MIN} min)' if db.HAS_MIRROR else 'not configured'}")
    print(f"  Origins : {', '.join(origins) or 'none'}")
    print(f"  Intake  : POST /api/public/intake   key {s.get('intake_api_key','')[:14]}…")
    if fresh:
        print(f"  Sign in : {core.SEED_ADMIN_EMAIL}")
        if core.GENERATED_PASSWORD:
            print("  " + "-" * 58)
            print("  FIRST SIGN IN — this is shown once and never again.")
            print(f"  Password: {core.GENERATED_PASSWORD}")
            print("  You will be asked to choose your own on sign in.")
            print("  Set ADMIN_PASSWORD in the environment to pick it yourself.")
            print("  " + "-" * 58)
    print(f"  Listening on http://0.0.0.0:{PORT}")
    print("=" * 64)
    sys.stdout.flush()
    return origins


def main():
    origins = boot()
    db.start_mirror_thread()
    srv = Server(("0.0.0.0", PORT), Handler)
    srv.origins = origins
    print("Ready.")
    sys.stdout.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
