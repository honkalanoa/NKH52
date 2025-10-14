import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Elements
const loginDiv = document.getElementById("login");
const dashDiv = document.getElementById("dashboard");
const publicDiv = document.getElementById("public-view");
const marketsDiv = document.getElementById("markets-page");
const stockSearchDiv = document.getElementById("stock-search-page");
const commissionsDiv = document.getElementById("commissions-page");
const balanceP = document.getElementById("balance");
const transactionsList = document.getElementById("transactions");
const chartCanvas = document.getElementById("fundChart");
const publicChartCanvas = document.getElementById("publicChart");
const perfDiv = document.getElementById("perf");
const publicPerfDiv = document.getElementById("public-perf");
const publicBalance = document.getElementById("public-balance");
const monthlyGoalInput = document.getElementById("monthly-goal-input");
const saveMonthlyGoalBtn = document.getElementById("save-monthly-goal-btn");
const monthlyGoalDisplay = document.getElementById("monthly-goal-display");
const assetsPageDiv = document.getElementById("assets-page");
const assetsTbody = document.getElementById("assets-tbody");
const assetKeyInput = document.getElementById("asset-key");
const assetValueInput = document.getElementById("asset-value");

// Commissions Elements
const commissionsTbody = document.getElementById("commissions-tbody");
const commissionDateInput = document.getElementById("commission-date");
const commissionAmountInput = document.getElementById("commission-amount");
const commissionNoteInput = document.getElementById("commission-note");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const bulkPercentInput = document.getElementById("bulk-percent");

// New AUM Elements
const aumTotal = document.getElementById("aum-total");
const aumChartCanvas = document.getElementById("aumChart");
let aumChart = null;

let fundChart = null;
let publicChart = null;

// ---------- SECURITY UTILITIES ----------
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>\"'&]/g, function(match) {
    switch(match) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#x27;';
      case '&': return '&amp;';
      default: return match;
    }
  });
}

// ---------- COMMISSIONS HELPERS ----------
function ensureCommissionDateMaxToday() {
  if (commissionDateInput) {
    const today = new Date().toISOString().split('T')[0];
    commissionDateInput.max = today;
    if (!commissionDateInput.value) commissionDateInput.value = today;
  }
}

function validateCommissionAmount(amount) {
  const num = parseFloat(amount);
  return !isNaN(num) && Math.abs(num) <= 1000000000;
}

// ---------- PERFORMANCE (TIME-WEIGHTED) ----------
function toJsDateFromFs(ts) {
  // handle Firestore Timestamp with seconds
  if (!ts) return null;
  if (ts.seconds) return new Date(ts.seconds * 1000);
  const d = new Date(ts);
  return isNaN(d) ? null : d;
}

function sumProfitBetween(txs, startDate, endDateInclusive) {
  const startMs = startDate ? startDate.getTime() : -Infinity;
  const endMs = endDateInclusive ? endDateInclusive.getTime() : Infinity;
  return txs.reduce((sum, t) => {
    const d = new Date(t.date);
    const ms = d.getTime();
    if (isNaN(ms)) return sum;
    if (ms > endMs || ms <= startMs) return sum;
    const amt = parseFloat(t.amount || 0) || 0;
    return sum + (t.type === 'sell' ? -amt : amt);
  }, 0);
}

function computeTWRSeries(aumHistory, txs) {
  // aumHistory: [{amount, date(Timestamp)}] sorted asc by date
  // txs: [{type, amount, date(string yyyy-mm-dd)}]
  if (!Array.isArray(aumHistory) || aumHistory.length === 0) return { labels: [], values: [] };
  const points = [];
  let cumulative = 1; // factor
  for (let i = 1; i < aumHistory.length; i++) {
    const prev = aumHistory[i - 1];
    const curr = aumHistory[i];
    const startAmt = Number(prev.amount) || 0;
    const endAmt = Number(curr.amount) || 0;
    const startDate = toJsDateFromFs(prev.date);
    const endDate = toJsDateFromFs(curr.date);
    if (!startDate || !endDate || startAmt <= 0) {
      points.push({ date: endDate || new Date(), value: (cumulative - 1) * 100 });
      continue;
    }
    const profit = sumProfitBetween(txs, startDate, endDate);
    const r = profit / startAmt; // neutralize flows
    cumulative *= (1 + r);
    points.push({ date: endDate, value: (cumulative - 1) * 100 });
  }
  const labels = points.map(p => p.date.toLocaleDateString());
  const values = points.map(p => p.value);
  return { labels, values };
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateAmount(amount) {
  const num = parseFloat(amount);
  return !isNaN(num) && num > 0 && num <= 1000000000; // Max 1 billion
}

function validateDate(dateString) {
  const date = new Date(dateString);
  const today = new Date();
  const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  return date instanceof Date && !isNaN(date) && date >= oneYearAgo && date <= today;
}

// Rate limiting
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(identifier) {
  const now = Date.now();
  const attempts = loginAttempts.get(identifier) || [];
  
  // Remove old attempts
  const recentAttempts = attempts.filter(time => now - time < LOCKOUT_TIME);
  
  if (recentAttempts.length >= MAX_LOGIN_ATTEMPTS) {
    return false; // Rate limited
  }
  
  recentAttempts.push(now);
  loginAttempts.set(identifier, recentAttempts);
  return true;
}

// ---------- LOGIN ----------
document.getElementById("loginBtn").addEventListener("click", async () => {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.getElementById("loginBtn");
  
  const email = sanitizeInput(emailInput.value.trim());
  const password = passwordInput.value;
  
  // Input validation
  if (!email || !password) {
    showSecureError("Please enter both email and password.");
    return;
  }
  
  if (!validateEmail(email)) {
    showSecureError("Please enter a valid email address.");
    return;
  }
  
  if (password.length < 6) {
    showSecureError("Password must be at least 6 characters long.");
    return;
  }
  
  // Rate limiting check
  if (!checkRateLimit(email)) {
    showSecureError("Too many login attempts. Please try again in 15 minutes.");
    return;
  }
  
  // Disable button during login
  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in...";
  
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // Clear rate limiting on successful login
    loginAttempts.delete(email);
  } catch (err) {
    // Generic error messages for security
    let errorMessage = "Login failed. Please check your credentials.";
    
    // Only show specific errors for common, non-sensitive issues
    if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
      errorMessage = "Invalid email or password.";
    } else if (err.code === 'auth/invalid-email') {
      errorMessage = "Invalid email format.";
    } else if (err.code === 'auth/user-disabled') {
      errorMessage = "Account has been disabled.";
    } else if (err.code === 'auth/too-many-requests') {
      errorMessage = "Too many failed attempts. Please try again later.";
    }
    
    showSecureError(errorMessage);
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
  }
});

