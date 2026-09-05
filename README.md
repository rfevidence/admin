# MAC Admin Portal

An admin CRM for the **Migration Advisory Centre**, a division of Right Fit
Evidence Pty Ltd — Maseru, Lesotho.

Only MAC staff sign in. Clients never see it. What they do see is the
consultation form on [maclesotho.com](https://maclesotho.com), and every
submission lands in this portal the moment they press send.

**Sign in:** `admin@maclesotho.com` / `Migration@20!26` — change this the first
time you sign in.

To put it online, follow [DEPLOY.md](DEPLOY.md).

---

## What it does

**Enquiries.** The website form posts here as well as to EmailJS — one script tag on maclesotho.com is the whole integration. New
submissions carry a bold badge and a count on the sidebar. Open one and you see
every field the visitor filled in. One button turns it into a client with a case
already opened and the right document checklist attached.

**Clients.** The full record: contact details, nationality, passport and permit
numbers with their expiry dates, occupation, years in Lesotho, and a running
history of everything anyone at MAC has done on the file.

**Cases.** One per application. Each moves along eight stages from *Enquiry
received* to *Approved*, or closes as rejected, withdrawn or referred out. The
submission date stamps itself when you mark a case submitted. Every move is
recorded with a note, so months later you can see who did what and when.

**Document checklists.** Opening a case generates the checklist for that service
— a work permit gets its Labour Commissioner forms, a study visa gets its
acceptance letter and proof of funds. Mark each document pending, received,
verified, rejected or waived. Documents can carry their own expiry date.

**Renewals.** Passports and permits expiring in the next four months, worst
first. This is the page that turns a one-off client into a returning one.

**Payments.** Matches how MAC actually charges: a consultation fee, then 50% on
commencement and 50% on submission. Each case shows agreed fee, received, and
balance outstanding. Payments can be voided and restored without deleting the
history.

**Tasks and consultations.** A follow-up date on any note becomes a task. The
diary holds consultations and tracks whether each was held or missed.

**Reports.** Nine of them — enquiries, clients, cases, payments, pipeline,
outcomes, outstanding documents, consultations, activity log. Any date range,
viewable on screen, printable, downloadable as CSV.

**Staff and roles.** Owners manage settings, staff and deletions. Administrators
do everything except that. Advisors do casework. New staff get a temporary
password and must choose their own.

**System.** Live view of both databases, how much space is used, when the last
backup copy ran, and a log of every website submission — accepted or refused,
with the reason. This page is where you look first if anything seems wrong.

---

## How the data is kept

Neon Postgres holds everything. Every read and every write goes there.

Supabase holds a copy. On a timer, by default every thirty minutes, the portal
copies all thirteen tables across in full. Owners can also trigger a copy by
hand from the System page.

If Neon has an outage the portal is unavailable — it does not silently fail over
— but your records exist in a second place under your own account, and you can
point `DATABASE_URL` at Supabase to get running again.

Run it with no database configured at all and it falls back to a local SQLite
file, which is how it runs on your own machine.

---

## Running it locally

```bash
python3 server.py
```

Then open <http://localhost:8500>. No dependencies needed for local use — it
runs on the Python standard library. `psycopg` is only required when you point
it at Postgres.

To test against a real Postgres:

```bash
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" python3 server.py
```

---

## Environment variables

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Neon connection string. Without it, a local SQLite file is used |
| `MIRROR_DATABASE_URL` | Supabase connection string for the backup copy |
| `MIRROR_EVERY_MIN` | Minutes between copies. Default 30 |
| `ADMIN_EMAIL` | Email of the first owner account |
| `ADMIN_PASSWORD` | Password for that account, used only when it is created |
| `INTAKE_API_KEY` | Fixes the website intake key. Otherwise one is generated |
| `ALLOWED_ORIGINS` | Comma-separated sites permitted to post the form |
| `PORT` | Supplied by Render. Never set it yourself |

Everything except the connection strings can also be changed from the Settings
page once you are signed in.

---

## Changing the colours

The whole palette lives in one block at the top of `static/app.css`:

```css
:root {
  --brand-deep:   #0E2A47;
  --brand-deep-2: #163A5F;
  --brand-gold:   #C8A248;
  --brand-gold-2: #A8842F;
  --brand-wash:   #F4EEDD;
  --brand-tint:   #EAF0F7;
}
```

Nothing else in the stylesheet hard-codes a brand colour. Copy the values from
your website's own `:root` block over these six and the portal matches the site
exactly.

---

## Files

| File | What it is |
|---|---|
| `server.py` | HTTP server, routing, static files, CORS |
| `api.py` | Every API endpoint |
| `core.py` | Passwords, sessions, taxonomies, document checklists, audit |
| `db.py` | SQLite/Postgres adapter, schema, the backup copy |
| `static/index.html` | Sign-in screen and portal shell |
| `static/app.css` | Stylesheet — brand colours at the top |
| `static/app.js` | The whole front end |
| `website-snippet.html` | The one line to add to your website, and why |
| `render.yaml` | Render service definition |
| `test_api.py` | 129 checks across every endpoint |
| `test_ui.js` | 40 checks driving the real interface |
| `test_restart.py` | Data survives restarts and dropped connections |
| `DEPLOY.md` | Step-by-step deployment |

---

## Testing

```bash
python3 server.py &                     # wait for "Ready."
python3 test_api.py http://localhost:8500
node test_ui.js  http://localhost:8500  # needs: npm install jsdom
```

Current state: **129 API checks, 40 interface checks, all passing**, on both
SQLite and PostgreSQL, plus verified persistence across restarts and recovery
from dropped database connections.

---

## Security

Passwords are stored as PBKDF2-SHA256 hashes with 240,000 iterations. Sessions
last twelve hours. Six failed sign-ins lock an account for fifteen minutes.
Disabling a staff account ends their session immediately.

The public intake endpoint needs a key, rejects anything that fills the honeypot
field, accepts at most twelve submissions an hour from one address, and only
answers browsers on the domains you list. Every attempt is logged whether it
succeeded or not.

Every action a staff member takes is written to an audit log that cannot be
edited from the interface.
