// Optional cloud sync through the owner's own Firebase project.
// One Firestore document per signed-in user: users/{uid} = { data: <state JSON>, updatedAt }.
// Loaded only when firebase-config.js holds a config, so the app also runs fully local.

const V = "10.12.2";
const lib = (name) => import(`https://www.gstatic.com/firebasejs/${V}/firebase-${name}.js`);

const AUTH_MESSAGES = {
  "auth/invalid-credential": "That email and password don't match. Try again.",
  "auth/wrong-password": "That email and password don't match. Try again.",
  "auth/user-not-found": "No account uses that email yet. Tap Create account.",
  "auth/invalid-email": "Enter a full email address.",
  "auth/email-already-in-use": "That email already has an account. Tap Sign in instead.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/missing-password": "Enter your password.",
  "auth/too-many-requests": "Too many tries. Wait a minute, then try again.",
  "auth/network-request-failed": "You're offline. Sign in once you have a connection.",
  "auth/operation-not-allowed": "Email sign-in isn't turned on in Firebase yet. Enable Email/Password under Authentication.",
};
export const authMessage = (e) => AUTH_MESSAGES[e && e.code] || "Sign-in didn't work. Check your connection and try again.";

export async function startSync(config, { onUser, onRemote, onStatus }) {
  const [appMod, authMod, fs] = await Promise.all([lib("app"), lib("auth"), lib("firestore")]);
  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  let db;
  try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() }); }
  catch { db = fs.getFirestore(app); }

  let uid = null, unsub = null, timer = null, pending = null;

  const ref = () => fs.doc(db, "users", uid);

  authMod.onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    uid = user ? user.uid : null;
    onUser(user ? { email: user.email, uid: user.uid } : null);
    if (!uid) return;
    unsub = fs.onSnapshot(ref(), { includeMetadataChanges: false }, (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      if (!snap.exists()) { onRemote(null); return; }
      const v = snap.data();
      try { onRemote(JSON.parse(v.data), v.updatedAt || 0); } catch { onRemote(null); }
      onStatus({ ok: true, at: Date.now() });
    }, (err) => onStatus({ ok: false, error: err && err.code }));
  });

  async function flush() {
    timer = null;
    if (!uid || !pending) return;
    const state = pending; pending = null;
    try {
      await fs.setDoc(ref(), { data: JSON.stringify(state), updatedAt: state.updatedAt || Date.now() });
      onStatus({ ok: true, at: Date.now() });
    } catch (err) {
      onStatus({ ok: false, error: err && err.code });
    }
  }

  return {
    signIn: (email, pw) => authMod.signInWithEmailAndPassword(auth, email, pw),
    signUp: (email, pw) => authMod.createUserWithEmailAndPassword(auth, email, pw),
    resetPassword: (email) => authMod.sendPasswordResetEmail(auth, email),
    signOut: () => authMod.signOut(auth),
    /** Queue the latest state; writes at most once per pause in typing. */
    push(state) { pending = state; if (timer) clearTimeout(timer); timer = setTimeout(flush, 700); },
    pushNow(state) { pending = state; if (timer) clearTimeout(timer); return flush(); },
  };
}
