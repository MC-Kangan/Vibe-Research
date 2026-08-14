# Deploy to UGREEN NAS from prebuilt Mac images

This is the supported deployment path for a NAS where you use the UGOS Docker app but
cannot run `docker compose` in a NAS terminal. The Mac builds Intel-compatible images and
exports one bundle. The NAS only imports the images and creates a Docker Project.

```text
Mac (source + Docker Desktop)
  -> build linux/amd64 images
  -> images-amd64.tar + image-only compose project
  -> securely copy bundle to NAS
  -> UGOS Docker: import images
  -> UGOS Docker: create Project

iPhone/laptop on tailnet -> private HTTPS -> Vibe -> TradeAgent API + worker
```

The DXP4800 Plus uses an Intel x86-64 processor. `linux/amd64` is therefore intentional,
including when the Mac itself uses Apple Silicon. The NAS Compose project contains no
`build:` sections and publishes no application ports.

## 1. Prepare the Mac

Install and start Docker Desktop. Keep these repositories beside one another:

```text
investment-stack/
├── VibeResearch/
└── TradeAgent/
```

From the `VibeResearch` directory:

```bash
cp .env.nas.example .env.nas
chmod 600 .env.nas
```

Resolve the TradeAgent Python base image to an immutable digest:

```bash
docker pull python:3.12-slim
docker image inspect python:3.12-slim --format '{{index .RepoDigests 0}}'
```

Put the complete `python@sha256:...` result into `PYTHON_BASE_IMAGE` in `.env.nas`.
Do not leave any `REPLACE_WITH` values.

## 2. Configure Tailscale

In the Tailscale admin console:

1. Enable MagicDNS and HTTPS certificates.
2. Create a pre-authorized, non-ephemeral auth key for this NAS node.
3. Keep Funnel disabled. Do not configure subnet routes or an exit node for this app.

Choose a unique hostname, for example `vibe-research`. Determine your tailnet DNS suffix
from the Tailscale DNS or Machines page, then complete these values:

```dotenv
TS_AUTHKEY=tskey-auth-your-temporary-enrollment-key
TS_HOSTNAME=vibe-research
VR_PUBLIC_ORIGIN=https://vibe-research.your-tailnet.ts.net
```

The exact public origin must match the final Tailscale HTTPS address and must not end with
a slash. Avoid a hostname already used by another tailnet machine, because Tailscale may
add a numeric suffix.

## 3. Generate secrets and the browser login

Generate the internal Vibe-to-TradeAgent bearer token:

```bash
mkdir -p deploy/secrets
chmod 700 deploy/secrets
umask 077
openssl rand -hex 32 > deploy/secrets/trade-research-token
```

Build the backend for AMD64 and use its offline password utility:

```bash
docker compose --env-file .env.nas \
  -f compose.nas.yaml -f compose.mac-build.yaml \
  build backend

docker run --rm -it --platform linux/amd64 \
  vibe-research-backend:nas-amd64 \
  python auth.py hash-password
```

Passwords must contain at least 8 characters. Prefer a longer, random password from a
password manager when practical. Put the complete hash between single quotes in `.env.nas`:

```dotenv
VR_AUTH_USERNAME=admin
VR_AUTH_PASSWORD_HASH='$argon2id$complete-generated-value'
```

Also replace the example email in `VR_SEC_USER_AGENT` with a real contact email. Leave
optional market-data credentials empty until the base deployment works.

## 4. Build the transferable NAS bundle

Run:

```bash
./scripts/build-nas-bundle.sh
```

The script:

- refuses known placeholder configuration;
- builds Vibe frontend, Vibe backend, and TradeAgent for `linux/amd64`;
- pulls the AMD64 Tailscale image;
- validates the image-only Compose project;
- exports all four distinct images to one tar archive;
- packages the Compose file, `.env`, Tailscale Serve config, and Docker secret.

The result is created under:

```text
deploy/output/vibe-research-nas-YYYYMMDD-HHMMSS/
├── images-amd64.tar
├── images.txt
├── compose.yaml
├── .env
├── DEPLOYMENT.md
└── deploy/
    ├── secrets/trade-research-token
    └── tailscale/serve.json
```

The tar can be several gigabytes. The bundle also contains your login hash, Tailscale
enrollment key, and internal token. Transfer it only over a trusted local connection and
never commit or share it.

