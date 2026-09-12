// MikroTik Multi-WAN Speedtest & Gateway Health Dashboard Client

let routerConfig = null;
let allFetchedInterfaces = [];
let configuredWans = [];
let activeWanName = null;
let pingIntervalTimer = null;

// Helper: Escape HTML strings to prevent XSS / render errors
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// DOM Elements
const connectForm = document.getElementById('connectForm');
const hostInput = document.getElementById('hostInput');
const usernameInput = document.getElementById('usernameInput');
const passwordInput = document.getElementById('passwordInput');
const portInput = document.getElementById('portInput');

const connectionStatusOrb = document.getElementById('connectionStatusOrb');
const routerStateBadge = document.getElementById('routerStateBadge');
const connectBtn = document.getElementById('connectBtn');
const masterResetBtn = document.getElementById('masterResetBtn');

const targetIpInput = document.getElementById('targetIpInput');

const resModel = document.getElementById('resModel');
const resVersion = document.getElementById('resVersion');
const resCpu = document.getElementById('resCpu');
const resUptime = document.getElementById('resUptime');

const configuredWanCountBadge = document.getElementById('configuredWanCountBadge');
const openAddWanModalBtn = document.getElementById('openAddWanModalBtn');

// Speedtest Gauge Modal Elements
const speedtestGaugeModal = document.getElementById('speedtestGaugeModal');
const closeGaugeModalBtn = document.getElementById('closeGaugeModalBtn');
const stopGaugeTestBtn = document.getElementById('stopGaugeTestBtn');
const gaugeIspBadge = document.getElementById('gaugeIspBadge');
const gaugeIpText = document.getElementById('gaugeIpText');
const ooklaStandbyBanner = document.getElementById('ooklaStandbyBanner');

const runServerCliBtn = document.getElementById('runServerCliBtn');
const cliResultsBox = document.getElementById('cliResultsBox');
const cliStatusText = document.getElementById('cliStatusText');
const cliServerText = document.getElementById('cliServerText');
const cliDlVal = document.getElementById('cliDlVal');
const cliUlVal = document.getElementById('cliUlVal');
const cliPingVal = document.getElementById('cliPingVal');
const cliJitterVal = document.getElementById('cliJitterVal');
const cliInstallNotice = document.getElementById('cliInstallNotice');

const testResultBar = document.getElementById('testResultBar');
const gaugeArcFill = document.getElementById('gaugeArcFill');
const gaugeSpeedNum = document.getElementById('gaugeSpeedNum');
const gaugeLabelText = document.getElementById('gaugeLabelText');
let gaugeAnimTimer = null;
let currentEventSource = null;

function speedToPct(speed) {
  const points = [
    { val: 0, pct: 0 },
    { val: 5, pct: 0.125 },
    { val: 10, pct: 0.25 },
    { val: 50, pct: 0.375 },
    { val: 100, pct: 0.50 },
    { val: 250, pct: 0.625 },
    { val: 500, pct: 0.75 },
    { val: 750, pct: 0.875 },
    { val: 1000, pct: 1.0 }
  ];
  if (speed <= 0) return 0;
  if (speed >= 1000) return 1.0;
  for (let i = 0; i < points.length - 1; i++) {
    if (speed >= points[i].val && speed <= points[i+1].val) {
      const rangeVal = points[i+1].val - points[i].val;
      const rangePct = points[i+1].pct - points[i].pct;
      const progress = (speed - points[i].val) / rangeVal;
      return points[i].pct + (progress * rangePct);
    }
  }
  return 1.0;
}

let currentGaugeSpeed = 0;
let targetGaugeSpeed = 0;
let gaugeRafId = null;
let currentGaugePhase = 'download';

function animateGaugeTo(targetSpeed, phase = 'download') {
  targetGaugeSpeed = Math.max(0, targetSpeed);
  currentGaugePhase = phase;
  if (!gaugeRafId) {
    gaugeRafId = requestAnimationFrame(stepGaugeAnim);
  }
}

function stepGaugeAnim() {
  const diff = targetGaugeSpeed - currentGaugeSpeed;
  if (Math.abs(diff) < 0.05) {
    currentGaugeSpeed = targetGaugeSpeed;
    renderGaugeState(currentGaugeSpeed, currentGaugePhase);
    gaugeRafId = null;
  } else {
    currentGaugeSpeed += diff * 0.22;
    renderGaugeState(currentGaugeSpeed, currentGaugePhase);
    gaugeRafId = requestAnimationFrame(stepGaugeAnim);
  }
}

function renderGaugeState(speedMbps, phase) {
  const pct = speedToPct(speedMbps);
  const gaugeSpeedNum = document.getElementById('gaugeSpeedNum');
  const gaugeArcFill = document.getElementById('gaugeArcFill');
  const gaugeLabelText = document.getElementById('gaugeLabelText');
  const gaugeNeedle = document.getElementById('gaugeNeedle');

  if (gaugeSpeedNum) gaugeSpeedNum.innerText = speedMbps.toFixed(2);
  
  if (gaugeArcFill) {
    const dashoffset = 397.9 * (1 - pct);
    gaugeArcFill.style.strokeDashoffset = dashoffset.toFixed(1);
    const needleStop = document.querySelector('#needleGrad stop:nth-child(2)');
    if (phase === 'upload') {
      gaugeArcFill.setAttribute('stroke', 'url(#uploadGradient)');
      if (gaugeLabelText) gaugeLabelText.innerHTML = '<span style="color:#d946ef;">↑ Mbps</span>';
      if (needleStop) needleStop.setAttribute('stop-color', '#d946ef');
    } else {
      gaugeArcFill.setAttribute('stroke', 'url(#downloadGradient)');
      if (gaugeLabelText) gaugeLabelText.innerHTML = '<span style="color:#00f2fe;">↓ Mbps</span>';
      if (needleStop) needleStop.setAttribute('stop-color', '#00f2fe');
    }
  }

  if (gaugeNeedle) {
    const angle = -120 + (pct * 240);
    gaugeNeedle.style.transform = `rotate(${angle.toFixed(1)}deg)`;
  }
}

function updateGaugeSpeed(speedMbps, phase = 'download') {
  if (gaugeRafId) {
    cancelAnimationFrame(gaugeRafId);
    gaugeRafId = null;
  }
  currentGaugeSpeed = speedMbps;
  targetGaugeSpeed = speedMbps;
  renderGaugeState(speedMbps, phase);
}