function showSecureError(message) {
  // Create a secure error display instead of using alert()
  const errorDiv = document.getElementById('error-message') || createErrorDiv();
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 5000);
}

function createErrorDiv() {
  const errorDiv = document.createElement('div');
  errorDiv.id = 'error-message';
  errorDiv.style.cssText = `
    background: #ef4444;
    color: white;
    padding: 12px;
    border-radius: 6px;
    margin: 10px 0;
    display: none;
    font-weight: bold;
  `;
  document.getElementById('login').appendChild(errorDiv);
  return errorDiv;
}
document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

// ---------- GOALS (MONTHLY) ----------
async function loadMonthlyGoal() {
  if (!monthlyGoalDisplay) return;
  try {
    const goalsSnap = await getDocs(collection(db, 'Goals'));
    // Use a single document named 'current' if exists, else first doc
    let currentDoc = null;
    goalsSnap.forEach(d => { if (d.id === 'current') currentDoc = d; });
    const docToUse = currentDoc || (goalsSnap.docs.length ? goalsSnap.docs[0] : null);
    if (docToUse) {
      const data = docToUse.data();
      const val = data && data["for this month"] ? String(data["for this month"]) : '';
      monthlyGoalDisplay.textContent = val ? `This month: ${val}` : 'No monthly goal set yet.';
      if (monthlyGoalInput) monthlyGoalInput.value = val;
    } else {
      monthlyGoalDisplay.textContent = 'No monthly goal set yet.';
    }
  } catch (e) {
    console.error('Failed to load monthly goal', e);
  }
}

async function saveMonthlyGoal() {
  if (!monthlyGoalInput) return;
  const raw = monthlyGoalInput.value;
  const value = sanitizeInput(String(raw).trim());
  if (!value) { showSecureError('Enter a goal for the month.'); return; }
  try {
    // Store in a stable doc id 'current'
    const currentRef = doc(db, 'Goals', 'current');
    await setDoc(currentRef, { "for this month": value, updatedAt: serverTimestamp() }, { merge: true });
    if (monthlyGoalDisplay) monthlyGoalDisplay.textContent = `This month: ${value}`;
  } catch (e) {
    showSecureError('Failed to save monthly goal.');
    console.error('Save goal error', e);
  }
}

if (saveMonthlyGoalBtn) {
  saveMonthlyGoalBtn.addEventListener('click', saveMonthlyGoal);
}

// ---------- ASSETS OWNED (CRUD) ----------
function renderAssetsRows(dataObj) {
  const entries = Object.entries(dataObj || {});
  if (!assetsTbody) return;
  assetsTbody.innerHTML = entries.map(([key, value]) => `
    <tr data-key="${key}">
      <td style="padding:8px; border-bottom:1px solid var(--border);"><input type="text" class="as-key" value="${sanitizeInput(key)}" style="width:100%; padding:6px; background:#0d1a2b; border:1px solid var(--border); border-radius:6px; color: var(--text);"></td>
      <td style="padding:8px; border-bottom:1px solid var(--border);"><input type="text" class="as-value" value="${sanitizeInput(String(value ?? ''))}" style="width:100%; padding:6px; background:#0d1a2b; border:1px solid var(--border); border-radius:6px; color: var(--text);"></td>
      <td style="padding:8px; border-bottom:1px solid var(--border); text-align:right;">
        <button class="as-save" style="margin-right:6px;">Save</button>
        <button class="as-delete" style="background:#ef4444;">Delete</button>
      </td>
    </tr>
  `).join("");

  // Bind events
  assetsTbody.querySelectorAll('button.as-save').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const oldKey = tr.getAttribute('data-key');
      const newKey = tr.querySelector('.as-key').value.trim();
      const newVal = tr.querySelector('.as-value').value.trim();
      await saveAssetEntry(oldKey, newKey, newVal);
    });
  });
  assetsTbody.querySelectorAll('button.as-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const key = tr.getAttribute('data-key');
      await deleteAssetEntry(key);
    });
  });
}

async function loadAssetsOwned() {
  try {
    const ref = doc(db, 'Assets', 'AssetsOwned');
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    renderAssetsRows(data);
  } catch (e) {
    showSecureError('Failed to load assets.');
  }
}

async function saveAssetEntry(oldKey, newKey, newValue) {
  const key = sanitizeInput(newKey);
  const value = sanitizeInput(newValue);
  if (!key) { showSecureError('Category cannot be empty.'); return; }
  try {
    const ref = doc(db, 'Assets', 'AssetsOwned');
    const payload = { [key]: value, updatedAt: serverTimestamp() };
    // If key changed, remove old key then set new
    if (oldKey && oldKey !== key) {
      const { deleteField } = await import('https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js');
      await updateDoc(ref, { [oldKey]: deleteField() });
    }
    await setDoc(ref, payload, { merge: true });
    await loadAssetsOwned();
  } catch (e) {
    showSecureError('Failed to save asset entry.');
  }
}

