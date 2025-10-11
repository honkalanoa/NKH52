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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Elements
const loginDiv = document.getElementById("login");
const dashDiv = document.getElementById("dashboard");
const publicDiv = document.getElementById("public-view");
const marketsDiv = document.getElementById("markets-page");
const balanceP = document.getElementById("balance");
const transactionsList = document.getElementById("transactions");
const chartCanvas = document.getElementById("fundChart");
const publicChartCanvas = document.getElementById("publicChart");
const perfDiv = document.getElementById("perf");
const publicPerfDiv = document.getElementById("public-perf");
const publicBalance = document.getElementById("public-balance");

// New AUM Elements
const aumTotal = document.getElementById("aum-total");
const aumChartCanvas = document.getElementById("aumChart");
let aumChart = null;

let fundChart = null;
let publicChart = null;

// ---------- LOGIN ----------
document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    alert("Login failed: " + err.message);
  }
});
document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

// ---------- MARKETS NAVIGATION ----------
let tradingViewWidgets = {};

document.getElementById("marketsBtn").addEventListener("click", () => {
  dashDiv.style.display = "none";
  marketsDiv.style.display = "block";
  initializeTradingViewWidgets();
});

document.getElementById("backToDashboardBtn").addEventListener("click", () => {
  marketsDiv.style.display = "none";
  dashDiv.style.display = "block";
  // Clean up TradingView widgets when leaving
  cleanupTradingViewWidgets();
});

function initializeTradingViewWidgets() {
  // Initialize all TradingView widgets
  const widgets = [
    { id: 'nasdaq100-widget', symbol: 'NDX' },
    { id: 'sse-widget', symbol: '000001' },
    { id: 'hangseng-widget', symbol: 'HSI' },
    { id: 'dax-widget', symbol: 'GDAXI' },
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

// ---------- ADD TRANSACTION ----------
async function addTransaction(type) {
  const amount = parseFloat(document.getElementById("tx-amount").value);
  const dateInput = document.getElementById("tx-date").value;
  if (!dateInput || isNaN(amount) || amount <= 0) return alert("Invalid input");

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
    newAmount: newAmount
  });

  document.getElementById("tx-amount").value = "";
  document.getElementById("tx-date").value = "";

  loadDashboard();
}

document.getElementById("buy-btn").addEventListener("click", () => addTransaction("buy"));
document.getElementById("sell-btn").addEventListener("click", () => addTransaction("sell"));

// ---------- AUM UPDATE ----------
document.getElementById("update-aum-btn").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("aum-amount").value);
  if (isNaN(amount) || amount <= 0) return alert("Enter a valid AUM amount.");

  await addDoc(collection(db, "funds", "total", "aumHistory"), {
    amount,
    date: serverTimestamp()
  });

  document.getElementById("aum-amount").value = "";
  loadAUM();
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
  const points = calculatePoints(currentAUM, totalInvested);

  balanceP.innerText = `AUM: €${currentAUM.toFixed(2)}`;
  let pointsEl = document.getElementById("pointsDisplay");
  if (!pointsEl) {
    pointsEl = document.createElement("p");
    pointsEl.id = "pointsDisplay";
    balanceP.parentNode.insertBefore(pointsEl, balanceP.nextSibling);
  }
  pointsEl.innerText = `Points: ${points.toFixed(2)}`;

  const txSnap = await getDocs(collection(db, "funds", "total", "transactions"));
  const txs = txSnap.docs
    .map(d => d.data())
    .filter(t => t.newAmount !== undefined)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  transactionsList.innerHTML = txs.map(
    t => `<li>${t.type.toUpperCase()} €${t.amount} (${t.date}) → total: ${t.newAmount}</li>`
  ).join("");

  const labels = txs.map(t => t.date);
  const dataPoints = txs.map(t => calculatePoints(t.newAmount, totalInvested));

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
  const points = calculatePoints(currentAUM, totalInvested);
  publicBalance.innerText = `Points: ${points.toFixed(2)} (€${currentAUM.toFixed(2)})`;

  const txSnap = await getDocs(collection(db, "funds", "total", "transactions"));
  const txs = txSnap.docs
    .map(d => d.data())
    .filter(t => t.newAmount !== undefined)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const labels = txs.map(t => t.date);
  const dataPoints = txs.map(t => calculatePoints(t.newAmount, totalInvested));

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
// ---------- TAX CALCULATOR ----------
document.getElementById("calcTaxBtn").addEventListener("click", () => {
  const gainInput = parseFloat(document.getElementById("gainInput").value);
  const resultDiv = document.getElementById("taxResult");

  if (isNaN(gainInput) || gainInput <= 0) {
    resultDiv.innerHTML = "<p style='color: red;'>Please enter a valid gain amount.</p>";
    return;
  }

  const threshold = 30000;
  let taxAmount = 0;

  if (gainInput <= threshold) {
    taxAmount = gainInput * 0.30;
  } else {
    const baseTax = threshold * 0.30;
    const extraTax = (gainInput - threshold) * 0.34;
    taxAmount = baseTax + extraTax;
  }

  const afterTax = gainInput - taxAmount;

  resultDiv.innerHTML = `
    <p><strong>Gain:</strong> €${gainInput.toFixed(2)}</p>
    <p><strong>Tax to pay:</strong> €${taxAmount.toFixed(2)}</p>
    <p><strong>After-tax amount:</strong> €${afterTax.toFixed(2)}</p>
  `;
});


// ---------- AUTH STATE ----------
onAuthStateChanged(auth, user => {
  if (user) {
    publicDiv.style.display = "none";
    loginDiv.style.display = "none";
    dashDiv.style.display = "block";
    marketsDiv.style.display = "none";
    loadDashboard();
  } else {
    publicDiv.style.display = "block";
    loginDiv.style.display = "block";
    dashDiv.style.display = "none";
    marketsDiv.style.display = "none";
    loadPublicView();
  }
});