// Modal Elements
const addWanModal = document.getElementById('addWanModal');
const closeAddWanModalBtn = document.getElementById('closeAddWanModalBtn');
const cancelAddWanModalBtn = document.getElementById('cancelAddWanModalBtn');
const addWanForm = document.getElementById('addWanForm');
const modalInterfaceSelect = document.getElementById('modalInterfaceSelect');
const modalWanLabelInput = document.getElementById('modalWanLabelInput');
const submitAddWanBtn = document.getElementById('submitAddWanBtn');

const wanGrid = document.getElementById('wanGrid');
const wanCountLabel = document.getElementById('wanCountLabel');
const toastContainer = document.getElementById('toastContainer');

// Notification Toast Helper
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// Auto-Load Saved Credentials & Auto-Detect Target Device Client IP
let isInitialAutoConnect = false;

const detectTargetIpBtn = document.getElementById('detectTargetIpBtn');

async function fetchClientIp(force = false) {
  try {
    const res = await fetch('/api/client-ip');
    const data = await res.json();
    const detectedIp = data.detectedIp || data.serverIp || data.clientIp;
    if (data.success && detectedIp) {
      if (force || !targetIpInput.value || targetIpInput.value === '172.16.10.253') {
        targetIpInput.value = detectedIp;
        if (force) {
          showToast(`Auto-detected Device IP: ${detectedIp}`, 'info');
        }
      }
    }
  } catch (err) {
    console.warn('Could not auto-detect IP:', err);
  }
}

if (detectTargetIpBtn) {
  detectTargetIpBtn.addEventListener('click', () => {
    fetchClientIp(true);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/saved-config');
    const result = await res.json();

    if (result.clientIp) {
      fetchClientIp(false);
    }

    if (result.success && result.hasSaved) {
      const d = result.data;
      if (d.host) hostInput.value = d.host;
      if (d.username) usernameInput.value = d.username;
      if (d.password) passwordInput.value = d.password;
      if (d.port) portInput.value = d.port;

      if (d.targetIp) {
        targetIpInput.value = d.targetIp;
      } else if (result.clientIp) {
        targetIpInput.value = result.clientIp;
      }

      if (Array.isArray(d.selectedWans) && d.selectedWans.length > 0) {
        configuredWans = d.selectedWans;
      }

      // Silent auto-connect on page refresh if host is configured
      if (hostInput.value.trim()) {
        isInitialAutoConnect = true;
        connectForm.dispatchEvent(new Event('submit'));
      }
    } else {
      fetchClientIp(true);
    }
  } catch (err) {
    console.error('Error loading saved config:', err);
    fetchClientIp(true);
  }
});

// 1. Connect Router Handler
connectForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  routerConfig = {
    host: hostInput.value.trim(),
    username: usernameInput.value.trim(),
    password: passwordInput.value,
    port: parseInt(portInput.value.trim(), 10) || 8728,
    saveCredentials: true,
    targetIp: targetIpInput.value.trim()
  };

  connectBtn.disabled = true;
  connectBtn.innerText = 'Connecting...';

  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routerConfig)
    });

    const result = await res.json();

    if (!result.success) {
      throw new Error(result.error);
    }

    // Connection Success
    connectionStatusOrb.classList.add('connected');
    routerStateBadge.classList.add('connected');
    routerStateBadge.innerText = 'Connected';
    connectBtn.disabled = false;
    connectBtn.innerText = 'Connected';

    // System Stats
    const sys = result.data;
    resModel.innerText = sys.model;
    resVersion.innerText = sys.version;
    resCpu.innerText = `${sys.cpuLoad}%`;
    resUptime.innerText = sys.uptime;

    allFetchedInterfaces = sys.allInterfaces || [];

    // Enable Add WAN Modal Button
    openAddWanModalBtn.disabled = false;

    if (!isInitialAutoConnect) {
      showToast(`Connected to MikroTik ${sys.model}!`, 'success');
    }
    isInitialAutoConnect = false;

    // Render saved WAN cards without calling re-provisioning API on load
    wanCountLabel.innerText = configuredWans.length;
    configuredWanCountBadge.innerText = `${configuredWans.length} WAN${configuredWans.length === 1 ? '' : 's'}`;
    renderWanCards();
    if (configuredWans.length > 0) {
      fetchPingStats();
      startLivePolling();
    }

  } catch (err) {
    isInitialAutoConnect = false;
    connectBtn.disabled = false;
    connectBtn.innerText = 'Connect Router';
    connectionStatusOrb.classList.remove('connected');
    routerStateBadge.classList.remove('connected');
    routerStateBadge.innerText = 'Error';
    showToast(`Connection Failed: ${err.message}`, 'error');
  }
});

// 2. Open Add WAN Modal Dialog Handler
openAddWanModalBtn.addEventListener('click', () => {
  if (allFetchedInterfaces.length === 0) {
    showToast('Please connect to your MikroTik router first!', 'error');
    return;
  }

  // Populate Interface Select Dropdown
  modalInterfaceSelect.innerHTML = allFetchedInterfaces.map(iface => {
    return `<option value="${iface.name}" data-gw="${iface.gateway}">${iface.name} (${iface.gateway})</option>`;
  }).join('');

  modalWanLabelInput.value = '';
  addWanModal.style.display = 'flex';
});

// Close Modal Controls
function closeModal() {
  addWanModal.style.display = 'none';
}
closeAddWanModalBtn.addEventListener('click', closeModal);
cancelAddWanModalBtn.addEventListener('click', closeModal);