async function deleteAssetEntry(key) {
  if (!key) return;
  try {
    const ref = doc(db, 'Assets', 'AssetsOwned');
    const { deleteField } = await import('https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js');
    await updateDoc(ref, { [key]: deleteField(), updatedAt: serverTimestamp() });
    await loadAssetsOwned();
  } catch (e) {
    showSecureError('Failed to delete asset entry.');
  }
}

document.getElementById('addAssetBtn').addEventListener('click', async () => {
  const key = assetKeyInput.value.trim();
  const val = assetValueInput.value.trim();
  await saveAssetEntry('', key, val);
  assetValueInput.value = '';
});

// ---------- MARKETS NAVIGATION ----------
let tradingViewWidgets = {};
let cryptoWidgets = {};
let stockWidget = null;
let recentSearches = [];

document.getElementById("marketsBtn").addEventListener("click", () => {
  dashDiv.style.display = "none";
  stockSearchDiv.style.display = "none";
  commissionsDiv.style.display = "none";
  if (assetsPageDiv) assetsPageDiv.style.display = "none";
  marketsDiv.style.display = "block";
  initializeTradingViewWidgets();
  updateMarketHours();
});

document.getElementById("backToDashboardBtn").addEventListener("click", () => {
  marketsDiv.style.display = "none";
  stockSearchDiv.style.display = "none";
  commissionsDiv.style.display = "none";
  if (assetsPageDiv) assetsPageDiv.style.display = "none";
  dashDiv.style.display = "block";
  // Clean up TradingView widgets when leaving
  cleanupTradingViewWidgets();
  cleanupCryptoWidgets();
  cleanupStockWidget();
});

// Stock Search Navigation
document.getElementById("stockSearchBtn").addEventListener("click", () => {
  marketsDiv.style.display = "none";
  commissionsDiv.style.display = "none";
  stockSearchDiv.style.display = "block";
  cleanupTradingViewWidgets();
  cleanupCryptoWidgets();
  loadRecentSearches();
});

document.getElementById("backToMarketsBtn").addEventListener("click", () => {
  stockSearchDiv.style.display = "none";
  commissionsDiv.style.display = "none";
  marketsDiv.style.display = "block";
  cleanupStockWidget();
  initializeTradingViewWidgets();
  updateMarketHours();
});

// ---------- COMMISSIONS NAVIGATION ----------
document.getElementById("commissionsBtn").addEventListener("click", () => {
  dashDiv.style.display = "none";
  marketsDiv.style.display = "none";
  stockSearchDiv.style.display = "none";
  if (assetsPageDiv) assetsPageDiv.style.display = "none";
  commissionsDiv.style.display = "block";
  ensureCommissionDateMaxToday();
  loadCommissions();
});

document.getElementById("backToDashboardFromCommissions").addEventListener("click", () => {
  commissionsDiv.style.display = "none";
  dashDiv.style.display = "block";
});

// ---------- ASSETS NAVIGATION ----------
document.getElementById("assetsBtn").addEventListener("click", () => {
  dashDiv.style.display = "none";
  marketsDiv.style.display = "none";
  stockSearchDiv.style.display = "none";
  commissionsDiv.style.display = "none";
  if (assetsPageDiv) {
    assetsPageDiv.style.display = "block";
    loadAssetsOwned();
  }
});

document.getElementById("backToDashboardFromAssets").addEventListener("click", () => {
  if (assetsPageDiv) assetsPageDiv.style.display = "none";
  dashDiv.style.display = "block";
});

// ---------- CRYPTO DATA TOGGLE ----------
document.getElementById("cryptoDataBtn").addEventListener("click", () => {
  const cryptoSection = document.getElementById("crypto-data-section");
  const cryptoBtn = document.getElementById("cryptoDataBtn");
  
  if (cryptoSection.style.display === "none") {
    cryptoSection.style.display = "block";
    cryptoBtn.textContent = "Hide Shitcoin Data";
    cryptoBtn.style.background = "#dc2626";
    initializeCryptoWidgets();
  } else {
    cryptoSection.style.display = "none";
    cryptoBtn.textContent = "Shitcoin data for nerds";
    cryptoBtn.style.background = "#ff6b35";
    cleanupCryptoWidgets();
  }
});

function initializeTradingViewWidgets() {
  // Initialize all TradingView widgets
  const widgets = [
    { id: 'nasdaq100-widget', symbol: 'NDX' },
    { id: 'sse-widget', symbol: '000001' },
    { id: 'hangseng-widget', symbol: 'HSI' },
    { id: 'dax-widget', symbol: 'GDAXI' },
    { id: 'eurostoxx-widget', symbol: 'STOXX50' },
    { id: 'ftse100-widget', symbol: 'FTSE' }
  ];

  widgets.forEach(widget => {
    createTradingViewWidget(widget.id, widget.symbol);
  });
}

function createTradingViewWidget(containerId, symbol) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Clean up existing widget if it exists
  if (tradingViewWidgets[containerId]) {
    tradingViewWidgets[containerId].remove();
  }

  // Create new TradingView widget
  tradingViewWidgets[containerId] = new TradingView.widget({
    "autosize": true,
    "symbol": symbol,
    "interval": "D",
    "timezone": "Etc/UTC",
    "theme": "dark",
    "style": "1",
    "locale": "en",
    "toolbar_bg": "#0d1a2b",
    "enable_publishing": false,
    "hide_top_toolbar": true,
    "hide_legend": false,
    "save_image": false,
    "container_id": containerId,
    "studies": [
      "RSI@tv-basicstudies"
    ],
    "show_popup_button": true,
    "popup_width": "1000",
    "popup_height": "650",
    "no_referral_id": true,
    "referral_id": "NKH52"
  });
}

