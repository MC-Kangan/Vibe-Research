# NAS Deployment Proof

## Verified status — 4 August 2026

The production topology was built and run locally on Docker Desktop (`linux/arm64`). The Dockerfiles use multi-architecture upstream images, but the DXP4800 Plus is an x86-64 target, so its native image build remains part of the physical-NAS installation proof. Local verification completed successfully:

- Both production images built from their Dockerfiles.
- Backend and frontend health checks became healthy.
- Only `127.0.0.1:8080` was published; the Compose backend retained only its internal `8900/tcp` exposure.
- Both runtime processes used non-root accounts (`uid 10001` for FastAPI and `uid 101` for Nginx).
- `/api/health` passed through the Nginx reverse proxy.
- `/` and direct `/stock` navigation both returned the production React application.
- A live `VOD.L` request passed through Nginx and FastAPI and returned normalized GBP data.
- A disposable uploaded report survived complete container recreation, proving the named-volume path, and was deleted after the check.
- Final container logs contained no application startup or request errors.

The verified stack remains bound to loopback and is intentionally not reachable from another device yet. It may be inspected locally at `http://127.0.0.1:8080` while the containers are running.

### Recorded follow-ups before remote exposure

- `npm audit --omit=dev` reports the React Router RSC-mode advisory [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2). This application is a client-side SPA and does not use React Server Components or server actions, but the dependency should still be moved to a patched release through an explicit, regression-tested package update before remote exposure.
- Docker Desktop's configured `desktop` credential helper hung during anonymous public-image resolution on this machine. Verification used an isolated temporary empty Docker configuration to pull the three public base images and did not change the user's Docker configuration. This is a workstation tooling issue, not a Compose or image failure, but normal image pulls should be confirmed on the NAS.
- A separate pre-existing local Python process was already listening on host loopback port `8900`; it is unrelated to Compose. Compose inspection confirms that the container backend does not publish a host port.

## Scope

This slice packages the current application for an always-on Docker host without adding application features. It proves:

- Production frontend build served by Nginx
- Same-origin `/api` reverse proxying
- FastAPI reachable only on the private Compose network
- Persistent portfolio and report storage
- Container health checks and restart policies
- React Router fallback for direct links
- A non-root runtime user in both containers

It does **not** make the application safe for direct internet exposure. Remote identity and Tailscale access are the next slice.

## Local deployment proof

From the repository root:

```bash
cp .env.deploy.example .env
docker compose config
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:8080/api/health
```

Open `http://127.0.0.1:8080`. Direct navigation to routes such as `http://127.0.0.1:8080/stock` must return the React application, not an Nginx 404.

Stop the application without deleting its data:

```bash
docker compose down
```

Do not add `--volumes` unless intentionally deleting the Docker-managed application data volume.

## Persistence proof

The backend stores portfolio data and uploaded reports under `/data`. By default, Compose mounts the named volume `vibe-data` there.

To prove persistence:

1. Start the deployment and create a disposable test holding or upload a disposable report.
2. Run `docker compose down` followed by `docker compose up -d`.
3. Confirm the disposable record still exists.
4. Remove the test record through the application.

Never use real portfolio or report data for an automated deployment test.

## UGREEN NAS configuration

Install Docker through UGOS Pro, copy the repository to a stable NAS directory, and create an application-data directory outside the source checkout. The exact storage prefix varies with the NAS volume configuration; this example is illustrative:

```bash
mkdir -p /volume1/docker/vibe-research/data
chown -R 10001:10001 /volume1/docker/vibe-research/data
```

Create `.env` beside `compose.yaml`:

