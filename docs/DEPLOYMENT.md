# Deployment

Four ways to run this project, from fastest to most portable.

| Option | Best for | Needs | Time |
|---|---|---|---|
| [Local, from source](#1-local-from-source) | development, anyone comfortable with a terminal | Node.js 18+ | 1 min |
| [Portable package](#2-portable-package-no-installation) | locked-down Windows machines, offline demos | nothing | 1 min |
| [Docker](#3-docker) | servers, reproducible environments | Docker | 2 min |
| [Cloud hosting](#4-cloud-hosting) | sharing one URL with a team | a container platform | 5 min |

---

## 1. Local, from source

```bash
git clone https://github.com/YiweiOu/smartcity-vision-inspector.git
cd smartcity-vision-inspector
npm install
npm start
```

Open http://localhost:3000. If port 3000 is occupied the server increments the
port automatically up to 3999 and prints the address it used.

Stop the server with `Ctrl+C`.

### Platform notes

- **Windows** — use PowerShell or Git Bash; the commands are identical.
- **macOS / Linux** — `npm start` works as-is. To keep it running after closing
  the terminal: `nohup npm start &`.
- If `npm` is missing, install Node.js from <https://nodejs.org> (LTS).

---

## 2. Portable package (no installation)

A zip archive is provided for situations where software cannot be installed, such
as a locked-down corporate laptop or a demo without internet access. It contains
two independent versions:

```
SmartCity-Vision-Inspector-LocalDeploy/
├── 01-No-Node-Required/    Windows only; Node.js runtime bundled (~120 MB)
│                           Extract, double-click start.bat, done.
└── 02-Node-Required/       Windows, macOS, Linux (~1 MB)
                            Install Node.js 18+ once, then run the launcher
                            for your system: start.bat / start.command / start.sh
```

Both versions include the six sample photographs and the six real inspection
reports, so the platform can be demonstrated without configuring anything.

### Running it

1. Extract the whole folder to a path with no spaces and no accented characters,
   for example `C:\scvi\` or `/opt/scvi/`.
2. Enter the version folder and run its launcher.
3. Keep the terminal window open. Closing it stops the server.
4. The browser opens on http://localhost:3000.

The first start of version 02 downloads three small libraries; later starts are
offline.

### If Windows blocks the bundled runtime

Windows Defender SmartScreen frequently blocks a Node runtime that arrived inside
a zip file. Right-click the downloaded zip, choose Properties, tick **Unblock**,
then extract again. If it still fails, right-click `node.exe`, Properties,
Unblock.

---

## 3. Docker

```bash
docker build -t smartcity-vision-inspector .
docker run -d --name scvi -p 3000:3000 smartcity-vision-inspector
```

Open http://localhost:3000. To stop it: `docker rm -f scvi`.

The image installs production dependencies only and has no build step. The
knowledge base is created inside the container on first run; mount a volume to
persist documents you upload:

```bash
docker run -d --name scvi -p 3000:3000 \
  -v scvi-data:/app/data \
  smartcity-vision-inspector
```

---

## 4. Cloud hosting

The Dockerfile runs on any container platform (Render, Railway, Fly.io, Google
Cloud Run, Azure Container Apps, AWS App Runner). Set:

| Setting | Value |
|---|---|
| Build | Docker |
| Port | `3000` (or the `PORT` environment variable) |
| Health check | `GET /api/health` |
| Persistent volume | mount `/app/data` if uploaded documents must survive a restart |

There is no server-side secret to configure: each user supplies their own API key
in the browser.

> [!WARNING]
> Anything you deploy publicly is reachable by anyone who finds the URL. The
> service holds no credentials of its own, so the exposure is limited to
> compute, but put an authentication layer in front of it if you deploy it
> outside a trusted network.

---

## Requirements

| | Requirement |
|---|---|
| Runtime | Node.js 18 or newer (bundled in the portable package) |
| Memory | under 100 MB |
| Disk | about 35 MB including dependencies |
| Network | needed only to reach the model provider, and for `npm install` |
| GPU | not required; inference runs on the provider's side |

## Verifying a deployment

```bash
curl http://localhost:3000/api/health                 # {"ok":true,...}
curl http://localhost:3000/api/knowledge              # four seeded clause sets
curl http://localhost:3000/api/providers              # provider and model catalogues
```

If `/api/health` answers, the deployment is working and the remaining setup is
entering an API key in the browser.

## Troubleshooting

**The window opens and closes immediately.** Read the message it printed. On
Windows the usual cause is SmartScreen blocking the bundled runtime (see above).

**Address already in use.** The server tries 3001, 3002 and so on and prints the
address it used. Alternatively set `PORT=8080 npm start`.

**`npm install` fails.** The first start needs internet access to fetch three
libraries. Connect and run again. Behind a proxy, set `npm config set proxy`.

**Browser does not open.** Type `http://localhost:3000` manually.

**Analysis returns a 401.** The API key is wrong, expired, or belongs to a
different provider than the one selected.
