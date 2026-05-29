// Optional realtime layer. If the VITE_FIREBASE_* env vars are absent the app
// runs fully in local mode and none of the Firebase SDK is even loaded
// (it is dynamically imported only when configured).

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined
}

export const isFirebaseConfigured = Boolean(cfg.apiKey && cfg.databaseURL)

export interface DbApi {
  db: import('firebase/database').Database
  ref: typeof import('firebase/database').ref
  set: typeof import('firebase/database').set
  update: typeof import('firebase/database').update
  remove: typeof import('firebase/database').remove
  onValue: typeof import('firebase/database').onValue
  onDisconnect: typeof import('firebase/database').onDisconnect
}

let api: DbApi | null = null
let initPromise: Promise<DbApi | null> | null = null

export function initFirebase(): Promise<DbApi | null> {
  if (!isFirebaseConfigured) return Promise.resolve(null)
  if (initPromise) return initPromise
  initPromise = (async () => {
    const [{ initializeApp }, { getAuth, signInAnonymously }, dbmod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/database')
    ])
    const app = initializeApp(cfg as Record<string, string>)
    try { await signInAnonymously(getAuth(app)) } catch (e) { console.warn('Anonim bejelentkezés sikertelen:', e) }
    api = {
      db: dbmod.getDatabase(app),
      ref: dbmod.ref, set: dbmod.set, update: dbmod.update, remove: dbmod.remove,
      onValue: dbmod.onValue, onDisconnect: dbmod.onDisconnect
    }
    return api
  })()
  return initPromise
}

export function getApi(): DbApi | null { return api }
