# Deploying the MAC Admin Portal

Everything below is on free plans. Set aside about forty minutes the first
time. Do the steps in order — each one produces something the next step needs.

You will end up with:

| Piece | Service | Costs |
|---|---|---|
| The portal itself | Render web service | free |
| The main database | Neon Postgres | free |
| The backup database | Supabase Postgres | free |
| The code | GitHub repository | free |

---

## Step 1 — Put the code on GitHub

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

## Step 2 — Create the Neon database (this is the real one)

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

## Step 3 — Create the Supabase backup database

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

## Step 4 — Create the Render web service

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

## Step 5 — Point the website at the portal

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

## Step 6 — Use your own subdomain (optional)

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

## What the free plans actually mean

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

## Day-to-day operations

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

## If something goes wrong

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
