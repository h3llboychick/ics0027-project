#!/usr/bin/env bash

# Provision local development secrets and the TLS certificate used by nginx.
# Safe to rerun: existing non-empty .env values and a valid local CA are kept.
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
CERT_DIR="$ROOT_DIR/certs"
CA_DIR="$CERT_DIR/ca"
CA_KEY="$CA_DIR/root-ca.key"
CA_CERT="$CA_DIR/root-ca.crt"
SERVER_KEY="$CERT_DIR/server-ecdsa.key"
SERVER_CERT="$CERT_DIR/server-ecdsa.crt"
DEV_HOST="secure-file-manager.dev"
DEV_URL="https://$DEV_HOST:8443"
TEMP_DIR=""

die() {
  printf 'setup-dev: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

for command_name in openssl node corepack docker; do
  command -v "$command_name" >/dev/null 2>&1 || die "$command_name is required. Install the prerequisites listed in README.md."
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( node_major >= 24 )) || die "Node.js 24 or newer is required."
docker compose version >/dev/null 2>&1 || die "Docker Compose is required."
docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker and rerun this script."
[[ -t 0 ]] || die "Run this script from an interactive terminal so it can prompt for credentials."

mkdir -p -- "$ROOT_DIR" "$CA_DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
chmod 700 "$CERT_DIR" "$CA_DIR"

