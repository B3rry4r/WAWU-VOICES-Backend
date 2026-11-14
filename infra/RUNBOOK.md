# VOICES droplet runbook (V-2, V-3)

Owner steps, in order. Nothing here touches the WAWU Hub droplet. No secret goes in git; GitHub secrets are listed by name only.

## 1. Create the droplet (DigitalOcean)
- Image: Ubuntu 24.04 LTS x64. Region: the same region as your WAWU droplet (read it off your DigitalOcean page). Use that region for both Spaces buckets too; it is `SPACES_REGION`.
- Size: Basic, 4 GB RAM / 2 vCPU / 80 GB (about $24 a month) is the launch size. The web build runs on the droplet, so do not go below 4 GB. Resize up in the DigitalOcean panel if load needs it.
- Authentication: SSH key (add your own). Turn on weekly backups. Name it `voices-prod`.
- Note the droplet's public IP.

## 2. Spaces bucket and CDN (V-3)
- Spaces > Create: a bucket named `wawu-voices` (recordings, photos, share cards), same region, restrict file listing.
- Enable the CDN on it, and note the CDN URL (that is `SPACES_CDN_URL`).
- CORS on `wawu-voices` only (recordings upload from the browser straight to Spaces by presigned PUT). No CORS on `wawu-voices-backups`. In DigitalOcean: Spaces Object Storage > click `wawu-voices` > Settings tab > CORS Configurations > Add > Origin `https://usevoices.com`, Allowed Methods tick PUT and GET only, Allowed Headers `Content-Type`, Access Control Max Age `3000` > Save Options.
  Optional, same thing by command (the rule is in `infra/spaces/cors.xml`; needs s3cmd set up with your Spaces key, `s3cmd --configure`): `s3cmd --host=<region>.digitaloceanspaces.com --host-bucket='%(bucket)s.<region>.digitaloceanspaces.com' setcors infra/spaces/cors.xml s3://wawu-voices`
- Create a second Space, `wawu-voices-backups` (nightly database dumps), same region, private, CDN off.
- Spaces > Access Keys > Generate a key pair. Keep the key and secret for step 5.

## 3. DNS
- Add two `A` records to the droplet IP, TTL 300: `usevoices.com` and `www.usevoices.com`. (Do this before step 6 so certbot can issue one certificate for both names.) `www.usevoices.com` then answers with a 301 to `https://usevoices.com` and keeps the path, so `www.usevoices.com/go` lands on `usevoices.com/go`.
- If the first run was done with only the bare record, add the www record later and run the paste again: it adds www to the certificate (`--expand`).
- A droplet provisioned before this change keeps its old nginx site file (the script never overwrites it): copy `infra/nginx/voices.conf` over it with `sed -e s/__DOMAIN__/usevoices.com/g -e s,__STATIC_ROOT__,/srv/voices/web-static,g` (and put `infra/nginx/busy.html` at `/var/www/voices/busy.html`, make `/var/cache/nginx/voices`; the script does both), run `nginx -t`, then run the paste again so certbot puts HTTPS on the new block.

## 4. First login and the one paste
On your computer: `ssh root@<droplet-ip>`. On the droplet, paste this one block:

```
apt-get update -y && apt-get install -y git \
&& git clone https://github.com/B3rry4r/WAWU-VOICES-Backend.git /root/voices-src \
&& CERTBOT_EMAIL=<your-email> bash /root/voices-src/infra/provision.sh
```

It is safe to run again. If the DNS record is not live yet it skips the certificate and says so; run the same paste again once DNS resolves.
The repo B3rry4r/WAWU-VOICES-Backend is private, so the clone asks for credentials. Easiest: skip the clone and, from your computer inside a checkout of the repo, run `scp -r infra root@<droplet-ip>:/root/voices-src-infra` then on the droplet `CERTBOT_EMAIL=<your-email> bash /root/voices-src-infra/provision.sh` (the script reads its files from the folder next to it).

