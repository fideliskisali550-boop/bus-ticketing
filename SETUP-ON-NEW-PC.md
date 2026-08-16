# SafiriConnect — Setup on a New PC

This guide explains how to move SafiriConnect to another computer and run it.

---

## 1. The one thing you must NOT copy

The project folder contains two folders that are **specific to this machine** and
must **not** be copied. They contain compiled, platform-specific binaries (the
Prisma database engine and the Next.js compiler) and copying them causes errors:

- `node_modules/`  — reinstalled fresh with `npm install`
- `.next/`         — rebuilt fresh with `npm run build`

Everything else in the folder **should** be copied, including the hidden
`.env` file (it holds the configuration) and, if you want to keep your data,
`prisma/dev.db`.

---

## 2. Install Node.js on the new PC (one-time)

SafiriConnect needs **Node.js 18 or newer** (Node 20 LTS is recommended).

1. Go to <https://nodejs.org/> and download the **LTS** installer for Windows.
2. Run it and accept the defaults (this also installs `npm`).
3. Confirm it worked — open a new Command Prompt and run:
   ```
   node -v
   ```
   You should see a version number such as `v20.x` or higher.

An **internet connection is required the first time** you set the app up, because
`npm install` downloads the packages. After that it runs offline.

---

## 3. Copy the project (excluding the two folders)

**Option A — copy with robocopy (recommended, excludes the heavy folders):**
Open Command Prompt and run (adjust the destination):
```
robocopy "C:\Users\Admin\Desktop\Bus Ticketing" "D:\SafiriConnect" /E /XD node_modules .next
```
`/E` copies all sub-folders; `/XD node_modules .next` skips those two.

**Option B — zip it:**
Delete `node_modules` and `.next` from a **copy** of the folder, then zip the
copy and move it. (Do not delete them from your working copy unless you plan to
reinstall here too.)

Either way, make sure these are included in the copy:
- the whole `src/` folder and `prisma/schema.prisma`
- `package.json` **and** `package-lock.json` (keeps versions identical)
- config files: `next.config.*`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.*`
- `.env`  (hidden — holds `DATABASE_URL`, `JWT_SECRET`, etc.)
- `START-SAFIRICONNECT.bat`
- `prisma/dev.db`  — **optional, ~182 MB.** See the note below.

### Keep your data, or start fresh?
- **Copy `prisma/dev.db`** → you keep everything exactly as it is now: all
  operators, trips, bookings and the **exact verification codes** you have been
  testing with. Use this if you plan to demo specific codes.
- **Skip `prisma/dev.db`** → the setup step below builds a **new** seeded
  database. The data is similar but the codes and references are different.

---

## 4. Run it

### The easy way — the launcher
Double-click **`START-SAFIRICONNECT.bat`** in the copied folder. On the first run
it automatically:
1. checks Node.js is installed,
2. runs `npm install` (downloads packages — a few minutes),
3. if there is no database, runs `npm run setup` to create and seed one
   (~4 minutes; skipped if you copied `dev.db`),
4. builds the app,
5. starts the server and opens your browser at <http://localhost:3000>.

Keep that window open while you use the app. Close it (or press Ctrl+C) to stop.

### The manual way (Command Prompt in the project folder)
```
npm install
npm run setup      REM  <-- run this ONLY if you did NOT copy prisma\dev.db
npm run build
npm run start
```
Then open <http://localhost:3000>.

---

## 5. Sign in

| Role          | Email                          | Password     |
|---------------|--------------------------------|--------------|
| Administrator | admin@safiriconnect.co.ke      | Password123  |
| Booking staff | staff@safiriconnect.co.ke      | Password123  |
| Passenger     | passenger@example.com          | Password123  |

(These demo accounts exist whether you copied the database or let setup create it.)

---

## 6. Common problems

- **`node` is not recognised** — Node.js is not installed, or you did not open a
  **new** Command Prompt after installing it. Install/reopen and try again.
- **Port 3000 is already in use (EADDRINUSE)** — the app is already running in
  another window. Close that one first; only run **one** instance at a time.
- **Errors mentioning Prisma or a `.dll` / native module** — you copied
  `node_modules`. Delete it and run `npm install` again to rebuild it for this PC.
- **`npm install` fails** — usually no internet or a full disk. Fix either and
  re-run.
- **Different operating system (Mac/Linux)** — the SQLite database and the source
  copy fine, but the `.bat` launcher is Windows-only; use the manual `npm`
  commands in step 4. Still do **not** copy `node_modules` or `.next`.

---

## 7. Quick checklist

- [ ] Node.js 18+ installed on the new PC
- [ ] Project folder copied **without** `node_modules` and `.next`
- [ ] `.env` and `package-lock.json` included in the copy
- [ ] Decided whether to copy `prisma/dev.db` (keep data) or not (fresh data)
- [ ] Ran the launcher, or `npm install` → (setup) → `npm run build` → `npm run start`
- [ ] Opened <http://localhost:3000> and signed in
