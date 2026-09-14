# 🚀 MikroTik Multi-WAN Console & Live Gateway Monitor

A high-performance, real-time web dashboard for **MikroTik RouterOS** Multi-WAN load balancing, policy routing, gateway failover health monitoring, and Ookla speedtesting.

Developed by **Joshua Limbaga || Pee Deleon** (Maintainer: `jaypeedeleon0-lgtm`).

---

## ✨ Features

- 🔒 **Monochrome Black & White Admin Login**: Secure authentication with `scrypt` password hashing and session tokens.
- ⚡ **Live WAN Speedtest Gauge**: Ookla speedtest integration with real-time dial meter and dynamic policy routing bypass.
- 🌐 **Multi-WAN Routing Rules**: Dynamically toggle policy routing marks for targeted client devices without disrupting existing router configurations.
- ⏱️ **PHT Manila Clock Widget**: Synchronized real-time Manila time widget.
- 📦 **Automated 1-Line Proxmox Installer**: Zero-config deployment on Proxmox VE hypervisor host shells with Debian 12 LXC auto-creation.

---

## ⚡ 1-Line Automated Installation (Proxmox VE Host Shell)

To deploy a dedicated LXC container with automatic CPU/RAM allocation (2 Cores, 1GB RAM, Auto-Boot) directly from your Proxmox host shell, run:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/jaypeedeleon0-lgtm/mikrotik-multiwan-console/main/install.sh)
```

---

## 🛠️ General Linux / LXC Container Installation

For existing Debian 12 / Ubuntu Linux servers or containers:

```bash
git clone https://github.com/jaypeedeleon0-lgtm/mikrotik-multiwan-console.git /root/app
cd /root/app
npm install --production
node server.js
```

Or run via **PM2 Process Manager**:

```bash
npm install -g pm2
pm2 start server.js --name "speedtest-dashboard"
pm2 save
```

---

## 🔑 Default Credentials

- **Username**: `admin`
- **Password**: `admin`

*(Password can be updated anytime from the Admin Profile icon 👤 in the dashboard header).*

---

## 📄 License

MIT License - Free for personal & commercial MikroTik network administration.