// 3. Add WAN Form Submit -> Provision Mangle & Update WAN Cards
addWanForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const selectedIfaceName = modalInterfaceSelect.value;
  if (!selectedIfaceName) return;

  const opt = modalInterfaceSelect.options[modalInterfaceSelect.selectedIndex];
  const gateway = opt ? opt.getAttribute('data-gw') || 'Static / Gateway' : 'Static / Gateway';
  const customLabel = modalWanLabelInput.value.trim() || selectedIfaceName;

  if (configuredWans.some(w => w.name === selectedIfaceName)) {
    showToast(`Interface ${selectedIfaceName} is already configured.`, 'error');
    return;
  }

  const newWan = {
    name: selectedIfaceName,
    label: customLabel,
    gateway: gateway
  };

  const updatedWanList = [...configuredWans, newWan];

  submitAddWanBtn.disabled = true;
  submitAddWanBtn.innerText = 'Applying Mangle...';

  try {
    await saveAndApplyWans(updatedWanList, false);
    submitAddWanBtn.disabled = false;
    submitAddWanBtn.innerText = 'Add & Apply Mangle Rule';
    closeModal();
    showToast(`Added WAN ${customLabel} and applied Mangle rule!`, 'success');
  } catch (err) {
    submitAddWanBtn.disabled = false;
    submitAddWanBtn.innerText = 'Add & Apply Mangle Rule';
  }
});

// 4. Save WANs & Apply Mangle Engine
async function saveAndApplyWans(wansToApply, isAutoLoad = false) {
  if (!routerConfig) return;

  try {
    const res = await fetch('/api/configure-wans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: routerConfig,
        targetIp: targetIpInput.value.trim(),
        selectedWans: wansToApply
      })
    });

    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    configuredWans = result.wans;
    wanCountLabel.innerText = configuredWans.length;
    configuredWanCountBadge.innerText = `${configuredWans.length} WAN${configuredWans.length === 1 ? '' : 's'}`;

    const activeWan = configuredWans.find(w => w.speedtestEnabled);
    activeWanName = activeWan ? activeWan.name : null;

    renderWanCards();
    fetchPingStats();
    startLivePolling();

  } catch (err) {
    if (!isAutoLoad) {
      showToast(`Configuration Error: ${err.message}`, 'error');
    }
    throw err;
  }
}

// Remove WAN Handler
async function removeWan(wanName) {
  const updatedList = configuredWans.filter(w => w.name !== wanName);
  try {
    await saveAndApplyWans(updatedList, false);
    showToast(`WAN ${wanName} removed.`, 'success');
  } catch (err) {
    showToast(`Failed to remove WAN: ${err.message}`, 'error');
  }
}

// 5. Render Configured WAN Speedtest Cards (Clean Monochrome)
function renderWanCards() {
  if (!wanGrid) return;

  if (configuredWans.length === 0) {
    wanGrid.innerHTML = `
      <div class="empty-state">
        <div class="pulse-icon">📡</div>
        <h4>No WANs Configured</h4>
        <p>Connect your MikroTik router on the left sidebar, then click <strong>+ Add WAN Interface</strong> to select an interface.</p>
      </div>
    `;
    return;
  }

  const cardsHtml = configuredWans.map(wan => {
    const isCurrentActive = activeWanName === wan.name;
    const cardClass = `glass-card wan-card ${isCurrentActive ? 'active-route' : ''}`;

    return `
      <div class="${cardClass}" id="wan-card-${wan.name}">
        <div class="wan-card-header">
          <div class="wan-title-group">
            <div style="display:flex; align-items:center; gap:8px;">
              <h4>${wan.label || wan.name}</h4>
            </div>
            <span class="wan-subtitle">Interface: ${wan.name} | GW: ${wan.gateway}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${isCurrentActive ? '<span class="active-badge">ACTIVE ROUTE</span>' : ''}
            <button type="button" class="btn-remove-wan" title="Remove WAN" onclick="removeWan('${wan.name}')">✕</button>
          </div>
        </div>

        <div class="ping-stats-row">
          <div class="stat-box">
            <span class="stat-lbl">Modem Gateway Ping</span>
            <span class="stat-val good" id="ping-val-${wan.name}">-- ms</span>
          </div>
          <div class="stat-box">
            <span class="stat-lbl">Speedtest Ping</span>
            <span class="stat-val good" id="speed-ping-val-${wan.name}">-- ms</span>
          </div>
        </div>

        <div class="speedtest-badge-row">
          <span class="speed-lbl">LAST SPEEDTEST:</span>
          <span class="speed-val" id="speed-val-${wan.name}">Not Tested Yet</span>
        </div>

        <button class="btn ${isCurrentActive ? 'btn-primary' : 'btn-secondary'} btn-full" 
          style="margin-top: 10px;"
          onclick="openSpeedtestGaugeModal('${wan.name}')">
          Test Speed on ${wan.label || wan.name}
        </button>
      </div>
    `;
  }).join('');

  wanGrid.innerHTML = cardsHtml;
  setTimeout(() => {
    configuredWans.forEach(wan => restoreSavedWanSpeedtestStats(wan.name));
  }, 0);
}

function saveAndApplyWanSpeedtestResult(wanName, pingMs, dlMbps, ulMbps) {
  if (!wanName) return;
  const data = {
    pingMs: pingMs,
    dl: dlMbps,
    ul: ulMbps
  };
  localStorage.setItem(`speed_res_${wanName}`, JSON.stringify(data));
  restoreSavedWanSpeedtestStats(wanName);
}

function restoreSavedWanSpeedtestStats(wanName) {
  try {
    const raw = localStorage.getItem(`speed_res_${wanName}`);
    if (!raw) return;
    const data = JSON.parse(raw);
    const speedPingEl = document.getElementById(`speed-ping-val-${wanName}`);
    const speedValEl = document.getElementById(`speed-val-${wanName}`);
    if (speedPingEl && data.pingMs !== undefined) {
      speedPingEl.innerText = `${data.pingMs} ms`;
      speedPingEl.className = 'stat-val good';
    }
    if (speedValEl && data.dl !== undefined && data.ul !== undefined) {
      speedValEl.innerText = `${data.dl} ↓ / ${data.ul} ↑ Mbps`;
    }
  } catch(e) {}
}

// 6. Fetch Live Ping & Interface Health Stats
async function fetchPingStats() {
  if (!routerConfig || configuredWans.length === 0) return;

  try {
    const res = await fetch('/api/ping-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: routerConfig,
        wans: configuredWans,
        targetAddress: '8.8.8.8'
      })
    });

    const result = await res.json();
    if (!result.success) return;

    result.pingResults.forEach(item => {
      const pingVal = document.getElementById(`ping-val-${item.wanName}`);

      if (pingVal) {
        if (item.status === 'disabled') {
          pingVal.innerText = 'DISABLED';
        } else if (item.status === 'down') {
          pingVal.innerText = item.isLinkDown ? 'LINK DOWN' : 'OFFLINE';
        } else {
          pingVal.innerText = `${item.pingMs} ms`;
        }

        pingVal.className = `stat-val ${item.status}`;
      }
    });
  } catch (err) {
    console.error('Ping poll error:', err);
  }
}