```dotenv
VR_BIND_ADDRESS=127.0.0.1
VR_WEB_PORT=8080
VR_PUBLIC_ORIGIN=https://your-nas.your-tailnet.ts.net
VR_DATA_PATH=/volume1/docker/vibe-research/data
VR_API_KEY=
VR_AUTH_ENABLED=true
VR_AUTH_USERNAME=admin
VR_AUTH_PASSWORD_HASH='<generated Argon2id hash>'
VR_SESSION_TTL_HOURS=12
VR_AUTH_COOKIE_SECURE=true
VR_IBKR_FLEX_TOKEN=<server-side IBKR Flex token>
VR_IBKR_FLEX_QUERY_ID=<current-position Flex query id>
VR_IBKR_FLEX_TIMEZONE=Europe/London
VR_IBKR_FLEX_COOLDOWN_SECONDS=300
```

Generate the first-run hash after building the backend image:

```bash
docker compose run --rm backend python auth.py hash-password
```

Passwords must contain at least 8 characters; prefer a longer, random password when
practical. Paste the complete output between the single quotes above. The username and hash seed
`/data/auth.sqlite3` only when it contains no user; subsequent password changes must use
the reset command below. Keep `VR_BIND_ADDRESS=127.0.0.1` until the authenticated
Tailscale proxy is installed. Do not open router ports, use a DMZ rule, expose port 8900,
or enable Tailscale Funnel.

Install and sign in to Tailscale on the NAS and each approved device, then publish only
the loopback frontend through Tailscale Serve (for example, `tailscale serve --bg 8080`).
Set `VR_PUBLIC_ORIGIN` to the exact HTTPS tailnet URL shown by Tailscale and restart the
Compose stack. Do not publish the
backend, TradeAgent, or database ports. The Vibe login screen remains enabled even inside
the tailnet, so a stolen or shared tailnet device does not automatically expose positions.

Use a Tailscale Grant to permit only the owner's identity to reach the NAS HTTPS service.
Application authentication remains independent of Tailscale identity headers in this
single-user deployment.

Reset a forgotten or compromised password from a NAS terminal:

```bash
docker compose exec backend python auth.py reset-password --username admin
```

The reset command updates the Argon2id hash and immediately revokes every browser session.

After the first login, open 我的持仓 and click 从 IBKR 刷新. This performs a read-only current
Flex query and stores a normalized snapshot under the configured data directory. It does
not import transactions or replace the existing manual portfolio records. Verify the
position count, report date, quantities, and costs against IBKR before relying on the view.

If the NAS Docker interface cannot consume Compose directly, use its project/Compose import function and select this repository's `compose.yaml`. Ensure the resulting frontend port binding remains loopback-only and the backend has no host port.

## Backup and restore

When `VR_DATA_PATH` points to a NAS directory, back up that directory with the NAS snapshot or backup facility. The important contents currently include:

- `portfolio.json`
- `auth.sqlite3`
- `myreports/`
- Any future application-owned persistent files

For a consistent manual backup, stop the containers first:

```bash
docker compose stop
```

Copy or snapshot the configured data directory, then restart:

```bash
docker compose start
```

Restore into an empty data directory with the same uid/gid ownership while the containers are stopped.

## Upgrade and rollback

Before an upgrade:

1. Back up the data directory.
2. Record the currently deployed Git commit or source archive.
3. Build the updated images without deleting the data volume.
4. Start and verify `/api/health`, the frontend, and one read-only market-data query.

Rollback by checking out or restoring the previous source version and rebuilding. Data migrations must be documented before any future release introduces them; this slice adds none.

## Security boundary before remote access

The deployment now supports an application login with Argon2id password hashing and an
expiring opaque HttpOnly session cookie. Only the session hash is stored in SQLite, so
logout and password reset can revoke access immediately. `VR_API_KEY` remains available
for scripts and service-to-service calls, but it is not the browser login mechanism.

The next deployment slice should:

- Install Tailscale on the NAS and personal devices.
- Serve the frontend origin through Tailscale Serve with HTTPS.
- Keep the Compose frontend bound to loopback.
- Add a Tailscale Grant for the owner's identity and NAS HTTPS service.
- Perform a deployment-focused security review before remote use.
