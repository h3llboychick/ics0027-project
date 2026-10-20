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

command -v openssl >/dev/null 2>&1 || die "OpenSSL is required to create the development certificates."

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

  awk -v key="$key" -v value="$value" '
    BEGIN { prefix = key "=" }
    index($0, prefix) == 1 {
      if (!found) print prefix value
      found = 1
      next
    }
    { print }
    END { if (!found) print prefix value }
  ' "$ENV_FILE" > "$temp_file"

  chmod 600 "$temp_file"
  mv -- "$temp_file" "$ENV_FILE"
}

ensure_value() {
  local key="$1"
  local default_value="$2"
  if [[ -z "$(read_env "$key")" ]]; then
    write_env "$key" "$default_value"
  fi
}

ensure_hex_secret() {
  local key="$1"
  local byte_count="$2"
  if [[ -z "$(read_env "$key")" ]]; then
    write_env "$key" "$(openssl rand -hex "$byte_count")"
  fi
}

ensure_value POSTGRES_DB storage
ensure_value POSTGRES_USER storage
ensure_hex_secret POSTGRES_PASSWORD 24
ensure_hex_secret BETTER_AUTH_SECRET 32
ensure_hex_secret FILE_ENCRYPTION_KEK 32
ensure_value RESEND_API_KEY ""

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
database_url="$(read_env DATABASE_URL)"
safe_url_component='^[-A-Za-z0-9._~]+$'
if [[ -z "$database_url" ]]; then
  [[ "$db_name" =~ $safe_url_component && "$db_user" =~ $safe_url_component && "$db_password" =~ $safe_url_component ]] \
    || die "Set DATABASE_URL explicitly: the current PostgreSQL values need URL encoding."
  write_env DATABASE_URL "postgresql://$db_user:$db_password@localhost:5432/$db_name"
fi

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

if [[ -z "$(read_env RESEND_API_KEY)" ]]; then
  printf '\nRESEND_API_KEY is empty. Add a valid Resend API key to .env to enable sign-up and password-reset emails.\n'
fi

printf '\nLocal development secrets and TLS files are ready. Secret values were not printed.\n'
printf '1. Add this hosts entry if it is not already present: 127.0.0.1 %s\n' "$DEV_HOST"
printf '2. Trust %s in your OS/browser certificate store.\n' "$CA_CERT"
printf '3. Start the app with: docker compose up --build -d\n'
printf '4. Open: %s\n' "$DEV_URL"