// 7. Start Live Polling Interval (Every 5 Seconds)
function startLivePolling() {
  if (pingIntervalTimer) clearInterval(pingIntervalTimer);
  pingIntervalTimer = setInterval(() => {
    fetchPingStats();
  }, 5000);
}

// 8. Switch WAN Handler
async function switchWan(wanName) {
  if (!routerConfig) {
    showToast('Please connect to your MikroTik router first!', 'error');
    return;
  }

  try {
    const res = await fetch('/api/switch-wan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: routerConfig,
        targetWanName: wanName
      })
    });

    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    activeWanName = wanName;
    configuredWans.forEach(w => {
      w.speedtestEnabled = (w.name === wanName);
    });

    renderWanCards();
    fetchPingStats();

  } catch (err) {
    showToast(`Failed to switch WAN: ${err.message}`, 'error');
  }
}

// 9. Live Asia/Manila Time Header Clock & Master Reset
function updateHeaderClock() {
  const clockEl = document.getElementById('headerClockTime');
  if (!clockEl) return;
  const now = new Date();
  const options = {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  clockEl.innerText = new Intl.DateTimeFormat('en-US', options).format(now);
}
setInterval(updateHeaderClock, 1000);
updateHeaderClock();

if (masterResetBtn) {
  masterResetBtn.addEventListener('click', async () => {
    if (!routerConfig) return;

    try {
      const res = await fetch('/api/switch-wan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: routerConfig,
          targetWanName: null
        })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      activeWanName = null;
      showToast('All Speedtest rules disabled. Returned to Normal Load Balancing!', 'success');

      configuredWans.forEach(w => w.speedtestEnabled = false);
      renderWanCards();
    } catch (err) {
      showToast(`Reset failed: ${err.message}`, 'error');
    }
  });
}

// 10. Speedtest History Log & Fast.com Modal Controller
let speedtestHistory = JSON.parse(localStorage.getItem('speedtestHistory') || '[]');
let currentActiveTestEntryId = null;

const speedtestHistoryBody = document.getElementById('speedtestHistoryBody');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

function filterCleanHistory() {
  if (!Array.isArray(speedtestHistory)) {
    speedtestHistory = [];
    return;
  }
  speedtestHistory = speedtestHistory.filter(item => {
    if (!item || !item.download) return false;
    const dlStr = String(item.download).replace(/Mbps/gi, '').trim();
    if (!dlStr || dlStr === 'null' || dlStr === 'Testing...' || dlStr === 'undefined' || dlStr === '--') return false;
    const num = parseFloat(dlStr);
    return !isNaN(num) && num > 0;
  });
  localStorage.setItem('speedtestHistory', JSON.stringify(speedtestHistory));
}

function renderSpeedtestHistory() {
  filterCleanHistory();
  if (!speedtestHistoryBody) return;
  if (!speedtestHistory || speedtestHistory.length === 0) {
    speedtestHistoryBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6" style="text-align: center; color: var(--text-dim); padding: 30px 10px;">
          No speedtest history recorded yet. Click <strong>Test Speed</strong> on any WAN card above to log test runs.
        </td>
      </tr>`;
    return;
  }

  speedtestHistoryBody.innerHTML = speedtestHistory.map(item => `
    <tr>
      <td><span class="badge-wan">${escapeHtml(item.wanLabel || item.wanName)}</span></td>
      <td><strong style="color:#ffffff; font-size:0.92rem;">${escapeHtml(item.download)} Mbps</strong></td>
      <td><strong style="color:#e4e4e7; font-size:0.92rem;">${escapeHtml(item.upload || '0.00')} Mbps</strong></td>
      <td>
        <span style="color:#a1a1aa; font-family:var(--font-mono); font-size:0.82rem;">${escapeHtml(item.unloadedMs || '--')} ms / ${escapeHtml(item.loadedMs || '--')} ms</span>
      </td>
      <td><strong>${escapeHtml(item.publicIp || 'Active Routed Line')}</strong> <span style="color:var(--text-muted); font-size:0.8rem;">(${escapeHtml(item.isp || 'Egress WAN Gateway')})</span></td>
      <td class="time-cell">${escapeHtml(item.timestamp)}</td>
    </tr>
  `).join('');
}

function addCompletedSpeedtestRecord(wanName, wanLabel, download, upload, ping, jitter, publicIp, isp) {
  const now = new Date();
  const manilaTimeString = now.toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }) + ' (PHT)';

  const entry = {
    id: Date.now(),
    wanName,
    wanLabel: wanLabel || wanName,
    download: String(download),
    upload: String(upload),
    unloadedMs: String(ping),
    loadedMs: String(jitter),
    publicIp: publicIp || 'Active Routed Line',
    isp: isp || 'Egress WAN Gateway',
    timestamp: manilaTimeString
  };

  speedtestHistory.unshift(entry);
  if (speedtestHistory.length > 50) speedtestHistory.pop();

  localStorage.setItem('speedtestHistory', JSON.stringify(speedtestHistory));
  renderSpeedtestHistory();
}

if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener('click', () => {
    speedtestHistory = [];
    currentActiveTestEntryId = null;
    localStorage.removeItem('speedtestHistory');
    renderSpeedtestHistory();
    showToast('Speedtest history cleared', 'info');
  });
}

// Initial render
renderSpeedtestHistory();

async function closeSpeedtestModal() {
  if (gaugeAnimTimer) clearInterval(gaugeAnimTimer);
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  if (speedtestGaugeModal) speedtestGaugeModal.style.display = 'none';

  // Automatically disable mangle policy routing rule when modal is closed
  if (routerConfig && activeWanName) {
    try {
      await fetch('/api/switch-wan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: routerConfig,
          targetWanName: null
        })
      });
      activeWanName = null;
      configuredWans.forEach(w => { w.speedtestEnabled = false; });
      renderWanCards();
      fetchPingStats();
      showToast('Speedtest modal closed. Mangle rule disabled (Normal Load Balance)', 'info');
    } catch (err) {
      console.error('Error disabling mangle rule on modal close:', err);
    }
  }
}

if (closeGaugeModalBtn) closeGaugeModalBtn.addEventListener('click', closeSpeedtestModal);
if (stopGaugeTestBtn) stopGaugeTestBtn.addEventListener('click', closeSpeedtestModal);
if (speedtestGaugeModal) {
  speedtestGaugeModal.addEventListener('click', (e) => {
    if (e.target === speedtestGaugeModal) closeSpeedtestModal();
  });
}

// Helper: Render 5-dot rating indicators HTML
function renderDotsHtml(count) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="rating-dot ${i <= count ? 'active' : ''}"></span>`;
  }
  return html;
}