function cleanupTradingViewWidgets() {
  Object.values(tradingViewWidgets).forEach(widget => {
    if (widget && widget.remove) {
      widget.remove();
    }
  });
  tradingViewWidgets = {};
}

function initializeCryptoWidgets() {
  // Initialize all cryptocurrency TradingView widgets
  const cryptoWidgets = [
    { id: 'btc-widget', symbol: 'BINANCE:BTCUSDT' },
    { id: 'eth-widget', symbol: 'BINANCE:ETHUSDT' },
    { id: 'bnb-widget', symbol: 'BINANCE:BNBUSDT' },
    { id: 'ada-widget', symbol: 'BINANCE:ADAUSDT' },
    { id: 'sol-widget', symbol: 'BINANCE:SOLUSDT' },
    { id: 'xrp-widget', symbol: 'BINANCE:XRPUSDT' },
    { id: 'doge-widget', symbol: 'BINANCE:DOGEUSDT' },
    { id: 'dot-widget', symbol: 'BINANCE:DOTUSDT' },
    { id: 'link-widget', symbol: 'BINANCE:LINKUSDT' },
    { id: 'ltc-widget', symbol: 'BINANCE:LTCUSDT' }
  ];

  cryptoWidgets.forEach(widget => {
    createCryptoWidget(widget.id, widget.symbol);
  });
}

function createCryptoWidget(containerId, symbol) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Clean up existing widget if it exists
  if (cryptoWidgets[containerId]) {
    cryptoWidgets[containerId].remove();
  }

  // Create new TradingView widget for crypto
  cryptoWidgets[containerId] = new TradingView.widget({
    "autosize": true,
    "symbol": symbol,
    "interval": "D",
    "timezone": "Etc/UTC",
    "theme": "dark",
    "style": "1",
    "locale": "en",
    "toolbar_bg": "#0d1a2b",
    "enable_publishing": false,
    "hide_top_toolbar": true,
    "hide_legend": false,
    "save_image": false,
    "container_id": containerId,
    "studies": [
      "RSI@tv-basicstudies",
      "MACD@tv-basicstudies"
    ],
    "show_popup_button": true,
    "popup_width": "1000",
    "popup_height": "650",
    "no_referral_id": true,
    "referral_id": "NKH52"
  });
}

function cleanupCryptoWidgets() {
  Object.values(cryptoWidgets).forEach(widget => {
    if (widget && widget.remove) {
      widget.remove();
    }
  });
  cryptoWidgets = {};
}

// ---------- STOCK SEARCH FUNCTIONALITY ----------
document.getElementById("searchStockBtn").addEventListener("click", () => {
  const symbolInput = document.getElementById("stockSymbol");
  const symbol = symbolInput.value.trim().toUpperCase();
  
  if (!symbol) {
    showSecureError("Please enter a stock symbol.");
    return;
  }
  
  // Validate symbol (basic check for letters/numbers)
  if (!/^[A-Z0-9]+$/.test(symbol)) {
    showSecureError("Please enter a valid stock symbol (letters and numbers only).");
    return;
  }
  
  searchStock(symbol);
});

// Allow Enter key to search
document.getElementById("stockSymbol").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    document.getElementById("searchStockBtn").click();
  }
});

function searchStock(symbol) {
  // Add to recent searches
  addToRecentSearches(symbol);
  
  // Create TradingView widget for the stock
  createStockWidget(symbol);
  
  // Show the chart container
  const chartContainer = document.getElementById("stock-chart-container");
  const chartTitle = document.getElementById("stock-chart-title");
  
  chartContainer.style.display = "block";
  chartTitle.textContent = `${symbol} - Stock Chart`;
}

function createStockWidget(symbol) {
  const container = document.getElementById("stock-widget");
  
  // Clean up existing widget
  if (stockWidget) {
    stockWidget.remove();
  }
  
  // Clear container
  container.innerHTML = "";
  
  // Create new TradingView widget
  stockWidget = new TradingView.widget({
    "autosize": true,
    "symbol": symbol,
    "interval": "D",
    "timezone": "Etc/UTC",
    "theme": "dark",
    "style": "1",
    "locale": "en",
    "toolbar_bg": "#0d1a2b",
    "enable_publishing": false,
    "hide_top_toolbar": false,
    "hide_legend": false,
    "save_image": false,
    "container_id": "stock-widget",
    "studies": [
      "RSI@tv-basicstudies",
      "MACD@tv-basicstudies",
      "Volume@tv-basicstudies"
    ],
    "show_popup_button": true,
    "popup_width": "1000",
    "popup_height": "650",
    "no_referral_id": true,
    "referral_id": "NKH52"
  });
}

function cleanupStockWidget() {
  if (stockWidget && stockWidget.remove) {
    stockWidget.remove();
  }
  stockWidget = null;
}

function addToRecentSearches(symbol) {
  // Remove if already exists
  recentSearches = recentSearches.filter(s => s !== symbol);
  
  // Add to beginning
  recentSearches.unshift(symbol);
  
  // Keep only last 5 searches
  recentSearches = recentSearches.slice(0, 5);
  
  // Save to localStorage
  localStorage.setItem("recentStockSearches", JSON.stringify(recentSearches));
  
  // Update display
  loadRecentSearches();
}