## 5. Transfer and import with UGOS

Using Finder, SMB, or the UGOS File Manager, copy the complete generated directory to a
stable NAS data-volume directory, for example:

```text
/volume1/docker/vibe-research/
```

Do not move only `compose.yaml`; its relative `deploy/` files must remain beside it.

In the UGOS Docker app:

1. Open **Images** (sometimes labelled **Local Images**).
2. Choose **Import** or **Load from file**.
3. Select `images-amd64.tar`.
4. Wait until the four names from `images.txt` appear locally.

Importing the tar does not start containers and does not require access to a registry.

## 6. Create the Docker Project

In the UGOS Docker app:

1. Open **Project**.
2. Choose **Create**.
3. Name it `vibe-research-nas`.
4. Select the transferred directory and its `compose.yaml`, or paste that file into the
   project editor while keeping the project directory unchanged.
5. Confirm that UGOS loads the `.env` file from the same directory.
6. Deploy the project.

If UGOS asks for environment values instead of loading `.env`, provide the variables from
that file in the Project environment editor. Do not paste them into a public screenshot.

Expected containers:

- `tailscale`: private HTTPS ingress and persistent tailnet identity
- `frontend`: Vibe SPA and same-origin `/api` reverse proxy
- `backend`: authentication, portfolio, reports, and provider integrations
- `research-api`: internal bearer-authenticated TradeAgent API
- `research-worker`: durable TradeAgent background worker

The project also creates three named volumes for Tailscale identity, Vibe data, and
TradeAgent data. Never delete those volumes during a routine upgrade.

## 7. Verify using the Docker UI and phone

In the Docker Project view, wait until `backend`, `frontend`, and `research-api` are marked
healthy. Open the logs for `tailscale` and confirm that it joined the tailnet and applied
the Serve configuration.

In the Tailscale Machines page, verify that the node DNS name exactly matches
`VR_PUBLIC_ORIGIN`. If Tailscale assigned a different name, edit `.env`, correct
`VR_PUBLIC_ORIGIN`, and redeploy the Project.

On the phone:

1. Install Tailscale and sign into the same tailnet.
2. Open the `VR_PUBLIC_ORIGIN` HTTPS address.
3. Sign in with `VR_AUTH_USERNAME` and the plaintext password used to create the hash.
4. Open AI Setup and configure DeepSeek or another model for that browser.
5. Open a stock page and verify that TradeAgent skills load.
6. Turn Tailscale off temporarily and confirm that the site becomes unreachable.

Do not add NAS port mappings for 8080, 8900, or 8000. Do not create router forwarding,
DMZ, Tailscale Funnel, `TS_ROUTES`, or exit-node configuration for this application.

## 8. Remove the enrollment key

After the Tailscale container has restarted once and retained its identity:

1. Revoke the auth key in the Tailscale admin console.
2. Set `TS_AUTHKEY=` in the NAS project `.env` file.
3. Redeploy the Project.

The persisted `tailscale-state` volume allows future restarts without retaining the
enrollment credential.

## 9. Updates

For each release, update both repositories on the Mac, choose new image tags in `.env.nas`
(for example `:2026-08-12-amd64`), rebuild a bundle, import its tar, and redeploy the NAS
Project with the matching `.env`. Versioned tags make rollback much safer than repeatedly
overwriting `:nas-amd64`.

Back up the three named volumes before an upgrade that changes stored data. Keeping an old
image tar is not a data backup.

## Troubleshooting

### Image reports the wrong architecture

All four images must report `linux/amd64`. Rebuild with the provided script; do not build
normally on an Apple Silicon Mac and export an ARM-only image.

### `/dev/net/tun` is unavailable

Enable the TUN device in UGOS. The Tailscale container intentionally uses `/dev/net/tun`,
`NET_ADMIN`, and `NET_RAW`; do not grant full privileged mode as a shortcut.

### The Project tries to build an image

You selected `compose.mac-build.yaml` or an older Compose file. The NAS must use only the
generated bundle's `compose.yaml`, which contains no `build:` sections.

### A local image is still pulled from the internet

Confirm the imported tag exactly matches the relevant image variable in `.env`. Image
names and tags are exact and case-sensitive.

### Login POST requests return 403

The browser origin and `VR_PUBLIC_ORIGIN` differ. Correct the HTTPS URL in `.env` and
redeploy the backend through the Project UI.
