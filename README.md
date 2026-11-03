<div align="center">

<img src="web/assets/img/logo.svg" alt="ClassSync logo" width="88">

# ClassSync

**Put your screen in front of every student.**

Push a link, share your screen and collect assignments on every computer in the classroom — at the same moment.
Runs on the teacher's laptop. No cloud, no installs, no internet required.

[![Python 3.9+](https://img.shields.io/badge/python-3.9%2B-1e3b35?logo=python&logoColor=white)](https://www.python.org/downloads/)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-1e3b35)](#requirements)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-1e3b35)](#quick-start)
[![License: MIT](https://img.shields.io/badge/license-MIT-f5d547)](LICENSE)

[Quick start](#quick-start) · [Features](#features) · [Screenshots](#screenshots) · [How it works](#how-it-works) · [Troubleshooting](#troubleshooting)

<br>

<img src="docs/screenshots/teacher-console.png" alt="The ClassSync teacher console while sharing a screen" width="860">

</div>

---

## Why ClassSync?

Every computer-lab lesson starts the same way: *"Go to docs dot python dot org, slash three, slash tutorial…"* — and five minutes later half the room is still on the wrong page.

ClassSync removes that friction. The teacher types the link once and it opens on every student computer. The teacher shares a window and it appears on every screen. The teacher opens an assignment and every student gets an upload box. Everything happens on the school's local network, so it works even when the internet doesn't.

## Features

| | |
|---|---|
| 🌐 **Open a link everywhere** | Send a website to every student computer in under a second. With the desktop helper it opens by itself; in the browser portal it arrives as a one-click card. |
| 🖥️ **Live screen sharing** | Share a window, a browser tab or the whole display. Three quality presets (*Data saver*, *Balanced*, *Sharp*) for anything from crowded Wi-Fi to wired labs. |
| 📥 **Assignment collection** | Set a due date, allowed file types and a size limit. Watch hand-ins arrive live, see who's missing, and download everything as one tidy ZIP (`Student Name/file.ext`). |
| 🎯 **Focus mode** | One switch covers every student screen with your message so the room looks up. |
| 📣 **Announcements** | Pin an instruction to the top of every student's page. |
| 👥 **Live roster** | See who is online, whether they use the browser or the helper, and what each student has handed in. |
| 🔒 **Private by design** | Accounts, names and files never leave the teacher's computer. Hardened against the usual web attacks (see [Security](#security)). |
| 🌗 **Polished UI** | Light and dark themes, responsive down to phones, keyboard accessible, respects *reduce motion*. |

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/student-portal.png" alt="Student portal showing the teacher's screen"><br><sub><b>Student portal</b> — the teacher's screen, links and assignments in one place.</sub></td>
    <td width="50%"><img src="docs/screenshots/submissions.png" alt="Submissions drawer"><br><sub><b>Submissions</b> — who handed in, who's missing, one-click ZIP download.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/join-code.png" alt="Join code shown on the projector"><br><sub><b>Join code</b> — put it on the projector; students type it once.</sub></td>
    <td><img src="docs/screenshots/portal-dark.png" alt="Student portal in dark mode"><br><sub><b>Dark mode</b> — follows the system setting or a manual toggle.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/landing.png" alt="Landing page"><br><sub><b>Landing page</b></sub></td>
    <td><img src="docs/screenshots/sign-up.png" alt="Teacher sign-up"><br><sub><b>Teacher sign-up</b> — with inline validation and a password-strength meter.</sub></td>
  </tr>
</table>

## Quick start

> **You need:** Python 3.9 or newer on the teacher's computer. Students need only a web browser.

**1 · Download**

```bash
git clone https://github.com/USERNAME/classsync.git
cd classsync
```

…or download the ZIP from the green **Code** button and extract it.

**2 · Start the server on the teacher's computer**

```bash
python run.py
```

```
  ClassSync 1.0.0 is running
  ──────────────────────────────────────────────────────────
  Teacher dashboard   http://localhost:8000
  Students join at    http://192.168.1.10:8000/join
  Data folder         /home/teacher/classsync/data
  ──────────────────────────────────────────────────────────
```

On Windows you can also double-click **`windows/start-server.bat`**.

**3 · Create your account and a class**

Open **http://localhost:8000**, choose **Create account**, then **New class**. Press **Show join code** and put it on the projector.

**4 · Students join**

Students open the address shown in the terminal (for example `http://192.168.1.10:8000/join`), type the six-letter code and their name. That's it.

> [!IMPORTANT]
> **Windows Firewall:** the first time you run the server, Windows asks whether Python may accept connections. Tick **Private networks** and click **Allow** — otherwise students can't connect. See [Troubleshooting](#troubleshooting) if you missed the prompt.

## The desktop helper (optional, recommended for computer labs)

Students can use ClassSync entirely in the browser. For lab computers, the **ClassSync Helper** adds automation:

- links the teacher sends **open by themselves** in the default browser,
- the class page **pops up** when the teacher starts sharing, turns on focus mode or opens an assignment,
- it **reconnects on its own** after Wi-Fi drops or the teacher's laptop restarts.

```bash
# first run — saves the settings
python helper.py --server 192.168.1.10:8000 --code ABC123 --name "Aziza Karimova"

# afterwards
python helper.py

# start automatically whenever this computer signs in
python helper.py --autostart
```

Settings are stored in `~/.classsync/helper.json`. On Windows, `windows/start-helper.bat` runs the helper with a double-click.

## Using ClassSync in a lesson

| In the teacher console | What students see |
|---|---|
| **Live → Open a link for everyone** | The site opens on their computer (helper) or as a card with an **Open** button (browser) |
| **Live → Start sharing** | Your screen, live, with a full-screen button. A yellow bar shows how many are watching |
| **Live → Quality** | *Data saver* for crowded Wi-Fi · *Balanced* by default · *Sharp* for small text and code |
| **Live → Focus mode** | A full-screen cover with your message until you switch it off |
| **Live → Announcement** | A banner pinned to the top of their page |
| **Assignments → New assignment** | An upload box with your instructions, accepted file types, size limit and due date |
| **Assignments → Submissions** | — live hand-in list, filters for *Handed in* / *Missing*, **Download all (.zip)** |
| **Students** | — online status, how each student is connected, hand-in counts, remove a student |
| **Activity** | — a timeline of everything that happened in the class |

## Requirements

| | Teacher computer | Student computers |
|---|---|---|
| **Software** | Python 3.9+ | Any modern browser · *(Helper: Python 3.9+)* |
| **Browser for screen sharing** | Chrome, Edge or Firefox (desktop) | Any |
| **Network** | Same local network (Wi-Fi or LAN) as the students | Same local network |
| **Python packages** | None — standard library only | None |

## Configuration

### Server — `run.py`

| Option | Default | Description |
|---|---|---|
| `--port PORT` | `8000` | Port to listen on |
| `--host HOST` | `0.0.0.0` | Network interface to bind (all by default) |
| `--data DIR` | `./data` | Where the database and uploaded files are stored |
| `--no-register` | off | Disable new teacher sign-ups once your staff have accounts |
| `--secure-cookies` | off | Mark cookies `Secure` — use when serving behind HTTPS |
| `--open` | off | Open the dashboard in a browser on start |
| `--debug` | off | Verbose logging |

### Helper — `helper.py`

| Option | Description |
|---|---|
| `--server ADDR` | Teacher's ClassSync address, e.g. `192.168.1.10:8000` |
| `--code CODE` | Six-character class code |
| `--name NAME` | Student's full name |
| `--autostart` | Start the helper automatically at sign-in (Windows / macOS / Linux) |
| `--no-portal` | Only open links; never open the class page automatically |
| `--reset` | Forget the saved class and start setup again |

### Backups

All state lives in the data folder:

```
data/
├── classsync.db     # accounts, classes, students, assignments (SQLite)
└── uploads/         # submitted files, one folder per class and assignment
```

Copy this folder to back up; copy it back to restore. **Never commit it to Git** — it contains password hashes and student work (it is already in `.gitignore`).

## How it works

```
                 JPEG frames (POST)                       MJPEG stream
 ┌─────────────┐ ─────────────────►  ┌──────────────────┐ ───────────►  ┌────────────────┐
 │  Teacher    │                     │   run.py         │               │ Student portal │
 │  console    │ ◄───────────────── │  HTTP server     │ ───────────►  │   (browser)    │
 │  (browser)  │   events (SSE)      │  SQLite · files  │  events (SSE) └────────────────┘
 └─────────────┘                     └──────────────────┘ ───────────►  ┌────────────────┐
                                                           events (SSE)  │  helper.py     │──► default browser
                                                                         └────────────────┘
```

- **Real-time messaging** uses Server-Sent Events — one long-lived HTTP connection per client that browsers reconnect automatically.
- **Screen sharing** captures the display with `getDisplayMedia`, encodes JPEG frames in the browser and fans them out as an MJPEG stream. The server keeps only the newest frame, so slow devices skip frames instead of falling behind.
- **Bandwidth-aware:** unchanged frames are not sent (a static slide costs about one frame every two seconds), and capture is driven from a Web Worker so it keeps running while the console tab is in the background.
- **Zero dependencies:** the server is built on Python's standard library (`http.server`, `sqlite3`, `hashlib`), and the frontend is plain HTML, CSS and ES modules — no build step, no CDN, works fully offline.

## Security

- Passwords are hashed with **PBKDF2-SHA256** (260,000 iterations). Session and student tokens are stored only as SHA-256 hashes.
- Cookies are `HttpOnly` and `SameSite=Lax`; changing your password signs out other devices.
- **CSRF** protection via a required request header and same-origin `Origin` check.
- Strict **Content-Security-Policy**, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- **Rate limiting** on sign-in, sign-up and class joining; uniform timing for unknown e-mail addresses.
- Teachers can access only their own classes; students only their own files.
- Uploads are stored under random names, checked for type and size, and always served as downloads.
- The helper opens **only** `http`/`https` links and never runs programs. Its browser sign-in uses a one-time link that expires after two minutes.

> [!NOTE]
> ClassSync is designed for a trusted school network and serves plain HTTP. If you expose it beyond your LAN, put it behind a reverse proxy with HTTPS and start it with `--secure-cookies`.

## Troubleshooting

<details>
<summary><b>Students can't open the join page</b></summary>

1. Make sure the teacher's computer and the students are on the **same network** (same Wi-Fi or LAN). Guest Wi-Fi networks often block device-to-device traffic.
2. Use the address printed in the terminal, not `localhost` (that only works on the teacher's own computer).
3. Allow the port through the firewall:
   - **Windows** (run PowerShell as Administrator):
     ```powershell
     netsh advfirewall firewall add rule name="ClassSync" dir=in action=allow protocol=TCP localport=8000 profile=private
     ```
     Also check that your network is set to **Private**, not Public (*Settings → Network & Internet → Properties*).
   - **macOS:** click **Allow** when asked whether Python may accept incoming connections.
   - **Linux (ufw):** `sudo ufw allow 8000/tcp`
</details>

<details>
<summary><b>"Could not start on port 8000"</b></summary>

Another program is using the port. Start on a different one: `python run.py --port 8080`, and give students the new address.
</details>

<details>
<summary><b>"Start sharing" does nothing or shows an error</b></summary>

Screen sharing needs **Chrome, Edge or Firefox on a desktop computer**, and the console must be opened at `http://localhost:8000` on the teacher's computer (browsers only allow screen capture on `localhost` or HTTPS). On macOS, allow your browser under *System Settings → Privacy & Security → Screen Recording*.
</details>

<details>
<summary><b>The shared screen is choppy</b></summary>

Switch **Quality** to **Data saver**. Sharing a single window instead of the whole screen also reduces bandwidth. Wired connections handle **Sharp** comfortably.
</details>

<details>
<summary><b>"This name is already connected"</b></summary>

Someone in the class is already online with that exact name. Add a surname or initial. If the student just switched computers, wait about 10 seconds for the old connection to time out.
</details>

<details>
<summary><b>The helper says "No class found"</b></summary>

The class code changed (teachers can generate a new one in **Settings**). Run `python helper.py --code NEWCODE`.
</details>

## Project structure

```
classsync/
├── run.py                  # server entry point
├── helper.py               # student desktop helper
├── classsync/              # server package
│   ├── server.py           # HTTP dispatch, security headers, CSRF, bootstrap
│   ├── core.py             # routing, request/response primitives
│   ├── db.py               # SQLite schema and access layer
│   ├── security.py         # password hashing, tokens, rate limiting, sanitising
│   ├── realtime.py         # SSE channels, presence, screen frames
│   ├── auth.py             # teacher accounts, sessions, access guards
│   ├── teacher.py          # classes, live controls, assignments, ZIP export
│   ├── student.py          # joining, student events, uploads
│   └── pages.py            # HTML pages and static assets
├── web/                    # frontend — HTML pages
│   └── assets/
│       ├── css/            # design system + per-page styles
│       ├── js/             # UI toolkit, screen-share engine, page scripts
│       └── img/
├── windows/                # double-click launchers
└── docs/screenshots/
```

## Roadmap

- [ ] Student screen thumbnails for the teacher
- [ ] Per-assignment feedback and grades
- [ ] Export the roster and hand-in status to CSV
- [ ] Built-in HTTPS with a self-signed certificate
- [ ] Translations (Uzbek, Russian)

## Contributing

Contributions are welcome!

1. Fork the repository and create a branch: `git checkout -b feature/my-change`
2. Run the server locally with `python run.py --debug --data ./dev-data` and test your change as both a teacher and a student (a private browser window works well as a second user).
3. Keep the project dependency-free: standard-library Python and plain browser JavaScript only.
4. Commit with a clear message and open a pull request describing **what** changed and **why**.

Found a bug? [Open an issue](../../issues) with steps to reproduce, your OS and browser.

## License

Released under the [MIT License](LICENSE).

<div align="center"><sub>Built for teachers who would rather teach the lesson than spell the URL.</sub></div>
