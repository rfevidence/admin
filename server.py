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
# A blank government form is a PDF, which does not fit in half a megabyte.
# The larger ceiling applies only where a file is expected; every other
# endpoint keeps the small one.
MAX_UPLOAD = 9 * 1024 * 1024
UPLOAD_PATHS = ("/api/forms",)

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



def artwork_present(name):
    """Is logo.png / login.png actually deployed? The server can just look."""
    root = os.path.dirname(os.path.abspath(__file__))
    for folder in (STATIC, root):
        candidate = os.path.normpath(os.path.join(folder, name))
        if candidate.startswith(folder) and os.path.isfile(candidate):
            return True
    return False


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
        path = self.path.split('?', 1)[0]
        cap = MAX_UPLOAD if any(path.startswith(p) for p in UPLOAD_PATHS) else MAX_BODY
        if length > cap:
            raise ApiError(413, "That request is too large."
                           if cap == MAX_BODY else
                           "That file is too large. Keep it under 6 MB.")
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
        if path == "/track.js":
            return self.serve_track_js()
        if path == "/track":
            return self.serve_track_page()
        if path.startswith("/print/"):
            return self.serve_printable(path, qs)
        if path.startswith("/forms/") and path.endswith("/download"):
            return self.serve_form_file(path, qs)

        if path.startswith("/api/") or path.startswith("/export/"):
            return self.handle_api(method, path, qs)
        if method == "GET":
            return self.serve_static(path)
        self.fail(405, "Method not allowed.")

    def serve_form_file(self, path, qs):
        """Hand over a blank form. Signed in only, and every one is counted."""
        conn = None
        try:
            conn = db.connect()
            user = core.user_for_token(conn, (qs.get("t") or [""])[0])
            if not user:
                return self.send_body(
                    401, "<h1>Please sign in</h1><p>Open this from the portal.</p>",
                    "text/html; charset=utf-8")
            try:
                fid = int(path.split("/")[2])
            except (ValueError, IndexError):
                return self.fail(404, "Not found.")
            row = conn.one("SELECT * FROM forms WHERE id = ?", (fid,))
            if not row or not row.get("content"):
                return self.fail(404, "That form is not here.")
            import base64 as _b64
            try:
                blob = _b64.b64decode(row["content"])
            except Exception:
                return self.fail(500, "That file could not be read.")
            conn.execute("UPDATE forms SET downloads = downloads + 1 WHERE id = ?",
                         (fid,))
            conn.commit()
            name = (row.get("filename") or "form").replace('"', "")
            self.send_response(200)
            self.send_header("Content-Type", row.get("mime") or "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{name}"')
            self.send_header("Content-Length", str(len(blob)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(blob)
        except ApiError as exc:
            self.fail(exc.status, exc.message)
        except Exception:
            traceback.print_exc()
            self.fail(500, "That form could not be fetched.")
        finally:
            if conn:
                conn.close()

    def serve_printable(self, path, qs):
        """The invoice or receipt as a page, laid out like the paper one.

        Signed in only: it carries a client's name and what they were charged.
        The token comes on the query string because this opens in a new tab,
        where no header can be set.
        """
        conn = None
        try:
            conn = db.connect()
            token = (qs.get("t") or [""])[0]
            user = core.user_for_token(conn, token) if token else None
            if not user:
                return self.send_body(
                    401, "<h1>Please sign in</h1><p>Open this from the portal.</p>",
                    "text/html; charset=utf-8")
            try:
                iid = int(path.rsplit("/", 1)[1])
            except (ValueError, IndexError):
                return self.fail(404, "Not found.")
            import api as _api
            inv = _api._invoice_full(conn, iid)
            return self.send_body(200, render_document(inv),
                                  "text/html; charset=utf-8",
                                  {"Cache-Control": "no-store"})
        except ApiError as exc:
            self.fail(exc.status, exc.message)
        except Exception:
            traceback.print_exc()
            self.fail(500, "That document could not be prepared.")
        finally:
            if conn:
                conn.close()

    def serve_track_page(self):
        """The page a client uses to check their own progress."""
        conn = None
        try:
            conn = db.connect()
            st = core.get_settings(conn)
        except Exception:
            st = {}
        finally:
            if conn:
                conn.close()
        import html as _h
        page = TRACK_PAGE.replace("__ORG__", _h.escape(st.get("org_name", "")))
        page = page.replace("__EMAIL__", _h.escape(st.get("org_email", "")))
        page = page.replace("__PHONE__", _h.escape(st.get("org_phone", "")))
        self.send_body(200, page, "text/html; charset=utf-8",
                       {"Cache-Control": "no-cache"})

    def serve_track_js(self):
        """One script tag on the website puts the progress check on the page.

        It builds its own address from wherever it was served, so a custom
        domain needs no change, and it asks the portal what it needs — there
        is nothing to keep in step by hand.
        """
        conn = None
        try:
            conn = db.connect()
            st = core.get_settings(conn)
        except Exception:
            st = {}
        finally:
            if conn:
                conn.close()
        strict = "1" if st.get("tracking_require_surname", "1") != "0" else "0"
        js = TRACK_JS.replace("__STRICT__", strict)
        js = js.replace("__PHONE__", json.dumps(st.get("org_phone", "")))
        js = js.replace("__EMAIL__", json.dumps(st.get("org_email", "")))
        self.send_body(200, js, "application/javascript; charset=utf-8",
                       {"Cache-Control": "public, max-age=300",
                        "Access-Control-Allow-Origin": "*"})

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
                # An administrator's changes wait for the owner. Reading never
                # waits, and neither do the things in the exempt list.
                if core.approval_required(conn, user, method, path):
                    # Let the handler's own permission check run first. If it
                    # refuses, the answer is "not allowed" — not "waiting for
                    # the owner", which would dress a forbidden action up as
                    # ordinary work in the approvals queue.
                    probe = api.Ctx(conn, user, body, qs, self.client_ip,
                                    self.headers)
                    probe.permission_check_only = True
                    try:
                        fn(probe, *m.groups())
                    except api._PermissionOk:
                        pass                      # allowed: hold it
                    finally:
                        conn.rollback()           # the probe wrote nothing
                    held = api.hold_for_approval(ctx, method, path, qs)
                    return self.send_body(202, held)
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
                # A connection that failed mid-request may be broken; it must
                # not go back into the pool for the next person to inherit.
                try:
                    conn.rollback()
                except Exception:
                    conn.no_reuse = True
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

        # Tell the page outright whether the artwork exists, rather than
        # having it probe with a request of its own. A probe was guessing at
        # something the server already knows, and a cached reply (304) made it
        # guess wrong — which is why the background photograph disappeared.
        if full.endswith("index.html"):
            flags = ' data-photo="%s" data-logo="%s"' % (
                "1" if artwork_present("login.png") else "0",
                "1" if artwork_present("logo.png") else "0")
            data = data.replace(b'<html lang="en-GB">',
                                ('<html lang="en-GB"' + flags + '>').encode(),
                                1)

        # An ETag lets the browser ask "has this changed?" and be told no in a
        # few bytes, instead of downloading the whole file again every five
        # minutes — or worse, running last week's code from a long cache.
        try:
            st = os.stat(full)
            tag = '"%x-%x"' % (int(st.st_mtime), st.st_size)
        except OSError:
            tag = None
        if tag and self.headers.get("If-None-Match") == tag:
            self.send_response(304)
            self.send_header("ETag", tag)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        extra = {"Cache-Control": "no-cache"}
        if tag:
            extra["ETag"] = tag
        self.send_body(200, data, ctype, extra)


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




def render_document(inv):
    """Lay an invoice or receipt out the way the practice already does it."""
    import html as _h

    def e(v):
        return _h.escape("" if v is None else str(v))

    receipt = inv["kind"] == "receipt"
    title = ("OFFICIAL RECEIPT<br><span>(PAYMENT RECEIVED)</span>" if receipt
             else "COMMERCIAL INVOICE<br><span>(PREPAYMENT)</span>")
    from_label = "RECEIVED BY:" if receipt else "PAYABLE TO:"
    to_label = "RECEIVED FROM:" if receipt else "BILL TO:"
    num_label = "Receipt Number" if receipt else "Invoice Number"
    final_label = "AMOUNT PAID:" if receipt else "GRAND TOTAL:"
    sym = inv.get("symbol") or ""
    cur = inv["currency"]

    def money(v):
        n = f"{float(v or 0):,.2f}"
        return (sym + n) if sym and len(sym) <= 2 else f"{cur} {n}"

    org = inv.get("org", {})
    bank = inv.get("bank", {})
    try:
        import datetime as _dt
        nice_date = _dt.datetime.strptime(inv["issue_date"][:10], "%Y-%m-%d"
                                          ).strftime("%B %d, %Y")
    except Exception:
        nice_date = inv["issue_date"]

    rows = "".join(
        f"<tr><td class=d>{e(i['description'])}</td>"
        f"<td class=c>{('%g' % float(i['qty'] or 0))}</td>"
        f"<td class=r>{money(i['price'])}</td>"
        f"<td class=r>{money(i['line_total'])}</td></tr>"
        for i in inv["items"]) or (
        "<tr><td class=d colspan=4 style='color:#9AA2AF'>No lines yet</td></tr>")

    # A conversion line only earns its place when the document is in some
    # other currency than the books are kept in. Converting loti to loti at a
    # rate of one, and labelling it in dollars, was worse than saying nothing.
    base = inv.get("base") or "USD"
    base_sym = inv.get("base_symbol") or ""
    conv = ""
    if cur != base:
        if inv.get("fx_rate") and inv.get("total_usd"):
            amount = float(inv["total_usd"])
            shown = (f"{base_sym}{amount:,.2f}" if base_sym and len(base_sym) <= 2
                     else f"{base} {amount:,.2f}")
            asof = (inv.get("rate_fetched") or "")[:10]
            conv = (f"<div class=conv>Equivalent to {shown} at "
                    f"{float(inv['fx_rate']):,.4f} {cur} to the {base}"
                    + (f", as at {asof}" if asof else "") + "</div>")
        else:
            conv = ("<div class=conv>No exchange rate is loaded for "
                    f"{cur}, so no {base} equivalent is shown.</div>")

    return f"""<!DOCTYPE html><html lang=en><head><meta charset=utf-8>
<title>{e(inv['kind'].capitalize())} {e(inv['number'])}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel=stylesheet>
<style>
:root{{--o:#F97316;--o2:#EA6A05;--ink:#1A1A2E}}
*{{box-sizing:border-box}}
body{{margin:0;background:#EEF0F3;font:14px/1.55 'Inter',-apple-system,sans-serif;color:#2B2B2B}}
.sheet{{width:210mm;min-height:297mm;margin:18px auto;background:#fff;position:relative;overflow:hidden}}
.head{{background:var(--o);color:#fff;padding:34px 40px 120px;position:relative}}
.crest{{position:absolute;left:40px;top:0;width:132px;height:150px;background:#fff;
border-radius:0 0 66px 66px;display:flex;align-items:center;justify-content:center;
flex-direction:column;gap:4px;padding:14px}}
.crest img{{max-width:96px;max-height:80px;object-fit:contain}}
.crest b{{color:var(--ink);font-size:12px;text-align:center;line-height:1.2}}
h1{{margin:0;text-align:right;font-size:31px;font-weight:800;letter-spacing:-.5px}}
h1 span{{font-size:31px}}
.meta{{text-align:right;margin-top:16px;font-size:15px}}
.two{{display:flex;justify-content:space-between;margin-top:44px;gap:30px}}
.lbl{{font-weight:800;letter-spacing:.02em;margin-bottom:8px}}
.two .right{{text-align:right}}
.two p{{margin:0 0 3px}}
.card{{margin:-90px 34px 0;background:#fff;border-radius:14px;
box-shadow:0 6px 26px rgba(0,0,0,.10);padding:0 0 26px;position:relative}}
table{{width:100%;border-collapse:collapse}}
thead tr{{background:var(--o);color:#fff}}
thead th{{padding:15px 18px;text-align:left;font-size:13.5px;font-weight:800}}
thead th:first-child{{border-radius:28px 0 0 28px;padding-left:30px}}
thead th:last-child{{border-radius:0 28px 28px 0;padding-right:30px}}
thead th.c{{text-align:center}} thead th.r{{text-align:right}}
tbody td{{padding:15px 18px;color:var(--o2);vertical-align:top}}
tbody td:first-child{{padding-left:30px}} tbody td:last-child{{padding-right:30px}}
td.c{{text-align:center}} td.r{{text-align:right;white-space:nowrap}}
td.d{{max-width:260px}}
.foot{{display:flex;justify-content:space-between;gap:34px;padding:26px 34px 0}}
.notes{{max-width:270px}}
.notes .lbl{{color:var(--o2)}}
.notes p{{margin:0;color:var(--o2)}}
.sums{{min-width:250px}}
.sums div{{display:flex;justify-content:space-between;gap:22px;margin-bottom:9px}}
.sums .k{{color:var(--o2);font-weight:800}}
.sums .grand{{font-weight:800;font-size:17px;color:#111}}
.conv{{text-align:right;color:#6B7280;font-size:12px;margin-top:6px}}
.more{{padding:26px 34px 0}}
.more .lbl{{color:var(--o2)}}
.bar{{margin:12px 34px 0;background:var(--o);color:#fff;border-radius:30px;
padding:15px 34px;display:flex;gap:44px;justify-content:center;font-size:14px}}
@media print{{
  body{{background:#fff}}
  .sheet{{margin:0;width:auto;box-shadow:none}}
  .noprint{{display:none}}
  @page{{size:A4;margin:0}}
}}
.noprint{{text-align:center;margin:14px}}
.noprint button{{font:inherit;font-weight:600;padding:9px 20px;border:0;
border-radius:999px;background:var(--ink);color:#fff;cursor:pointer}}
</style></head><body>
<div class=noprint><button onclick="window.print()">Print or save as PDF</button></div>
<div class=sheet>
  <div class=head>
    <div class=crest><img src="/logo.png" alt="" onerror="this.style.display='none'">
      <b>{e(org.get('org_name',''))}</b></div>
    <h1>{title}</h1>
    <div class=meta>{e(num_label)}: {e(inv['number'])}<br>Date: {e(nice_date)}</div>
    <div class=two>
      <div>
        <div class=lbl>{e(from_label)}</div>
        <p>{e((org.get('org_parent') or 'RIGHT FIT EVIDENCE (PTY) LTD').replace('A Division of ','').upper())}</p>
        <p>{e(org.get('org_address') or 'MASERU 100, LESOTHO')}</p>
        <p>{e(org.get('org_email'))}</p>
        <div class=lbl style="margin-top:14px">{e(to_label)}</div>
        <p><b>NAME:</b> {e(inv['bill_name'])}</p>
        <p><b>EMAIL:</b> {e(inv['bill_email'])}</p>
        <p><b>TEL:</b> {e(inv['bill_phone'])}</p>
      </div>
      <div class=right>
        <div class=lbl>PAYMENT DETAILS:</div>
        <p><b>Account No.</b> {e(bank.get('account_no'))}</p>
        <p><b>Account Name:</b> {e(bank.get('account_name'))}</p>
        <p><b>Bank Name:</b> {e(bank.get('bank_name'))}</p>
      </div>
    </div>
  </div>

  <div class=card>
    <table><thead><tr><th>ITEM DESCRIPTION</th><th class=c>QTY</th>
      <th class=r>PRICE</th><th class=r>TOTAL</th></tr></thead>
      <tbody>{rows}</tbody></table>
    <div class=foot>
      <div class=notes><div class=lbl>NOTES:</div><p>{e(inv['notes'])}</p></div>
      <div class=sums>
        <div><span class=k>SUB TOTAL:</span><span>{money(inv['subtotal'])}</span></div>
        <div><span class=k>TAX:</span><span>{money(inv['tax'])}</span></div>
        <div><span class=k>{e(final_label)}</span>
             <span class=grand>{money(inv['total'])}</span></div>
        {conv}
      </div>
    </div>
    <div class=more><div class=lbl>MORE INFORMATION:</div></div>
    <div class=bar><span>www.maclesotho.com</span><span>{e(org.get('org_email'))}</span></div>
  </div>
</div></body></html>"""



TRACK_JS = r"""(function () {
  "use strict";
  // Where this script came from is where the portal is.
  var me = document.currentScript;
  if (!me) {
    var all = document.getElementsByTagName("script");
    me = all[all.length - 1];
  }
  var BASE = me.src.replace(/\/track\.js.*$/, "");
  var STRICT = "__STRICT__" === "1";
  var PHONE = __PHONE__, EMAIL = __EMAIL__;

  function esc(t) {
    var d = document.createElement("div");
    d.textContent = t == null ? "" : t;
    return d.innerHTML;
  }

  function mount(host) {
    host.innerHTML =
      '<form class="mac-track-form" novalidate>' +
      '<label class="mac-track-lbl" for="macTrackP">Passport number</label>' +
      '<input class="mac-track-in" id="macTrackP" autocomplete="off" ' +
      'placeholder="As it appears on your passport">' +
      (STRICT
        ? '<label class="mac-track-lbl" for="macTrackS">Surname</label>' +
          '<input class="mac-track-in" id="macTrackS" autocomplete="family-name">'
        : "") +
      '<button class="mac-track-btn" type="submit">Check my progress</button>' +
      '<div class="mac-track-msg" hidden></div>' +
      "</form><div class=\"mac-track-out\"></div>";

    var form = host.querySelector("form"),
        msg = host.querySelector(".mac-track-msg"),
        out = host.querySelector(".mac-track-out"),
        btn = host.querySelector(".mac-track-btn");

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var body = { passport_no: host.querySelector("#macTrackP").value };
      if (STRICT) body.last_name = host.querySelector("#macTrackS").value;
      if (!body.passport_no || (STRICT && !body.last_name)) {
        msg.textContent = STRICT
          ? "Enter your passport number and your surname."
          : "Enter your passport number.";
        msg.hidden = false;
        return;
      }
      msg.hidden = true;
      out.innerHTML = "";
      btn.disabled = true;
      btn.textContent = "Checking\u2026";
      fetch(BASE + "/api/public/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error ||
            "We could not check that just now. Please try again shortly.");
          return d;
        });
      }).then(function (d) {
        out.innerHTML = d.cases.map(function (k) {
          var i = d.stages.indexOf(k.stage);
          var rail = d.stages.map(function (_, n) {
            return '<i class="mac-track-step' +
              ((k.closed || n <= i) && i >= 0 ? " on" : "") + '"></i>';
          }).join("");
          return '<div class="mac-track-case">' +
            '<div class="mac-track-ref">' + esc(k.reference) + "</div>" +
            '<div class="mac-track-svc">' + esc(k.service) + "</div>" +
            '<span class="mac-track-badge">' + esc(k.stage) + "</span>" +
            '<div class="mac-track-rail">' + rail + "</div>" +
            "<p>" + esc(k.what_happens_now) + "</p>" +
            (k.documents_outstanding
              ? '<p class="mac-track-small">We are still waiting on ' +
                k.documents_outstanding + " document" +
                (k.documents_outstanding === 1 ? "" : "s") + " from you.</p>"
              : "") +
            "</div>";
        }).join("");
      }).catch(function (e) {
        msg.innerHTML = esc(e.message) +
          (PHONE ? " You can also telephone " + esc(PHONE) + "." : "");
        msg.hidden = false;
      }).then(function () {
        btn.disabled = false;
        btn.textContent = "Check my progress";
      });
    });
  }

  function style() {
    if (document.getElementById("mac-track-style")) return;
    var s = document.createElement("style");
    s.id = "mac-track-style";
    s.textContent =
      ".mac-track-form{max-width:420px}" +
      ".mac-track-lbl{display:block;font-size:13px;font-weight:600;" +
      "margin:0 0 5px;color:#4B5563}" +
      ".mac-track-in{width:100%;font:inherit;padding:11px 14px;margin:0 0 13px;" +
      "border:1.5px solid #D1D5DB;border-radius:999px;box-sizing:border-box}" +
      ".mac-track-in:focus{outline:none;border-color:#F97316;" +
      "box-shadow:0 0 0 4px rgba(249,115,22,.18)}" +
      ".mac-track-btn{font:inherit;font-weight:650;padding:12px 26px;border:0;" +
      "border-radius:999px;background:#F97316;color:#1A1A2E;cursor:pointer}" +
      ".mac-track-btn:hover{background:#EA6A05;color:#fff}" +
      ".mac-track-btn[disabled]{opacity:.6;cursor:not-allowed}" +
      ".mac-track-msg{margin-top:13px;padding:11px 13px;border-radius:8px;" +
      "background:#FEE2E2;color:#B91C1C;font-size:14px}" +
      ".mac-track-case{margin-top:18px;padding:16px 18px;border:1px solid #E5E7EB;" +
      "border-radius:12px;background:#fff;max-width:520px}" +
      ".mac-track-ref{font-size:12.5px;color:#6B7280;letter-spacing:.06em}" +
      ".mac-track-svc{font-size:17px;font-weight:650;margin:2px 0 9px}" +
      ".mac-track-badge{display:inline-block;background:#FFF7ED;color:#B45309;" +
      "border-radius:20px;padding:3px 12px;font-size:13px;font-weight:650}" +
      ".mac-track-rail{display:flex;gap:3px;margin:14px 0 8px;flex-wrap:wrap}" +
      ".mac-track-step{flex:1 1 44px;height:6px;border-radius:3px;background:#E5E7EB}" +
      ".mac-track-step.on{background:#F97316}" +
      ".mac-track-small{font-size:13px;color:#6B7280}";
    document.head.appendChild(s);
  }

  function start() {
    var hosts = document.querySelectorAll("[data-mac-track]");
    if (!hosts.length) return;
    style();
    Array.prototype.forEach.call(hosts, mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
"""


TRACK_PAGE = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Track your application — __ORG__</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--orange:#F97316;--orange-dark:#EA6A05;--wash:#FFF7ED;--dark:#1A1A2E;
--line:#E5E7EB;--muted:#6B7280;--text:#111827;--ok:#15803D;--okbg:#DCFCE7}
*{box-sizing:border-box}
body{margin:0;background:#F9FAFB;color:var(--text);line-height:1.6;
font:15px/1.6 'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.top{background:var(--dark);color:#fff;padding:26px 20px;text-align:center}
.top h1{margin:0;font-size:23px;letter-spacing:.06em;text-transform:uppercase}
.top h1 span{color:var(--orange)}
.top p{margin:6px 0 0;color:#C9CBD8;font-size:13.5px}
.wrap{max-width:660px;margin:0 auto;padding:26px 18px 60px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;
padding:22px;margin-bottom:16px}
label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px}
input{width:100%;font:inherit;padding:12px 14px;border:1.5px solid #D1D5DB;
border-radius:999px;margin-bottom:14px}
input:focus{outline:none;border-color:var(--orange);box-shadow:0 0 0 4px rgba(249,115,22,.18)}
button{width:100%;font:inherit;font-weight:650;padding:13px;border:0;
border-radius:999px;background:var(--orange);color:#1A1A2E;cursor:pointer}
button:hover{background:var(--orange-dark);color:#fff}
button[disabled]{opacity:.6;cursor:not-allowed}
.note{background:var(--wash);border:1px solid #F5D9BC;border-radius:8px;
padding:11px 13px;font-size:13px;margin-bottom:16px}
.msg{padding:11px 13px;border-radius:8px;font-size:14px;margin-bottom:14px;
background:#FEE2E2;color:#B91C1C;border:1px solid #F3C6C2}
.case{border-top:1px solid var(--line);padding-top:16px;margin-top:16px}
.case:first-child{border-top:0;padding-top:0;margin-top:0}
.ref{font-size:12.5px;color:var(--muted);letter-spacing:.06em}
.svc{font-size:17px;font-weight:650;margin:2px 0 10px}
.badge{display:inline-block;background:var(--wash);color:#B45309;
border-radius:20px;padding:3px 12px;font-size:13px;font-weight:650}
.badge.done{background:var(--okbg);color:var(--ok)}
.rail{display:flex;gap:3px;margin:16px 0 10px;flex-wrap:wrap}
.step{flex:1 1 60px;height:6px;border-radius:3px;background:var(--line)}
.step.on{background:var(--orange)}
.what{margin:10px 0 0}
.small{font-size:13px;color:var(--muted)}
.foot{text-align:center;font-size:13px;color:var(--muted);margin-top:26px}
.foot a{color:#B45309}
</style></head><body>
<div class="top"><h1>Track your <span>application</span></h1>
<p>__ORG__</p></div>
<div class="wrap">
  <div class="card">
    <div class="note">Enter your passport number and your surname exactly as
      they appear on your passport. Both must match the file we hold.</div>
    <form id="f">
      <label for="p">Passport number</label>
      <input id="p" autocomplete="off" placeholder="EA1234567" required>
      <label for="s">Surname</label>
      <input id="s" autocomplete="family-name" placeholder="As on your passport" required>
      <div id="m" class="msg" hidden></div>
      <button id="b" type="submit">Check my progress</button>
    </form>
  </div>
  <div id="out"></div>
  <div class="foot">Cannot find your file? Telephone __PHONE__ or write to
    <a href="mailto:__EMAIL__">__EMAIL__</a>.</div>
</div>
<script>
var esc=function(t){var d=document.createElement('div');d.textContent=t==null?'':t;
  return d.innerHTML;};
document.getElementById('f').addEventListener('submit',function(ev){
  ev.preventDefault();
  var b=document.getElementById('b'),m=document.getElementById('m'),
      out=document.getElementById('out');
  m.hidden=true; out.innerHTML=''; b.disabled=true; b.textContent='Checking…';
  fetch('/api/public/track',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({passport_no:document.getElementById('p').value,
                         last_name:document.getElementById('s').value})})
   .then(function(r){return r.json().catch(function(){return {};})
     .then(function(d){if(!r.ok)throw new Error(d.error||
       'We could not check that just now. Please try again shortly.');return d;});})
   .then(function(d){
     out.innerHTML='<div class="card">'+d.cases.map(function(k){
       var i=d.stages.indexOf(k.stage);
       var rail=d.stages.map(function(_,n){
         return '<div class="step'+((k.closed||n<=i)&&i>=0?' on':'')+'"></div>';}).join('');
       return '<div class="case"><div class="ref">'+esc(k.reference)+'</div>'+
         '<div class="svc">'+esc(k.service)+
         (k.destination?' <span class="small">to '+esc(k.destination)+'</span>':'')+'</div>'+
         '<span class="badge'+(k.closed?' done':'')+'">'+esc(k.stage)+'</span>'+
         '<div class="rail">'+rail+'</div>'+
         '<p class="what">'+esc(k.what_happens_now)+'</p>'+
         (k.documents_outstanding?'<p class="small">We are still waiting on '+
           k.documents_outstanding+' document'+(k.documents_outstanding===1?'':'s')+
           ' from you.</p>':'')+
         '<p class="small">Opened '+esc(k.opened_on)+
         (k.submitted_on?' · submitted '+esc(k.submitted_on):'')+
         (k.decided_on?' · decided '+esc(k.decided_on):'')+'</p></div>';
     }).join('')+'</div>';
   })
   .catch(function(e){m.textContent=e.message;m.hidden=false;})
   .then(function(){b.disabled=false;b.textContent='Check my progress';});
});
</script></body></html>
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
    upgraded = db.create_schema(conn)
    core.seed_services(conn)
    fresh = core.seed(conn)
    s = core.get_settings(conn)
    origins = core.allowed_origins(conn)
    conn.close()

    print("=" * 64)
    print(f"  {core.APP_NAME} {core.VERSION}")
    print(f"  Storage : {'PostgreSQL — ' + db.host_of(db.DATABASE_URL) if db.IS_PG else 'SQLite file ' + db.DB_PATH}")
    print(f"  Backup  : {'Supabase — ' + db.host_of(db.MIRROR_DATABASE_URL) + f' (every {db.MIRROR_EVERY_MIN} min)' if db.HAS_MIRROR else 'not configured'}")
    print(f"  Origins : {', '.join(origins) or 'none'}")
    if upgraded:
        print(f"  Upgrade : added {', '.join(upgraded)}")
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


def reminder_loop():
    """Sweep for consultations that need a reminder.

    Worth knowing: on a plan where the service sleeps when idle, this thread
    sleeps with it, so a reminder only goes out if the portal happens to be
    awake. A keep-alive ping every few minutes fixes that.
    """
    import time as _t
    _t.sleep(45)
    while True:
        conn = None
        try:
            conn = db.connect()
            res = core.send_due_reminders(conn)
            if res.get("sent"):
                print(f"Reminders: sent {res['sent']}.")
                sys.stdout.flush()
            for err in res.get("errors", []):
                print(f"Reminders: {err}")
                sys.stdout.flush()
        except Exception as exc:
            # A brief database hiccup here is not worth a stack trace every
            # three minutes; the next sweep picks up whatever was missed, and
            # the sent flag stops anything going twice.
            print(f"Reminders: skipped this sweep ({type(exc).__name__}: "
                  f"{str(exc)[:120]})")
            sys.stdout.flush()
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
        _t.sleep(180)


def main():
    origins = boot()
    db.start_mirror_thread()
    threading.Thread(target=reminder_loop, daemon=True, name="reminders").start()
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
