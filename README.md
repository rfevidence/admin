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
11. [Two-step sign in](#11-two-step-sign-in)
12. [Requirements and fees](#12-requirements-and-fees)
13. [Forms](#13-forms)
14. [Analytics and maps](#14-analytics-and-maps)
15. [Accounts, invoices and receipts](#15-accounts-invoices-and-receipts)
16. [Client case tracking](#16-client-case-tracking)
17. [Consultation reminders by email](#17-consultation-reminders-by-email)
18. [Data entry](#18-data-entry)
19. [Security](#19-security)
20. [When something goes wrong](#20-when-something-goes-wrong)
21. [The files in this repository](#21-the-files-in-this-repository)

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

**Staff and roles.** Two roles. The **owner** sees everything, including the
Office section — Reports, Staff, Settings, System and the Activity log.
**Administrators** do the casework: enquiries, clients, cases, consultations,
payments and the service catalogue, but none of the office section. It is
hidden from their sidebar, refused by the server, and typing the address
directly returns them to the dashboard.

Owners can add a staff member, reset a password, clear two-step sign in, and
remove an account outright. Removing one takes away the sign in only — every
client, case, note and payment they worked on stays exactly as it is, because
the record belongs to the practice rather than to the account.

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
| `logo.png` | Large on the sign-in page, and in the white sidebar band once signed in |
| `login.png` | The full-bleed photograph behind the sign-in page |

Neither is required. Without `logo.png` a drawn crest is shown; without
`login.png` the brand gradient shows through. Nothing looks broken while you
are still finding the artwork.

A wide PNG with a transparent background suits the logo best. The sidebar is
dark, so the logo is given a white plate behind it. The photograph is covered
by a pale veil so the form stays readable whatever the image.

### When the service is asleep

The portal always answers in JSON, so a reply that is not JSON did not come
from the portal — it came from Render's edge while the service was asleep,
redeploying or restarting. Because such a reply proves the request never
reached the portal, retrying is safe even for a payment: nothing was
processed. Every button and the sign-in form retry three times, roughly five
seconds in total, before showing a plain-English message. A genuine refusal
from the portal — a wrong password, a missing field — is never retried and
keeps its own wording.

### The loading overlay

Pressing Sign In dims the page and shows a spinner until the portal answers.
If it takes more than a few seconds a line appears explaining that the free
plan lets the service sleep, so a long first wait looks intentional rather than
broken. The same overlay appears when a returning visitor's saved session is
being restored.

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
| `EXCHANGE_API_KEY` | Optional. The exchangerate-api.com key, if you prefer it here rather than in Settings |
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

## 11. Two-step sign in

An extra six-digit code on top of the password, from an authenticator app on
the phone. Worth switching on: this portal holds passport numbers and
immigration histories.

**Turning it on.** My profile → Two-step sign in → Set it up. A square appears;
scan it with Google Authenticator, Microsoft Authenticator, Authy or any
similar app. Type the six digits it shows and it is on. If the phone camera
will not cooperate, the key underneath can be typed into the app by hand.

**Recovery codes.** Eight are shown once, at the moment you switch it on. Each
signs you in a single time if the phone is lost. Keep them somewhere that is
not the phone — printed in the office safe is fine. The portal tells you how
many remain.

**If someone loses their phone and their codes.** The account owner opens
Staff and presses *Clear two-step* on that person's row. They then sign in with
their password alone and can set it up again. Nobody else can do this, and it
is written to the activity log.

**Turning it off** needs both the password and a current code, so it cannot be
switched off on a screen someone left unlocked.

Codes are checked against the previous, current and next thirty-second window,
so a phone clock that drifts by a few seconds still works. Six wrong codes lock
the account for fifteen minutes, exactly as six wrong passwords do.

---

## 12. Requirements and fees

The sidebar entry **Requirements & fees** holds, for every permit and visa, what
a client must bring and what it costs. It exists so that when a client rings and
asks *"what do I need for a work permit, and what will it cost?"*, whoever picks
up the phone reads from the same list as everyone else.

**Requirements.** Each service starts with the built-in checklist and can then
be edited freely — add an item, mark one optional, or write a note against it
such as *"certified, not older than three months"*.

**Fees.** Add each charge with a name, an amount and when it falls due — a
consultation fee, then the amounts on commencement and on submission. The page
totals them, so you can quote a full figure.

**It feeds casework.** When a case is opened for a service, its document
checklist is taken from this catalogue rather than the built-in list. Editing
the catalogue changes what *new* cases ask for; cases already open keep the
checklist they started with, so nothing shifts under an application in progress.

Any signed-in staff member can read the catalogue. Administrators and owners can
change it, and every change is recorded in the activity log.

---

## 13. Forms

**Forms** in the sidebar holds the blank government papers clients have to
complete, so nobody hunts through an inbox for the current version. Add one
with a name, the authority it belongs to, the service it relates to, a version,
and a note such as *completed and signed in black ink*. Staff download it with
one press; the list is grouped by authority and counts how often each has been
taken.

**Files are kept in the database, not on disk.** The service runs on a platform
that wipes its filesystem on every deploy, so a file saved beside the code
would quietly disappear the next time you push. The database survives, and the
copy to the Supabase standby takes the forms with it — I tested that a stored
file arrives at the standby byte for byte.

Up to 6 MB each: PDF, Word, Excel, an image or a zip. That ceiling is
deliberate. Neon's free tier gives half a gigabyte for everything, so keeping
forms modest leaves room for the casework they exist to serve. If a form is
very large, record a **link** to the authority's own page instead of attaching
it — an entry can be a file, a link, or both.

**Retire rather than delete.** Unticking *in use* hides a form from the list
while keeping it for reference, which matters when an application submitted on
last year's version is still open. Deleting takes the file with it, and only
the owner can.

---

## 14. Analytics and maps

**Analytics** in the sidebar shows the shape of the practice: where clients
come from, where they are going, which services, which stage cases sit at, how
applications end, and how long a decision takes.

**The maps** use [Leaflet](https://leafletjs.com/) with satellite imagery from
Esri, with Esri's boundaries-and-place-names layer over the top so countries
are outlined and labelled rather than left as bare terrain. Both are free and neither needs an account or a key. A circle sits on
each country, sized by how many clients or cases it accounts for; clicking one
names the place, the count, and the nationalities behind it.

Two things worth knowing about how the maps behave.

**Nothing is silently dropped.** A nationality or country the portal has no
coordinates for is listed underneath the map by name, with its count, and said
plainly to be included in the totals. The figure on the page always matches the
figure in the register.

**Nothing is silently misplaced.** Names are matched against an explicit list
rather than guessed at. An early version matched loosely and put *Chinese* on
Chile — a circle in the wrong hemisphere is far worse than an honest "could not
place this one", so a name that cannot be resolved with certainty is reported
rather than approximated.

**If the map cannot load** — a blocked network, a bad connection — the page
does not show a blank rectangle. It says so and lists exactly the same figures
as a ranked chart, so the analysis is never lost behind a broken map.

---

## 15. Accounts, invoices and receipts

**Accounts** in the sidebar is the money side of the practice: what has been
billed, what has come in, what is still owed, month by month and currency by
currency.

**Raising an invoice.** From Accounts, or straight from a case with the
Invoice button. Add lines with a description, quantity and price; the total
adds up as you type. Press **Open to print or save as PDF** and you get the
document laid out exactly like your existing paperwork — the orange header,
the crest, payable-to and bill-to blocks, the itemised table, sub total, tax
and grand total, your bank details and the footer. Your browser's print dialog
saves it as a PDF.

### Payments and Accounts are not the same thing

**Payments** is the ledger: every amount actually received, including money
that never had an invoice — a deposit handed over at the counter, a government
fee paid on a client's behalf. It is what client and case balances are worked
out from, and what the dashboard counts.

**Accounts** is the paperwork: the invoice you send and the receipt you hand
back. Raising a receipt posts its amount into the ledger automatically, so the
balance follows without anyone typing it twice.

That leaves one trap, and the portal guards against it. If one person raises a
receipt while another records the same money as a payment, the client would
show as having paid twice and their balance would be wrong. So recording a
payment that matches a receipt for the same client, same amount, within a week
is stopped, and the receipt that already holds it is named. If it really is a
separate payment — two instalments of the same size in one week — you can say
so and it saves. Entries that came from a receipt are marked as such in the
ledger.

**Turning it into a receipt.** One button marks the invoice paid, raises the
receipt with the same lines and the receipt wording, and posts the amount into
the payments ledger against that client. Numbering carries on from your paper
book — set the next number in Settings before you raise the first one.

**Your wording and bank details** live in Settings, so a change of account or a
change of policy is one edit rather than a rebuild.

### Currency

**The primary currency is yours to choose**, in Settings → Money. It starts as
US dollars. Changing it clears the stored exchange rates, because every one of
them was relative to the old base — press *Refresh rates* afterwards and the
Accounts page will say plainly that amounts are unconverted until you do.

**Cases and invoices each carry their own currency**, chosen when they are
raised, so a file agreed in rand and an invoice issued in dollars sit together
without either being misstated.

**US dollars is the default base.** Every document is kept in the currency it was
agreed in *and* converted to dollars, so the books add up across a file quoted
in three of them. Twenty currencies are offered, the region's first.

Conversion needs a free key from
[exchangerate-api.com](https://www.exchangerate-api.com). Paste it into
Settings → Money and press **Refresh rates**. It can also be supplied as an
`EXCHANGE_API_KEY` environment variable if you would rather keep every secret
in one place; a key typed into Settings takes precedence, so it can be changed
without a redeploy. Without a key nothing breaks:
amounts stay in their own currency, and anything that could not be converted is
named plainly at the top of the Accounts page rather than being counted as
though it were dollars. An LSL 9,000 invoice silently counted as $9,000 would
quietly ruin a year's figures, so the portal refuses to guess.

An invoice shows a converted equivalent only when it is in some currency other
than the books are kept in, and says which rate it used and when that rate was
fetched. If no rate is loaded it says so rather than inventing one.

A rate is stored on the document when it is raised and is never rewritten by a
later refresh — the rate on the day is the one the books keep. Documents raised
before any rate existed are filled in the first time rates arrive.

---

## 16. Client case tracking

The portal serves a page at **/track** where a client checks their own progress.
Link to it from maclesotho.com; there is nothing to install on the website.

There are two ways to offer it. The hosted page at **/track**, or a snippet you
paste into maclesotho.com so the client checks without leaving your site:

```html
<div data-mac-track></div>
<script src="https://your-portal/track.js" defer></script>
```

The snippet brings its own styling, touches nothing else on the page, and works
from whatever address served it, so a custom domain needs no change.

They enter their **passport number and surname**, and both must belong to the
same file. Settings lets you drop the surname and ask for the passport number
alone. That is your call to make, but it is weaker: a passport number is not a
secret, and an employer, an agent or a relative may have it. Only the stage is
ever shown, never a name or contact detail, but with one field anybody holding
the number can see that client's progress. What comes back is deliberately thin: the case reference, the stage,
a sentence about what happens next, and how many documents are still owed.
Never a name, contact details, fees, payments or notes, and nothing about any
other client.

A passport number is not a secret, so guessing is guarded against three ways.
Two facts are needed, not one. Wrong pairs are limited per connection and every
attempt is logged where you can see it on the System page. And a wrong surname
gives exactly the same answer as an unknown passport, so the page cannot be
used to discover whether a passport number is on file.

A correct pair clears that connection's failed attempts, so one person guessing
on a shared office connection cannot lock out everybody behind it — and past the
limit a correct pair is still honoured, only wrong ones are turned away.

Switch the whole thing off in Settings if you would rather not offer it.

---

## 17. Consultation reminders by email

A message to the office inbox before each booked consultation, carrying the
client, the time, the place and the case reference.

Set it up in **Settings → Consultation reminders**. Zoho's server is filled in
already. The password is an **app password** generated in Zoho, not your
mailbox password — Zoho refuses ordinary passwords for SMTP. It is stored once
and never shown again. Use **Send a test message** to prove the settings before
relying on them, and **Send any due now** to run a sweep by hand.

**One caveat worth understanding before you rely on this.** On a plan where the
service sleeps when idle, the reminder sweep sleeps with it, so a reminder only
goes out if the portal happens to be awake. The free UptimeRobot ping described
earlier keeps it awake through the working day and solves this. Without either
that or a paid plan, treat reminders as a convenience rather than something to
depend on.

---

## 18. Data entry

**Countries and nationalities are chosen, not typed**, so the same country
cannot arrive as "Zim", "zimbabwe" and "Zimbabwe " in three records.
Nationality uses demonyms — Mosotho, Zimbabwean — matching what the website
form already collects. Lesotho and its neighbours sit at the top of both lists.

A record created before a list changed keeps whatever it holds: an unrecognised
value is shown as an extra option rather than dropped, so opening an old file
and pressing Save can never quietly erase it.

**Permit expiry follows the permit.** Choose *No current permit* and the expiry
field is replaced by **n/a** and any stored date is cleared, because there is
nothing to expire. A blank status is different — it means "not stated yet", so
a date typed there is kept.

**Email addresses are checked twice**, in the browser before the request is
sent and again on the server, on client records, staff accounts and invoices.

**Dates are unambiguous.** Every date field gives the operating system's own
calendar, and echoes the choice back in words underneath — *Saturday, 5
September 2026* — so nobody has to wonder whether 05/09 means September or May.

**"Other" always asks what.** A dropdown that stops at *Other* throws the
answer away. Choosing it opens a box to say what, and what is typed is what
gets stored, so a file reads *Special permit under section 12* rather than
*Other*. This applies to permit status, gender, payment method and service.

---

## 19. Security

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

## 20. When something goes wrong

| What you see | What it usually is |
|---|---|
| Build fails: "no matching distribution for psycopg-binary" | Render picked a Python version too new for the database driver's prebuilt wheel. Set `PYTHON_VERSION` to `3.12.7` and redeploy |
| Build fails on Render | `requirements.txt` missing from the repository root |
| Deploy succeeds, site won't load | `PORT` was set by hand — delete that variable |
| "Sign in to continue" straight after signing in | System clock skew, or the session expired after 12 hours |
| Enquiries never arrive | Wrong key, or your domain missing from `ALLOWED_ORIGINS`. Check the System page |
| Backup shows a red dot | Supabase password wrong in `MIRROR_DATABASE_URL`, or the project was paused for inactivity |
| Everything is slow on the first click | Free-plan sleep. See the section above |
| Someone cannot sign in and has lost their phone | Staff → Clear two-step on their row. Only the account owner can |
| A button briefly says the portal is starting up | The service was asleep or redeploying. The portal retries three times on its own before showing this; wait a moment and press again |

Render's own logs (**Logs** tab) print the reason for any server error.

---

## 21. The files in this repository

| File | What it is |
|---|---|
| `server.py` | HTTP server, routing, static files, CORS, the website intake script |
| `api.py` | Every API endpoint |
| `core.py` | Passwords, sessions, taxonomies, document checklists, audit |
| `db.py` | SQLite/Postgres adapter, schema, the backup copy |
| `static/index.html` | Sign-in screen and portal shell |
| `static/app.css` | Stylesheet — brand colours at the top |
| `static/app.js` | The whole front end |
| `requirements.txt` | Two dependencies: Postgres access and the QR code |
| `render.yaml` | Render service definition |
| `.python-version` | Pins Python, so a new release cannot break the build |
| `README.md` | This document — the whole manual |
| `test_api.py` | 129 checks across every endpoint |
| `test_ui.js` | 43 checks driving the real interface |
| `test_restart.py` | Survives restarts and dropped connections |
| `audit.py` | Concurrency, unicode, injection, permissions, exports |
| `test_features.py` | Two-step sign in and the service catalogue |
| `test_public.py` | Case tracking and email reminders |
