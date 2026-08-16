# Plumbline — setup

From a clean machine to a running app. Read the two **Gotchas** at the bottom
first if something goes wrong; both have cost real time.

## Prerequisites

- **Node.js 18+** — <https://nodejs.org>
- **Python 3.6+** — <https://python.org> (used only by the build)
- **Git**
- Access to the Plumbline Supabase project

## 1. Clone to a local disk

```
git clone https://github.com/rmsamuel2/Plumbline2.git C:\dev\Plumbline2
cd C:\dev\Plumbline2
```

The path matters. **Do not clone into a Google Drive or OneDrive folder** — see
Gotcha 1. Any local folder is fine; GitHub is the source of truth, so the
working copy is disposable.

## 2. Create `server\.env`

`.env` is gitignored and never travels with the repo. Copy the template and
fill it in with values supplied by the project owner **out of band** — not
through GitHub, not by email:

```
copy server\.env.example server\.env
notepad server\.env
```

| Key | Notes |
| --- | --- |
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string. **Use the session pooler hostname** (`*.pooler.supabase.com`). The direct hostname is IPv6-only and fails on most Windows networks. |
| `SESSION_SECRET` | Must be **identical** across everyone sharing a database, or sessions issued by one server will not validate against another. |
| `ANTHROPIC_API_KEY` | Only needed for LLM features. The key stays server-side and never reaches the browser. |

If a password contains `$`, keep it in **single** quotes anywhere you paste it
into PowerShell — double quotes silently expand `$word`.

## 3. Run setup

```
powershell -ExecutionPolicy Bypass -File .\setup-plumbline.ps1
```

It checks prerequisites and the filesystem, runs `npm install`, applies every
database migration through 006 (idempotent), builds
`dist\Plumbline_Studio_V2.html`, starts the API on port 8080 in its own window,
and opens `http://localhost:8080/#/home`.

Seeded logins are `rob / password` and `max / password`. **Change both
immediately** — Account → Change password, which revokes old sessions and
writes an audit row.

## Day-to-day

| Task | Command |
| --- | --- |
| Start the app | `start-plumbline.bat` |
| Rebuild after editing `src\` | `python build.py`, then refresh the browser |
| Full setup (after pulling `package.json` or migration changes) | `setup-plumbline.ps1` |
| Stop | close the "Plumbline API" window |
| Edit without building | open `src\plumbline-dev.html` |

## Adding a user

Sign in with a superuser account, then choose **Create account** in the top
navigation. Anonymous signup is disabled; the API enforces the same
superuser-only rule even if a client attempts to call it directly. Passwords
are hashed through the same `bcrypt.hash(pw, 10)` path used by authentication.

Then promote if needed:

```sql
update users set user_type = 'analyst' where username = 'someone';
```

`user_type` is one of `user` (save workflows), `analyst` (also run conformance
analysis), or `superuser` (everything). Row-level security scopes workflows by
`owner_user_id`, so **give each person their own account** rather than sharing
one — otherwise you are all editing the same objects with no ownership
distinction.

## Sharing one database

Workable, with two hazards worth agreeing on up front:

- You can overwrite each other's data.
- A migration run from any machine hits everyone. Route schema changes through
  one person.

An isolated Supabase project plus `npm run migrate` takes about five minutes if
you would rather not share.

---

## Gotcha 1 — the repo cannot live on Google Drive

`node_modules` needs a real local filesystem. npm extracts tarballs using rapid
write-then-rename, hardlinks, and many concurrent file handles. The Google
Drive virtual filesystem — the whole `G:` mount, not just `My Drive` — supports
none of these.

Symptoms:

```
npm warn tar TAR_ENTRY_ERROR UNKNOWN: unknown error, write
```

then, at run time:

```
Error: Invalid package config ...\node_modules\pg\package.json
code: 'ERR_INVALID_PACKAGE_CONFIG'
```

naming a **different package each run**, because every package is damaged.

Pausing sync does **not** help — the filesystem driver is the problem, not the
sync agent. Redirecting `node_modules` with a junction does not work either:
the driver refuses reparse points outright (`New-Item : Incorrect function`).

The only fix is to clone to a local disk. `setup-plumbline.ps1` now probes for
this and stops before installing. OneDrive placeholder folders and some network
shares behave the same way.

## Gotcha 2 — usernames are lowercased by the UI

The sign-in form lowercases before sending:

```js
const username = authVal("authUser").toLowerCase();
```

The server does an exact match:

```sql
select id, password_hash from users where (username=$1 or email=$1) and is_active
```

So an account inserted via SQL as `Lukka` can never be logged into — the form
sends `lukka`, which does not match. The password is irrelevant; it fails
before the hash comparison.

Create accounts through `/api/signup` (which applies the same lowercasing), or
insert lowercase usernames in SQL. To diagnose, this returns `true` when the
password is genuinely correct — if it does, the problem is the lookup, not the
hash:

```sql
select username, is_active,
       password_hash = crypt('the-password', password_hash) as pw_ok
from users where username ilike '%name%';
```
