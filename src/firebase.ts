import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth } from 'firebase/auth';
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

export const auth = getAuth(firebaseApp);
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
