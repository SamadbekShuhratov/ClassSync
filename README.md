# ClassSync

Put your screen in front of every student. ClassSync runs on the teacher's laptop and lets you, in one click:

- **Open a website on every student computer** — no more spelling out URLs.
- **Share your screen live** — a window, a tab or the whole display, full-screen on every desk.
- **Collect assignments** — an upload box appears for everyone; see who handed in, download it all as one ZIP.
- **Focus mode** — cover student screens with a message so the room looks up.
- **Announcements** — pin an instruction to the top of every student's screen.

It needs **only Python 3.9+** — no packages, no internet, no cloud. Everything stays on your school network.

---

## Quick start

### 1. Teacher laptop

```bash
python run.py
```

```
  ClassSync 1.0.0 is running
  ──────────────────────────────────────────────
  Teacher dashboard   http://localhost:8000
  Students join at    http://192.168.1.10:8000/join
```

Open **http://localhost:8000**, create a teacher account and a class. Press **Show join code** to put the code on the projector.

> **Windows:** allow Python through the firewall on *Private networks* when asked, otherwise students can't connect. Or double-click `windows\start-server.bat`.

### 2. Student computers — pick one

| | How | What students get |
|---|---|---|
| **Browser only** | Open `http://<teacher-ip>:8000/join`, type the code and name | Live screen, links (one-click open), assignments, focus mode |
| **ClassSync Helper** (recommended for lab PCs) | `python helper.py --server 192.168.1.10:8000 --code ABC123 --name "Aziza Karimova"` | Everything above **plus** links open by themselves and the class page pops up when you start sharing |

The helper remembers its settings in `~/.classsync/helper.json`, reconnects on its own, and can start at sign-in:

```bash
python helper.py --autostart      # Windows Startup folder, macOS LaunchAgent or Linux autostart
```

---

## Using it in a lesson

| You do (teacher console) | Students see |
|---|---|
| **Live → Open a link for everyone** | The site opens in their browser (helper) or a card with an *Open* button |
| **Live → Start sharing** | Your screen, full-screen-able, in their class page. The yellow bar tells you how many are watching |
| **Quality: Data saver / Balanced / Sharp** | Lower bandwidth on weak Wi-Fi, or crisp small text for code |
| **Focus mode** switch | A full-screen "eyes on the teacher" cover with your message |
| **Announcement → Pin for everyone** | A yellow banner on top of their page |
| **Assignments → New assignment** | An upload box (file types, size limit and due date enforced). Re-submitting creates a new version |
| **Submissions → Download all (.zip)** | — you get `Student Name/file.ext` for every latest submission |

---

## How it works

```
 teacher browser ──JPEG frames──►  run.py (ThreadingHTTPServer + SQLite)  ──MJPEG──►  student portals
   console        ◄──SSE events──                                         ──SSE───►  helper.py → default browser
```

- **Real-time:** Server-Sent Events for commands and presence; the teacher's screen is captured with `getDisplayMedia`, encoded to JPEG in the browser and fanned out as an MJPEG stream. Only the newest frame is kept, so slow viewers skip frames instead of lagging.
- **Bandwidth-aware:** unchanged frames are skipped (a static slide costs ~one frame every 2 s); capture is timed from a Web Worker so it keeps running while the console tab is in the background.
- **Storage:** `data/classsync.db` (SQLite, WAL) and `data/uploads/`. Back up the `data` folder to keep everything.

### Security

- Passwords hashed with PBKDF2-SHA256 (260k iterations); session tokens stored only as SHA-256 hashes; HttpOnly + SameSite cookies.
- CSRF protection via a required custom header and same-origin check; strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`.
- Login and join rate-limiting; constant-time checks for unknown e-mails.
- Teachers can only reach their own classes; students only their own files. Uploads are stored under random names, size/type-checked and always served as downloads.
- The helper opens **only** `http(s)` links and never runs programs. Its portal sign-in uses a one-time link that expires in 2 minutes.

### Options

```bash
python run.py --port 9000 --data /srv/classsync   # custom port / data folder
python run.py --no-register                       # stop new teacher sign-ups once your staff are set up
python run.py --secure-cookies                    # when served behind HTTPS
python helper.py --reset                          # forget the saved class
python helper.py --no-portal                      # only open links, never the class page
```

### Limits & tips

- All computers must be on the same network. If students can't load the join page, check the firewall first.
- Screen sharing needs Chrome, Edge or Firefox on the teacher's computer.
- For 30+ students on Wi-Fi, use **Data saver**. On wired labs **Sharp** is fine.

## Project layout

```
run.py                 server entry point
helper.py              student desktop helper
classsync/
  server.py            HTTP dispatch, security headers, CSRF, bootstrap
  core.py              routing, request/response helpers
  db.py                SQLite schema and access
  security.py          hashing, tokens, rate limiting, sanitising
  realtime.py          SSE channels, presence, screen frames
  auth.py              teacher accounts & sessions, guards
  teacher.py           classes, live controls, assignments, ZIP export
  student.py           join, portal events, uploads
  pages.py             HTML pages & static assets
web/                   pages, CSS design system, ES-module JavaScript
windows/               double-click launchers
```
