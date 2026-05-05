import {
  collection,
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

export async function upsertUserProfile(firebaseUser: FirebaseUser, displayName?: string): Promise<User> {
  const user: User = {
    id: firebaseUser.uid,
    name: displayName?.trim() || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Messenger Kullanıcı',
    email: firebaseUser.email || '',
    isPremium: true,
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

export async function saveFriend(userId: string, friend: Friend) {
  await setDoc(doc(firestore, usersPath, userId, 'friends', friend.id), friend, { merge: true });
}

export async function saveConversation(userId: string, conversation: Conversation) {
  await setDoc(doc(firestore, usersPath, userId, 'conversations', conversation.id), conversation, { merge: true });
}

export async function saveMessage(userId: string, message: Message) {
  await setDoc(doc(firestore, usersPath, userId, 'messages', message.id), message, { merge: true });
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
    if (message.expiresAt <= now) {
      batch.delete(item.ref);
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
