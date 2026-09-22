# Postlyra — Backend (Auth + Dashboard)

A working Node.js/Express backend for the Postlyra signup/login flow,
serving your existing landing page plus new login, signup, and dashboard
pages styled to match.

## What's included

- `server.js` — Express app, serves `/public`, mounts the auth + uploads APIs
- `routes/auth.js` — signup, login, logout, "who am I", forgot-password (stub)
- `routes/uploads.js` — upload a photo, generate per-platform crops + AI captions
- `services/imageProcessor.js` — smart crop/resize via sharp (the "attention" strategy auto-detects the subject so it isn't cut off)
- `services/captionGenerator.js` — calls Claude's vision API to write platform-matched captions/hashtags from the photo
- `config/platforms.js` — the 10 supported platforms, their target dimensions, and caption tone guidance
- `middleware/authenticate.js` — verifies the session cookie on protected routes
- `db.js` / `uploadsDb.js` — simple JSON-file stores for users and uploads (swap for Postgres/MySQL later)
- `public/index.html` — your landing page (unchanged)
- `public/login.html`, `public/signup.html`, `public/dashboard.html` — auth pages
- `public/upload.html` — pick a photo + platforms, see crops and captions generated live
- `public/history.html` — every past upload, expandable to view/copy captions again or delete it

## How auth works

- Passwords are hashed with bcrypt before they're ever stored.
- On signup/login, the server signs a JWT and sets it as an **httpOnly
  cookie** — JavaScript on the page never touches the token directly, which
  protects it from theft via XSS.
- `GET /api/auth/me` reads that cookie to check who's signed in (this is
  what `dashboard.html` calls to get the business name).
- Sessions last 7 days; signing out clears the cookie.

## How the upload pipeline works

1. You pick a photo and the **exact sizes** you want it in — e.g. Instagram
   Square Post, Instagram Story, AND LinkedIn Landscape, all from one
   upload. Every platform lists every format it actually supports; one is
   pre-checked by default per platform so the form isn't overwhelming, but
   you can check as many as you like.
2. The server resizes the photo to fit fully inside each selected size —
   nothing is ever cropped or cut off. Any leftover space is filled with a
   blurred, darkened version of the same photo (the same trick Instagram
   Stories uses), so there are no empty bars either.
3. The original photo (downscaled for efficiency) is sent once to Claude's
   vision API, which writes **two different caption + hashtag options**
   per platform — tone-matched (LinkedIn reads differently than TikTok).
   On the upload page, you can pick either option, or just type your own
   caption from scratch in the same editable box — the Copy button always
   grabs whatever's currently in it.
4. Everything is saved to disk and listed in the response: image URLs per
   size, and the caption options per platform.

**Without a `GEMINI_API_KEY`,** the resize step still works fully —
captions just show a placeholder telling you to add a key. Real captions
appear automatically the moment a key is added; no code changes needed.

### Getting a Gemini API key (free)

1. Go to **aistudio.google.com** and sign in with a Google account.
2. Click **Get API key** → **Create API key**. No credit card or billing
   setup required for the free tier.
3. Copy the key.
4. Open `.env` and set:
   ```
   GEMINI_API_KEY=...
   ```
5. Restart the server (`Ctrl+C`, then `npm start`).

That's it — no other code changes needed.

**Worth knowing before you scale this up:** Google's free tier comes with
tight, frequently-changing rate limits, and its terms currently exclude
commercial use (your inputs may also be used to improve their models on
the free tier — that changes once billing is enabled). Fine for building
and testing; worth revisiting once you have paying customers relying on
this daily. The Anthropic API is the paid alternative this was built
against originally — cheap per-call, no commercial-use restriction — see
`services/captionGenerator.js` for the integration if you want to switch
back or compare.

## Running it locally

```bash
npm install
cp .env.example .env
```

Open `.env` and replace `JWT_SECRET` with a real random value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Paste that output in as `JWT_SECRET=...`, then start the server:

```bash
npm start
```

Visit **http://localhost:3000** — that's your landing page. Sign Up, log
in, and you'll land on the dashboard placeholder.

User data is stored in `data/users.json`, created automatically on first
run. Delete that file any time to reset all accounts (handy for testing).

## API reference

| Method | Path                          | Body / params                                                    | Notes                                  |
|--------|--------------------------------|--------------------------------------------------------------------|------------------------------------------|
| POST   | `/api/auth/signup`             | `businessName, email, password, confirmPassword, agreedToTerms`   | Creates account, signs you in           |
| POST   | `/api/auth/login`              | `email, password`                                                  | Signs you in                            |
| POST   | `/api/auth/logout`             | —                                                                   | Clears the session                      |
| GET    | `/api/auth/me`                 | —                                                                   | Requires session cookie                 |
| POST   | `/api/auth/forgot-password`    | `email`                                                             | Stub — see note below                   |
| GET    | `/api/uploads/platforms`       | —                                                                   | Platforms + every format each one supports |
| GET    | `/api/uploads`                 | —                                                                   | This user's upload history              |
| POST   | `/api/uploads`                 | multipart: `photo` (file), `variants` (JSON array of `{platformId, formatId}`, optional) | Generates the selected sizes + 2 caption options per platform; omit `variants` to use one default size per platform |
| GET    | `/api/uploads/:id/file/:platformId/:formatId` | —                                                             | Serves one rendered image               |
| DELETE | `/api/uploads/:id`             | —                                                                   | Deletes a past project (files + record) |

## What's intentionally NOT built yet

This covers auth + the upload/AI pipeline, per your last two messages.
Still ahead, whenever you're ready:

1. **Forgot password is a stub.** It validates the email and responds
   successfully, but doesn't send an email yet — you'll need an email
   provider (Resend, SendGrid, SES) and a reset-token table for that to
   actually work.
2. **The JSON file stores are for development.** Fine for testing, but
   they don't handle concurrent writes safely. Move to Postgres/MySQL
   before you have real signups.
3. **No video support yet** — this version handles photos only, per your
   last answer. Video would need ffmpeg and a longer-running job queue.
4. **Social platform publishing and billing** are separate, larger pieces
   of backend work — not covered here. Right now, "approve" just means
   downloading/copying — there's no actual one-click publish to Instagram,
   TikTok, etc. yet.

## Production checklist (before this goes live anywhere public)

- [ ] Real `JWT_SECRET`, kept out of version control
- [ ] Real database instead of the JSON files
- [ ] Real cloud storage (S3 or similar) instead of local disk for uploaded photos
- [ ] HTTPS (cookies are flagged `secure` automatically when `NODE_ENV=production`)
- [ ] Rate limiting on `/api/auth/*` and `/api/uploads` to slow down abuse
- [ ] Real email sending for forgot-password
- [ ] A plan for AI captions at scale — either Gemini paid tier or switching to a paid provider once free-tier rate limits or commercial-use terms become a problem