function loadRecentSearches() {
  // Load from localStorage
  const saved = localStorage.getItem("recentStockSearches");
  if (saved) {
    try {
      recentSearches = JSON.parse(saved);
    } catch (e) {
      recentSearches = [];
    }
  }
  
  const recentDiv = document.getElementById("recent-searches");
  const recentList = document.getElementById("recent-searches-list");
  
  if (recentSearches.length === 0) {
    recentDiv.style.display = "none";
    return;
  }
  
  recentDiv.style.display = "block";
  recentList.innerHTML = "";
  
  recentSearches.forEach(symbol => {
    const button = document.createElement("button");
    button.textContent = symbol;
    button.style.cssText = `
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      border: 1px solid #475569;
      color: #e2e8f0;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: bold;
      transition: all 0.2s ease;
    `;
    
    button.addEventListener("mouseenter", () => {
      button.style.background = "linear-gradient(135deg, #334155 0%, #475569 100%)";
      button.style.borderColor = "#64748b";
    });
    
    button.addEventListener("mouseleave", () => {
      button.style.background = "linear-gradient(135deg, #1e293b 0%, #334155 100%)";
      button.style.borderColor = "#475569";
    });
    
    button.addEventListener("click", () => {
      document.getElementById("stockSymbol").value = symbol;
      searchStock(symbol);
    });
    
    recentList.appendChild(button);
  });
}

// ---------- POINTS CALCULATION ----------
async function getFundData() {
  const totalRef = doc(db, "funds", "total");
  const totalSnap = await getDoc(totalRef);
  if (!totalSnap.exists()) {
    await updateDoc(totalRef, { amount: 0, totalInvested: 0, lastUpdated: serverTimestamp() }).catch(() => {});
    return { amount: 0, totalInvested: 0 };
  }
  const data = totalSnap.data();
  if (!data.totalInvested) data.totalInvested = data.amount; // fallback
  return data;
}

function calculatePoints(aum, totalInvested) {
  if (totalInvested === 0) return 0;
  const scalingFactor = 0.01; // adjust based on scale preference
  return (aum / totalInvested) * aum * scalingFactor;
}

// New points model: grows with BUY, decreases with SELL
function calculatePointsFromTransactions(transactions) {
  if (!Array.isArray(transactions)) return 0;
  return transactions.reduce((sum, tx) => {
    const amt = parseFloat(tx.amount || 0) || 0;
    if (tx.type === 'buy') return sum + amt;
    if (tx.type === 'sell') return sum - amt;
    return sum;
  }, 0);
}

// ---------- ADD TRANSACTION ----------
async function addTransaction(type) {
  const amountInput = document.getElementById("tx-amount").value;
  const dateInput = document.getElementById("tx-date").value;
  
  // Input validation
  if (!amountInput || !dateInput) {
    showSecureError("Please fill in all fields.");
    return;
  }
  
  const amount = parseFloat(amountInput);
  if (!validateAmount(amount)) {
    showSecureError("Please enter a valid amount between 0 and 1,000,000,000.");
    return;
  }
  
  if (!validateDate(dateInput)) {
    showSecureError("Please enter a valid date within the last year.");
    return;
  }

  try {
    const totalRef = doc(db, "funds", "total");
    const fundData = await getFundData();
    const currentAUM = fundData.amount || 0;
    const currentInvested = fundData.totalInvested || 0;

    let newAmount, newTotalInvested;
    if (type === "buy") {
      newAmount = currentAUM + amount;
      newTotalInvested = currentInvested + amount;
    } else {
      newAmount = currentAUM - amount;
      if (newAmount < 0) {
        showSecureError("Insufficient funds for this transaction.");
        return;
      }
      newTotalInvested = currentInvested; // selling doesn't reduce total invested
    }

    await updateDoc(totalRef, {
      amount: newAmount,
      totalInvested: newTotalInvested,
      lastUpdated: serverTimestamp()
    });

    await addDoc(collection(db, "funds", "total", "transactions"), {
      type,
      amount,
      date: dateInput,
      newAmount: newAmount,
      timestamp: serverTimestamp()
    });

    document.getElementById("tx-amount").value = "";
    document.getElementById("tx-date").value = "";

    loadDashboard();
  } catch (error) {
    showSecureError("Transaction failed. Please try again.");
    console.error("Transaction error:", error);
  }
}

document.getElementById("buy-btn").addEventListener("click", () => addTransaction("buy"));
document.getElementById("sell-btn").addEventListener("click", () => addTransaction("sell"));

// ---------- AUM UPDATE ----------
document.getElementById("update-aum-btn").addEventListener("click", async () => {
  const amountInput = document.getElementById("aum-amount").value;
  
  if (!amountInput || amountInput.trim() === '') {
    showSecureError("Please enter an AUM amount.");
    return;
  }
  
  const amount = parseFloat(amountInput);
  if (!validateAmount(amount)) {
    showSecureError("Please enter a valid amount between 0 and 1,000,000,000.");
    return;
  }

  try {
    await addDoc(collection(db, "funds", "total", "aumHistory"), {
      amount,
      date: serverTimestamp()
    });

    document.getElementById("aum-amount").value = "";
    loadAUM();
  } catch (error) {
    showSecureError("Failed to update AUM. Please try again.");
    console.error("AUM update error:", error);
  }
});

