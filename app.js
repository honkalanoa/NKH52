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
const balanceP = document.getElementById("balance");
const transactionsList = document.getElementById("transactions");
const chartCanvas = document.getElementById("fundChart");
const publicChartCanvas = document.getElementById("publicChart");
const perfDiv = document.getElementById("perf");
const publicPerfDiv = document.getElementById("public-perf");
const publicBalance = document.getElementById("public-balance");

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

// ---------- ADD TRANSACTION ----------
async function addTransaction(type) {
  const amount = parseFloat(document.getElementById("tx-amount").value);
  const dateInput = document.getElementById("tx-date").value;
  if (!dateInput || isNaN(amount) || amount <= 0) return alert("Invalid input");

  const totalRef = doc(db, "funds", "total");
  const totalSnap = await getDoc(totalRef);
  const current = totalSnap.exists() ? totalSnap.data().amount : 0;
  const newAmount = type === "buy" ? current + amount : current - amount;

  await updateDoc(totalRef, { amount: newAmount, lastUpdated: serverTimestamp() });
  await addDoc(collection(db, "funds", "total", "transactions"), {
    type,
    amount,
    date: dateInput,
    newAmount
  });

  document.getElementById("tx-amount").value = "";
  document.getElementById("tx-date").value = "";
  loadDashboard();
}

document.getElementById("buy-btn").addEventListener("click", () => addTransaction("buy"));
document.getElementById("sell-btn").addEventListener("click", () => addTransaction("sell"));

// ---------- CALCULATE PERFORMANCE ----------
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

// ---------- DISPLAY PERFORMANCE ----------
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
  const totalSnap = await getDoc(doc(db, "funds", "total"));
  const currentTotal = totalSnap.exists() ? totalSnap.data().amount : 0;

  const txSnap = await getDocs(collection(db, "funds", "total", "transactions"));
  const txs = txSnap.docs
    .map(d => d.data())
    .filter(t => t.newAmount !== undefined)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  balanceP.innerText = `Total: ${currentTotal} pts (€${currentTotal})`;
  transactionsList.innerHTML = txs.map(
    t => `<li>${t.type.toUpperCase()} €${t.amount} (${t.date}) → total: ${t.newAmount}</li>`
  ).join("");

  const labels = txs.map(t => t.date);
  const dataPoints = txs.map(t => t.newAmount);

  if (fundChart) fundChart.destroy();
  fundChart = new Chart(chartCanvas, {
    type: "line",
    data: { labels, datasets: [{ label: "Fund Points", data: dataPoints, borderColor: "rgb(75,192,192)", backgroundColor: "rgba(75,192,192,0.2)", fill: true, tension: 0.1 }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });

  const perf = calcPerformance(txs, currentTotal);
  renderPerf(perfDiv, perf);
}

// ---------- PUBLIC DASHBOARD ----------
async function loadPublicView() {
  const totalSnap = await getDoc(doc(db, "funds", "total"));
  const currentTotal = totalSnap.exists() ? totalSnap.data().amount : 0;

  const txSnap = await getDocs(collection(db, "funds", "total", "transactions"));
  const txs = txSnap.docs
    .map(d => d.data())
    .filter(t => t.newAmount !== undefined)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  publicBalance.innerText = `Total: ${currentTotal} pts (€${currentTotal})`;

  const labels = txs.map(t => t.date);
  const dataPoints = txs.map(t => t.newAmount);

  if (publicChart) publicChart.destroy();
  publicChart = new Chart(publicChartCanvas, {
    type: "line",
    data: { labels, datasets: [{ label: "Fund Points (Public)", data: dataPoints, borderColor: "rgb(100,100,255)", backgroundColor: "rgba(100,100,255,0.1)", fill: true, tension: 0.1 }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });

  const perf = calcPerformance(txs, currentTotal);
  renderPerf(publicPerfDiv, perf);
}

// ---------- AUTH STATE ----------
onAuthStateChanged(auth, user => {
  if (user) {
    publicDiv.style.display = "none";
    loginDiv.style.display = "none";
    dashDiv.style.display = "block";
    loadDashboard();
  } else {
    publicDiv.style.display = "block";
    loginDiv.style.display = "block";
    dashDiv.style.display = "none";
    loadPublicView();
  }
});
