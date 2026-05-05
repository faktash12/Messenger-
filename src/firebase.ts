import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth, initializeAuth, type Auth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: 'AIzaSyBWB2EzL9qUjJ6A0nfkIjTZR2dvhyRES70',
  authDomain: 'messenger-37c0d.firebaseapp.com',
  projectId: 'messenger-37c0d',
  storageBucket: 'messenger-37c0d.firebasestorage.app',
  messagingSenderId: '1052135811563',
  appId: '1:1052135811563:web:b465573815bb927714d1ae',
  measurementId: 'G-70YXK3F7TV',
};

export const firebaseApp: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

const reactNativePersistence = {
  type: 'LOCAL' as const,
  async _isAvailable() {
    return true;
  },
  async _set(key: string, value: unknown) {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async _get<T>(key: string) {
    const value = await AsyncStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  },
  async _remove(key: string) {
    await AsyncStorage.removeItem(key);
  },
  _addListener() {
    return undefined;
  },
  _removeListener() {
    return undefined;
  },
};

function createAuth(): Auth {
  if (Platform.OS === 'web') {
    return getAuth(firebaseApp);
  }

  try {
    return initializeAuth(firebaseApp, {
      persistence: reactNativePersistence as never,
    });
  } catch {
    return getAuth(firebaseApp);
  }
}

export const auth = createAuth();
export const firestore = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

if (Platform.OS === 'web') {
  isSupported()
    .then((supported) => {
      if (supported) {
        getAnalytics(firebaseApp);
      }
    })
    .catch(() => undefined);
}