// ---------- LOAD AUM ----------
async function loadAUM() {
  const aumSnap = await getDocs(collection(db, "funds", "total", "aumHistory"));
  const data = aumSnap.docs.map(d => d.data()).sort((a, b) => new Date(a.date.seconds * 1000) - new Date(b.date.seconds * 1000));

  if (data.length === 0) {
    aumTotal.innerText = "No AUM data yet.";
    return;
  }

  const latest = data[data.length - 1];
  aumTotal.innerText = `Current AUM: €${latest.amount.toFixed(2)}`;

  const labels = data.map(d => new Date(d.date.seconds * 1000).toLocaleDateString());
  const values = data.map(d => d.amount);

  if (aumChart) aumChart.destroy();
  aumChart = new Chart(aumChartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "AUM (€)",
        data: values,
        borderColor: "rgb(0,102,204)",
        backgroundColor: "rgba(0,102,204,0.15)",
        fill: true,
        tension: 0.1
      }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

// ---------- PERFORMANCE ----------
function calcPerformance(txs, currentTotal) {
  const now = new Date();
  const ranges = {
    "24h": 1,
    "5d": 5,
    "1mo": 30,
    "3mo": 90,
    "6mo": 180,
    "ytd": "ytd",
    "1y": 365,
    "5y": 1825,
    "all": "all"
  };

  const perf = {};

  for (const [label, days] of Object.entries(ranges)) {
    let refTx;
    if (days === "ytd") {
      const jan1 = new Date(now.getFullYear(), 0, 1);
      refTx = txs.find(t => new Date(t.date) >= jan1);
      if (!refTx && txs.length > 0) refTx = txs[0];
    } else if (days === "all") {
      refTx = txs[0];
    } else {
      const past = new Date(now - days * 24 * 60 * 60 * 1000);
      refTx = txs.find(t => new Date(t.date) >= past);
      if (!refTx && txs.length > 0) refTx = txs[0];
    }
    if (refTx) {
      const old = refTx.newAmount || 0;
      const change = ((currentTotal - old) / old) * 100;
      perf[label] = isFinite(change) ? change.toFixed(2) : "0.00";
    } else perf[label] = "0.00";
  }
  return perf;
}

function renderPerf(container, perf) {
  container.innerHTML = "";
  for (const [label, val] of Object.entries(perf)) {
    const span = document.createElement("span");
    const pct = parseFloat(val);
    span.className = pct >= 0 ? "gain" : "loss";
    span.innerText = `${label}: ${val}%`;
    container.appendChild(span);
  }
}

// ---------- LOAD DASHBOARD ----------
async function loadDashboard() {
  const fundData = await getFundData();
  const currentAUM = fundData.amount || 0;
  const totalInvested = fundData.totalInvested || 0;
  // Hide incorrect AUM balance display on top
  if (balanceP) {
    balanceP.style.display = 'none';
    balanceP.innerText = '';
  }
  let pointsEl = document.getElementById("pointsDisplay");
  if (!pointsEl) {
    pointsEl = document.createElement("p");
    pointsEl.id = "pointsDisplay";
    balanceP.parentNode.insertBefore(pointsEl, balanceP.nextSibling);
  }
  // Points now based on net buy/sell transactions
  const txSnap = await getDocs(collection(db, "funds", "total", "transactions"));
  const txs = txSnap.docs
    .map(d => d.data())
    .filter(t => t.newAmount !== undefined)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  // Display latest TWR percentage as points
  const aumSnapForPts = await getDocs(collection(db, "funds", "total", "aumHistory"));
  const aumHistForPts = aumSnapForPts.docs.map(d => d.data()).sort((a,b) => new Date(a.date.seconds * 1000) - new Date(b.date.seconds * 1000));
  const { values: twrValues } = computeTWRSeries(aumHistForPts, txs);
  const latestPct = twrValues.length ? twrValues[twrValues.length - 1] : 0;
  pointsEl.innerText = `Performance: ${latestPct.toFixed(2)}%`;


  transactionsList.innerHTML = txs.map(
    t => `<li>${t.type.toUpperCase()} €${t.amount} (${t.date}) → total: ${t.newAmount}</li>`
  ).join("");

  // Build time-weighted return series from AUM history + profit txs
  const aumSnap = await getDocs(collection(db, "funds", "total", "aumHistory"));
  const aumHist = aumSnap.docs.map(d => d.data()).sort((a,b) => new Date(a.date.seconds * 1000) - new Date(b.date.seconds * 1000));
  const twr = computeTWRSeries(aumHist, txs);
  const labels = twr.labels;
  const dataPoints = twr.values;

  if (fundChart) fundChart.destroy();
  fundChart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Fund Points",
        data: dataPoints,
        borderColor: "rgb(34,197,94)",
        backgroundColor: "rgba(34,197,94,0.2)",
        fill: true,
        tension: 0.1
      }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });

  const perf = calcPerformance(txs, currentAUM);
  renderPerf(perfDiv, perf);
  await loadAUM(); // load AUM chart when dashboard loads
}

// ---------- LOAD PUBLIC VIEW ----------
async function loadPublicView() {
  const fundData = await getFundData();
  const currentAUM = fundData.amount || 0;
  const totalInvested = fundData.totalInvested || 0;
  const txSnap = await getDocs(collection(db, "funds", "total", "transactions"));
  const txs = txSnap.docs
    .map(d => d.data())
    .filter(t => t.newAmount !== undefined)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const points = calculatePointsFromTransactions(txs);
  publicBalance.innerText = `Points: ${points.toFixed(2)} (€${currentAUM.toFixed(2)})`;

  const aumSnap = await getDocs(collection(db, "funds", "total", "aumHistory"));
  const aumHist = aumSnap.docs.map(d => d.data()).sort((a,b) => new Date(a.date.seconds * 1000) - new Date(b.date.seconds * 1000));
  const twr = computeTWRSeries(aumHist, txs);
  const labels = twr.labels;
  const dataPoints = twr.values;

  if (publicChart) publicChart.destroy();
  publicChart = new Chart(publicChartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Fund Points (Public)",
        data: dataPoints,
        borderColor: "rgb(100,100,255)",
        backgroundColor: "rgba(100,100,255,0.1)",
        fill: true,
        tension: 0.1
      }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });

  const perf = calcPerformance(txs, currentAUM);
  renderPerf(publicPerfDiv, perf);
}

