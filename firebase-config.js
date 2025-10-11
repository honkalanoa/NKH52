import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBBLr1CMPQCIBEbyv5BQCwf02oPGnccekU",
  authDomain: "nkh52-bc944.firebaseapp.com",
  projectId: "nkh52-bc944",
  storageBucket: "nkh52-bc944.firebasestorage.app",
  messagingSenderId: "511922412403",
  appId: "1:511922412403:web:04871b60385450541e4306",
  measurementId: "G-ETCFWLKF5Q"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
    