// Helper: Calculate dynamic 5-dot experience ratings based on Ookla thresholds
function updateExperienceRatings(dlMbps, ulMbps, pingMs) {
  const dl = parseFloat(dlMbps) || 0;
  const ul = parseFloat(ulMbps) || 0;
  const ping = parseFloat(pingMs) || 0;

  // Web Browsing (🖥️)
  let bScore = 0;
  if (dl >= 50) bScore = 5;
  else if (dl >= 25) bScore = 4;
  else if (dl >= 12) bScore = 3;
  else if (dl >= 5) bScore = 2;
  else if (dl > 0) bScore = 1;

  // Online Gaming (🎮)
  let gScore = 0;
  if (ping > 0) {
    if (ping <= 22) gScore = 5;
    else if (ping <= 40) gScore = 4;
    else if (ping <= 70) gScore = 3;
    else if (ping <= 120) gScore = 2;
    else gScore = 1;
  }

  // Video Streaming (🎬)
  let sScore = 0;
  if (dl >= 50) sScore = 5;
  else if (dl >= 25) sScore = 4;
  else if (dl >= 12) sScore = 3;
  else if (dl >= 5) sScore = 2;
  else if (dl > 0) sScore = 1;

  // Video & Voice Calls (👤)
  let cScore = 0;
  if (ul > 0 || ping > 0) {
    if (ul >= 15 && ping <= 20) cScore = 5;
    else if (ul >= 10 && ping <= 35) cScore = 4;
    else if (ul >= 5 && ping <= 60) cScore = 3;
    else if (ul >= 2 && ping <= 100) cScore = 2;
    else cScore = 1;
  }

  const scoreLabels = { 5: 'Excellent', 4: 'Very Good', 3: 'Good', 2: 'Fair', 1: 'Poor', 0: 'Awaiting Speedtest' };

  const dotsB = document.getElementById('dotsBrowsing');
  const dotsG = document.getElementById('dotsGaming');
  const dotsS = document.getElementById('dotsStreaming');
  const dotsC = document.getElementById('dotsCalls');

  const itemB = document.getElementById('ratingItemBrowsing');
  const itemG = document.getElementById('ratingItemGaming');
  const itemS = document.getElementById('ratingItemStreaming');
  const itemC = document.getElementById('ratingItemCalls');

  if (dotsB) dotsB.innerHTML = renderDotsHtml(bScore);
  if (dotsG) dotsG.innerHTML = renderDotsHtml(gScore);
  if (dotsS) dotsS.innerHTML = renderDotsHtml(sScore);
  if (dotsC) dotsC.innerHTML = renderDotsHtml(cScore);

  if (itemB) itemB.setAttribute('title', `Web Browsing: ${scoreLabels[bScore]}${bScore > 0 ? ` (${bScore}/5)` : ''}`);
  if (itemG) itemG.setAttribute('title', `Online Gaming: ${scoreLabels[gScore]}${gScore > 0 ? ` (${gScore}/5)` : ''}`);
  if (itemS) itemS.setAttribute('title', `Video Streaming: ${scoreLabels[sScore]}${sScore > 0 ? ` (${sScore}/5)` : ''}`);
  if (itemC) itemC.setAttribute('title', `Video & Voice Calls: ${scoreLabels[cScore]}${cScore > 0 ? ` (${cScore}/5)` : ''}`);
}

async function openSpeedtestGaugeModal(wanName) {
  const wanObj = configuredWans.find(w => w.name === wanName);
  if (!wanObj) return;

  if (gaugeAnimTimer) clearInterval(gaugeAnimTimer);
  if (gaugeRafId) {
    cancelAnimationFrame(gaugeRafId);
    gaugeRafId = null;
  }

  const goBtnContainer = document.getElementById('goBtnContainer');
  const gaugeWrapper = document.getElementById('gaugeWrapper');
  const resultPanelContainer = document.getElementById('resultPanelContainer');
  const cliPingDownVal = document.getElementById('cliPingDownVal');
  const cliPingUpVal = document.getElementById('cliPingUpVal');

  if (goBtnContainer) goBtnContainer.style.display = 'flex';
  if (gaugeWrapper) gaugeWrapper.style.display = 'none';
  if (resultPanelContainer) resultPanelContainer.style.display = 'none';

  if (cliDlVal) cliDlVal.innerText = '--';
  if (cliUlVal) cliUlVal.innerText = '--';
  if (cliPingVal) cliPingVal.innerText = '--';
  if (cliPingDownVal) cliPingDownVal.innerText = '--';
  if (cliPingUpVal) cliPingUpVal.innerText = '--';

  // Reset ratings dots to default 0 active (dim pending state)
  updateExperienceRatings(0, 0, 0);

  gaugeIspBadge.innerText = wanObj.label || wanObj.name;
  gaugeIpText.innerText = 'Detecting Public IP...';
  
  // Auto-Detect nearest Ookla Speedtest Server immediately on modal open
  if (cliServerText) cliServerText.innerText = 'Detecting nearest Ookla server...';
  fetch('/api/detect-speedtest-server')
    .then(r => r.json())
    .then(data => {
      if (data.success && data.server) {
        const loc = data.server.location ? ` (${data.server.location})` : '';
        if (cliServerText) cliServerText.innerText = `${data.server.name}${loc}`;
      }
    })
    .catch(() => {
      if (cliServerText) cliServerText.innerText = 'Globe Telecom (Bacolod)';
    });

  speedtestGaugeModal.style.display = 'flex';

  // 1. Enable Policy Routing Mark for this WAN on MikroTik
  await switchWan(wanName);

  // 2. Fetch Egress Public IP details for Modal header
  try {
    const res = await fetch('/api/public-ip');
    const data = await res.json();
    if (data.success) {
      gaugeIspBadge.innerText = data.isp || wanObj.label || wanObj.name;
      gaugeIpText.innerText = data.ip;
    }
  } catch (e) {
    gaugeIspBadge.innerText = wanObj.label || wanObj.name;
    gaugeIpText.innerText = `GW: ${wanObj.gateway || 'Active Routed Line'}`;
  }
}