// ---------- EARNINGS CALCULATOR ----------
document.getElementById("calcEarningsBtn").addEventListener("click", () => {
  const currentAmountInput = document.getElementById("currentAmount").value;
  const previousAmountInput = document.getElementById("previousAmount").value;
  const resultDiv = document.getElementById("earningsResult");

  // Input validation
  if (!currentAmountInput || !previousAmountInput || 
      currentAmountInput.trim() === '' || previousAmountInput.trim() === '') {
    resultDiv.textContent = "Please enter valid amounts for both fields.";
    return;
  }

  const currentAmount = parseFloat(currentAmountInput);
  const previousAmount = parseFloat(previousAmountInput);

  if (!validateAmount(currentAmount) || !validateAmount(previousAmount)) {
    resultDiv.textContent = "Please enter valid amounts between 0 and 1,000,000,000.";
    return;
  }

  const earnings = currentAmount - previousAmount;
  
  if (earnings <= 0) {
    resultDiv.innerHTML = `
      <p><strong>Current Amount:</strong> €${currentAmount.toFixed(2)}</p>
      <p><strong>Previous Amount:</strong> €${previousAmount.toFixed(2)}</p>
      <p><strong>Earnings:</strong> €${earnings.toFixed(2)}</p>
      <p style='color: #ef4444;'><strong>No earnings to calculate from - amount has not grown.</strong></p>
    `;
    return;
  }

  // Calculate tax on earnings first
  const taxThreshold = 30000;
  let taxAmount = 0;
  
  if (earnings <= taxThreshold) {
    taxAmount = earnings * 0.30; // 30% tax on earnings up to €30,000
  } else {
    const baseTax = taxThreshold * 0.30; // 30% on first €30,000
    const extraTax = (earnings - taxThreshold) * 0.34; // 34% on amount above €30,000
    taxAmount = baseTax + extraTax;
  }

  const afterTaxEarnings = earnings - taxAmount;
  const managementFee = afterTaxEarnings * 0.20; // 20% of after-tax earnings
  const finalNetEarnings = afterTaxEarnings - managementFee;

  resultDiv.innerHTML = `
    <p><strong>Current Amount:</strong> €${currentAmount.toFixed(2)}</p>
    <p><strong>Previous Amount:</strong> €${previousAmount.toFixed(2)}</p>
    <p><strong>Total Earnings:</strong> €${earnings.toFixed(2)}</p>
    <hr style="border: 1px solid rgba(255,255,255,0.2); margin: 10px 0;">
    <p><strong>Tax on Earnings:</strong> €${taxAmount.toFixed(2)}</p>
    <p><strong>After-Tax Earnings:</strong> €${afterTaxEarnings.toFixed(2)}</p>
    <hr style="border: 1px solid rgba(255,255,255,0.2); margin: 10px 0;">
    <p><strong>Management Fee (20%):</strong> €${managementFee.toFixed(2)}</p>
    <p style="color: #10b981; font-weight: bold;"><strong>Final Net Earnings:</strong> €${finalNetEarnings.toFixed(2)}</p>
  `;
});

// ---------- COMMISSIONS CRUD ----------
async function loadCommissions() {
  const snap = await getDocs(collection(db, "commissions"));
  const rows = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  commissionsTbody.innerHTML = rows.map(r => renderCommissionRowHtml(r)).join("");
  bindCommissionRowEvents();
}

function renderCommissionRowHtml(row) {
  const dateStr = row.date ? new Date(row.date).toISOString().split('T')[0] : '';
  const amountStr = (typeof row.amount === 'number') ? row.amount.toFixed(2) : '';
  const noteStr = row.note ? sanitizeInput(String(row.note)) : '';
  return `
    <tr data-id="${row.id}">
      <td style="padding:8px; border-bottom:1px solid var(--border);"><input type="date" value="${dateStr}" class="cm-date" max=""></td>
      <td style="padding:8px; border-bottom:1px solid var(--border); text-align:right;"><input type="number" value="${amountStr}" class="cm-amount" step="0.01" min="-1000000000" max="1000000000" style="width:140px;"></td>
      <td style="padding:8px; border-bottom:1px solid var(--border);"><input type="text" value="${noteStr}" class="cm-note" style="width:100%; padding:6px; background:#0d1a2b; border:1px solid var(--border); border-radius:6px; color: var(--text);"></td>
      <td style="padding:8px; border-bottom:1px solid var(--border); text-align:right;">
        <button class="cm-save" style="margin-right:6px;">Save</button>
        <button class="cm-delete" style="background:#ef4444;">Delete</button>
      </td>
    </tr>`;
}

function bindCommissionRowEvents() {
  const today = new Date().toISOString().split('T')[0];
  commissionsTbody.querySelectorAll('input.cm-date').forEach(inp => inp.max = today);

  commissionsTbody.querySelectorAll('button.cm-save').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const id = tr.getAttribute('data-id');
      const date = tr.querySelector('.cm-date').value;
      const amountVal = tr.querySelector('.cm-amount').value;
      const note = tr.querySelector('.cm-note').value;

      if (!date) { showSecureError('Please set a date.'); return; }
      const amount = parseFloat(amountVal);
      if (!validateCommissionAmount(amount)) { showSecureError('Enter valid amount (±1,000,000,000).'); return; }

      await updateDoc(doc(db, 'commissions', id), {
        date,
        amount,
        note: sanitizeInput(note),
        updatedAt: serverTimestamp()
      }).catch(() => showSecureError('Failed to save row.'));
      await loadCommissions();
    });
  });

  commissionsTbody.querySelectorAll('button.cm-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const id = tr.getAttribute('data-id');
      await updateDoc(doc(db, 'commissions', id), { __deleted: true, updatedAt: serverTimestamp() }).catch(() => {});
      // actually delete to keep collection tidy
      try {
        await import('https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js').then(m => m.deleteDoc(doc(db, 'commissions', id)));
      } catch (err) {}
      await loadCommissions();
    });
  });
}

