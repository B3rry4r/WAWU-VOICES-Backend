# Shared settings for the LCH-09 load harness. Sourced by stack.sh and run.sh; override any of these in the environment.
# Everything runs on this machine, on the ports and database names the lead gave bundle D (15000-15019, lchd_*, Redis db 12).
HERE_LOAD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE_LOAD/../.." && pwd)"
API_DIR="${API_DIR:-$REPO_ROOT/api}"
WEB_DIR="${WEB_DIR:-/home/user/wt/lch-d-web}"
RUN="${LOAD_DIR:-/tmp/voices-load/lch-d}"

# Ports (all inside 15000-15019)
P_NGINX=${P_NGINX:-15000}   # what the load goes to: nginx with infra/nginx/voices.conf, no TLS
P_API=${P_API:-15001}
P_WEB=${P_WEB:-15002}
P_ID=${P_ID:-15003}         # WAWU ID stand-in (sign-up, sign-in, refresh, JWKS)
P_SPACES=${P_SPACES:-15004} # Spaces stand-in (presigned PUT, HEAD, GET, DELETE)
P_PG=${P_PG:-15010}         # a Postgres of our own, so it can sit on the same two CPUs as the apps, like on the droplet
P_REDIS=${P_REDIS:-15011}
REDIS_DB=${REDIS_DB:-12}
DB_NAME=${DB_NAME:-lchd_load}

# The droplet is 4 GB / 2 vCPU and runs nginx, the API, the web server, Postgres and Redis together: those five share
# APP_CPUS. The load generator and the two stand-ins run on the other CPUs.
APP_CPUS=${APP_CPUS:-2,3}
GEN_CPUS=${GEN_CPUS:-0,1}

# What the broadcast runs with: the repo's example env, plus the stand-ins. Real values only for the stand-ins.
PHONE_PEPPER=load-test-pepper-not-a-secret