read_env() {
  local key="$1"
  local value=""

  if [[ -f "$ENV_FILE" ]]; then
    value="$(awk -v key="$key" '
      index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
      END { if (value != "") print value }
    ' "$ENV_FILE")"
  fi

  value="${value%$'\r'}"
  if [[ ${#value} -ge 2 && ${value:0:1} == '"' && ${value: -1} == '"' ]]; then
    value="${value:1:${#value}-2}"
  elif [[ ${#value} -ge 2 && ${value:0:1} == "'" && ${value: -1} == "'" ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s' "$value"
}

write_env() {
  local key="$1"
  local value="$2"
  local temp_file
  temp_file="$(mktemp "$ROOT_DIR/.env.XXXXXX")"

  SETUP_ENV_VALUE="$value" awk -v key="$key" '
    BEGIN { prefix = key "=" }
    index($0, prefix) == 1 {
      if (!found) print prefix ENVIRON["SETUP_ENV_VALUE"]
      found = 1
      next
    }
    { print }
    END { if (!found) print prefix ENVIRON["SETUP_ENV_VALUE"] }
  ' "$ENV_FILE" > "$temp_file"

  chmod 600 "$temp_file"
  mv -- "$temp_file" "$ENV_FILE"
}

prompt_database_value() {
  local key="$1"
  local label="$2"
  local default_value="$3"
  local existing value
  existing="$(read_env "$key")"

  if [[ -n "$existing" ]]; then
    read -r -p "$label [$existing] (Enter keeps it): " value
    [[ -n "$value" ]] || value="$existing"
  else
    read -r -p "$label [$default_value]: " value
    [[ -n "$value" ]] || value="$default_value"
  fi

  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "$label may contain only letters, digits, and underscores."
  if [[ -n "$existing" && "$value" != "$existing" ]]; then
    printf 'Changing this value may require reinitializing the existing PostgreSQL volume.\n'
  fi
  write_env "$key" "$value"
}

prompt_secret() {
  local key="$1"
  local label="$2"
  local byte_count="$3"
  local kind="$4"
  local existing value keeping_existing=false
  existing="$(read_env "$key")"

  if [[ -n "$existing" ]]; then
    read -r -s -p "$label already exists. Enter a replacement or press Enter to keep it: " value
  else
    read -r -s -p "$label (press Enter to generate a random value): " value
  fi
  printf '\n'

  if [[ -z "$value" ]]; then
    if [[ -n "$existing" ]]; then
      value="$existing"
      keeping_existing=true
    else
      value="$(openssl rand -hex "$byte_count")"
      printf 'Generated %s.\n' "$key"
    fi
  fi

  case "$kind" in
    auth)
      [[ ${#value} -ge 32 && "$value" =~ ^[-A-Za-z0-9._~]+$ ]] \
        || die "$label must be at least 32 characters and use only letters, digits, dot, underscore, tilde, or hyphen."
      ;;
    postgres)
      [[ "$value" =~ ^[-A-Za-z0-9._~]+$ ]] \
        || die "$label must be URL-safe (letters, digits, dot, underscore, tilde, or hyphen)."
      if [[ "$keeping_existing" == false && ${#value} -lt 32 ]]; then
        die "$label must be at least 32 characters."
      elif [[ "$keeping_existing" == true && ${#value} -lt 32 ]]; then
        printf 'Keeping the existing PostgreSQL password; it is shorter than the recommended 32 characters.\n'
      fi
      ;;
    kek)
      [[ "$value" =~ ^[[:xdigit:]]{64}$ ]] \
        || die "$label must be exactly 64 hexadecimal characters (32 bytes)."
      ;;
  esac

  if [[ -n "$existing" && "$value" != "$existing" ]]; then
    case "$key" in
      POSTGRES_PASSWORD) printf 'Changing this password may require a fresh PostgreSQL volume.\n' ;;
      FILE_ENCRYPTION_KEK) printf 'Changing this key makes files encrypted with the previous key unreadable.\n' ;;
      BETTER_AUTH_SECRET) printf 'Changing this secret invalidates existing authentication sessions.\n' ;;
    esac
  fi

  write_env "$key" "$value"
}

prompt_resend_key() {
  local existing value
  existing="$(read_env RESEND_API_KEY)"

  if [[ -n "$existing" ]]; then
    read -r -s -p "Resend API key already exists. Enter a replacement or press Enter to keep it: " value
  else
    read -r -s -p "Resend API key: " value
  fi
  printf '\n'

  if [[ -n "$value" ]]; then
    [[ "$value" =~ ^[A-Za-z0-9._~/-]+$ ]] || die "The Resend API key contains unsupported characters."
    write_env RESEND_API_KEY "$value"
  elif [[ -z "$existing" ]]; then
    die "RESEND_API_KEY is required when EMAIL_PROVIDER=resend."
  fi
}

prompt_email_provider() {
  local existing value
  existing="$(read_env EMAIL_PROVIDER)"
  existing="${existing:-console}"
  read -r -p "Email provider (console/resend) [$existing]: " value
  value="${value:-$existing}"

  case "$value" in
    console|resend) write_env EMAIL_PROVIDER "$value" ;;
    *) die "Email provider must be console or resend." ;;
  esac

  if [[ "$value" == resend ]]; then
    prompt_resend_key
  fi
}

prompt_database_value POSTGRES_DB "PostgreSQL database name" storage
prompt_database_value POSTGRES_USER "PostgreSQL username" storage
prompt_secret POSTGRES_PASSWORD "PostgreSQL password" 24 postgres
prompt_secret BETTER_AUTH_SECRET "Better Auth secret" 32 auth
prompt_secret FILE_ENCRYPTION_KEK "File encryption KEK" 32 kek
prompt_email_provider

auth_url="$(read_env BETTER_AUTH_URL)"
if [[ -z "$auth_url" || "$auth_url" == "http://localhost:3000" ]]; then
  write_env BETTER_AUTH_URL "$DEV_URL"
elif [[ "$auth_url" != "$DEV_URL" ]]; then
  printf 'setup-dev: keeping your custom BETTER_AUTH_URL value.\n'
fi

auth_secret="$(read_env BETTER_AUTH_SECRET)"
[[ ${#auth_secret} -ge 32 ]] || die "BETTER_AUTH_SECRET must contain at least 32 characters."

encryption_kek="$(read_env FILE_ENCRYPTION_KEK)"
[[ "$encryption_kek" =~ ^[[:xdigit:]]{64}$ ]] || die "FILE_ENCRYPTION_KEK must be exactly 64 hexadecimal characters (32 bytes)."

db_name="$(read_env POSTGRES_DB)"
db_user="$(read_env POSTGRES_USER)"
db_password="$(read_env POSTGRES_PASSWORD)"
safe_url_component='^[-A-Za-z0-9._~]+$'
[[ "$db_name" =~ $safe_url_component && "$db_user" =~ $safe_url_component && "$db_password" =~ $safe_url_component ]] \
  || die "PostgreSQL values must be URL-safe to build DATABASE_URL."
write_env DATABASE_URL "postgresql://$db_user:$db_password@localhost:5432/$db_name"

if [[ -f "$CA_KEY" && -f "$CA_CERT" ]]; then
  openssl x509 -in "$CA_CERT" -noout -checkend 0 >/dev/null 2>&1 \
    || die "The local CA certificate is expired or unreadable. Back up/remove certs/ca and rerun to create a new trust anchor."
  openssl verify -CAfile "$CA_CERT" "$CA_CERT" >/dev/null 2>&1 \
    || die "The local CA certificate is invalid. Back up/remove certs/ca and rerun to create a new trust anchor."
  cert_public_key="$(openssl x509 -in "$CA_CERT" -pubkey -noout 2>/dev/null)" \
    || die "Could not read the local CA certificate."
  ca_public_key="$(openssl pkey -in "$CA_KEY" -pubout -passin pass: 2>/dev/null)" \
    || die "Could not read the local CA private key."
  [[ "$cert_public_key" == "$ca_public_key" ]] \
    || die "The local CA certificate and private key do not match. Back up/remove certs/ca and rerun."
elif [[ -e "$CA_KEY" || -e "$CA_CERT" ]]; then
  die "Only part of the local CA exists. Back up/remove certs/ca and rerun to create a new trust anchor."
else
  TEMP_DIR="$(mktemp -d "$CERT_DIR/.setup.XXXXXX")"
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$TEMP_DIR/root-ca.key"
  openssl req -x509 -new -key "$TEMP_DIR/root-ca.key" \
    -sha256 -days 3650 \
    -out "$TEMP_DIR/root-ca.crt" \
    -subj "/CN=Secure File Manager Local CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash"
  chmod 600 "$TEMP_DIR/root-ca.key"
  chmod 644 "$TEMP_DIR/root-ca.crt"
  mv -- "$TEMP_DIR/root-ca.key" "$CA_KEY"
  mv -- "$TEMP_DIR/root-ca.crt" "$CA_CERT"
  rm -rf -- "$TEMP_DIR"
  TEMP_DIR=""
fi

server_certificate_valid=false
if [[ -f "$SERVER_KEY" && -f "$SERVER_CERT" ]] \
  && openssl x509 -in "$SERVER_CERT" -noout -checkend 0 >/dev/null 2>&1 \
  && openssl verify -CAfile "$CA_CERT" "$SERVER_CERT" >/dev/null 2>&1 \
  && openssl x509 -in "$SERVER_CERT" -noout -checkhost "$DEV_HOST" >/dev/null 2>&1; then
  cert_public_key="$(openssl x509 -in "$SERVER_CERT" -pubkey -noout 2>/dev/null)"
  server_public_key="$(openssl pkey -in "$SERVER_KEY" -pubout -passin pass: 2>/dev/null || true)"
  if [[ -n "$server_public_key" && "$cert_public_key" == "$server_public_key" ]]; then
    server_certificate_valid=true
  fi
fi

if [[ "$server_certificate_valid" == true ]]; then
  printf 'Using the existing valid TLS certificate for %s.\n' "$DEV_HOST"
else
  TEMP_DIR="$(mktemp -d "$CERT_DIR/.setup.XXXXXX")"
  openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout "$TEMP_DIR/server-ecdsa.key" \
    -out "$TEMP_DIR/server-ecdsa.csr" \
    -subj "/CN=$DEV_HOST" \
    -addext "subjectAltName=DNS:$DEV_HOST"

  cat > "$TEMP_DIR/server-extensions.cnf" <<EOF
[server_cert]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:$DEV_HOST
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

  openssl x509 -req \
    -in "$TEMP_DIR/server-ecdsa.csr" \
    -CA "$CA_CERT" \
    -CAkey "$CA_KEY" \
    -CAcreateserial \
    -out "$TEMP_DIR/server-ecdsa.crt" \
    -days 365 -sha256 \
    -extfile "$TEMP_DIR/server-extensions.cnf" \
    -extensions server_cert

  openssl verify -CAfile "$CA_CERT" "$TEMP_DIR/server-ecdsa.crt" >/dev/null \
    || die "Could not verify the generated server certificate."
  openssl x509 -in "$TEMP_DIR/server-ecdsa.crt" -noout -checkhost "$DEV_HOST" >/dev/null \
    || die "The generated server certificate does not cover $DEV_HOST."

  chmod 600 "$TEMP_DIR/server-ecdsa.key"
  chmod 644 "$TEMP_DIR/server-ecdsa.crt"
  mv -- "$TEMP_DIR/server-ecdsa.key" "$SERVER_KEY"
  mv -- "$TEMP_DIR/server-ecdsa.crt" "$SERVER_CERT"
  rm -rf -- "$TEMP_DIR"
  TEMP_DIR=""
  printf 'Created a local TLS certificate for %s.\n' "$DEV_HOST"
fi

chmod 600 "$ENV_FILE" "$CA_KEY" "$SERVER_KEY"
chmod 644 "$CA_CERT" "$SERVER_CERT"

printf '\nInstalling project dependencies with Corepack and pnpm...\n'
(cd "$ROOT_DIR" && corepack pnpm install --frozen-lockfile)

printf '\nGenerating the Prisma client...\n'
(cd "$ROOT_DIR" && corepack pnpm exec prisma generate)

printf '\nBuilding and starting the application stack...\n'
(cd "$ROOT_DIR" && docker compose up --build -d)

printf 'Waiting for PostgreSQL to become ready...\n'
db_ready=false
for attempt in {1..60}; do
  if (cd "$ROOT_DIR" && docker compose exec -T db pg_isready -q -U "$db_user" -d "$db_name") >/dev/null 2>&1; then
    db_ready=true
    break
  fi
  sleep 1
done
[[ "$db_ready" == true ]] || die "PostgreSQL did not become ready. Check docker compose logs db."

printf '\nApplying database migrations...\n'
(cd "$ROOT_DIR" && corepack pnpm exec prisma migrate deploy)

if [[ "$(read_env EMAIL_PROVIDER)" == console ]]; then
  printf '\nEmail verification and password-reset messages are printed to application logs.\n'
fi

printf '\nSetup is complete. Secret values were not printed.\n'
printf 'Add this hosts entry if it is not already present: 127.0.0.1 %s\n' "$DEV_HOST"
printf 'Trust %s in your OS or browser certificate store.\n' "$CA_CERT"
printf 'Open: %s\n' "$DEV_URL"
printf 'View app logs: docker compose logs -f app\n'
printf 'Stop services and keep data: docker compose down\n'
