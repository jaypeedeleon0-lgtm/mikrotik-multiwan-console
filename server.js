const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');
const http = require('http');
const https = require('https');
const { RouterOSAPI } = require('node-routeros');

const app = express();
const PORT = process.env.PORT || 5000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ENV_FILE = path.join(__dirname, '.env');

// Master Encryption Key
let ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  if (fs.existsSync(ENV_FILE)) {
    const envContent = fs.readFileSync(ENV_FILE, 'utf8');
    const match = envContent.match(/ENCRYPTION_KEY=(.+)/);
    if (match) ENCRYPTION_KEY = match[1].trim();
  }
}
if (!ENCRYPTION_KEY) {
  ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(ENV_FILE, `PORT=5000\nENCRYPTION_KEY=${ENCRYPTION_KEY}\n`, 'utf8');
}

const ALGORITHM = 'aes-256-cbc';
const KEY_BUFFER = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');

function encryptText(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY_BUFFER, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decryptText(encryptedText) {
  if (!encryptedText || !encryptedText.includes(':')) return '';
  const [ivHex, encryptedHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY_BUFFER, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// ==========================================================================
// ADMIN AUTHENTICATION SYSTEM (scrypt Hashing & Session Guard)
// ==========================================================================
const AUTH_FILE = path.join(__dirname, 'auth.json');
const activeSessions = new Map(); // token -> { username, expiresAt }

function hashPassword(password, salt) {
  return crypto.scryptSync(password || '', salt, 64).toString('hex');
}

function getAuthData() {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const raw = fs.readFileSync(AUTH_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.username && parsed.hash && parsed.salt) {
        return parsed;
      }
    } catch (e) {}
  }
  
  // Initialize default admin / admin credentials on first launch
  const salt = crypto.randomBytes(16).toString('hex');
  const defaultHash = hashPassword('admin', salt);
  const defaultAuth = {
    username: 'admin',
    hash: defaultHash,
    salt: salt,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(defaultAuth, null, 2), 'utf8');
  return defaultAuth;
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 Hours valid
  activeSessions.set(token, { username, expiresAt });
  return token;
}

function verifyToken(token) {
  if (!token || !activeSessions.has(token)) return false;
  const session = activeSessions.get(token);
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return session;
}

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim() || req.query.token;
  const session = verifyToken(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Please log in first.' });
  }
  req.user = session;
  next();
}

