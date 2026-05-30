import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCQPza1y2uXdbHpgyp_QvT0vvxw4thgxYU",
  authDomain: "set-list-b1813.firebaseapp.com",
  projectId: "set-list-b1813",
  storageBucket: "set-list-b1813.firebasestorage.app",
  messagingSenderId: "83305566010",
  appId: "1:83305566010:web:d418631376ba95812dca03"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);