// 11. Black & White Background Theme Toggle Handler
const bwToggleBtn = document.getElementById('bwToggleBtn');
const bwToggleText = document.getElementById('bwToggleText');
const bwToggleIcon = document.getElementById('bwToggleIcon');

const themeSunSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const themeMoonSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function setBwMode(enabled) {
  if (enabled) {
    document.body.classList.add('bw-mode');
    if (bwToggleText) bwToggleText.innerText = 'Black Mode';
    if (bwToggleIcon) bwToggleIcon.innerHTML = themeMoonSvg;
    if (bwToggleBtn) bwToggleBtn.setAttribute('title', 'Switch to Black Background Mode');
    localStorage.setItem('bwMode', 'enabled');
  } else {
    document.body.classList.remove('bw-mode');
    if (bwToggleText) bwToggleText.innerText = 'White Mode';
    if (bwToggleIcon) bwToggleIcon.innerHTML = themeSunSvg;
    if (bwToggleBtn) bwToggleBtn.setAttribute('title', 'Switch to White Background Mode');
    localStorage.setItem('bwMode', 'disabled');
  }
}

if (bwToggleBtn) {
  bwToggleBtn.addEventListener('click', () => {
    const isBw = document.body.classList.contains('bw-mode');
    setBwMode(!isBw);
  });
}

// Restore saved preference on page load
if (localStorage.getItem('bwMode') === 'enabled') {
  setBwMode(true);
}

