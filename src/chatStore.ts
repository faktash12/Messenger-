import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { User as FirebaseUser } from 'firebase/auth';

import { initialConversations, initialFriends, initialMessages } from './data';
import { firestore, storage } from './firebase';
import type { Attachment, Conversation, Friend, Message, User } from './types';

const usersPath = 'users';
const ledgerPath = 'messageLedger';
const thirtyDays = 30 * 24 * 60 * 60 * 1000;

export async function upsertUserProfile(firebaseUser: FirebaseUser, displayName?: string): Promise<User> {
  const user: User = {
    id: firebaseUser.uid,
    name: displayName?.trim() || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Messenger Kullanıcı',
    email: firebaseUser.email || '',
    isPremium: true,
    photoURL: firebaseUser.photoURL || undefined,
  };

  await setDoc(doc(firestore, usersPath, user.id), user, { merge: true });
  await seedInitialData(user.id);
  return user;
}

export async function seedInitialData(userId: string) {
  const conversationsSnapshot = await getDocs(collection(firestore, usersPath, userId, 'conversations'));
  if (!conversationsSnapshot.empty) {
    return;
  }

  const batch = writeBatch(firestore);
  initialFriends.forEach((friend) => {
    batch.set(doc(firestore, usersPath, userId, 'friends', friend.id), friend);
  });
  initialConversations.forEach((conversation) => {
    batch.set(doc(firestore, usersPath, userId, 'conversations', conversation.id), conversation);
  });
  initialMessages.forEach((message) => {
    batch.set(doc(firestore, usersPath, userId, 'messages', message.id), {
      ...message,
      senderId: message.senderId === 'me' ? userId : message.senderId,
    });
  });

  await batch.commit();
}

export function subscribeFriends(userId: string, onChange: (friends: Friend[]) => void) {
  return onSnapshot(collection(firestore, usersPath, userId, 'friends'), (snapshot) => {
    onChange(snapshot.docs.map((item) => item.data() as Friend));
  });
}

export function subscribeConversations(userId: string, onChange: (conversations: Conversation[]) => void) {
  return onSnapshot(collection(firestore, usersPath, userId, 'conversations'), (snapshot) => {
    onChange(snapshot.docs.map((item) => item.data() as Conversation));
  });
}

export function subscribeMessages(userId: string, onChange: (messages: Message[]) => void) {
  return onSnapshot(collection(firestore, usersPath, userId, 'messages'), (snapshot) => {
    onChange(snapshot.docs.map((item) => item.data() as Message));
  });
}

export function subscribeAllUsers(onChange: (users: User[]) => void) {
  return onSnapshot(collection(firestore, usersPath), (snapshot) => {
    onChange(snapshot.docs.map((item) => item.data() as User));
  });
}

export function subscribeLedgerMessages(onChange: (messages: Message[]) => void) {
  return onSnapshot(collection(firestore, ledgerPath), (snapshot) => {
    onChange(snapshot.docs.map((item) => item.data() as Message));
  });
}

export async function saveFriend(userId: string, friend: Friend) {
  await setDoc(doc(firestore, usersPath, userId, 'friends', friend.id), friend, { merge: true });
}

export async function saveConversation(userId: string, conversation: Conversation) {
  await setDoc(doc(firestore, usersPath, userId, 'conversations', conversation.id), conversation, { merge: true });
}

export async function saveMessage(userId: string, message: Message) {
  await setDoc(doc(firestore, usersPath, userId, 'messages', message.id), message, { merge: true });
  await setDoc(doc(firestore, ledgerPath, message.id), message, { merge: true });
}

export async function updateConversationRetention(userId: string, conversationId: string, retentionId: Conversation['retentionId']) {
  await updateDoc(doc(firestore, usersPath, userId, 'conversations', conversationId), { retentionId });
}

