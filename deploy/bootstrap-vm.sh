#!/usr/bin/env bash
set -euo pipefail

# Run this once on a fresh Ubuntu/Debian Azure VM as root.
# It installs Docker Engine, Docker Compose plugin, NGINX, and Certbot,
# then prepares the /opt/crm-support deployment directory.

DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-$USER}}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/crm-support}"

apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release nginx certbot python3-certbot-nginx

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

ARCH="$(dpkg --print-architecture)"
CODENAME="$(
  . /etc/os-release
  echo "$VERSION_CODENAME"
)"

cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker
systemctl enable nginx
systemctl start nginx

usermod -aG docker "$DEPLOY_USER"

mkdir -p "$DEPLOY_ROOT/deploy"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_ROOT"

cat <<EOF
Bootstrap complete.

Next manual steps:
1. Copy deploy/nginx.dev.conf to /etc/nginx/sites-available/crm-support-dev
2. Replace the server_name with your real API domain
3. Enable the site and reload NGINX
4. Create $DEPLOY_ROOT/.env.azure manually from the repo template .env.azure.example
   This runtime file is not uploaded or overwritten by CI.
5. Log Docker into GHCR once or let CI log in during each deploy
6. Run certbot after DNS points to the VM:
   sudo certbot --nginx -d your-api-domain

If you use UFW, allow only:
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
EOF