// 12. Proxmox Server-Side Ookla Speedtest CLI Runner Handler (Real-Time Live Streaming)
function triggerSpeedtest() {
  if (!activeWanName) return;

  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }

  const goBtnContainer = document.getElementById('goBtnContainer');
  const gaugeWrapper = document.getElementById('gaugeWrapper');
  const resultPanelContainer = document.getElementById('resultPanelContainer');
  const cliPingDownVal = document.getElementById('cliPingDownVal');
  const cliPingUpVal = document.getElementById('cliPingUpVal');
  const surveyFeedbackMsg = document.getElementById('surveyFeedbackMsg');

  if (surveyFeedbackMsg) surveyFeedbackMsg.style.display = 'none';

  // Reset active state on survey buttons
  document.querySelectorAll('.survey-btn').forEach(btn => btn.classList.remove('active'));

  // Switch to State 2: Show Gauge, Hide GO & Result panel
  if (goBtnContainer) goBtnContainer.style.display = 'none';
  if (resultPanelContainer) resultPanelContainer.style.display = 'none';
  if (gaugeWrapper) gaugeWrapper.style.display = 'flex';

  if (runServerCliBtn) runServerCliBtn.disabled = true;

  if (cliStatusText) cliStatusText.innerText = '● Connecting to Proxmox Ookla CLI...';
  if (cliDlVal) cliDlVal.innerText = '--';
  if (cliUlVal) cliUlVal.innerText = '--';
  if (cliPingVal) cliPingVal.innerText = '--';
  if (cliPingDownVal) cliPingDownVal.innerText = '--';
  if (cliPingUpVal) cliPingUpVal.innerText = '--';

  updateGaugeSpeed(0, 'download');

  let isStreamActive = false;
  let isFinished = false;
  let hasLockedDownload = false;
  let hasStartedUploadPhase = false;
  let isUploadTransitioning = false;

  if (gaugeAnimTimer) {
    clearInterval(gaugeAnimTimer);
    gaugeAnimTimer = null;
  }

  let finalResult = { download: 0, upload: 0, ping: 0, jitter: 0, publicIp: 'Active Routed Line', isp: activeWanName };

  try {
    const evtSource = new EventSource(`/api/run-server-speedtest-stream?wanName=${encodeURIComponent(activeWanName)}`);
    currentEventSource = evtSource;

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'testStart' && data.server) {
          const sName = data.server.name || 'Ookla Server';
          const sLoc = data.server.location ? ` (${data.server.location})` : '';
          if (cliServerText) cliServerText.innerText = `${sName}${sLoc}`;
        }
        else if (data.type === 'ping' && data.ping) {
          const p = Math.round(data.ping.latency || 0);
          const j = Math.round(data.ping.jitter || 0);
          finalResult.ping = p;
          finalResult.jitter = j;
          if (cliPingVal) cliPingVal.innerText = `${p}`;
          if (cliStatusText) cliStatusText.innerText = '● Testing Ping & Latency...';
          updateExperienceRatings(0, 0, p);
        } 
        else if (data.type === 'download' && data.download) {
          if (!isStreamActive) {
            isStreamActive = true;
            if (gaugeAnimTimer) clearInterval(gaugeAnimTimer);
          }
          const bw = data.download.bandwidth || 0;
          const dlMbps = (bw * 8) / 1000000;
          finalResult.download = dlMbps;
          animateGaugeTo(dlMbps, 'download');
          if (data.download.latency && data.download.latency.iqm !== undefined) {
            const dlPing = Math.round(data.download.latency.iqm);
            if (cliPingDownVal) cliPingDownVal.innerText = `${dlPing}`;
          }
          if (cliStatusText) cliStatusText.innerText = '● Testing Live Download Speed...';
          updateExperienceRatings(dlMbps, 0, finalResult.ping);
        }
        else if (data.type === 'upload' && data.upload) {
          if (!isStreamActive) {
            isStreamActive = true;
            if (gaugeAnimTimer) clearInterval(gaugeAnimTimer);
          }

          // Reset gauge to 0.00 and Upload gradient theme on transition to Upload phase!
          if (!hasStartedUploadPhase) {
            hasStartedUploadPhase = true;
            hasLockedDownload = true;
            if (cliDlVal) cliDlVal.innerText = `${finalResult.download.toFixed(2)}`;
            
            // Drop needle to 0.00 & switch theme to Upload Magenta
            updateGaugeSpeed(0, 'upload');
            
            // Hold 0.00 Mbps state for 400ms so user visually sees needle reset to 0!
            isUploadTransitioning = true;
            setTimeout(() => {
              isUploadTransitioning = false;
            }, 400);
          }

          const bw = data.upload.bandwidth || 0;
          const ulMbps = (bw * 8) / 1000000;
          finalResult.upload = ulMbps;

          if (!isUploadTransitioning) {
            animateGaugeTo(ulMbps, 'upload');
          }

          if (data.upload.latency && data.upload.latency.iqm !== undefined) {
            const ulPing = Math.round(data.upload.latency.iqm);
            if (cliPingUpVal) cliPingUpVal.innerText = `${ulPing}`;
          }
          if (cliStatusText) cliStatusText.innerText = '● Testing Live Upload Speed...';
          updateExperienceRatings(finalResult.download, ulMbps, finalResult.ping);
        }
        else if (data.type === 'result') {
          if (data.download && data.download.bandwidth) {
            finalResult.download = (data.download.bandwidth * 8) / 1000000;
          }
          if (data.upload && data.upload.bandwidth) {
            finalResult.upload = (data.upload.bandwidth * 8) / 1000000;
          }
          if (data.download && data.download.latency && data.download.latency.iqm !== undefined) {
            if (cliPingDownVal) cliPingDownVal.innerText = `${Math.round(data.download.latency.iqm)}`;
          }
          if (data.upload && data.upload.latency && data.upload.latency.iqm !== undefined) {
            if (cliPingUpVal) cliPingUpVal.innerText = `${Math.round(data.upload.latency.iqm)}`;
          }
          if (data.ping && data.ping.latency) {
            finalResult.ping = Math.round(data.ping.latency);
            finalResult.jitter = Math.round(data.ping.jitter || 0);
          }
          if (data.interface && data.interface.externalIp) {
            finalResult.publicIp = data.interface.externalIp;
            if (gaugeIpText) gaugeIpText.innerText = data.interface.externalIp;
          }
          if (data.isp) {
            finalResult.isp = data.isp;
            if (gaugeIspBadge) gaugeIspBadge.innerText = data.isp;
          }
          if (data.server && data.server.name) {
            const loc = data.server.location ? ` (${data.server.location})` : '';
            if (cliServerText) cliServerText.innerText = `${data.server.name}${loc}`;
          }
        }
      } catch(e) {}
    };

    evtSource.addEventListener('done', () => {
      isFinished = true;
      if (gaugeAnimTimer) clearInterval(gaugeAnimTimer);
      if (gaugeRafId) {
        cancelAnimationFrame(gaugeRafId);
        gaugeRafId = null;
      }
      evtSource.close();
      currentEventSource = null;
      if (runServerCliBtn) runServerCliBtn.disabled = false;

      const dlStr = finalResult.download.toFixed(2);
      const ulStr = finalResult.upload.toFixed(2);

      // Lock in final top summary metrics!
      if (cliDlVal) cliDlVal.innerText = `${dlStr}`;
      if (cliUlVal) cliUlVal.innerText = `${ulStr}`;
      if (cliPingVal) cliPingVal.innerText = `${finalResult.ping}`;

      // Switch to State 3: Show Finished Result Panel (GO button on left + Survey on right)
      if (gaugeWrapper) gaugeWrapper.style.display = 'none';
      if (goBtnContainer) goBtnContainer.style.display = 'none';
      if (resultPanelContainer) resultPanelContainer.style.display = 'flex';

      const wanObj = configuredWans.find(w => w.name === activeWanName);
      const label = wanObj ? (wanObj.label || wanObj.name) : activeWanName;

      const surveyIspName = document.getElementById('surveyIspName');
      if (surveyIspName) surveyIspName.innerText = (finalResult.isp || label).toUpperCase();

      // Update dynamic 5-dot experience ratings based on test results
      updateExperienceRatings(finalResult.download, finalResult.upload, finalResult.ping);

      // Automatically log completed result to Speedtest History & update WAN card display
      addCompletedSpeedtestRecord(activeWanName, label, dlStr, ulStr, finalResult.ping, finalResult.jitter, finalResult.publicIp, finalResult.isp);
      saveAndApplyWanSpeedtestResult(activeWanName, finalResult.ping, dlStr, ulStr);

      showToast('Proxmox Server Speedtest Completed & Recorded!', 'success');
    });

    evtSource.onerror = (err) => {
      if (isFinished) return; // Prevent resetting view if completed
      if (gaugeAnimTimer) clearInterval(gaugeAnimTimer);
      evtSource.close();
      currentEventSource = null;
      if (runServerCliBtn) runServerCliBtn.disabled = false;
      if (gaugeWrapper) gaugeWrapper.style.display = 'none';
      if (goBtnContainer) goBtnContainer.style.display = 'flex';
    };

  } catch (err) {
    if (gaugeAnimTimer) clearInterval(gaugeAnimTimer);
    if (runServerCliBtn) runServerCliBtn.disabled = false;
    if (gaugeWrapper) gaugeWrapper.style.display = 'none';
    if (goBtnContainer) goBtnContainer.style.display = 'flex';
    showToast(`Server speedtest error: ${err.message}`, 'error');
  }
}

if (runServerCliBtn) runServerCliBtn.addEventListener('click', triggerSpeedtest);

const runServerCliBtnFinished = document.getElementById('runServerCliBtnFinished');
if (runServerCliBtnFinished) runServerCliBtnFinished.addEventListener('click', triggerSpeedtest);