document.getElementById('addCommissionBtn').addEventListener('click', async () => {
  const date = commissionDateInput.value;
  const note = commissionNoteInput.value;
  const amountVal = commissionAmountInput.value;

  if (!date) { showSecureError('Please select a date.'); return; }
  if (!amountVal || amountVal.trim() === '') { showSecureError('Enter amount.'); return; }
  const amount = parseFloat(amountVal);
  if (!validateCommissionAmount(amount)) { showSecureError('Enter valid amount (±1,000,000,000).'); return; }

  try {
    await addDoc(collection(db, 'commissions'), {
      date,
      amount,
      note: sanitizeInput(note),
      createdAt: serverTimestamp()
    });
    commissionAmountInput.value = '';
    commissionNoteInput.value = '';
    ensureCommissionDateMaxToday();
    await loadCommissions();
  } catch (e) {
    showSecureError('Failed to add commission.');
  }
});

// CSV Export
exportCsvBtn.addEventListener('click', async () => {
  const snap = await getDocs(collection(db, 'commissions'));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const header = ['id','date','amount','note'];
  const csv = [header.join(',')].concat(
    rows.map(r => [r.id, r.date || '', r.amount ?? '', (r.note || '').replace(/\n|\r|,/g, ' ')].join(','))
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `commissions-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Bulk percentage adjust
document.getElementById('applyBulkBtn').addEventListener('click', async () => {
  const pctStr = bulkPercentInput.value;
  if (!pctStr || pctStr.trim() === '') { showSecureError('Enter percentage.'); return; }
  const pct = parseFloat(pctStr);
  if (isNaN(pct)) { showSecureError('Invalid percentage.'); return; }

  const snap = await getDocs(collection(db, 'commissions'));
  const updates = snap.docs.map(async d => {
    const data = d.data();
    const oldAmt = parseFloat(data.amount || 0);
    const newAmt = oldAmt + (oldAmt * pct / 100);
    return updateDoc(doc(db, 'commissions', d.id), { amount: newAmt, updatedAt: serverTimestamp() });
  });
  try {
    await Promise.all(updates);
    await loadCommissions();
  } catch (e) {
    showSecureError('Bulk update failed.');
  }
});

// ---------- MARKET HOURS ----------
function updateMarketHours() {
  const now = new Date();
  const helsinkiTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Helsinki"}));
  const currentHour = helsinkiTime.getHours();
  const currentMinute = helsinkiTime.getMinutes();
  const currentTime = currentHour + currentMinute / 60;
  const dayOfWeek = helsinkiTime.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // Market hours in Helsinki time
  const marketHours = {
    nasdaq: { start: 16.5, end: 23, name: "NASDAQ 100" }, // 4:30 PM - 11:00 PM
    sse: { start: 3, end: 9, name: "SSE Index" }, // 3:00 AM - 9:00 AM
    hangseng: { start: 3, end: 6, breakStart: 6, breakEnd: 7, end2: 10, name: "Hang Seng" }, // 3:00 AM - 6:00 AM, 7:00 AM - 10:00 AM
    dax: { start: 10, end: 18.5, name: "DAX" }, // 10:00 AM - 6:30 PM
    ftse: { start: 10, end: 18.5, name: "FTSE 100" } // 10:00 AM - 6:30 PM
  };

  function isMarketOpen(hours) {
    if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Weekend
    
    if (hours.name === "Hang Seng") {
      // Special case for Hang Seng with lunch break
      return (currentTime >= hours.start && currentTime < hours.end) || 
             (currentTime >= hours.breakEnd && currentTime < hours.end2);
    } else {
      return currentTime >= hours.start && currentTime < hours.end;
    }
  }

  function getStatusText(hours) {
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return '<span style="color: #94a3b8;">Closed (Weekend)</span>';
    }
    
    const isOpen = isMarketOpen(hours);
    if (isOpen) {
      return '<span style="color: #10b981; font-weight: bold;">🟢 OPEN</span>';
    } else {
      return '<span style="color: #ef4444; font-weight: bold;">🔴 CLOSED</span>';
    }
  }

  // Update each market status
  document.getElementById("nasdaq-status").innerHTML = getStatusText(marketHours.nasdaq);
  document.getElementById("sse-status").innerHTML = getStatusText(marketHours.sse);
  document.getElementById("hangseng-status").innerHTML = getStatusText(marketHours.hangseng);
  document.getElementById("dax-status").innerHTML = getStatusText(marketHours.dax);
  document.getElementById("ftse-status").innerHTML = getStatusText(marketHours.ftse);

  // Add current Helsinki time
  const timeDisplay = document.getElementById("market-hours").querySelector("h4");
  timeDisplay.innerHTML = `📅 Market Hours (Helsinki Time) - Current: ${helsinkiTime.toLocaleTimeString()}`;
}


// Set max date for date input to today
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('tx-date');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.max = today;
    dateInput.value = today; // Set default to today
  }
});

// ---------- AUTH STATE ----------
onAuthStateChanged(auth, user => {
  if (user) {
    publicDiv.style.display = "none";
    loginDiv.style.display = "none";
    dashDiv.style.display = "block";
    marketsDiv.style.display = "none";
    loadDashboard();
    loadMonthlyGoal();
  } else {
    publicDiv.style.display = "block";
    loginDiv.style.display = "block";
    dashDiv.style.display = "none";
    marketsDiv.style.display = "none";
    loadPublicView();
  }
});