// Authentication API Endpoints
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const authData = getAuthData();

    if (!username || username.trim() !== authData.username) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    }

    const inputHash = hashPassword(password, authData.salt);
    if (inputHash !== authData.hash) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    }

    const token = createSession(authData.username);
    res.json({ success: true, token, username: authData.username });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/status', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim() || req.query.token;
  const session = verifyToken(token);
  if (session) {
    res.json({ success: true, authenticated: true, username: session.username });
  } else {
    res.json({ success: true, authenticated: false });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (token) activeSessions.delete(token);
  res.json({ success: true });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body;
    const authData = getAuthData();

    const inputHash = hashPassword(currentPassword, authData.salt);
    if (inputHash !== authData.hash) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect.' });
    }

    if (!newPassword || newPassword.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'New password must be at least 3 characters.' });
    }

    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = hashPassword(newPassword, newSalt);
    const updatedUsername = (newUsername && newUsername.trim()) ? newUsername.trim() : authData.username;

    const updatedAuth = {
      username: updatedUsername,
      hash: newHash,
      salt: newSalt,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(AUTH_FILE, JSON.stringify(updatedAuth, null, 2), 'utf8');

    // Invalidate old sessions
    activeSessions.clear();
    const newToken = createSession(updatedUsername);

    res.json({
      success: true,
      message: 'Admin credentials updated successfully.',
      token: newToken,
      username: updatedUsername
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Persistent Connection Pool
let activeApiConnection = null;
let currentConfig = null;

const os = require('os');

function getServerIp(req) {
  if (req && req.headers && req.headers.host) {
    const hostHeader = req.headers.host.split(':')[0].trim();
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostHeader) && hostHeader !== '127.0.0.1') {
      return hostHeader;
    }
  }
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return getClientIp(req);
}

async function getRosClient(config) {
  const isSameConfig = currentConfig &&
    currentConfig.host === config.host &&
    currentConfig.username === config.username &&
    currentConfig.password === config.password &&
    currentConfig.port === config.port;

  if (activeApiConnection && isSameConfig && activeApiConnection.connected) {
    return activeApiConnection;
  }

  if (activeApiConnection) {
    try { activeApiConnection.close(); } catch(e){}
    activeApiConnection = null;
  }
  
  currentConfig = { ...config };
  const realPassword = (config.password && config.password.includes(':'))
    ? decryptText(config.password)
    : (config.password || '');

  const conn = new RouterOSAPI({
    host: config.host || '',
    user: config.username || 'admin',
    password: realPassword,
    port: parseInt(config.port, 10) || 8728,
    timeout: 10
  });

  conn.on('error', (err) => {
    console.log('RouterOS Socket Info:', err.message);
    try { conn.close(); } catch(e){}
    if (activeApiConnection === conn) {
      activeApiConnection = null;
    }
  });

  await conn.connect();
  activeApiConnection = conn;
  return activeApiConnection;
}

async function runRosCmd(config, command, paramsObj = null) {
  try {
    const conn = await getRosClient(config);
    if (paramsObj && typeof paramsObj === 'object') {
      const args = [command];
      for (const [key, val] of Object.entries(paramsObj)) {
        args.push(`=${key}=${val}`);
      }
      return await conn.write(args);
    } else {
      return await conn.write(command);
    }
  } catch (err) {
    if (activeApiConnection) {
      try { activeApiConnection.close(); } catch(e){}
      activeApiConnection = null;
    }
    throw err;
  }
}

function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (ip.includes('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  if (ip === '::1' || ip === '127.0.0.1') {
    ip = '127.0.0.1';
  }
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  return ip;
}

// Client / Server IP Auto Detection API
app.get('/api/client-ip', (req, res) => {
  const serverIp = getServerIp(req);
  const clientIp = getClientIp(req);
  res.json({ success: true, serverIp, clientIp, detectedIp: serverIp });
});

// 0. Load Saved Credentials
app.get('/api/saved-config', requireAuth, (req, res) => {
  try {
    const detectedIp = getServerIp(req);
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const savedConfig = JSON.parse(raw);
      
      const decryptedPassword = savedConfig.encryptedPassword 
        ? decryptText(savedConfig.encryptedPassword) 
        : (savedConfig.password || '');

      const host = savedConfig.host || '';
      const targetIp = savedConfig.targetIp || detectedIp;

      return res.json({
        success: true,
        hasSaved: !!host,
        clientIp: detectedIp,
        data: {
          host: host,
          username: savedConfig.username || '',
          password: decryptedPassword,
          port: savedConfig.port || 8728,
          targetIp: targetIp,
          selectedWans: savedConfig.selectedWans || []
        }
      });
    }
    res.json({ success: true, hasSaved: false, clientIp: detectedIp });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 1. Connect Router & Get System Info + All Interfaces
app.post('/api/connect', requireAuth, async (req, res) => {
  try {
    const { host, username, password, port, saveCredentials, targetIp } = req.body;
    const config = { host, username, password, port };

    const [sysDataArr, interfaces, dhcpClients, routingTables, mangleRules] = await Promise.all([
      runRosCmd(config, '/system/resource/print'),
      runRosCmd(config, '/interface/print').catch(() => []),
      runRosCmd(config, '/ip/dhcp-client/print').catch(() => []),
      runRosCmd(config, '/routing/table/print').catch(() => []),
      runRosCmd(config, '/ip/firewall/mangle/print').catch(() => [])
    ]);

    const sysData = Array.isArray(sysDataArr) ? sysDataArr[0] : sysDataArr;

    const dhcpMap = {};
    if (Array.isArray(dhcpClients)) {
      dhcpClients.forEach(c => {
        if (c.interface) dhcpMap[c.interface] = c.gateway || 'DHCP';
      });
    }

    // Extract unique Routing Marks configured in MikroTik
    const routingMarksSet = new Set();
    if (Array.isArray(routingTables)) {
      routingTables.forEach(t => {
        if (t.name) routingMarksSet.add(t.name);
      });
    }
    if (Array.isArray(mangleRules)) {
      mangleRules.forEach(r => {
        if (r['new-routing-mark']) routingMarksSet.add(r['new-routing-mark']);
        if (r['routing-mark']) routingMarksSet.add(r['routing-mark']);
      });
    }
    const routingMarks = Array.from(routingMarksSet);

    // Filter available interfaces for user selection
    const allInterfaces = [];
    if (Array.isArray(interfaces)) {
      interfaces.forEach(iface => {
        if (iface.disabled !== 'true') {
          allInterfaces.push({
            name: iface.name,
            type: iface.type || 'ether',
            running: iface.running === 'true',
            gateway: dhcpMap[iface.name] || 'Static / Gateway'
          });
        }
      });
    }

    if (saveCredentials) {
      const encryptedPassword = encryptText(password);
      let existing = {};
      if (fs.existsSync(CONFIG_FILE)) {
        try { existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch(e){}
      }

      const configToSave = {
        ...existing,
        savedAt: new Date().toISOString(),
        host,
        username,
        encryptedPassword,
        port,
        targetIp: targetIp || getServerIp(req)
      };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2), 'utf8');
    }

    res.json({
      success: true,
      data: {
        model: sysData['board-name'] || sysData['architecture-name'] || 'MikroTik Board',
        version: sysData['version'] || 'v7.x',
        cpuLoad: sysData['cpu-load'] || '0',
        uptime: sysData['uptime'] || 'Unknown',
        allInterfaces: allInterfaces,
        routingMarks: routingMarks
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Save WAN Selection & AUTOMATICALLY Provision Mangle & Routes
app.post('/api/configure-wans', requireAuth, async (req, res) => {
  try {
    const { config, targetIp, selectedWans } = req.body;

    if (!Array.isArray(selectedWans)) {
      throw new Error('Invalid WAN selection.');
    }

    const selectedNames = selectedWans.map(w => w.name);

    // Step A: Ensure Routing Tables exist in ROS v7
    const existingTables = await runRosCmd(config, '/routing/table/print').catch(() => []);
    for (const wan of selectedWans) {
      const tableName = wan.routingMark || `to-${wan.name}`;
      const hasTable = Array.isArray(existingTables) && existingTables.some(t => t.name === tableName);
      if (!hasTable) {
        await runRosCmd(config, '/routing/table/add', {
          name: tableName,
          fib: 'yes'
        }).catch(() => {});
      }
    }

    // Step B: Ensure IP Routes exist for active WANs & remove routes for removed WANs
    const existingRoutes = await runRosCmd(config, '/ip/route/print').catch(() => []);
    if (Array.isArray(existingRoutes)) {
      // Remove routes for deleted WANs
      for (const r of existingRoutes) {
        if (r.comment) {
          if (r.comment.startsWith('Route for ')) {
            const wanNameFromComment = r.comment.replace('Route for ', '').trim();
            if (!selectedNames.includes(wanNameFromComment)) {
              console.log(`Removing Route for removed WAN: ${wanNameFromComment}`);
              await runRosCmd(config, '/ip/route/remove', { '.id': r['.id'] }).catch(() => {});
            }
          } else if (r.comment.startsWith('SPEEDTEST_PROBE:')) {
            const probeWan = r.comment.replace('SPEEDTEST_PROBE:', '').trim();
            if (!selectedNames.includes(probeWan)) {
              console.log(`Removing Probe Route for removed WAN: ${probeWan}`);
              await runRosCmd(config, '/ip/route/remove', { '.id': r['.id'] }).catch(() => {});
            }
          }
        }
      }
    }

    for (const wan of selectedWans) {
      const tableName = wan.routingMark || `to-${wan.name}`;
      const hasRoute = Array.isArray(existingRoutes) && existingRoutes.some(r => r['routing-table'] === tableName);
      if (!hasRoute) {
        await runRosCmd(config, '/ip/route/add', {
          'dst-address': '0.0.0.0/0',
          gateway: wan.gateway !== 'DHCP' && wan.gateway !== 'Static / Gateway' ? wan.gateway : wan.name,
          'routing-table': tableName,
          'check-gateway': 'ping',
          comment: `Route for ${wan.name}`
        }).catch(() => {});
      }
    }

    // Step C: Manage Mangle Rules - Add/Set selected WANs & REMOVE unselected/deleted WANs
    const mangleRules = await runRosCmd(config, '/ip/firewall/mangle/print').catch(() => []);

    if (Array.isArray(mangleRules)) {
      // Remove Mangle rules for WANs that were removed by user
      for (const r of mangleRules) {
        if (r.comment && r.comment.startsWith('SPEEDTEST: PC to ')) {
          const wanNameFromComment = r.comment.replace('SPEEDTEST: PC to ', '').trim();
          if (!selectedNames.includes(wanNameFromComment)) {
            console.log(`Removing Mangle rule for removed WAN: ${wanNameFromComment}`);
            await runRosCmd(config, '/ip/firewall/mangle/remove', { '.id': r['.id'] }).catch(() => {});
          }
        }
      }
    }

    for (const wan of selectedWans) {
      const commentTag = `SPEEDTEST: PC to ${wan.name}`;
      const targetRoutingMark = wan.routingMark || `to-${wan.name}`;
      const existingRule = Array.isArray(mangleRules) && mangleRules.find(r => r.comment === commentTag);

      if (!existingRule) {
        await runRosCmd(config, '/ip/firewall/mangle/add', {
          chain: 'prerouting',
          'src-address': targetIp,
          'dst-address-type': '!local',
          action: 'mark-routing',
          'new-routing-mark': targetRoutingMark,
          passthrough: 'no',
          disabled: 'yes',
          comment: commentTag
        });
      } else {
        await runRosCmd(config, '/ip/firewall/mangle/set', {
          '.id': existingRule['.id'],
          'src-address': targetIp,
          'dst-address-type': '!local',
          'new-routing-mark': targetRoutingMark
        });
      }
    }

    // Update config.json with user-selected WANs
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        existing.selectedWans = selectedWans;
        existing.targetIp = targetIp;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2), 'utf8');
      } catch (e) {}
    }

    // Return configured WAN list with active speedtest status
    const currentMangles = await runRosCmd(config, '/ip/firewall/mangle/print').catch(() => []);
    
    const configuredWanCards = selectedWans.map(wan => {
      const commentTag = `SPEEDTEST: PC to ${wan.name}`;
      const rule = Array.isArray(currentMangles) && currentMangles.find(r => r.comment === commentTag);
      return {
        name: wan.name,
        label: wan.label || wan.name,
        gateway: wan.gateway || 'Static / Gateway',
        speedtestEnabled: rule ? rule.disabled !== 'true' : false
      };
    });

    res.json({
      success: true,
      message: 'WAN Configuration saved & Mangle rules provisioned.',
      wans: configuredWanCards
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function parseRosv7TimeMs(timeRaw) {
  if (!timeRaw && timeRaw !== 0) return 0;
  const str = String(timeRaw).trim();
  let totalMs = 0;
  
  const secMatch = str.match(/(?<![a-zA-Z])(\d+(?:\.\d+)?)s(?![a-zA-Z])/);
  if (secMatch) totalMs += parseFloat(secMatch[1]) * 1000;

  const msMatch = str.match(/(\d+(?:\.\d+)?)ms/);
  if (msMatch) totalMs += parseFloat(msMatch[1]);

  const usMatch = str.match(/(\d+(?:\.\d+)?)us/);
  if (usMatch) totalMs += parseFloat(usMatch[1]) / 1000;

  if (!secMatch && !msMatch && !usMatch) {
    const val = parseFloat(str);
    if (!isNaN(val)) {
      totalMs = val > 100 ? val / 1000 : val;
    }
  }

  return totalMs;
}

// 3. Live Ping & Interface Health Monitor (5s Polling)
app.post('/api/ping-all', requireAuth, async (req, res) => {
  try {
    const { config, wans, targetAddress = '8.8.8.8' } = req.body;

    // Fetch interface states and IP addresses from MikroTik
    const interfaces = await runRosCmd(config, '/interface/print').catch(() => []);
    const ipAddrs = await runRosCmd(config, '/ip/address/print').catch(() => []);

    const results = [];

    for (const wan of wans) {
      try {
        const ifaceObj = Array.isArray(interfaces) 
          ? interfaces.find(i => i.name === wan.name) 
          : null;

        if (ifaceObj) {
          if (ifaceObj.disabled === 'true') {
            results.push({
              wanName: wan.name,
              pingMs: 0,
              packetLoss: 100,
              status: 'disabled',
              statusText: 'Interface Disabled',
              isDisabled: true,
              isLinkDown: false
            });
            continue;
          }

          if (ifaceObj.running === 'false') {
            results.push({
              wanName: wan.name,
              pingMs: 0,
              packetLoss: 100,
              status: 'down',
              statusText: 'Link Down / Cable Disconnected',
              isDisabled: false,
              isLinkDown: true
            });
            continue;
          }
        }

        // Clean up any lingering SPEEDTEST_PROBE routes on MikroTik so routing table is 100% clean and log 100% quiet
        const routes = await runRosCmd(config, '/ip/route/print').catch(() => []);
        if (Array.isArray(routes)) {
          for (const r of routes) {
            if (r.comment && r.comment.startsWith('SPEEDTEST_PROBE:')) {
              if (r['.id']) {
                await runRosCmd(config, '/ip/route/remove', { '.id': r['.id'] }).catch(() => null);
              }
            }
          }
        }

        // Gateway Health Probe: Ping immediate ISP Gateway IP (100% stable modem connection check)
        const addrObj = Array.isArray(ipAddrs) ? ipAddrs.find(a => a.interface === wan.name) : null;
        const srcIp = addrObj && addrObj.address ? addrObj.address.split('/')[0] : null;

        const gwTargetIp = (wan.gateway && wan.gateway !== 'Static / Gateway' && wan.gateway !== 'DHCP')
          ? wan.gateway
          : (srcIp || '8.8.8.8');

        let pingParams = {
          address: gwTargetIp,
          count: '3',
          interval: '200ms'
        };
        if (srcIp && gwTargetIp !== srcIp) pingParams['src-address'] = srcIp;

        let pingRes = await runRosCmd(config, '/ping', pingParams).catch(() => null);

        let total = Array.isArray(pingRes) ? pingRes.length : 0;
        let received = 0;
        let sumTime = 0;

        if (Array.isArray(pingRes)) {
          pingRes.forEach(p => {
            const packetLoss = p['packet-loss'] || p.loss;
            if (p.status === 'timeout' || p.status === 'packet rejected' || packetLoss === '100' || (!p.time && p.time !== 0)) {
              // Lost
            } else {
              received++;
              sumTime += parseRosv7TimeMs(p.time);
            }
          });
        }

        const avgPingMs = received > 0 ? Math.round(sumTime / received) : 0;
        const lossPercent = total > 0 ? Math.round(((total - received) / total) * 100) : 0;

        let status = 'good';
        let statusText = 'Gateway Active / Low Latency';

        if (lossPercent === 100 || received === 0) {
          status = 'down';
          statusText = 'Gateway Offline / Disconnected';
        } else if (lossPercent > 0) {
          status = 'warning';
          statusText = `Gateway Packet Loss (${lossPercent}%)`;
        }

        results.push({
          wanName: wan.name,
          pingMs: avgPingMs,
          packetLoss: lossPercent,
          status: status,
          statusText: statusText,
          isDisabled: false,
          isLinkDown: false
        });
      } catch (pingErr) {
        results.push({
          wanName: wan.name,
          pingMs: 0,
          packetLoss: 100,
          status: 'down',
          statusText: 'Check Failed',
          isDisabled: false,
          isLinkDown: false,
          error: pingErr.message
        });
      }
    }

    res.json({ success: true, pingResults: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Switch Speedtest WAN
app.post('/api/switch-wan', requireAuth, async (req, res) => {
  try {
    const { config, targetWanName } = req.body;
    const mangleRules = await runRosCmd(config, '/ip/firewall/mangle/print');

    if (!Array.isArray(mangleRules)) {
      throw new Error('Could not fetch Mangle rules from MikroTik');
    }

    const speedtestRules = mangleRules.filter(r => r.comment && r.comment.includes('SPEEDTEST'));

    for (const rule of speedtestRules) {
      const isMatch = targetWanName && rule.comment.includes(targetWanName);
      if (isMatch) {
        await runRosCmd(config, '/ip/firewall/mangle/enable', { '.id': rule['.id'] });
      } else {
        await runRosCmd(config, '/ip/firewall/mangle/disable', { '.id': rule['.id'] });
      }
    }

    res.json({ success: true, activeWan: targetWanName || 'NORMAL_LOAD_BALANCE' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Detect Egress Public IP & ISP Provider Details
app.get('/api/public-ip', async (req, res) => {
  try {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const response = await fetch('https://api.ipify.org?format=json', { timeout: 4000 });
    const data = await response.json();
    
    let ispName = 'WAN Connection';
    try {
      const ipDetails = await fetch(`https://ipapi.co/${data.ip}/json/`, { timeout: 3000 });
      const ipJson = await ipDetails.json();
      if (ipJson.org || ipJson.asn) {
        ispName = cleanIspName(ipJson.org || ipJson.asn);
      }
    } catch(e) {}

    res.json({
      success: true,
      ip: data.ip || 'Unknown Public IP',
      isp: ispName
    });
  } catch (err) {
    res.json({
      success: true,
      ip: 'Active Gateway IP',
      isp: 'WAN Interface'
    });
  }
});

// 6. Speedtest Payload Endpoints (High-Accuracy Throughput Measurement)
const SPEEDTEST_BUFFER = Buffer.alloc(10 * 1024 * 1024, 'x'); // 10MB test buffer

app.get('/api/speedtest/download', (req, res) => {
  const sizeMb = parseInt(req.query.size, 10) || 5;
  const targetBytes = Math.min(sizeMb, 25) * 1024 * 1024;
  
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', targetBytes);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  let sent = 0;
  const chunk = SPEEDTEST_BUFFER;

  function sendChunk() {
    while (sent < targetBytes) {
      const remaining = targetBytes - sent;
      const currentChunk = remaining < chunk.length ? chunk.slice(0, remaining) : chunk;
      sent += currentChunk.length;
      if (!res.write(currentChunk)) {
        res.once('drain', sendChunk);
        return;
      }
    }
    res.end();
  }

  sendChunk();
});

app.post('/api/speedtest/upload', (req, res) => {
  let receivedBytes = 0;
  req.on('data', chunk => {
    receivedBytes += chunk.length;
  });
  req.on('end', () => {
    res.json({ success: true, bytesReceived: receivedBytes });
  });
});

// 7. Proxmox Server-Side Ookla Speedtest CLI Runner Endpoint
app.post('/api/run-server-speedtest', requireAuth, (req, res) => {
  const { wanName } = req.body;
  const cmd = 'speedtest --format=json';

  exec(cmd, { timeout: 35000 }, (error, stdout, stderr) => {
    if (!error && stdout) {
      try {
        const json = JSON.parse(stdout);
        const downloadMbps = ((json.download.bandwidth * 8) / 1000000).toFixed(2);
        const uploadMbps = ((json.upload.bandwidth * 8) / 1000000).toFixed(2);
        const pingMs = Math.round(json.ping.latency).toString();
        const jitterMs = Math.round(json.ping.jitter || 0).toString();
        const publicIp = json.interface ? json.interface.externalIp : 'Active Routed Line';
        const isp = json.isp || wanName || 'Egress WAN Gateway';
        const serverName = json.server ? json.server.name : 'Ookla Server';

        return res.json({
          success: true,
          cliInstalled: true,
          downloadMbps,
          uploadMbps,
          pingMs,
          jitterMs,
          publicIp,
          isp,
          serverName,
          timestamp: new Date().toISOString()
        });
      } catch (parseErr) {
        // Fallthrough
      }
    }

    res.json({
      success: false,
      cliInstalled: false,
      error: 'Ookla Speedtest CLI binary execution failed or not installed.',
      downloadMbps: null,
      uploadMbps: null,
      pingMs: null,
      jitterMs: null
    });
  });
});

// 8. Real-Time Live Streaming Speedtest Endpoint (Server-Sent Events for Live Gauge)
app.get('/api/run-server-speedtest-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { spawn } = require('child_process');
  const wanName = req.query.wanName || 'WAN';

  const cmd = 'speedtest';
  const args = ['--format=jsonl', '--accept-license', '--accept-gdpr'];

  let proc;
  try {
    proc = spawn(cmd, args);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
    return;
  }

  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    lines.forEach(line => {
      if (!line.trim()) return;
      try {
        const data = JSON.parse(line.trim());
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {}
    });
  });

  proc.stderr.on('data', (data) => {
    console.error('Speedtest Stream Stderr:', data.toString());
  });

  proc.on('close', (code) => {
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer.trim());
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {}
    }
    res.write('event: done\ndata: {"status":"complete"}\n\n');
    res.end();
  });

  req.on('close', () => {
    try { proc.kill(); } catch (e) {}
  });
});

// 9. Auto-Detect Nearest Ookla Server Endpoint
app.get('/api/detect-speedtest-server', (req, res) => {
  const cmd = 'speedtest --servers --format=json';
  exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
    if (!error && stdout) {
      try {
        const json = JSON.parse(stdout);
        if (json.servers && json.servers.length > 0) {
          const s = json.servers[0];
          return res.json({
            success: true,
            server: {
              id: s.id,
              name: s.name,
              location: s.location || 'PH',
              country: s.country || 'Philippines',
              host: s.host
            }
          });
        }
      } catch (e) {}
    }

    res.json({
      success: false,
      server: null
    });
  });
});

// 10. System Version & Update API Endpoints (GitHub Integration)
app.get('/api/system/version-info', (req, res) => {
  exec('git log -1 --format="%h|%s|%cd" && git rev-parse --abbrev-ref HEAD', (err, stdout) => {
    if (err || !stdout) {
      return res.json({
        success: true,
        commit: '3336991',
        message: 'Initial release v1.0.0',
        date: new Date().toLocaleDateString(),
        branch: 'main'
      });
    }
    const lines = stdout.trim().split('\n');
    const parts = (lines[0] || '').split('|');
    res.json({
      success: true,
      commit: parts[0] || 'v1.0.0',
      message: parts[1] || 'MikroTik Multi-WAN Console',
      date: parts[2] || '',
      branch: lines[1] || 'main'
    });
  });
});

app.get('/api/system/check-update', requireAuth, (req, res) => {
  exec('git fetch origin main && git log HEAD..origin/main --format="%h|%s|%cd"', { timeout: 15000 }, (err, stdout) => {
    if (err) {
      return res.json({
        success: false,
        error: err.message || 'Could not fetch updates from GitHub.'
      });
    }

    const raw = stdout.trim();
    if (!raw) {
      return res.json({
        success: true,
        hasUpdate: false,
        behindCount: 0,
        unpulledCommits: []
      });
    }

    const commitLines = raw.split('\n').filter(l => l.trim().length > 0);
    const unpulledCommits = commitLines.map(line => {
      const parts = line.split('|');
      return {
        hash: parts[0] || '',
        message: parts[1] || '',
        date: parts[2] || ''
      };
    });

    res.json({
      success: true,
      hasUpdate: unpulledCommits.length > 0,
      behindCount: unpulledCommits.length,
      unpulledCommits: unpulledCommits,
      latestCommit: unpulledCommits[0] || null
    });
  });
});

app.post('/api/system/apply-update', requireAuth, (req, res) => {
  exec('git fetch origin main && git reset --hard origin/main', { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to pull update from GitHub.'
      });
    }

    res.json({
      success: true,
      message: 'System successfully updated to latest GitHub release! Restarting service...'
    });

    setTimeout(() => {
      exec('pm2 restart speedtest-dashboard', () => {
        process.exit(0);
      });
    }, 800);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 MikroTik Multi-WAN Console running on http://localhost:${PORT}`);
});

