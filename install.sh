#!/usr/bin/env bash

# MikroTik Multi-WAN Console - 1-Line Automated Installer Script
# Supports: Proxmox VE (Host Shell auto-creates LXC) & Linux CT/VM (Debian/Ubuntu)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "================================================================"
echo "    MIKROTIK MULTI-WAN CONSOLE - AUTOMATED 1-LINE INSTALLER    "
echo "================================================================"
echo -e "${NC}"

# 1. Detect if running directly on Proxmox VE Host Shell
if [ -d "/etc/pve" ] && [ ! -f "/.dockerenv" ] && [ ! -f "/run/systemd/container" ]; then
  echo -e "${YELLOW}Detected Proxmox VE Host Shell!${NC}"
  echo -e "${CYAN}Creating dedicated Debian LXC Container...${NC}"
  
  # Find next available CTID
  CTID=$(pvesh get /cluster/nextid)
  STORAGE="local"
  
  pveam update >/dev/null 2>&1 || true
  
  if ! pveam list ${STORAGE} 2>/dev/null | grep -q "debian"; then
    echo -e "${YELLOW}Downloading Debian 12 LXC Template...${NC}"
    LATEST_DEBIAN=$(pveam available 2>/dev/null | grep debian-12 | head -n 1 | awk '{print $2}' || echo "")
    if [ -n "$LATEST_DEBIAN" ]; then
      pveam download ${STORAGE} "$LATEST_DEBIAN"
    fi
  fi
  
  TEMPLATE=$(pveam list ${STORAGE} 2>/dev/null | grep debian | tail -n 1 | awk '{print $2}' || echo "")
  
  if [ -z "$TEMPLATE" ]; then
    echo -e "${RED}Error: Could not find or download Debian LXC template on storage '${STORAGE}'.${NC}"
    echo -e "Please create a Debian LXC container manually in Proxmox and run this installer inside it!"
    exit 1
  fi
  
  echo -e "${GREEN}Creating LXC Container ID ${CTID}...${NC}"
  pct create ${CTID} ${STORAGE}:vztmpl/${TEMPLATE} \
    --ostype debian \
    --hostname mikrotik-multiwan \
    --cores 2 \
    --memory 1024 \
    --swap 512 \
    --features nesting=1 \
    --net0 name=eth0,bridge=vmbr0,ip=dhcp \
    --storage local-lvm \
    --unprivileged 0 \
    --onboot 1 \
    --start 1 || pct create ${CTID} ${STORAGE}:vztmpl/${TEMPLATE} --hostname mikrotik-multiwan --cores 2 --memory 1024 --net0 name=eth0,bridge=vmbr0,ip=dhcp --start 1
  
  echo -e "${CYAN}Waiting for LXC container CTID ${CTID} network initialization...${NC}"
  sleep 6
  
  echo -e "${GREEN}Running 1-Line Installer inside LXC Container CTID ${CTID}...${NC}"
  pct exec ${CTID} -- bash -c "curl -fsSL https://raw.githubusercontent.com/mamamoblue52/mikrotik-multiwan-console/main/install.sh | bash"
  
  IP_ADDR=$(pct exec ${CTID} -- ip a s eth0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d/ -f1 || echo "CONTAINER_IP")
  
  echo -e "${GREEN}${BOLD}"
  echo "================================================================"
  echo "  🎉 PROXMOX LXC CONTAINER INSTALLED & DEPLOYED SUCCESSFULLY!"
  echo "  Container ID: ${CTID}"
  echo "  Web Dashboard URL: http://${IP_ADDR}:5000"
  echo "================================================================"
  echo -e "${NC}"
  exit 0
fi

# 2. General Linux / LXC Container Installation (Debian / Ubuntu)
echo -e "${CYAN}Step 1/5: Updating package lists & base tools...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git build-essential speedtest-cli ca-certificates gnupg

# Step 2: Install Node.js 20 LTS
if ! command -v node >/dev/null 2>&1 || [ $(node -v | cut -d. -f1 | tr -d 'v') -lt 18 ]; then
  echo -e "${CYAN}Step 2/5: Installing Node.js 20 LTS...${NC}"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
else
  echo -e "${GREEN}Node.js $(node -v) is already installed.${NC}"
fi

# Step 3: Install PM2 Process Manager
if ! command -v pm2 >/dev/null 2>&1; then
  echo -e "${CYAN}Step 3/5: Installing PM2 Process Manager...${NC}"
  npm install -g pm2
else
  echo -e "${GREEN}PM2 is already installed.${NC}"
fi

# Step 4: Clone or Update Application
APP_DIR="/root/app"
REPO_URL="https://github.com/mamamoblue52/mikrotik-multiwan-console.git"

echo -e "${CYAN}Step 4/5: Setting up application in ${APP_DIR}...${NC}"
if [ -d "$APP_DIR/.git" ]; then
  echo -e "${YELLOW}Updating existing installation...${NC}"
  cd "$APP_DIR"
  git fetch --all
  git reset --hard origin/main
else
  echo -e "${CYAN}Cloning repository from GitHub...${NC}"
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

npm install --production

# Step 5: Start & Save PM2 Service
echo -e "${CYAN}Step 5/5: Starting PM2 application service...${NC}"
pm2 stop speedtest-dashboard 2>/dev/null || true
pm2 delete speedtest-dashboard 2>/dev/null || true
pm2 start server.js --name "speedtest-dashboard"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || pm2 startup 2>/dev/null || true

MAIN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "SERVER_IP")

echo -e "${GREEN}${BOLD}"
echo "================================================================"
echo "  🚀 MIKROTIK MULTI-WAN CONSOLE INSTALLED SUCCESSFULLY!"
echo "================================================================"
echo -e "${NC}"
echo -e " Access Web Dashboard: ${CYAN}${BOLD}http://${MAIN_IP}:5000${NC}"
echo -e " Application Directory: ${YELLOW}/root/app${NC}"
echo -e " PM2 Process Name:      ${GREEN}speedtest-dashboard${NC}"
echo -e ""
echo -e "To check status: ${BOLD}pm2 status${NC}"
echo -e "To view live logs: ${BOLD}pm2 logs speedtest-dashboard${NC}"
echo -e ""
