import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, reauthenticateWithPopup, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

async function requestDriveReadAccess() {
  if (!auth.currentUser) throw new Error('Iniciá sesión para elegir una carpeta de Drive.');
  const memberSnapshot = await getDoc(doc(db, 'members', auth.currentUser.uid));
  if (!memberSnapshot.exists()
    || memberSnapshot.data().enabled !== true
    || memberSnapshot.data().role !== 'admin') {
    throw new Error('Solo las cuentas administradoras pueden descargar tickets.');
  }

  const driveProvider = new GoogleAuthProvider();
  driveProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
  driveProvider.setCustomParameters({ prompt: 'consent select_account' });
  const result = await reauthenticateWithPopup(auth.currentUser, driveProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) throw new Error('Google no concedió acceso de lectura a Drive.');

  const projectNumber = String(firebaseConfig.appId || '').match(/^1:(\d+):/)?.[1];
  return { accessToken: credential.accessToken, apiKey: firebaseConfig.apiKey, projectNumber };
}

window.TravelFirebase = Object.freeze({
  app,
  auth,
  db,
  onAuthStateChanged,
  signIn: () => signInWithPopup(auth, googleProvider),
  requestDriveReadAccess,
  signOut: () => signOut(auth)
});

export { app, auth, db };