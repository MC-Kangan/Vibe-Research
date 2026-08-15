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

The Tailscale settings window on your Mac is the **client** configuration. It is not where
the first three deployment settings are created. Open the web admin console instead:

- [DNS settings](https://login.tailscale.com/admin/dns)
- [Auth keys](https://login.tailscale.com/admin/keys)

Complete these three steps in the web console:

1. On **DNS**, enable **MagicDNS** if it is not already enabled. This creates names such
   as `vibe-research.<your-tailnet>.ts.net` for devices in your tailnet.
2. On the same **DNS** page, under **HTTPS Certificates**, select **Enable HTTPS** and
   acknowledge the public-certificate-ledger notice. The deployment uses this for its
   private HTTPS address.
3. On **Keys**, select **Generate auth key**. Use **Pre-approved/Pre-authorized** when
   that option is available, leave **Ephemeral** off, and leave **Reusable** off. This
   creates a one-time enrollment key for the persistent NAS node. If pre-approval is not
   available, generate the key and approve the new NAS device manually on the Machines
   page after the first start.

Keep Funnel disabled. Do not configure subnet routes or an exit node for this app.

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

For example, if the tailnet DNS suffix is `tail752dd9.ts.net` and the NAS hostname is
`vibe-research`, use:

```dotenv
VR_PUBLIC_ORIGIN=https://vibe-research.tail752dd9.ts.net
```

Do not use the tailnet suffix by itself (`https://tail752dd9.ts.net`). The machine
hostname is part of the HTTPS address.

In the Mac Tailscale window shown in the setup screenshots:

- **Use Tailscale DNS settings** checked: correct; it lets the Mac resolve MagicDNS names.
- **Use Tailscale subnets**: not required for this deployment; it can remain checked, but
  this app does not advertise or consume subnet routes.
- **Run as exit node** unchecked: correct; do not enable it.
- **Allow incoming connections**: unrelated to the NAS container; no change is needed.

## 3. Generate credentials and the browser login

Generate the internal Vibe-to-TradeAgent bearer token and put it directly in `.env.nas`:

```bash
TRADE_RESEARCH_API_TOKEN=$(openssl rand -hex 32)
printf '%s\n' "$TRADE_RESEARCH_API_TOKEN"
```

Copy the printed value into the private `.env.nas` file:

```text
TRADE_RESEARCH_API_TOKEN=<generated value>
```

This is not the Vibe login password and it is not the Tailscale auth key. Both the backend
and TradeAgent receive it as an environment variable inside the private Compose network.
Do not commit `.env.nas` or paste it into screenshots.

Optional server-side DeepSeek configuration can be placed in the same file:

```dotenv
VR_LLM_PROVIDER=deepseek
VR_LLM_BASE_URL=https://api.deepseek.com
VR_LLM_API_KEY=<your DeepSeek API key>
VR_LLM_MODEL=deepseek-v4-flash
```

The model value is sent to DeepSeek exactly as written; use the model identifier currently
enabled for your account. The key stays in the backend container and is not sent to the
browser. If a browser already has an API configuration saved, open **AI Setup → Clear**
once to use the server-side values. If these variables are omitted, configure AI from the
browser's **AI Setup** page.

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
- packages the Compose file, `.env`, and Tailscale Serve config.

The result is created under:

```text
deploy/output/vibe-research-nas-YYYYMMDD-HHMMSS/
├── images-amd64.tar
├── images.txt
├── compose.yaml
├── .env
├── DEPLOYMENT.md
└── deploy/
    └── tailscale/serve.json
```

The tar can be several gigabytes. The bundle also contains your login hash, Tailscale
enrollment key, internal token, and optionally your DeepSeek key. Transfer it only over a
trusted local connection and never commit or share it.

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
5. Confirm that UGOS loads the file named exactly `.env` from the same directory. Do not
   leave it named `.env.nas`; UGOS's Project editor normally does not auto-load that name.
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

Before deploying, verify the transferred project contains the `.env` file with non-empty
`TRADE_RESEARCH_API_TOKEN`:

```text
/volume1/docker/vibe-research/.env
```

Do not create or upload `deploy/secrets/trade-research-token`; the NAS Compose file no
longer uses a Docker secret mount. The TradeAgent CLI still prints only safe,
operator-facing diagnostics and never prints token values.

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

### `research-api` repeats `Error: invalid command or arguments`

That message means the NAS is still running an older TradeAgent image, or the command is
being rejected before the service starts. `serve --help` only checks that the CLI exists;
it does not validate the token or provider configuration. Rebuild and re-import the
bundle after any TradeAgent change:

```bash
cd /Users/chenkangan/Documents/VibeResearch
./scripts/build-nas-bundle.sh
```

Then import the newly generated `images-amd64.tar`, confirm that the Project's
`TRADE_RESEARCH_IMAGE` tag in `.env` matches the imported tag, and force-recreate the
Project. Open the **research-api** container's own log (not only the Project activity
log). A current image reports the actionable cause, for example:

```text
Error: TRADE_RESEARCH_API_TOKEN must be set
Error: host must be a private IP literal
Error: research configuration is invalid
```

The intended NAS command is either form below; both are valid Click syntax, but keep it
as a list in YAML so UGOS does not invoke a shell:

```yaml
command:
  - trade-research
  - serve
  - --host=0.0.0.0
  - --port=8000
```

If the current image still prints only the generic message after a rebuild, the imported
tar or image tag is not the one used by the Project. Do not troubleshoot Tailscale until
`research-api` stays healthy; the other services wait for that dependency.

### Login POST requests return 403

The browser origin and `VR_PUBLIC_ORIGIN` differ. Correct the HTTPS URL in `.env` and
redeploy the backend through the Project UI.