// Handle Survey Button Clicks
document.addEventListener('click', (e) => {
  if (e.target && e.target.classList.contains('survey-btn')) {
    document.querySelectorAll('.survey-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    const msg = document.getElementById('surveyFeedbackMsg');
    if (msg) msg.style.display = 'block';
  }
});

// 13. System Update Engine Handler (GitHub Auto-Deployer)
const systemUpdateBtn = document.getElementById('systemUpdateBtn');
const systemUpdateModal = document.getElementById('systemUpdateModal');
const closeUpdateModalBtn = document.getElementById('closeUpdateModalBtn');
const cancelUpdateModalBtn = document.getElementById('cancelUpdateModalBtn');
const applyUpdateBtn = document.getElementById('applyUpdateBtn');

const currentVersionBadge = document.getElementById('currentVersionBadge');
const updateStatusZone = document.getElementById('updateStatusZone');
const updateBadgeDot = document.getElementById('updateBadgeDot');
const updateBtnText = document.getElementById('updateBtnText');

function closeSystemUpdateModal() {
  if (systemUpdateModal) systemUpdateModal.style.display = 'none';
}

if (closeUpdateModalBtn) closeUpdateModalBtn.addEventListener('click', closeSystemUpdateModal);
if (cancelUpdateModalBtn) cancelUpdateModalBtn.addEventListener('click', closeSystemUpdateModal);

// Fetch Current Version Info on load
async function fetchVersionInfo() {
  try {
    const res = await fetch('/api/system/version-info');
    const data = await res.json();
    if (data.success && currentVersionBadge) {
      currentVersionBadge.innerText = `${data.branch}@${data.commit}`;
    }
  } catch (e) {}
}

// Check for updates against GitHub repository
async function checkForUpdates(showModal = false) {
  if (showModal && systemUpdateModal) {
    systemUpdateModal.style.display = 'flex';
  }

  if (updateStatusZone) {
    updateStatusZone.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #94a3b8;">
        <div style="margin-bottom: 12px; display: flex; justify-content: center;">
          <svg style="width: 24px; height: 24px; animation: spin 1s linear infinite; stroke: #00f2fe;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
        <span>Checking GitHub repository for updates...</span>
      </div>
    `;
  }

  if (applyUpdateBtn) applyUpdateBtn.disabled = true;

  try {
    const res = await fetch('/api/system/check-update');
    const data = await res.json();

    if (!data.success) {
      if (updateStatusZone) {
        updateStatusZone.innerHTML = `
          <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 12px; color: #ef4444; font-size: 0.85rem;">
            Could not check GitHub: ${escapeHtml(data.error || 'Network error')}
          </div>
        `;
      }
      return;
    }

    if (data.hasUpdate) {
      // Highlight Header Button with pulsing badge
      if (updateBadgeDot) updateBadgeDot.style.display = 'block';
      if (updateBtnText) updateBtnText.innerText = `Update Available (${data.behindCount})`;
      if (systemUpdateBtn) systemUpdateBtn.classList.add('has-update');

      if (!showModal) {
        showToast(`${data.behindCount} new update(s) available on GitHub! Click "Check Update" to apply.`, 'info');
      }

      if (updateStatusZone) {
        const commitListHtml = (data.unpulledCommits || []).map(c => `
          <div style="border-bottom: 1px solid #1e293b; padding: 8px 0;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <strong style="color: #60a5fa; font-family: var(--font-mono); font-size: 0.82rem;">${escapeHtml(c.hash)}</strong>
              <span style="font-size: 0.72rem; color: #64748b;">${escapeHtml(c.date)}</span>
            </div>
            <div style="font-size: 0.84rem; color: #f1f5f9; margin-top: 2px;">${escapeHtml(c.message)}</div>
          </div>
        `).join('');

        updateStatusZone.innerHTML = `
          <div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); border-radius: 8px; padding: 12px; margin-bottom: 12px; color: #10b981; font-weight: 700; font-size: 0.88rem; display: flex; align-items: center; gap: 8px;">
            <svg style="width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2;" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            ${data.behindCount} New Commit Update(s) Ready to Install!
          </div>
          <div style="max-height: 180px; overflow-y: auto; padding-right: 6px;">
            ${commitListHtml}
          </div>
        `;
      }

      if (applyUpdateBtn) applyUpdateBtn.disabled = false;
    } else {
      if (updateBadgeDot) updateBadgeDot.style.display = 'none';
      if (updateBtnText) updateBtnText.innerText = 'Check Update';
      if (systemUpdateBtn) systemUpdateBtn.classList.remove('has-update');

      if (updateStatusZone) {
        updateStatusZone.innerHTML = `
          <div style="text-align: center; padding: 20px; color: #10b981;">
            <div style="width: 42px; height: 42px; background: rgba(16,185,129,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; color: #10b981;">
              <svg style="width: 22px; height: 22px; stroke: currentColor; stroke-width: 2.5; fill: none;" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
            </div>
            <strong style="font-size: 0.95rem; color: #ffffff;">System is up to date!</strong>
            <p style="font-size: 0.8rem; color: #94a3b8; margin-top: 4px;">You are running the latest GitHub commit release.</p>
          </div>
        `;
      }
    }
  } catch (err) {
    if (updateStatusZone) {
      updateStatusZone.innerHTML = `
        <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 12px; color: #ef4444; font-size: 0.85rem;">
          Error connecting to server update API: ${escapeHtml(err.message)}
        </div>
      `;
    }
  }
}

if (systemUpdateBtn) {
  systemUpdateBtn.addEventListener('click', () => {
    checkForUpdates(true);
  });
}

if (applyUpdateBtn) {
  applyUpdateBtn.addEventListener('click', async () => {
    applyUpdateBtn.disabled = true;
    applyUpdateBtn.innerHTML = `Updating from GitHub...`;

    if (updateStatusZone) {
      updateStatusZone.innerHTML = `
        <div style="text-align: center; padding: 24px; color: #00f2fe;">
          <div style="margin-bottom: 12px; display: flex; justify-content: center;">
            <svg style="width: 28px; height: 28px; animation: spin 1s linear infinite; stroke: #00f2fe;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <strong style="font-size: 0.95rem; color: #ffffff;">Applying GitHub Update (git pull & PM2 restart)...</strong>
          <p style="font-size: 0.8rem; color: #94a3b8; margin-top: 6px;">Dashboard will automatically refresh in 4 seconds.</p>
        </div>
      `;
    }

    try {
      const res = await fetch('/api/system/apply-update', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Update applied successfully! Reloading dashboard...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 3500);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      applyUpdateBtn.disabled = false;
      applyUpdateBtn.innerText = 'Apply Update Now';
      showToast(`Update failed: ${err.message}`, 'error');
    }
  });
}

// Initial fetch version info & silent update check on load
fetchVersionInfo();
setTimeout(() => {
  checkForUpdates(false);
}, 2000);

