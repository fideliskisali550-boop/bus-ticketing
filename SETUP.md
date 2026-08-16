# SafiriConnect — Setup Guide

How to get this project running on a brand-new computer, from nothing.

Written for someone who has never seen this project before. Every step below was
tested on a clean copy — no leftover files, no prior configuration — so it works
as written.

**Total time:** about 10 minutes, most of it waiting for downloads.

---

## Before you start

You need three things:

| Requirement | Details |
|---|---|
| **Internet connection** | Only for the one-time install. The app itself runs entirely offline afterwards. |
| **~2 GB free disk space** | The project source is under 1 MB; the rest is downloaded libraries. |
| **The project folder** | The `Bus Ticketing` folder, copied from a flash drive, cloud storage, or Git. |

Works on **Windows, macOS and Linux**. Commands are identical on all three
unless noted.

---

## Step 1 — Install Node.js

Node.js is the engine that runs the application. It is the only thing you must
install by hand.

1. Go to **<https://nodejs.org>**
2. Download the **LTS** version (the left-hand button, marked "Recommended For
   Most Users")
3. Run the installer and click Next through every screen — the defaults are fine
4. **Restart your computer** if the installer asks

### Check it worked

Open a terminal:

- **Windows** — press `Win + R`, type `cmd`, press Enter
- **macOS** — press `Cmd + Space`, type `Terminal`, press Enter
- **Linux** — press `Ctrl + Alt + T`

Type these two commands, pressing Enter after each:

```bash
node -v
npm -v
```

You should see two version numbers, for example:

```
v22.14.0
10.9.2
```

**Any Node version 18 or higher works.** If you instead see
`'node' is not recognized`, Node did not install correctly — restart the
computer and try the installer again.

> **Nothing else needs installing.** No database server, no Docker, no Python.
> The database is a single file that the project creates for itself.

---

## Step 2 — Open the project folder in your terminal

Copy the `Bus Ticketing` folder somewhere sensible, such as your Desktop. Then
tell the terminal to work inside it with the `cd` ("change directory") command.

**Windows:**
```bash
cd "C:\Users\YourName\Desktop\Bus Ticketing"
```

**macOS / Linux:**
```bash
cd ~/Desktop/"Bus Ticketing"
```

Replace `YourName` with the actual Windows username.

> **Shortcut:** type `cd ` (with a space), then drag the folder from your file
> manager onto the terminal window. The path fills in by itself, quotes and all.

### Check you are in the right place

```bash
dir          # Windows
ls           # macOS / Linux
```

You should see `package.json`, `README.md`, `prisma` and `src` listed. If you
do not, you are in the wrong folder.

---

## Step 3 — Create the settings file

The project ships with a template called `.env.example` but **not** the real
`.env` file, because that file holds secrets and is deliberately kept out of
version control. You must create it by copying the template.

**Windows:**
```bash
copy .env.example .env
```

**macOS / Linux:**
```bash
cp .env.example .env
```

That is the whole step. The default values work as-is for development.

> ### ⚠ Do not skip this
> This is the single most common reason setup fails. Without `.env`, the next
> step stops with `Environment variable not found: DATABASE_URL`. If you see
> that error, you missed this step — run the copy command and try again.

---

## Step 4 — Download the libraries

```bash
npm install
```

This downloads about 440 packages. **It takes 2–5 minutes** depending on your
connection, and prints a lot of text. That is normal.

**Warnings in yellow are safe to ignore.** Messages containing `deprecated` are
notices about third-party packages, not errors. You are looking for a final line
like:

```
added 441 packages in 2m
```

If it stops with a red `ERR!`, check your internet connection and run
`npm install` again.

---

## Step 5 — Build the database and load the sample data

```bash
npm run setup
```

One command does three jobs: prepares the database tools, creates the database
file, and fills it with realistic demonstration data.

**This takes about two minutes.** You will know it worked when it prints:

```
Seed complete in ~2 minutes.

  254 locations (238 in Kenya across 47 counties, 16 international)
  1,952 routes from 81 origins (65 hand-priced, 1,887 derived, 116 cross-border)
  15 operators · 300 buses · 18,000 departures · 72,000 bookings

Sign in with:
  Admin      admin@safiriconnect.co.ke      / Password123
  Staff      staff@safiriconnect.co.ke      / Password123
  Passenger  passenger@example.com          / Password123
```

The database is now a file at `prisma/dev.db`. Nothing was installed system-wide
and nothing was sent over the internet.

---

## Step 6 — Start it

```bash
npm run dev
```

Wait for:

```
✓ Ready in 8s
- Local:  http://localhost:3000
```

Open a web browser and go to **<http://localhost:3000>**

You should see the SafiriConnect home page with live departure data.

> **Leave the terminal window open.** Closing it stops the server. To stop it
> deliberately, click the terminal and press `Ctrl + C`.

---

## Step 7 — Sign in

The sign-in page lists the demo accounts and you can **click any of them to fill
the form in automatically.**

| Role | Email | Password | What they can do |
|---|---|---|---|
| **Administrator** | `admin@safiriconnect.co.ke` | `Password123` | Everything, including users and the audit trail |
| **Booking staff** | `staff@safiriconnect.co.ke` | `Password123` | Departures, routes, fleet, bookings, gate check-in |
| **Passenger** | `passenger@example.com` | `Password123` | Search, book, pay, manage own tickets |

---

## Before you present: use demo mode

`npm run dev` recompiles each page the first time you open it, so the first
click on any screen takes a few seconds. That is the development server doing
its job, not the application being slow.

For a presentation, run this instead:

```bash
npm run demo
```

It builds the optimised version and serves it on <http://localhost:3000>. Every
screen then responds in well under a tenth of a second. The build takes about a
minute; do it before the examiners arrive, not during.

You can confirm the difference yourself with `npm run perf` in a second
terminal.

---

## A five-minute demonstration route

If you are showing this to someone, this order tells the clearest story:

1. **Home page** — live routes and fares, pulled from the database
2. **Find a bus** → search *Nairobi → Mombasa* — several bus companies compete
   on the same corridor at different prices; filter by company or sort by fare
3. **Select seats** — the actual layout of that bus; taken seats are struck through
4. **Pay** — choose M-Pesa; a prompt simulates for 3–6 seconds, then confirms
5. **Your ticket** — QR boarding code; click *Download ticket* for the PDF
6. Sign out, sign in as **admin** → **Operations overview** — charts and revenue
7. **Check-in** — paste a ticket code to board a passenger
8. **Audit trail** — every action recorded, with who did it and from where

Toggle **dark mode** with the moon icon, and resize the window to show the
mobile layout.

To show all three roles at once without signing in and out: account menu →
*Sign in to another account*, repeat for each role, then open extra tabs and
switch each one to a different account. Each tab keeps its own identity.

> **Payments are simulated and cannot charge anyone.** The simulator deliberately
> fails roughly 1 time in 10 so you can demonstrate the retry path — if a payment
> fails during your demo, that is the feature working, not a bug. Just try again.

---

## Coming back to it later

Once set up, you only ever need the last command:

```bash
cd "path/to/Bus Ticketing"
npm run dev
```

Steps 1–5 are one-time only.

---

## If something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| `'node' is not recognized` | Node.js is not installed, or needs a restart | Redo Step 1, then restart the computer |
| `Environment variable not found: DATABASE_URL` | The `.env` file is missing | Redo Step 3 |
| `Cannot find module` | Libraries did not download fully | Run `npm install` again |
| `Port 3000 is already in use` | Another program has that port | Run `npm run dev -- -p 3001`, then use <http://localhost:3001> |
| `EACCES` / permission denied | Folder is write-protected | Move the project to your Desktop and retry |
| `ENOSPC: no space left on device` | Disk is full | Free up at least 2 GB and run `npm install` again |
| Page loads but looks unstyled | Build cache is stale | Stop with `Ctrl + C`, delete the `.next` folder, run `npm run dev` |
| Data looks wrong or empty | Database got into a bad state | Run `npm run db:reset` to wipe and reload |

### The universal fix

If it is behaving strangely and you cannot tell why, this resets everything
except your source code:

```bash
npm run db:reset
```

To go further and rebuild from scratch, delete the `node_modules` and `.next`
folders, then repeat Steps 4 and 5.

---

## Moving the project to another computer

**Copy the source only.** Specifically, **do not copy the `node_modules` folder.**
It contains programs compiled for one specific operating system and will break
on a different machine — and it is by far the largest part of the folder.

Safe to copy — everything except:

```
node_modules/     ← never copy; recreated by `npm install`
.next/            ← never copy; build cache
prisma/dev.db     ← optional; `npm run setup` creates a fresh one
.env              ← optional; recreated in Step 3
```

The source that actually matters is about **1 MB / 93 files.** On the new
machine, start from Step 1.

---

## All available commands

Run these from inside the project folder.

| Command | What it does |
|---|---|
| `npm run dev` | Start for development (what you normally want) |
| `npm run build` | Compile the optimised production version |
| `npm start` | Run the production version (needs `npm run build` first) |
| `npm run setup` | First-time database creation and sample data |
| `npm run db:reset` | Wipe the database and reload sample data |
| `npm run db:studio` | Open a visual database browser |
| `npm run demo` | **Build and serve for a presentation** (what to use on the day) |
| `npm test` | Run the automated tests (66 should pass) |
| `npm run perf` | Measure how fast each screen responds |
| `npm run typecheck` | Check the code for type errors |

> **Do not run `npm run build` while `npm run dev` is running.** They write to
> the same folder and will corrupt each other, producing
> `Cannot find module './xxxx.js'`. Stop one before starting the other; if it
> happens, delete `.next` and restart.

---

## Deploying to a real server

For the presentation, everything above is sufficient — it runs on a laptop with
no internet.

When you are ready to put it online:

1. **Change `JWT_SECRET`** in `.env` to a long random string. The development
   default is publicly known and must not protect real accounts.
2. **Switch to PostgreSQL** — change one line in `prisma/schema.prisma`. See
   *Deployment* in [README.md](README.md).
3. **Serve over HTTPS.** The code detects production and switches cookies to
   secure mode automatically.
4. **Add real payments** only when you choose to. See *Going live with M-Pesa*
   in the README. Until then the simulator runs and nothing can be charged.

---

## What this project installs on your computer

Worth knowing before you install anything on someone else's machine:

- **Node.js** is installed system-wide by its official installer (Step 1). This
  is the only system-wide change.
- **Everything else stays inside the project folder.** The ~440 libraries live
  in `node_modules`, and the database is the single file `prisma/dev.db`.
- **No database server, web server, or background service is installed.** Nothing
  starts automatically with your computer, and nothing runs when the terminal is
  closed.
- **To remove the project completely**, delete the folder. That is all — nothing
  is left behind except Node.js itself, which you can uninstall normally.