## 5. Fill in the env files on the droplet
The files are in `/etc/voices/`. Edit with `nano`. `DATABASE_URL` is already filled in.
- `api.env`: `WAWU_ID_ISSUER`, `WAWU_ID_AUDIENCE`, `SPACES_REGION` (your droplet's region), `SPACES_ENDPOINT` (`https://<region>.digitaloceanspaces.com`), `SPACES_BUCKET` (wawu-voices), `SPACES_BACKUP_BUCKET` (wawu-voices-backups), `SPACES_KEY`, `SPACES_SECRET`, `SPACES_CDN_URL`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH`, `GEMINI_API_KEY`, `THROTTLE_LIMIT` (600: requests a minute per network address; many people share one mobile-carrier address, the per-route limits are the real ones).
- `api.env` also holds `PUBLIC_WEB_BASE` and `APP_BASE_URL`, both `https://usevoices.com` (V-35: share links and cards, and where Flutterwave sends people back).
- WAWU ID: in the WAWU ID admin, add `https://usevoices.com` to the allowed origins for the VOICES client (the one paste; no `www`, no trailing slash). Sign-in from the web app fails until it is there.
- `web.env`: normally nothing to change.
- `backup.env`: `SPACES_BACKUP_BUCKET` (wawu-voices-backups) and `BACKUP_KEEP_DAYS`. The backup reads the region, endpoint, key and secret from `api.env`.
Then test the backup once: `sudo -u voices bash -c 'set -a; . /etc/voices/api.env; . /etc/voices/backup.env; set +a; /usr/local/bin/voices-backup'`. It prints `Backup ok`. The timer then runs it every night at about 02:30 UTC and keeps 7 days.

## 6. Deploy key and GitHub secrets
- On your computer: `ssh-keygen -t ed25519 -f voices_deploy -N ""`. Install the public key. On your computer: `scp voices_deploy.pub root@<droplet-ip>:/tmp/voices_deploy.pub`. On the droplet, paste:
  ```
  mkdir -p /srv/voices/.ssh
  cat /tmp/voices_deploy.pub >> /srv/voices/.ssh/authorized_keys
  chown -R voices:voices /srv/voices/.ssh
  chmod 700 /srv/voices/.ssh && chmod 600 /srv/voices/.ssh/authorized_keys
  rm /tmp/voices_deploy.pub
  ```
- Get the host key: `ssh-keyscan -t ed25519 <droplet-ip>`; the whole line is `VOICES_HOST_KEY`.
- In BOTH GitHub repos (B3rry4r/WAWU-VOICES-Backend and B3rry4r/WAWU-VOICES-Web): Settings > Secrets and variables > Actions > New repository secret, these four names (the same values in both):
  - `VOICES_SSH_KEY` (contents of the private file `voices_deploy`)
  - `VOICES_HOST_KEY` (the ssh-keyscan line)
  - `VOICES_HOST` (the droplet IP)
  - `VOICES_DOMAIN` (`usevoices.com`)
- Delete the private key file from your computer once it is in GitHub.

## 7. First deploy
Deploy the backend repo first (it places `/srv/voices/deploy/deploy.sh` on the droplet), then the web repo. In each: push or merge to `main` (or Actions > Deploy > Run workflow). The backend run tests, copies the source, builds a new release beside the live one, migrates, switches, restarts, then checks `https://usevoices.com/api/health` for 200; the web run tests, copies, builds a new release beside the live one, switches, restarts the two web servers one at a time and checks the home page for 200. A red run leaves the previous version serving. Only `main` deploys; running the workflow from another branch skips the deploy job.
Last step: open https://usevoices.com/api/health in your browser and expect `ok`.

## How a deploy works (V-DEPLOY-SAFE)
A deploy never builds or deletes anything under the files that are being served.
- CI rsyncs the source into `/srv/voices/api` and `/srv/voices/web` (source only; nothing runs from there) and runs `deploy.sh`.
- `deploy.sh` copies the source into `/srv/voices/releases/<app>/<UTC time>`, runs `npm ci`, the build (and, for the API, `prisma migrate deploy`) there, and only when that succeeds points `/srv/voices/<app>-current` at it and restarts. A build that fails is deleted and nothing live changed.
- Web: two Next servers, `voices-web@3001` and `voices-web@3002`, are restarted one at a time. nginx tries the other one when a connection is refused, so the restart is not seen. A new server that does not answer is rolled back before the second one is touched.
- Static files: nginx serves `/_next/static/` from `/srv/voices/web-static`, which each release adds its files to (never replacing or deleting). A page opened from the release before still finds its chunks. Files go only when no kept release has them and they are older than 7 days.
- API: one process (it runs the schedulers, so two would run each job twice). The restart has a gap of a few seconds in which nginx answers the busy page (503, Retry-After 60) and the app retries.
- The last 3 releases of each app are kept, plus the one the rollback link points at.
- Before the one-time layout change has been run on the droplet (it writes `/srv/voices/.layout-v2`), `deploy.sh` does the old in-place deploy and says so.

Roll back (one line, on the droplet as the voices user): `bash /srv/voices/deploy/deploy.sh rollback web` or `... rollback api`. It points the link at the previous release and restarts. Running it again goes forward again. A migration that has run stays run.

The one-time layout change is `infra/deploy/layout-once.sh` (run as root; safe to run twice; `provision.sh` runs it too). Check the live state with `ls -l /srv/voices/*-current /srv/voices/*-previous` and `systemctl status voices-api voices-web@3001 voices-web@3002`.

## Day to day
- Logs: `journalctl -u voices-api -f`, `journalctl -u 'voices-web@*' -f`.
- Restart: `systemctl restart voices-api voices-web@3001` (then `voices-web@3002`; one at a time, or the site is down for a second).
- Restore a backup: `infra/backup/restore.md`.
- Re-run provisioning after a change to `infra/`: pull the repo on the droplet and run `bash infra/provision.sh` again.