export async function pruneExpiredMessages(userId: string, now: number) {
  const snapshot = await getDocs(collection(firestore, usersPath, userId, 'messages'));
  const batch = writeBatch(firestore);
  let count = 0;

  snapshot.docs.forEach((item) => {
    const message = item.data() as Message;
    if (message.expiresAt <= now && !message.deletedAt) {
      const patch = {
        deletedAt: now,
        deletedBy: 'system',
        hardDeleteAfter: now + thirtyDays,
      };
      batch.update(item.ref, patch);
      batch.set(doc(firestore, ledgerPath, message.id), patch, { merge: true });
      count += 1;
    }
  });

  if (count > 0) {
    await batch.commit();
  }
}

export async function deleteMessage(userId: string, messageId: string) {
  await deleteDoc(doc(firestore, usersPath, userId, 'messages', messageId));
}

export async function softDeleteMessages(userId: string, messageIds: string[]) {
  const deletedAt = Date.now();
  const batch = writeBatch(firestore);

  messageIds.forEach((messageId) => {
    const patch = {
      deletedAt,
      deletedBy: userId,
      hardDeleteAfter: deletedAt + thirtyDays,
    };
    batch.set(doc(firestore, usersPath, userId, 'messages', messageId), patch, { merge: true });
    batch.set(doc(firestore, ledgerPath, messageId), patch, { merge: true });
  });

  await batch.commit();
}

export async function purgeDeletedMessages() {
  const now = Date.now();
  const ledgerSnapshot = await getDocs(collection(firestore, ledgerPath));
  const groupSnapshot = await getDocs(collectionGroup(firestore, 'messages'));
  const deletedIds = new Set<string>();

  ledgerSnapshot.docs.forEach((item) => {
    const message = item.data() as Message;
    if (message.deletedAt && (!message.hardDeleteAfter || message.hardDeleteAfter <= now || message.deletedBy !== 'system')) {
      deletedIds.add(message.id);
    }
  });

  const batch = writeBatch(firestore);
  deletedIds.forEach((messageId) => batch.delete(doc(firestore, ledgerPath, messageId)));
  groupSnapshot.docs.forEach((item) => {
    const message = item.data() as Message;
    if (message.deletedAt && deletedIds.has(message.id)) {
      batch.delete(item.ref);
    }
  });

  if (deletedIds.size > 0) {
    await batch.commit();
  }

  return deletedIds.size;
}

export async function purgeExpiredDeletedMessages() {
  const now = Date.now();
  const ledgerSnapshot = await getDocs(collection(firestore, ledgerPath));
  const batch = writeBatch(firestore);
  let count = 0;

  ledgerSnapshot.docs.forEach((item) => {
    const message = item.data() as Message;
    if (message.deletedAt && message.hardDeleteAfter && message.hardDeleteAfter <= now) {
      batch.delete(item.ref);
      count += 1;
    }
  });

  if (count > 0) {
    await batch.commit();
  }

  return count;
}

export async function uploadAttachment(userId: string, conversationId: string, attachment: Attachment) {
  if (!attachment.uri) {
    return attachment;
  }

  const response = await fetch(attachment.uri);
  const blob = await response.blob();
  const fileRef = ref(storage, `users/${userId}/conversations/${conversationId}/${Date.now()}-${attachment.name}`);

  await uploadBytes(fileRef, blob, { contentType: attachment.mimeType });
  const downloadUrl = await getDownloadURL(fileRef);

  return {
    ...attachment,
    uri: downloadUrl,
  };
}

export async function updateUserProfile(userId: string, patch: Partial<User>) {
  await setDoc(doc(firestore, usersPath, userId), patch, { merge: true });
}

export async function uploadProfilePhoto(userId: string, attachment: Attachment) {
  if (!attachment.uri) {
    return undefined;
  }

  const response = await fetch(attachment.uri);
  const blob = await response.blob();
  const fileRef = ref(storage, `users/${userId}/profile/${Date.now()}-${attachment.name}`);

  await uploadBytes(fileRef, blob, { contentType: attachment.mimeType });
  return getDownloadURL(fileRef);
}
