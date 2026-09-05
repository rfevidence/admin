# MAC Admin Portal

An admin CRM for the **Migration Advisory Centre**, a division of Right Fit
Evidence Pty Ltd — Maseru, Lesotho.

Only MAC staff sign in. Clients never see it. What they do see is the
consultation form on [maclesotho.com](https://maclesotho.com), and every
submission lands in this portal the moment they press send.

This one file is the whole manual: what the portal does, how to put it online,
how to connect the website, and what to do when something looks wrong.

---

## Contents

1. [What it does](#1-what-it-does)
2. [Putting it online](#2-putting-it-online) — GitHub, Neon, Supabase, Render
3. [Connecting the website](#3-connecting-the-website)
4. [Your own subdomain](#4-your-own-subdomain-optional)
5. [What the free plans mean](#5-what-the-free-plans-actually-mean)
6. [Day-to-day operations](#6-day-to-day-operations)
7. [Your artwork and colours](#7-your-artwork-and-colours)
8. [How the data is kept](#8-how-the-data-is-kept)
9. [Environment variables](#9-environment-variables)
10. [Running and testing it yourself](#10-running-and-testing-it-yourself)
11. [Security](#11-security)
12. [When something goes wrong](#12-when-something-goes-wrong)
13. [The files in this repository](#13-the-files-in-this-repository)

---

## 1. What it does
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

## 2. Putting it online

Everything below is on free plans. Set aside about forty minutes the first
time. Do the steps in order — each one produces something the next needs.

| Piece | Service | Costs |
|---|---|---|
| The portal itself | Render web service | free |
| The main database | Neon Postgres | free |
| The backup database | Supabase Postgres | free |
| The code | GitHub repository | free |

### Step 1 — Put the code on GitHub

1. Go to <https://github.com/new>.
2. Name it `mac-admin-portal`. Choose **Private** — this repository will hold
   your client data configuration.
3. Do not tick "Add a README". Press **Create repository**.
4. On your computer, in the folder containing these files:

```bash
git init
git add .
git commit -m "MAC admin portal"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/mac-admin-portal.git
git push -u origin main
```

If you would rather not use the command line, GitHub's web uploader works:
open the empty repository, click **uploading an existing file**, and drag in
every file *including the `static` folder*.

---

### Step 2 — Create the Neon database (this is the real one)

1. Sign up at <https://neon.tech> and create a project.
   Name it `mac-crm`. For the region pick the one closest to Lesotho —
   **AWS eu-central-1 (Frankfurt)** is usually the quickest from here.
2. When the project opens you will see a **Connection string**.
3. Set the dropdown to **Pooled connection**, then copy the whole string.
   It looks like:

```
postgresql://mac_owner:XXXXXXXX@ep-something-pooler.eu-central-1.aws.neon.tech/mac-crm?sslmode=require
```

Two things matter here:

- Use the **pooled** string (the host contains `-pooler`). Render's free plan
  opens and closes connections often, and the pooler handles that gracefully.
- Keep `?sslmode=require` on the end. Neon refuses plain connections.

Paste it somewhere safe for a moment. This is `DATABASE_URL`.

---

### Step 3 — Create the Supabase backup database

The portal reads and writes only to Neon. On a timer it copies everything
across to Supabase, so if Neon ever has a bad day your records still exist
somewhere you control.

1. Sign up at <https://supabase.com>, create a project called `mac-crm-backup`.
2. Choose a database password and save it — Supabase will not show it again.
3. Go to **Project Settings → Database → Connection string → URI**.
4. Copy it and replace `[YOUR-PASSWORD]` with the password you chose:

```
postgresql://postgres.abcdefgh:YOURPASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

This is `MIRROR_DATABASE_URL`.

You can skip this step and add it later. The portal runs fine without a
backup configured — the System page will simply say so.

---

### Step 4 — Create the Render web service

1. Sign up at <https://render.com> and connect your GitHub account.
2. **New → Web Service**, pick the `mac-admin-portal` repository.
3. Fill in:

   | Field | Value |
   |---|---|
   | Name | `mac-admin-portal` |
   | Region | Frankfurt |
   | Branch | `main` |
   | Runtime | Python 3 |
   | Build command | `pip install -r requirements.txt` |
   | Start command | `python3 server.py` |
   | Instance type | **Free** |

4. Open **Advanced** and set the health check path to `/healthz`.

5. Still under Advanced, add these environment variables:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon pooled string from step 2 |
   | `MIRROR_DATABASE_URL` | the Supabase string from step 3 |
   | `ADMIN_EMAIL` | `admin@maclesotho.com` |
   | `ADMIN_PASSWORD` | a strong password you choose |
   | `ALLOWED_ORIGINS` | `https://maclesotho.com,https://www.maclesotho.com` |
   | `MIRROR_EVERY_MIN` | `30` |
   | `PYTHON_VERSION` | `3.12.7` |

   Do **not** set `PORT`. Render provides it, and setting it by hand stops the
   service from ever going live.

6. Press **Create Web Service**. The first build takes three or four minutes.

When the log shows `Ready.` you are live at
`https://mac-admin-portal.onrender.com`.

Sign in with `ADMIN_EMAIL` and the `ADMIN_PASSWORD` you chose.

If you left `ADMIN_PASSWORD` blank, the portal generates a strong password at
first boot and prints it **once** in the Render **Logs** tab, in a box headed
*FIRST SIGN IN*. Copy it from there and sign in; you will be asked to choose
your own straight away.

Either way, once you are in and have set a password you are happy with, delete
`ADMIN_PASSWORD` from Render. It is read only when the very first account is
created, and leaving it there is a password sitting in a dashboard.

---

## 3. Connecting the website

One line. Open `index.html` in your website repository, find the closing
`</body>` tag near the bottom, and paste this just above it:

```html
<script src="https://mac-admin-portal.onrender.com/intake.js" defer></script>
```

Use whatever address you actually sign in at — change it if your Render
service has a different name, or once you set up a subdomain in step 6.

Commit and push. That is the entire website change.

The portal serves that script itself, already carrying its own address and
intake key, so there is no key to copy and nothing to configure. The script
finds your consultation form, adds its own hidden honeypot field, and sends a
copy of each submission to the portal. Your EmailJS send is untouched.

**Test it.** Submit the form on your own site, then look under **Enquiries**.
It should be there with a bold *New* badge.

If it is not, open the **System** page. Every attempt is listed with the reason
it was turned away — usually a domain missing from `ALLOWED_ORIGINS`. Your
browser's console on maclesotho.com also prints a line starting `[MAC]`.

If the console says no consultation form was found, add `data-mac-intake` to
your form tag and push again:

```html
<form id="consultationForm" data-mac-intake>
```

### The field names your form already uses

The portal accepts several spellings for each field, so your existing form
needs no renaming. These were checked against the live form on maclesotho.com
and all fifteen fields map correctly.

| Meaning | Names accepted |
|---|---|
| first name | `first_name`, `firstName`, `first`, `from_first_name` |
| last name | `last_name`, `lastName`, `surname`, `from_last_name` |
| email | `email`, `email_address`, `from_email`, `reply_to` |
| phone | `phone`, `contact_number`, `contactNumber`, `tel`, `mobile` |
| occupation | `occupation`, `job`, `profession` |
| address | `address`, `physical_address`, `physicalAddress` |
| nationality | `nationality`, `citizenship` |
| residence | `country_residence`, `country_of_residence`, `residence` |
| service | `service`, `service_required`, `immigration_service` |
| destination | `destination`, `destination_country`, `destinationCountry` |
| permit status | `permit_status`, `current_status`, `visa_status` |
| years in Lesotho | `years_in_lesotho`, `years_lesotho`, `years` |
| criminal record | `criminal_record`, `criminal_charges`, `convictions` |
| prior rejection | `prior_rejection`, `visa_rejection`, `previous_rejection` |
| their situation | `message`, `situation`, `details`, `additional_information` |
| consent | `consent` |

Text boxes, dropdowns, radio buttons, checkboxes and text areas are all read
correctly. Anything unrecognised is ignored rather than refused.

### What the script does on your page

It finds your consultation form, adds a hidden honeypot field so bots are
filtered without you editing the form, and copies each submission to the portal
as the visitor presses send.

Your EmailJS send is untouched. The script listens in the capture phase, so it
works even though your handler calls `preventDefault()` — and it runs the same
`checkValidity()` check your form does, so a half-filled form never reaches the
portal. If the portal is asleep the request is abandoned after nine seconds and
the visitor still sees your normal thank-you message. The email always goes
out; only the portal record is ever at risk.

If the console says no consultation form was found, add `data-mac-intake` to
your form tag:

```html
<form id="intakeForm" data-mac-intake>
```

### If you ever rotate the intake key

Nothing to do. The script is served by the portal and picks up the new key on
its own within five minutes. That is the main reason it works this way rather
than as a block of code pasted into your site.

---

## 4. Your own subdomain (optional)

Nicer for staff than an `onrender.com` address.

1. In Render: **Settings → Custom Domains → Add**, enter
   `portal.maclesotho.com`.
2. Render shows you a target such as `mac-admin-portal.onrender.com`.
3. At whoever manages DNS for `maclesotho.com`, add:

   | Type | Name | Value |
   |---|---|---|
   | CNAME | `portal` | `mac-admin-portal.onrender.com` |

4. Wait for it to propagate — usually minutes, occasionally a few hours.
   Render issues the HTTPS certificate on its own once it resolves.
5. Update `CRM_URL` in the website snippet to the new address.

---

Adding a custom domain does not break anything. Render keeps the
`.onrender.com` address working permanently, and the intake script configures
itself from whichever address served it — so both work at once, and switching
is a one-line change on your website whenever you feel like it.

---

## 5. What the free plans actually mean

**Render sleeps after 15 minutes of no traffic.** The first request after that
takes roughly 30 to 50 seconds while the service starts. For staff this means
the sign-in page occasionally takes a moment in the morning.

It matters more for the website form: if a visitor submits while the service is
asleep, the browser may give up before the portal wakes. The snippet is written
so this never affects the visitor — EmailJS still delivers their enquiry to your
inbox — but the record may not reach the portal.

Two ways to handle it:

- **Free:** set up a ping at <https://uptimerobot.com> hitting
  `https://your-service.onrender.com/healthz` every 5 minutes. That keeps the
  service awake through the working day.
- **Paid:** Render's Starter plan is around 7 USD a month and never sleeps.

**Neon's free plan** gives about 0.5 GB. A migration practice writes small text
records; that is room for tens of thousands of clients. The System page shows
how much you have used.

---

## 6. Day-to-day operations

**Adding a staff member.** Staff → Add a staff member. You get a temporary
password to hand over. They must set their own on first sign in. Advisors can
do casework but cannot change settings, see the intake key, or delete records.

**Checking the backup.** System page. It shows when the last copy ran and how
many rows went across. Owners can press **Copy now** at any time.

**If the intake key leaks.** Settings → Rotate key. The old key stops working
instantly, so paste the new one into your website in the same sitting.

**Updating the portal.** Push to `main` on GitHub. Render rebuilds and redeploys
by itself. Your data lives in Neon, not on Render, so nothing is lost.

**Getting your data out.** Reports → pick a report → Download CSV. Every table
is exportable. You are never locked in.

---

## 7. Your artwork and colours

Two optional images. Commit either at the top level of the repository or inside
`static/` — both places are served.

| File | Where it appears |
|---|---|
| `logo.png` | Large on the sign-in page, and in the sidebar once signed in |
| `login.png` | The full-bleed photograph behind the sign-in page |

Neither is required. Without `logo.png` a drawn crest is shown; without
`login.png` the brand gradient shows through. Nothing looks broken while you
are still finding the artwork.

A wide PNG with a transparent background suits the logo best. The sidebar is
dark, so the logo is given a white plate behind it. The photograph is covered
by a pale veil so the form stays readable whatever the image.

### The sign-in animation

The passport-stamp intro from maclesotho.com plays on the sign-in page. It runs
once per browser session, clears itself after a moment, dismisses on a click or
a key press, and is skipped entirely for anyone whose system asks for reduced
motion. The form underneath is never blocked by it.

### Changing the colours

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

## 8. How the data is kept

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

## 9. Environment variables

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Neon connection string. Without it, a local SQLite file is used |
| `MIRROR_DATABASE_URL` | Supabase connection string for the backup copy |
| `MIRROR_EVERY_MIN` | Minutes between copies. Default 30 |
| `ADMIN_EMAIL` | Email of the first owner account |
| `ADMIN_PASSWORD` | Password for that account, read only when it is created. Leave it unset and a strong one is generated and printed once to the service log |
| `INTAKE_API_KEY` | Fixes the website intake key. Otherwise one is generated |
| `ALLOWED_ORIGINS` | Comma-separated sites permitted to post the form |
| `PORT` | Supplied by Render. Never set it yourself |

Everything except the connection strings can also be changed from the Settings
page once you are signed in.

---

## 10. Running and testing it yourself

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

### Running the test suites

The suites sign in as the owner, so give the server a known password:

```bash
ADMIN_PASSWORD='TestOnly#2026' python3 server.py &   # wait for "Ready."
python3 test_api.py http://localhost:8500
node     test_ui.js  http://localhost:8500           # needs: npm install jsdom
```

Run them in that order against a fresh database — the interface suite opens
client and case files that the API suite creates.

There is also a pre-deployment audit covering the failure modes that only
appear under real use — simultaneous writes, non-Latin names, injection
attempts, spreadsheet-formula text in exports, and role boundaries:

```bash
python3 audit.py http://localhost:8500
```

Current state: **129 API checks, 43 interface checks, 39 audit checks**, all
passing on both SQLite and PostgreSQL, plus verified persistence across
restarts, recovery from dropped database connections, and a clean upgrade over
a database that already holds records.

---

## 11. Security

No password appears anywhere in this repository. The first owner account takes
its password from `ADMIN_PASSWORD`; with that unset, one is generated at first
boot, printed once to the service log, and must be changed on first sign in.

Passwords are stored as PBKDF2-SHA256 hashes with 240,000 iterations. Sessions
last twelve hours. Six failed sign-ins lock an account for fifteen minutes.
Disabling a staff account ends their session immediately.

The public intake endpoint needs a key, rejects anything that fills the honeypot
field, accepts at most twelve submissions an hour from one address, and only
answers browsers on the domains you list. Every attempt is logged whether it
succeeded or not.

Every action a staff member takes is written to an audit log that cannot be
edited from the interface.

---

## 12. When something goes wrong

| What you see | What it usually is |
|---|---|
| Build fails: "no matching distribution for psycopg-binary" | Render picked a Python version too new for the database driver's prebuilt wheel. Set `PYTHON_VERSION` to `3.12.7` and redeploy |
| Build fails on Render | `requirements.txt` missing from the repository root |
| Deploy succeeds, site won't load | `PORT` was set by hand — delete that variable |
| "Sign in to continue" straight after signing in | System clock skew, or the session expired after 12 hours |
| Enquiries never arrive | Wrong key, or your domain missing from `ALLOWED_ORIGINS`. Check the System page |
| Backup shows a red dot | Supabase password wrong in `MIRROR_DATABASE_URL`, or the project was paused for inactivity |
| Everything is slow on the first click | Free-plan sleep. See the section above |

Render's own logs (**Logs** tab) print the reason for any server error.

---

## 13. The files in this repository

| File | What it is |
|---|---|
| `server.py` | HTTP server, routing, static files, CORS, the website intake script |
| `api.py` | Every API endpoint |
| `core.py` | Passwords, sessions, taxonomies, document checklists, audit |
| `db.py` | SQLite/Postgres adapter, schema, the backup copy |
| `static/index.html` | Sign-in screen and portal shell |
| `static/app.css` | Stylesheet — brand colours at the top |
| `static/app.js` | The whole front end |
| `requirements.txt` | The one dependency, needed only for Postgres |
| `render.yaml` | Render service definition |
| `.python-version` | Pins Python, so a new release cannot break the build |
| `GUIDE.md` | This document |
| `test_api.py` | 129 checks across every endpoint |
| `test_ui.js` | 43 checks driving the real interface |
| `test_restart.py` | Survives restarts and dropped connections |
| `audit.py` | Concurrency, unicode, injection, permissions, exports |
