import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  pruneExpiredMessages,
  purgeDeletedMessages,
  purgeExpiredDeletedMessages,
  saveConversation,
  saveFriend,
  saveIncomingMessage,
  saveMessage,
  softDeleteMessages,
  subscribeAllUsers,
  subscribeConversations,
  subscribeFriends,
  subscribeLedgerMessages,
  subscribeMessages,
  updateConversationRetention,
  updateUserProfile,
  uploadAttachment,
  uploadProfilePhoto,
  upsertUserProfile,
} from './src/chatStore';
import { adminCredentials, adminUser, directory, initialConversations, initialFriends, initialMessages } from './src/data';
import { auth } from './src/firebase';
import { quotes } from './src/quotes';
import { formatRemaining, getRetention, retentionOptions } from './src/retention';
import type { Conversation, Friend, Message, RetentionId, TabId, User } from './src/types';

const palette = {
  ink: '#111827',
  muted: '#667085',
  soft: '#f5f7fb',
  panel: '#ffffff',
  border: '#d8dee9',
  accent: '#115e59',
  accentStrong: '#0f766e',
  accentSoft: '#dff8f4',
  coral: '#f97363',
  blue: '#2f6fed',
  warning: '#f4a62a',
  dark: '#172033',
};

const tabs: Array<{ id: TabId; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'chats', label: 'Sohbet', icon: 'chatbubble-ellipses-outline' },
  { id: 'friends', label: 'Arkadaşlar', icon: 'people-outline' },
  { id: 'settings', label: 'Ayarlar', icon: 'settings-outline' },
  { id: 'admin', label: 'Admin', icon: 'server-outline' },
];

function usesFirebase(user: User | null): user is User {
  return Boolean(user && user.authProvider !== 'local-admin');
}

function getAuthErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : 'Firebase oturumu açılamadı.';

  if (rawMessage.includes('auth/operation-not-allowed')) {
    return 'Firebase Email/Password kapalı. Firebase Console > Authentication > Sign-in method > Email/Password sağlayıcısını etkinleştir.';
  }

  if (rawMessage.includes('auth/invalid-credential') || rawMessage.includes('auth/wrong-password')) {
    return 'E-posta veya şifre hatalı.';
  }

  if (rawMessage.includes('auth/email-already-in-use')) {
    return 'Bu e-posta ile zaten bir hesap var. Giriş yap sekmesini kullan.';
  }

  return rawMessage.replace('Firebase: ', '');
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [friends, setFriends] = useState<Friend[]>(initialFriends);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [ledgerMessages, setLedgerMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('chats');
  const [selectedConversationId, setSelectedConversationId] = useState(initialConversations[0].id);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          setFriends([]);
          setConversations([]);
          setMessages([]);
          setLedgerMessages([]);
          setSelectedConversationId('');
          setOpenConversationId(null);
          const profile = await upsertUserProfile(firebaseUser);
          setUser(profile);
        } else {
          setUser(null);
        }
      } finally {
        setAuthReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!usesFirebase(user)) {
      return undefined;
    }

    const unsubscribers = [
      subscribeFriends(user.id, setFriends),
      subscribeConversations(user.id, (items) => {
        setConversations(items);
        if (items.length > 0 && !items.some((item) => item.id === selectedConversationId)) {
          setSelectedConversationId(items[0].id);
        } else if (items.length === 0) {
          setSelectedConversationId('');
          setOpenConversationId(null);
        }
      }),
      subscribeMessages(user.id, setMessages),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [selectedConversationId, user]);

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const unsubscribers = [
      subscribeAllUsers(setAllUsers),
      ...(user.isAdmin ? [subscribeLedgerMessages(setLedgerMessages)] : []),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [user]);

  useEffect(() => {
    const timer = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      setMessages((current) => current.filter((message) => message.expiresAt > tick));
      if (usesFirebase(user)) {
        pruneExpiredMessages(user.id, tick).catch(() => undefined);
        purgeExpiredDeletedMessages().catch(() => undefined);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [user]);

  const accessibleConversations = useMemo(() => {
    const friendIds = new Set(friends.map((friend) => friend.id));
    return conversations.filter((conversation) => friendIds.has(conversation.friendId));
  }, [conversations, friends]);

  const visibleMessages = useMemo(() => {
    const allowedConversationIds = new Set(accessibleConversations.map((conversation) => conversation.id));
    return messages.filter(
      (message) =>
        message.expiresAt > now &&
        !message.deletedAt &&
        (user?.isAdmin || allowedConversationIds.has(message.conversationId)),
    );
  }, [accessibleConversations, messages, now, user?.isAdmin]);

  const authenticate = async ({
    cleanEmail,
    mode,
    name,
    password,
  }: {
    cleanEmail: string;
    mode: 'login' | 'register';
    name: string;
    password: string;
  }) => {
    if (cleanEmail === adminCredentials.email && password === adminCredentials.password) {
      try {
        let credential;
        try {
          credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (!message.includes('auth/user-not-found') && !message.includes('auth/invalid-credential')) {
            throw error;
          }
          credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        }

        await updateProfile(credential.user, { displayName: adminUser.name }).catch(() => undefined);
        const profile = await upsertUserProfile(credential.user, adminUser.name, {
          isAdmin: true,
          isPremium: true,
          protectedAccount: true,
        });
        setUser({ ...profile, isAdmin: true, protectedAccount: true });
        setFriends([]);
        setConversations([]);
        setMessages([]);
        setLedgerMessages([]);
        setSelectedConversationId('');
        setOpenConversationId(null);
        setActiveTab('admin');
        return;
      } catch {
        // Firebase admin oturumu kurulamazsa uygulama içi korumalı admin açık kalır.
      }

      setUser(adminUser);
      setAllUsers([
        adminUser,
        ...initialFriends.map((friend) => ({
          id: friend.id,
          name: friend.name,
          email: friend.email,
          isPremium: friend.premium,
        })),
      ]);
      setFriends(initialFriends);
      setConversations(initialConversations);
      const adminMessages = initialMessages.map((message) => ({
          ...message,
          senderId: message.senderId === 'me' ? adminUser.id : message.senderId,
          senderEmail: message.senderId === 'me' ? adminUser.email : `${message.senderId}@example.com`,
          receiverId: message.senderId === 'me' ? 'ece' : adminUser.id,
          receiverEmail: message.senderId === 'me' ? 'ece@example.com' : adminUser.email,
        }));
      setMessages(adminMessages);
      setLedgerMessages(adminMessages);
      setSelectedConversationId(initialConversations[0].id);
      setOpenConversationId(null);
      setActiveTab('chats');
      return;
    }

    const credential =
      mode === 'register'
        ? await createUserWithEmailAndPassword(auth, cleanEmail, password)
        : await signInWithEmailAndPassword(auth, cleanEmail, password);

    if (mode === 'register' && name.trim()) {
      await updateProfile(credential.user, { displayName: name.trim() });
    }

    const profile = await upsertUserProfile(credential.user, name);
    setUser(profile);
  };

  if (!authReady) {
    return (
      <>
        <StatusBar style="dark" />
        <View style={styles.authRoot}>
          <View style={styles.logoMark}>
            <Ionicons color="#ffffff" name="leaf-outline" size={30} />
          </View>
          <Text style={styles.brandTitle}>Özlü Sözler</Text>
        </View>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <StatusBar style="dark" />
        <AuthScreen onAuthenticate={authenticate} />
      </>
    );
  }

  const addFriend = (email: string, openChat = true) => {
    const cleanEmail = email.trim().toLowerCase();
    const existing = friends.find((friend) => friend.email.toLowerCase() === cleanEmail);

    if (existing) {
      const existingConversation = conversations.find((conversation) => conversation.friendId === existing.id);
      const conversation =
        existingConversation ?? {
          id: `chat-${existing.id}`,
          friendId: existing.id,
          retentionId: user.isPremium ? 'forever' : '10m',
        };
      if (!existingConversation) {
        setConversations((current) => [...current, conversation]);
        if (usesFirebase(user)) {
          saveConversation(user.id, conversation).catch(() => undefined);
        }
      }
      if (openChat) {
        setSelectedConversationId(conversation.id);
        setOpenConversationId(conversation.id);
        setActiveTab('chats');
      }
      return 'Bu kişi zaten arkadaş listende.';
    }

    const fromDirectory = directory.find((friend) => friend.email.toLowerCase() === cleanEmail);
    const registeredUser = allUsers.find((item) => item.email.toLowerCase() === cleanEmail);
    const newFriend: Friend =
      registeredUser
        ? {
            id: registeredUser.id,
            userId: registeredUser.id,
            name: registeredUser.name,
            email: registeredUser.email,
            status: 'online',
            avatarColor: palette.blue,
            premium: registeredUser.isPremium,
            photoURL: registeredUser.photoURL,
          }
        :
      fromDirectory ??
      {
        id: `friend-${Date.now()}`,
        name: cleanEmail.split('@')[0].replace(/[._-]/g, ' '),
        email: cleanEmail,
        status: 'offline',
        avatarColor: '#475467',
        premium: false,
      };

    const newConversation: Conversation = {
      id: `chat-${newFriend.id}`,
      friendId: newFriend.id,
      retentionId: user.isPremium ? 'forever' : '10m',
    };

    setFriends((current) => [...current, newFriend]);
    setConversations((current) => [...current, newConversation]);
    if (usesFirebase(user)) {
      saveFriend(user.id, newFriend).catch(() => undefined);
      saveConversation(user.id, newConversation).catch(() => undefined);
      if (registeredUser) {
        const reciprocalFriend: Friend = {
          id: user.id,
          userId: user.id,
          name: user.name,
          email: user.email,
          status: 'online',
          avatarColor: palette.accent,
          premium: user.isPremium,
          photoURL: user.photoURL,
        };
        saveFriend(registeredUser.id, reciprocalFriend).catch(() => undefined);
        saveConversation(registeredUser.id, { ...newConversation, friendId: user.id }).catch(() => undefined);
      }
    }
    if (openChat) {
      setSelectedConversationId(newConversation.id);
      setOpenConversationId(newConversation.id);
      setActiveTab('chats');
    }
    return `${newFriend.name} arkadaş olarak eklendi.`;
  };

  const sendMessage = (conversationId: string, text: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    const friend = friends.find((item) => item.id === conversation?.friendId);
    if (!conversation || !text.trim()) {
      return;
    }

    const createdAt = Date.now();
    const retention = getRetention(conversation.retentionId);

    const nextMessage: Message = {
      id: `msg-${createdAt}`,
      conversationId,
      senderId: user.id,
      receiverId: friend?.userId ?? friend?.id,
      senderEmail: user.email,
      receiverEmail: friend?.email,
      senderName: user.name,
      receiverName: friend?.name,
      text: text.trim(),
      createdAt,
      expiresAt: createdAt + retention.milliseconds,
    };

    setMessages((current) => [...current, nextMessage]);
    if (usesFirebase(user)) {
      saveMessage(user.id, nextMessage).catch(() => undefined);
      if (friend?.userId) {
        saveIncomingMessage(friend.userId, user, conversation, nextMessage).catch(() => undefined);
      }
    }
  };

  const sendFile = async (conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    const friend = friends.find((item) => item.id === conversation?.friendId);
    if (!conversation) {
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: ['image/*', 'video/*', 'application/pdf', '*/*'],
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    const createdAt = Date.now();
    const retention = getRetention(conversation.retentionId);

    const localAttachment = {
      name: asset.name,
      size: asset.size,
      mimeType: asset.mimeType,
      uri: asset.uri,
    };
    const nextMessage: Message = {
      id: `file-${createdAt}`,
      conversationId,
      senderId: user.id,
      receiverId: friend?.userId ?? friend?.id,
      senderEmail: user.email,
      receiverEmail: friend?.email,
      senderName: user.name,
      receiverName: friend?.name,
      attachment: localAttachment,
      createdAt,
      expiresAt: createdAt + retention.milliseconds,
    };

    setMessages((current) => [...current, nextMessage]);

    if (usesFirebase(user)) {
      try {
        const uploadedAttachment = await uploadAttachment(user.id, conversationId, localAttachment);
        const uploadedMessage = { ...nextMessage, attachment: uploadedAttachment };
        await saveMessage(user.id, uploadedMessage);
        if (friend?.userId) {
          await saveIncomingMessage(friend.userId, user, conversation, uploadedMessage).catch(() => undefined);
        }
      } catch (error) {
        const failedMessage = {
          ...nextMessage,
          text: `Dosya yüklenemedi: ${localAttachment.name}`,
          attachment: undefined,
        };
        setMessages((current) => current.map((message) => (message.id === nextMessage.id ? failedMessage : message)));
        await saveMessage(user.id, failedMessage);
        if (friend?.userId) {
          await saveIncomingMessage(friend.userId, user, conversation, failedMessage).catch(() => undefined);
        }
      }
    }
  };

  const updateRetention = (conversationId: string, retentionId: RetentionId) => {
    const retention = getRetention(retentionId);
    const changedAt = Date.now();

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, retentionId } : conversation,
      ),
    );
    if (usesFirebase(user)) {
      updateConversationRetention(user.id, conversationId, retentionId).catch(() => undefined);
    }

    setMessages((current) =>
      current.map((message) => {
        const nextMessage =
          message.conversationId === conversationId
            ? { ...message, expiresAt: changedAt + retention.milliseconds }
            : message;
        if (nextMessage !== message && usesFirebase(user)) {
          saveMessage(user.id, nextMessage).catch(() => undefined);
        }
        return nextMessage;
      }),
    );
  };

  const deleteSelectedMessages = async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      return;
    }

    const deletedAt = Date.now();
    setMessages((current) =>
      current.map((message) =>
        messageIds.includes(message.id)
          ? { ...message, deletedAt, deletedBy: user.id, hardDeleteAfter: deletedAt + 30 * 24 * 60 * 60 * 1000 }
          : message,
      ),
    );

    if (usesFirebase(user)) {
      await softDeleteMessages(user.id, messageIds);
    }
  };

  const updateProfilePhoto = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: 'image/*',
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    const fallbackUri = asset.uri;
    setUser((current) => (current ? { ...current, photoURL: fallbackUri } : current));

    if (usesFirebase(user)) {
      try {
        const photoURL = await uploadProfilePhoto(user.id, {
          name: asset.name,
          size: asset.size,
          mimeType: asset.mimeType,
          uri: asset.uri,
        });
        if (photoURL) {
          await updateUserProfile(user.id, { photoURL });
          setUser((current) => (current ? { ...current, photoURL } : current));
        }
      } catch {
        await updateUserProfile(user.id, { photoURL: fallbackUri }).catch(() => undefined);
      }
    }
  };

  const purgeDeleted = async () => {
    if (!user.isAdmin) {
      return 0;
    }

    const deletedIds = new Set(ledgerMessages.filter((message) => message.deletedAt).map((message) => message.id));
    setLedgerMessages((current) => current.filter((message) => !deletedIds.has(message.id)));

    try {
      return await purgeDeletedMessages();
    } catch {
      return deletedIds.size;
    }
  };

  const activatePremium = () => {
    setUser((current) => (current ? { ...current, isPremium: true } : current));
  };

  const updateAdminUser = async (userId: string, patch: Partial<User>) => {
    setAllUsers((current) => current.map((item) => (item.id === userId ? { ...item, ...patch } : item)));
    if (usesFirebase(user)) {
      await updateUserProfile(userId, patch).catch(() => undefined);
    }
  };

  const deleteAdminUser = async (targetUser: User) => {
    if (targetUser.protectedAccount || targetUser.email === adminCredentials.email) {
      return 'Admin hesabı silinemez.';
    }

    setAllUsers((current) => current.filter((item) => item.id !== targetUser.id));
    setFriends((current) => current.filter((friend) => friend.userId !== targetUser.id && friend.id !== targetUser.id));
    setConversations((current) => current.filter((conversation) => conversation.friendId !== targetUser.id));
    setMessages((current) =>
      current.filter((message) => message.senderId !== targetUser.id && message.receiverId !== targetUser.id),
    );
    setLedgerMessages((current) =>
      current.filter((message) => message.senderId !== targetUser.id && message.receiverId !== targetUser.id),
    );

    return `${targetUser.name} kullanıcı listesinden kaldırıldı.`;
  };

  const closeConversation = async () => {
    const conversationId = openConversationId;
    const conversation = conversations.find((item) => item.id === conversationId);

    if (conversation?.retentionId === 'instant') {
      const messageIds = messages
        .filter((message) => message.conversationId === conversation.id && !message.deletedAt)
        .map((message) => message.id);
      await deleteSelectedMessages(messageIds);
    }

    setOpenConversationId(null);
  };

  return (
    <>
      <StatusBar style="dark" />
      <AppShell
        activeTab={activeTab}
        conversations={accessibleConversations}
        friends={friends}
        messages={visibleMessages}
        now={now}
        onActivatePremium={activatePremium}
        onAddFriend={addFriend}
        onChangeRetention={updateRetention}
        onDeleteMessages={deleteSelectedMessages}
        onDeleteAdminUser={deleteAdminUser}
        onLogout={() => {
          if (usesFirebase(user)) {
            signOut(auth);
          } else {
            setUser(null);
          }
        }}
        onSelectConversation={(conversationId) => {
          setSelectedConversationId(conversationId);
          setOpenConversationId(conversationId);
          setActiveTab('chats');
        }}
        onSendFile={sendFile}
        onSendMessage={sendMessage}
        onSetTab={(tab) => {
          if (tab !== 'chats') {
            void closeConversation();
          }
          setActiveTab(tab);
        }}
        onPurgeDeleted={purgeDeleted}
        onUpdateAdminUser={updateAdminUser}
        onUpdateProfilePhoto={updateProfilePhoto}
        openConversationId={openConversationId}
        onCloseConversation={() => {
          void closeConversation();
        }}
        selectedConversationId={selectedConversationId}
        allUsers={allUsers}
        ledgerMessages={ledgerMessages}
        user={user}
      />
    </>
  );
}

function AuthScreen({
  onAuthenticate,
}: {
  onAuthenticate: (payload: {
    cleanEmail: string;
    mode: 'login' | 'register';
    name: string;
    password: string;
  }) => Promise<void>;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [panelOpen, setPanelOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [quote] = useState(() => quotes[Math.floor(Math.random() * quotes.length)]);

  const openPanel = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setPanelOpen(true);
    setNotice('');
  };

  const shareQuote = async () => {
    try {
      await Share.share({
        message: `${quote.text}\n[${quote.author}]`,
      });
    } catch {
      setNotice('Paylaşım menüsü açılamadı.');
    }
  };

  const submit = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);

    if (!validEmail) {
      setNotice('Geçerli bir e-posta adresi gir.');
      return;
    }

    if (password.length < 6) {
      setNotice('Şifre en az 6 karakter olmalı.');
      return;
    }

    if (mode === 'register' && name.trim().length < 2) {
      setNotice('Ad soyad alanını doldur.');
      return;
    }

    setSubmitting(true);
    setNotice('');

    try {
      await onAuthenticate({
        cleanEmail,
        mode,
        name: mode === 'register' ? name.trim() : cleanEmail.split('@')[0],
        password,
      });
    } catch (error) {
      setNotice(getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.authRoot}>
      <View style={styles.authBrand}>
        <View style={styles.brandRow}>
          <View style={styles.logoMark}>
            <Ionicons color="#ffffff" name="leaf-outline" size={28} />
          </View>
          <Text style={styles.brandTitle}>Özlü Sözler</Text>
        </View>
        <View style={styles.quoteCard}>
          <Ionicons color={palette.accent} name="sparkles-outline" size={22} />
          <Text style={styles.quoteText}>{quote.text}</Text>
          <Text style={styles.quoteAuthor}>[{quote.author}]</Text>
          <View style={styles.quoteActionRow}>
            <IconActionButton accessibilityLabel="Özlü sözü paylaş" icon="share-social-outline" onPress={shareQuote} />
            <IconActionButton
              accessibilityLabel="Üye ol"
              active={panelOpen && mode === 'register'}
              icon="person-add-outline"
              onPress={() => openPanel('register')}
            />
            <IconActionButton
              accessibilityLabel="Giriş yap"
              active={panelOpen && mode === 'login'}
              icon="key-outline"
              onPress={() => openPanel('login')}
            />
          </View>
        </View>
      </View>

      {panelOpen ? (
        <View style={styles.authCard}>
          {mode === 'register' ? (
            <LabeledInput
              autoCapitalize="words"
              icon="person-outline"
              label="Ad soyad"
              onChangeText={setName}
              placeholder="Adın"
              value={name}
            />
          ) : null}

          <LabeledInput
            autoCapitalize="none"
            icon="mail-outline"
            keyboardType="email-address"
            label="E-posta"
            onChangeText={setEmail}
            placeholder="ornek@mail.com"
            value={email}
          />

          <LabeledInput
            icon="lock-closed-outline"
            label="Şifre"
            onChangeText={setPassword}
            placeholder="En az 6 karakter"
            secureTextEntry
            value={password}
          />

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          <PrimaryButton
            icon="arrow-forward"
            label={submitting ? 'Bağlanıyor...' : mode === 'register' ? 'Hesap oluştur' : 'Giriş yap'}
            onPress={submit}
          />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function AppShell({
  activeTab,
  allUsers,
  conversations,
  friends,
  ledgerMessages,
  messages,
  now,
  onActivatePremium,
  onAddFriend,
  onChangeRetention,
  onDeleteMessages,
  onDeleteAdminUser,
  onLogout,
  onCloseConversation,
  onPurgeDeleted,
  onSelectConversation,
  onSendFile,
  onSendMessage,
  onSetTab,
  onUpdateProfilePhoto,
  onUpdateAdminUser,
  openConversationId,
  selectedConversationId,
  user,
}: {
  activeTab: TabId;
  allUsers: User[];
  conversations: Conversation[];
  friends: Friend[];
  ledgerMessages: Message[];
  messages: Message[];
  now: number;
  onActivatePremium: () => void;
  onAddFriend: (email: string, openChat?: boolean) => string;
  onChangeRetention: (conversationId: string, retentionId: RetentionId) => void;
  onDeleteMessages: (messageIds: string[]) => Promise<void>;
  onDeleteAdminUser: (targetUser: User) => Promise<string>;
  onLogout: () => void;
  onCloseConversation: () => void;
  onPurgeDeleted: () => Promise<number>;
  onSelectConversation: (conversationId: string) => void;
  onSendFile: (conversationId: string) => Promise<void>;
  onSendMessage: (conversationId: string, text: string) => void;
  onSetTab: (tab: TabId) => void;
  onUpdateAdminUser: (userId: string, patch: Partial<User>) => Promise<void>;
  onUpdateProfilePhoto: () => Promise<void>;
  openConversationId: string | null;
  selectedConversationId: string;
  user: User;
}) {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const activeConversationId = openConversationId ?? selectedConversationId;
  const selectedConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
      style={styles.root}
    >
      <View style={styles.topBar}>
        <View style={styles.userBlock}>
          <View style={styles.logoMarkSmall}>
            <Ionicons color="#ffffff" name="chatbubble-ellipses" size={20} />
          </View>
          <View style={styles.userText}>
            <Text numberOfLines={1} style={styles.appName}>
              Özlü Sözler
            </Text>
            <Text numberOfLines={1} style={styles.userEmail}>
              {user.email}
            </Text>
          </View>
          {user.isPremium ? (
            <View style={styles.ultraDot}>
              <Ionicons color="#ffffff" name="diamond" size={14} />
            </View>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" onPress={onLogout} style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}>
          <Ionicons color={palette.muted} name="log-out-outline" size={19} />
          {isWide ? <Text style={styles.logoutText}>Çıkış</Text> : null}
        </Pressable>
      </View>

      <View style={styles.content}>
        {activeTab === 'chats' ? (
          <ChatsView
            conversations={conversations}
            friends={friends}
            isWide={isWide}
            messages={messages}
            now={now}
            onChangeRetention={onChangeRetention}
            onCloseConversation={onCloseConversation}
            onSelectConversation={onSelectConversation}
            onSendFile={onSendFile}
            onSendMessage={onSendMessage}
            onDeleteMessages={onDeleteMessages}
            openConversationId={openConversationId}
            selectedConversation={selectedConversation}
            user={user}
          />
        ) : null}
        {activeTab === 'friends' ? (
          <FriendsView
            conversations={conversations}
            friends={friends}
            allUsers={allUsers}
            onAddFriend={onAddFriend}
            onSelectConversation={onSelectConversation}
          />
        ) : null}
        {activeTab === 'admin' ? (
          <AdminView
            allUsers={allUsers}
            messages={ledgerMessages}
            onDeleteUser={onDeleteAdminUser}
            onPurgeDeleted={onPurgeDeleted}
            onUpdateUser={onUpdateAdminUser}
          />
        ) : null}
        {activeTab === 'premium' ? <PremiumView onActivatePremium={onActivatePremium} user={user} /> : null}
        {activeTab === 'settings' ? <SettingsView onLogout={onLogout} onUpdateProfilePhoto={onUpdateProfilePhoto} user={user} /> : null}
      </View>

      <View style={styles.bottomTabs}>
        {tabs.filter((tab) => tab.id !== 'admin' || user.isAdmin).map((tab) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.id }}
            key={tab.id}
            onPress={() => onSetTab(tab.id)}
            style={({ pressed }) => [
              styles.bottomTabItem,
              activeTab === tab.id && styles.bottomTabItemActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons color={activeTab === tab.id ? palette.accent : palette.muted} name={tab.icon} size={22} />
            <Text style={[styles.bottomTabLabel, activeTab === tab.id && styles.bottomTabLabelActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </KeyboardAvoidingView>
  );
}

function ChatsView({
  conversations,
  friends,
  isWide,
  messages,
  now,
  onChangeRetention,
  onCloseConversation,
  onDeleteMessages,
  onSelectConversation,
  onSendFile,
  onSendMessage,
  openConversationId,
  selectedConversation,
  user,
}: {
  conversations: Conversation[];
  friends: Friend[];
  isWide: boolean;
  messages: Message[];
  now: number;
  onChangeRetention: (conversationId: string, retentionId: RetentionId) => void;
  onCloseConversation: () => void;
  onDeleteMessages: (messageIds: string[]) => Promise<void>;
  onSelectConversation: (conversationId: string) => void;
  onSendFile: (conversationId: string) => Promise<void>;
  onSendMessage: (conversationId: string, text: string) => void;
  openConversationId: string | null;
  selectedConversation?: Conversation;
  user: User;
}) {
  const showChat = Boolean(openConversationId && selectedConversation);
  const activeConversation = showChat ? selectedConversation : undefined;

  return (
    <View style={[styles.chatLayout, !isWide && styles.chatLayoutMobile]}>
      {!showChat ? (
        <ConversationList
          conversations={conversations}
          friends={friends}
          messages={messages}
          now={now}
          onSelectConversation={onSelectConversation}
          selectedConversationId={selectedConversation?.id ?? ''}
        />
      ) : null}
      {activeConversation ? (
        <ChatPanel
          conversation={activeConversation}
          friend={friends.find((friend) => friend.id === activeConversation.friendId)}
          messages={messages.filter((message) => message.conversationId === activeConversation.id)}
          now={now}
          onBack={onCloseConversation}
          onChangeRetention={onChangeRetention}
          onDeleteMessages={onDeleteMessages}
          onSendFile={onSendFile}
          onSendMessage={onSendMessage}
          user={user}
        />
      ) : null}
    </View>
  );
}

function ConversationList({
  conversations,
  friends,
  messages,
  now,
  onSelectConversation,
  selectedConversationId,
}: {
  conversations: Conversation[];
  friends: Friend[];
  messages: Message[];
  now: number;
  onSelectConversation: (conversationId: string) => void;
  selectedConversationId: string;
}) {
  return (
    <View style={styles.conversationList}>
      <View style={styles.sectionHeader}>
        <Text style={styles.screenTitle}>Sohbetler</Text>
        <Text style={styles.screenSubtitle}>Süre dolunca mesajlar otomatik silinir.</Text>
      </View>

      <ScrollView contentContainerStyle={styles.listStack} showsVerticalScrollIndicator={false}>
        {conversations.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons color={palette.accent} name="people-outline" size={34} />
            <Text style={styles.emptyTitle}>Henüz arkadaş sohbeti yok</Text>
            <Text style={styles.emptyText}>Arkadaşlar sekmesinden kişi ekleyince sohbet burada görünür.</Text>
          </View>
        ) : null}
        {conversations.map((conversation) => {
          const friend = friends.find((item) => item.id === conversation.friendId);
          const lastMessage = messages
            .filter((message) => message.conversationId === conversation.id)
            .sort((a, b) => b.createdAt - a.createdAt)[0];

          return (
            <Pressable
              accessibilityRole="button"
              key={conversation.id}
              onPress={() => onSelectConversation(conversation.id)}
              style={({ pressed }) => [
                styles.conversationRow,
                selectedConversationId === conversation.id && styles.conversationRowActive,
                pressed && styles.pressed,
              ]}
            >
              <Avatar color={friend?.avatarColor} label={friend?.name ?? '?'} premium={friend?.premium} photoURL={friend?.photoURL} />
              <View style={styles.rowMain}>
                <View style={styles.rowTop}>
                  <Text numberOfLines={1} style={styles.rowTitle}>
                    {friend?.name ?? 'Bilinmeyen'}
                  </Text>
                  <Text style={styles.rowMeta}>{getRetention(conversation.retentionId).shortLabel}</Text>
                </View>
                <Text numberOfLines={1} style={styles.rowMessage}>
                  {lastMessage?.attachment ? `Dosya: ${lastMessage.attachment.name}` : lastMessage?.text ?? 'Henüz mesaj yok'}
                </Text>
                {lastMessage ? (
                  <Text style={styles.expiryLine}>Silinmeye kalan: {formatRemaining(lastMessage.expiresAt, now)}</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ChatPanel({
  conversation,
  friend,
  messages,
  now,
  onBack,
  onChangeRetention,
  onDeleteMessages,
  onSendFile,
  onSendMessage,
  user,
}: {
  conversation: Conversation;
  friend?: Friend;
  messages: Message[];
  now: number;
  onBack: () => void;
  onChangeRetention: (conversationId: string, retentionId: RetentionId) => void;
  onDeleteMessages: (messageIds: string[]) => Promise<void>;
  onSendFile: (conversationId: string) => Promise<void>;
  onSendMessage: (conversationId: string, text: string) => void;
  user: User;
}) {
  const [draft, setDraft] = useState('');
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);

  const submit = () => {
    onSendMessage(conversation.id, draft);
    setDraft('');
  };

  const toggleMessage = (messageId: string) => {
    setSelectedMessageIds((current) =>
      current.includes(messageId) ? current.filter((id) => id !== messageId) : [...current, messageId],
    );
  };

  const deleteSelected = async () => {
    await onDeleteMessages(selectedMessageIds);
    setSelectedMessageIds([]);
  };

  return (
    <View style={styles.chatPanel}>
      <View style={styles.chatHeader}>
        <View style={styles.chatIdentity}>
          <Pressable accessibilityRole="button" onPress={onBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Ionicons color={palette.accent} name="chevron-back" size={22} />
          </Pressable>
          <Avatar color={friend?.avatarColor} label={friend?.name ?? '?'} premium={friend?.premium} photoURL={friend?.photoURL} />
          <View>
            <Text style={styles.chatTitle}>{friend?.name ?? 'Sohbet'}</Text>
            <Text style={styles.chatStatus}>{statusLabel(friend?.status)} · {friend?.email}</Text>
          </View>
        </View>
        <View style={styles.securityChip}>
          <Ionicons color={palette.accent} name="lock-closed-outline" size={16} />
          <Text style={styles.securityText}>Süreli</Text>
        </View>
      </View>

      <View style={styles.retentionBar}>
        {retentionOptions.map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option.id}
            onPress={() => onChangeRetention(conversation.id, option.id)}
            style={({ pressed }) => [
              styles.retentionButton,
              conversation.retentionId === option.id && styles.retentionButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.retentionText, conversation.retentionId === option.id && styles.retentionTextActive]}>
              {option.shortLabel}
            </Text>
          </Pressable>
        ))}
      </View>

      {selectedMessageIds.length > 0 ? (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionText}>{selectedMessageIds.length} mesaj seçildi</Text>
          <Pressable accessibilityRole="button" onPress={deleteSelected} style={({ pressed }) => [styles.deleteSelectedButton, pressed && styles.pressed]}>
            <Ionicons color="#ffffff" name="trash-outline" size={17} />
            <Text style={styles.deleteSelectedText}>Mesajı sil</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.messageStack} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.messageScroller}>
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons color={palette.accent} name="timer-outline" size={34} />
            <Text style={styles.emptyTitle}>Bu sohbette görünür mesaj yok</Text>
            <Text style={styles.emptyText}>Yeni mesajlar seçili süre sonunda otomatik kaldırılır.</Text>
          </View>
        ) : (
          messages
            .slice()
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((message) => {
              const mine = message.senderId === user.id;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={message.id}
                  onLongPress={() => toggleMessage(message.id)}
                  onPress={() => {
                    if (selectedMessageIds.length > 0) {
                      toggleMessage(message.id);
                    }
                  }}
                  style={[
                    styles.messageBubble,
                    mine ? styles.messageMine : styles.messageFriend,
                    selectedMessageIds.includes(message.id) && styles.messageSelected,
                  ]}
                >
                  {message.text ? <Text style={[styles.messageText, mine && styles.messageTextMine]}>{message.text}</Text> : null}
                  {message.attachment ? <AttachmentCard attachment={message.attachment} mine={mine} /> : null}
                  <Text style={[styles.messageMeta, mine && styles.messageMetaMine]}>
                    {new Date(message.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                    {conversation.retentionId === 'instant' ? 'Çıkınca silinir' : formatRemaining(message.expiresAt, now)}
                  </Text>
                </Pressable>
              );
            })
        )}
      </ScrollView>

      <View style={styles.composer}>
        <Pressable accessibilityRole="button" onPress={() => onSendFile(conversation.id)} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <Ionicons color={palette.accent} name="attach-outline" size={22} />
        </Pressable>
        <TextInput
          multiline
          onChangeText={setDraft}
          placeholder="Mesaj yaz..."
          placeholderTextColor="#98a2b3"
          style={styles.composerInput}
          value={draft}
        />
        <Pressable accessibilityRole="button" onPress={submit} style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}>
          <Ionicons color="#ffffff" name="send" size={19} />
        </Pressable>
      </View>
    </View>
  );
}

function FriendsView({
  allUsers,
  conversations,
  friends,
  onAddFriend,
  onSelectConversation,
}: {
  allUsers: User[];
  conversations: Conversation[];
  friends: Friend[];
  onAddFriend: (email: string, openChat?: boolean) => string;
  onSelectConversation: (conversationId: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [searchedEmail, setSearchedEmail] = useState('');

  const search = () => {
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!validEmail) {
      setNotice('Geçerli bir e-posta adresi gir.');
      return;
    }

    setSearchedEmail(email.trim().toLowerCase());
    setNotice('');
  };

  const searchResults = searchedEmail
    ? allUsers.filter((item) => item.email.toLowerCase().includes(searchedEmail)).slice(0, 5)
    : [];

  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <Text style={styles.screenTitle}>Arkadaş ekle</Text>
        <Text style={styles.screenSubtitle}>E-posta ile arkadaş bul, sohbeti hemen başlat.</Text>
      </View>

      <View style={styles.addFriendBox}>
        <LabeledInput
          autoCapitalize="none"
          icon="person-add-outline"
          keyboardType="email-address"
          label="E-posta"
          onChangeText={(value) => {
            setEmail(value);
            setSearchedEmail('');
          }}
          placeholder="kullanici@mail.com"
          value={email}
        />
        <PrimaryButton icon="search" label="Ara" onPress={search} />
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </View>

      {searchedEmail ? (
        <View style={styles.searchResults}>
          {searchResults.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons color={palette.accent} name="search-outline" size={34} />
              <Text style={styles.emptyTitle}>Kullanıcı bulunamadı</Text>
              <Text style={styles.emptyText}>Bu e-posta ile kayıtlı kullanıcı Firestore users listesinde görünmüyor.</Text>
            </View>
          ) : null}
          {searchResults.map((item) => (
              <View key={item.id} style={styles.searchRow}>
                <Avatar color={palette.blue} label={item.name} premium={item.isPremium} photoURL={item.photoURL} />
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.rowMessage}>{item.email}</Text>
                </View>
                <View style={styles.searchActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setNotice(onAddFriend(item.email, false));
                    }}
                    style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}
                  >
                    <Ionicons color={palette.accent} name="person-add-outline" size={17} />
                    <Text style={styles.smallActionText}>Arkadaşı ekle</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setNotice(onAddFriend(item.email, true));
                    }}
                    style={({ pressed }) => [styles.outlineAction, pressed && styles.pressed]}
                  >
                    <Ionicons color={palette.muted} name="chatbubble-outline" size={17} />
                    <Text style={styles.outlineActionText}>Mesaj gönder</Text>
                  </Pressable>
                </View>
              </View>
            ))}
        </View>
      ) : null}

      <View style={styles.friendList}>
        {friends.map((friend) => {
          const conversation = conversations.find((item) => item.friendId === friend.id);
          return (
            <View key={friend.id} style={styles.friendRow}>
              <View style={styles.friendCardTop}>
                <Avatar color={friend.avatarColor} label={friend.name} premium={friend.premium} photoURL={friend.photoURL} />
                <View style={styles.friendInfo}>
                  <Text style={styles.friendName}>{friend.name}</Text>
                  <Text style={styles.friendEmail}>{friend.email}</Text>
                </View>
              </View>
              <View style={styles.friendActions}>
                <Text style={styles.statusText}>{statusLabel(friend.status)}</Text>
                {conversation ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onSelectConversation(conversation.id)}
                    style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}
                  >
                    <Ionicons color={palette.accent} name="chatbubble-outline" size={17} />
                    <Text style={styles.smallActionText}>Yazış</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function AdminView({
  allUsers,
  messages,
  onDeleteUser,
  onPurgeDeleted,
  onUpdateUser,
}: {
  allUsers: User[];
  messages: Message[];
  onDeleteUser: (targetUser: User) => Promise<string>;
  onPurgeDeleted: () => Promise<number>;
  onUpdateUser: (userId: string, patch: Partial<User>) => Promise<void>;
}) {
  const [leftUserId, setLeftUserId] = useState(allUsers[0]?.id ?? adminUser.id);
  const [rightUserId, setRightUserId] = useState(allUsers[1]?.id ?? 'ece');
  const [adminAction, setAdminAction] = useState<'details' | 'edit' | 'history'>('details');
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [notice, setNotice] = useState('');

  const leftUser = allUsers.find((item) => item.id === leftUserId);
  const rightUser = allUsers.find((item) => item.id === rightUserId);
  const deletedMessageCount = messages.filter((message) => message.deletedAt).length;
  const activeMessageCount = messages.length - deletedMessageCount;
  const pairMessages = messages
    .filter((message) => {
      const participants = [message.senderId, message.receiverId].filter(Boolean);
      const participantEmails = [message.senderEmail, message.receiverEmail].filter(Boolean);
      return (
        (participants.includes(leftUserId) && participants.includes(rightUserId)) ||
        (leftUser?.email && rightUser?.email && participantEmails.includes(leftUser.email) && participantEmails.includes(rightUser.email))
      );
    })
    .sort((a, b) => a.createdAt - b.createdAt);

  useEffect(() => {
    if (!leftUser && allUsers[0]) {
      setLeftUserId(allUsers[0].id);
      return;
    }

    setEditName(leftUser?.name ?? '');
    setEditEmail(leftUser?.email ?? '');
  }, [allUsers, leftUser]);

  const purge = async () => {
    const count = await onPurgeDeleted();
    setNotice(`${count} silinmiş mesaj kalıcı olarak temizlendi.`);
  };

  const saveUser = async () => {
    if (!leftUser) {
      return;
    }

    await onUpdateUser(leftUser.id, {
      email: editEmail.trim().toLowerCase(),
      name: editName.trim() || leftUser.name,
    });
    setNotice(`${leftUser.name} güncellendi.`);
    setAdminAction('details');
  };

  const deleteUser = async () => {
    if (!leftUser) {
      return;
    }

    const message = await onDeleteUser(leftUser);
    setNotice(message);
    setAdminAction('details');
  };

  return (
    <View style={styles.adminLayout}>
      <View style={styles.adminUsersPane}>
        <View style={styles.sectionHeader}>
          <Text style={styles.screenTitle}>Admin</Text>
          <Text style={styles.screenSubtitle}>Kullanıcı istatistikleri, yönetim ve A {'->'} B mesaj geçmişi.</Text>
        </View>
        <View style={styles.adminStats}>
          <View style={styles.adminStatCard}>
            <Text style={styles.adminStatValue}>{allUsers.length}</Text>
            <Text style={styles.adminStatLabel}>Toplam kullanıcı</Text>
          </View>
          <View style={styles.adminStatCard}>
            <Text style={styles.adminStatValue}>{activeMessageCount}</Text>
            <Text style={styles.adminStatLabel}>Aktif mesaj</Text>
          </View>
          <View style={styles.adminStatCard}>
            <Text style={styles.adminStatValue}>{deletedMessageCount}</Text>
            <Text style={styles.adminStatLabel}>Silinmiş mesaj</Text>
          </View>
        </View>
        <Text style={styles.paneTitle}>Kullanıcıları yönet</Text>
        <ScrollView contentContainerStyle={styles.listStack} showsVerticalScrollIndicator={false}>
          {allUsers.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              onPress={() => {
                setLeftUserId(item.id);
                setAdminAction('details');
                setNotice('');
              }}
              style={[styles.conversationRow, leftUserId === item.id && styles.conversationRowActive]}
            >
              <Avatar color={palette.blue} label={item.name} premium={item.isPremium} photoURL={item.photoURL} />
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowMessage}>{item.email}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.adminMessagesPane}>
        <View style={styles.adminPairHeader}>
          <Text style={styles.chatTitle}>{leftUser?.name ?? 'Kullanıcı seç'}</Text>
          <Pressable accessibilityRole="button" onPress={purge} style={({ pressed }) => [styles.deleteSelectedButton, pressed && styles.pressed]}>
            <Ionicons color="#ffffff" name="trash-bin-outline" size={17} />
            <Text style={styles.deleteSelectedText}>Silinmiş mesajları sil</Text>
          </Pressable>
        </View>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {leftUser ? (
          <View style={styles.adminUserCard}>
            <Avatar color={palette.blue} label={leftUser.name} premium={leftUser.isPremium} photoURL={leftUser.photoURL} />
            <View style={styles.rowMain}>
              <Text style={styles.friendName}>{leftUser.name}</Text>
              <Text style={styles.friendEmail}>{leftUser.email}</Text>
              <Text style={styles.rowMessage}>{leftUser.protectedAccount ? 'Silinemez admin hesabı' : 'Standart kullanıcı'}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.adminActionGrid}>
          <Pressable accessibilityRole="button" onPress={() => setAdminAction('edit')} style={({ pressed }) => [styles.adminActionButton, pressed && styles.pressed]}>
            <Ionicons color={palette.accent} name="create-outline" size={18} />
            <Text style={styles.smallActionText}>Düzenle</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setAdminAction('history')} style={({ pressed }) => [styles.adminActionButton, pressed && styles.pressed]}>
            <Ionicons color={palette.accent} name="chatbubbles-outline" size={18} />
            <Text style={styles.smallActionText}>Mesaj geçmişi</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(leftUser?.protectedAccount)}
            onPress={deleteUser}
            style={({ pressed }) => [
              styles.adminDeleteButton,
              leftUser?.protectedAccount && styles.disabledAction,
              pressed && !leftUser?.protectedAccount && styles.pressed,
            ]}
          >
            <Ionicons color="#b42318" name="trash-outline" size={18} />
            <Text style={styles.adminDeleteText}>Kullanıcı sil</Text>
          </Pressable>
        </View>

        {adminAction === 'edit' ? (
          <View style={styles.adminEditPanel}>
            <LabeledInput icon="person-outline" label="Ad soyad" onChangeText={setEditName} placeholder="Kullanıcı adı" value={editName} />
            <LabeledInput
              autoCapitalize="none"
              icon="mail-outline"
              keyboardType="email-address"
              label="E-posta"
              onChangeText={setEditEmail}
              placeholder="mail@example.com"
              value={editEmail}
            />
            <PrimaryButton icon="save-outline" label="Kaydet" onPress={saveUser} />
          </View>
        ) : null}

        {adminAction === 'history' ? (
          <>
            <Text style={styles.paneTitle}>{leftUser?.name ?? 'A kullanıcısı'} {'->'} {rightUser?.name ?? 'B kullanıcısı'}</Text>
            <ScrollView horizontal contentContainerStyle={styles.adminUserRail} showsHorizontalScrollIndicator={false}>
              {allUsers
                .filter((item) => item.id !== leftUserId)
                .map((item) => (
                  <Pressable
                    accessibilityRole="button"
                    key={item.id}
                    onPress={() => setRightUserId(item.id)}
                    style={[styles.retentionButton, rightUserId === item.id && styles.retentionButtonActive]}
                  >
                    <Text style={[styles.retentionText, rightUserId === item.id && styles.retentionTextActive]}>{item.name}</Text>
                  </Pressable>
                ))}
            </ScrollView>

            <ScrollView contentContainerStyle={styles.messageStack} showsVerticalScrollIndicator={false}>
              {pairMessages.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons color={palette.accent} name="file-tray-outline" size={34} />
                  <Text style={styles.emptyTitle}>Bu iki kullanıcı arasında kayıt yok</Text>
                  <Text style={styles.emptyText}>Yeni mesajlar global admin geçmişine işlenir.</Text>
                </View>
              ) : (
                pairMessages.map((message) => (
                  <View key={message.id} style={[styles.adminMessageRow, message.deletedAt ? styles.deletedMessageRow : null]}>
                    <Text style={[styles.messageText, message.deletedAt ? styles.deletedMessageText : null]}>
                      {message.text || message.attachment?.name || 'Dosya mesajı'}
                    </Text>
                    <Text style={styles.rowMessage}>
                      {message.senderEmail || message.senderId} {'->'} {message.receiverEmail || message.receiverId || '?'} ·{' '}
                      {new Date(message.createdAt).toLocaleString('tr-TR')}
                      {message.deletedAt ? ` · silindi: ${new Date(message.deletedAt).toLocaleString('tr-TR')}` : ''}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </>
        ) : null}
      </View>
    </View>
  );
}

function PremiumView({ onActivatePremium, user }: { onActivatePremium: () => void; user: User }) {
  const features = [
    ['Kaybolan sohbet', '1 dakika ile süresiz arasında arkadaş bazlı saklama.'],
    ['Büyük dosya paylaşımı', 'Web ve Android uyumlu belge gönderimi.'],
    ['Öncelikli gizlilik', 'Kilitli oturum, süre rozeti ve temiz geçmiş akışı.'],
    ['Ultra profil', 'Sohbetlerde premium elmas işareti.'],
  ];

  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.premiumHero}>
        <View style={styles.premiumIcon}>
          <Ionicons color="#ffffff" name="diamond" size={30} />
        </View>
        <Text style={styles.premiumTitle}>Ultra Premium</Text>
        <Text style={styles.premiumText}>Daha uzun saklama seçenekleri, gelişmiş dosya akışı ve ayrıcalıklı profil.</Text>
        <PrimaryButton
          icon={user.isPremium ? 'checkmark' : 'diamond'}
          label={user.isPremium ? 'Ultra aktif' : 'Ultra Premium yap'}
          onPress={onActivatePremium}
        />
      </View>

      <View style={styles.featureList}>
        {features.map(([title, body]) => (
          <View key={title} style={styles.featureRow}>
            <View style={styles.featureIcon}>
              <Ionicons color={palette.accent} name="checkmark-circle-outline" size={22} />
            </View>
            <View style={styles.featureCopy}>
              <Text style={styles.featureTitle}>{title}</Text>
              <Text style={styles.featureBody}>{body}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function SettingsView({ onLogout, onUpdateProfilePhoto, user }: { onLogout: () => void; onUpdateProfilePhoto: () => Promise<void>; user: User }) {
  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <Text style={styles.screenTitle}>Ayarlar</Text>
        <Text style={styles.screenSubtitle}>Hesap, gizlilik ve oturum tercihleri.</Text>
      </View>

      <View style={styles.settingsPanel}>
        <View style={styles.profilePreview}>
          <Avatar color={palette.accent} label={user.name} premium={user.isPremium} photoURL={user.photoURL} />
          <View style={styles.rowMain}>
            <Text style={styles.friendName}>{user.name}</Text>
            <Text style={styles.friendEmail}>{user.email}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onUpdateProfilePhoto} style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}>
            <Ionicons color={palette.accent} name="camera-outline" size={17} />
            <Text style={styles.smallActionText}>Fotoğraf</Text>
          </Pressable>
        </View>
        <SettingsRow icon="mail-outline" label="E-posta" value={user.email} />
        <SettingsRow icon="diamond-outline" label="Plan" value={user.isPremium ? 'Ultra Premium' : 'Standart'} />
        <SettingsRow icon="shield-checkmark-outline" label="Yetki" value={user.isAdmin ? 'Silinemez admin' : 'Kullanıcı'} />
        <SettingsRow icon="timer-outline" label="Varsayılan süre" value={user.isPremium ? 'Süresiz' : '10 dakika'} />
        <Pressable accessibilityRole="button" onPress={onLogout} style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}>
          <Ionicons color="#b42318" name="log-out-outline" size={19} />
          <Text style={styles.dangerText}>Çıkış yap</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function LabeledInput({
  icon,
  label,
  ...props
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputShell}>
        <Ionicons color={palette.muted} name={icon} size={19} />
        <TextInput placeholderTextColor="#98a2b3" style={styles.input} {...props} />
      </View>
    </View>
  );
}

function PrimaryButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
      <Text style={styles.primaryButtonText}>{label}</Text>
      <Ionicons color="#ffffff" name={icon} size={19} />
    </Pressable>
  );
}

function IconActionButton({
  active,
  accessibilityLabel,
  icon,
  onPress,
}: {
  active?: boolean;
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quoteActionButton, active && styles.quoteActionButtonActive, pressed && styles.pressed]}
    >
      <Ionicons color={active ? '#ffffff' : palette.accent} name={icon} size={22} />
    </Pressable>
  );
}

function Avatar({ color, label, premium, photoURL }: { color?: string; label: string; premium?: boolean; photoURL?: string }) {
  return (
    <View style={[styles.avatar, { backgroundColor: color ?? palette.accent }]}>
      {photoURL ? <Image source={{ uri: photoURL }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{label.slice(0, 1).toUpperCase()}</Text>}
      {premium ? (
        <View style={styles.avatarBadge}>
          <Ionicons color="#ffffff" name="diamond" size={10} />
        </View>
      ) : null}
    </View>
  );
}

function AttachmentCard({ attachment, mine }: { attachment: Message['attachment']; mine: boolean }) {
  if (!attachment) {
    return null;
  }

  const size = attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : 'Dosya';

  return (
    <Pressable
      accessibilityRole={attachment.uri ? 'link' : 'text'}
      disabled={!attachment.uri}
      onPress={() => {
        if (attachment.uri) {
          Linking.openURL(attachment.uri).catch(() => undefined);
        }
      }}
      style={({ pressed }) => [styles.attachmentCard, mine && styles.attachmentCardMine, pressed && styles.pressed]}
    >
      <Ionicons color={mine ? '#ffffff' : palette.accent} name="document-attach-outline" size={22} />
      <View style={styles.attachmentTextWrap}>
        <Text numberOfLines={1} style={[styles.attachmentName, mine && styles.messageTextMine]}>
          {attachment.name}
        </Text>
        <Text style={[styles.attachmentSize, mine && styles.messageMetaMine]}>{size}</Text>
      </View>
    </Pressable>
  );
}

function SettingsRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.settingsRow}>
      <View style={styles.settingsLabelWrap}>
        <Ionicons color={palette.accent} name={icon} size={20} />
        <Text style={styles.settingsLabel}>{label}</Text>
      </View>
      <Text style={styles.settingsValue}>{value}</Text>
    </View>
  );
}

function statusLabel(status?: Friend['status']) {
  if (status === 'online') {
    return 'Çevrimiçi';
  }

  if (status === 'busy') {
    return 'Meşgul';
  }

  return 'Çevrimdışı';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.soft,
    flexDirection: 'column',
  },
  authRoot: {
    alignItems: 'center',
    backgroundColor: '#eef7f4',
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  authBrand: {
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
    maxWidth: 520,
    width: '100%',
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  logoMark: {
    alignItems: 'center',
    backgroundColor: palette.accent,
    borderRadius: 16,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  brandTitle: {
    color: palette.ink,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
  },
  quoteCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#c7e8df',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 18,
    width: '100%',
  },
  quoteText: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 26,
    textAlign: 'center',
  },
  quoteAuthor: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  quoteActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginTop: 6,
  },
  quoteActionButton: {
    alignItems: 'center',
    backgroundColor: '#ecfdf7',
    borderColor: '#b7e4d7',
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  quoteActionButtonActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  authCard: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 460,
    padding: 22,
    width: '100%',
    ...Platform.select({
      web: { boxShadow: '0 18px 60px rgba(23, 32, 51, 0.10)' },
      default: {
        elevation: 4,
        shadowColor: '#172033',
        shadowOffset: { height: 10, width: 0 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
      },
    }),
  },
  modeSwitch: {
    backgroundColor: '#eef2f6',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 18,
    padding: 5,
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    paddingVertical: 11,
  },
  segmentButtonActive: {
    backgroundColor: palette.panel,
  },
  segmentText: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: palette.ink,
  },
  inputGroup: {
    gap: 7,
    marginBottom: 14,
  },
  inputLabel: {
    color: palette.dark,
    fontSize: 13,
    fontWeight: '700',
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  input: {
    color: palette.ink,
    flex: 1,
    fontSize: 15,
    minHeight: 46,
    paddingVertical: 0,
  },
  notice: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: palette.accent,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  demoButton: {
    alignItems: 'center',
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 48,
  },
  demoButtonText: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
  topBar: {
    alignItems: 'center',
    backgroundColor: palette.panel,
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sidebar: {
    backgroundColor: palette.panel,
    borderRightColor: palette.border,
    borderRightWidth: 1,
    justifyContent: 'space-between',
    padding: 18,
    width: 270,
  },
  mobileHeader: {
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    borderRightWidth: 0,
    gap: 12,
    height: 'auto',
    justifyContent: 'flex-start',
    paddingBottom: 12,
    position: 'absolute',
    width: '100%',
    zIndex: 5,
  },
  userBlock: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  logoMarkSmall: {
    alignItems: 'center',
    backgroundColor: palette.accent,
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  userText: {
    flex: 1,
  },
  appName: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  userEmail: {
    color: palette.muted,
    fontSize: 12,
    marginTop: 2,
  },
  ultraDot: {
    alignItems: 'center',
    backgroundColor: palette.coral,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  nav: {
    gap: 8,
  },
  navMobile: {
    flexDirection: 'row',
    gap: 6,
  },
  navItem: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 13,
  },
  navItemMobile: {
    flex: 1,
    gap: 5,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 4,
  },
  navItemActive: {
    backgroundColor: palette.accent,
  },
  navLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  navLabelActive: {
    color: '#ffffff',
  },
  logoutButton: {
    alignItems: 'center',
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  logoutText: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    padding: 14,
  },
  bottomTabs: {
    alignItems: 'center',
    backgroundColor: palette.panel,
    borderTopColor: palette.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: Platform.OS === 'ios' ? 18 : 8,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  bottomTabItem: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    gap: 3,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bottomTabItemActive: {
    backgroundColor: palette.accentSoft,
  },
  bottomTabLabel: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: '900',
  },
  bottomTabLabelActive: {
    color: palette.accent,
  },
  chatLayout: {
    flex: 1,
    flexDirection: 'column',
  },
  chatLayoutMobile: {
    flexDirection: 'column',
  },
  conversationList: {
    flex: 1,
    width: '100%',
  },
  sectionHeader: {
    marginBottom: 16,
  },
  screenTitle: {
    color: palette.ink,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0,
  },
  screenSubtitle: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  listStack: {
    gap: 10,
    paddingBottom: 18,
  },
  conversationRow: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  conversationRowActive: {
    borderColor: palette.accent,
    borderWidth: 2,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    position: 'relative',
    width: 48,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '900',
  },
  avatarImage: {
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  avatarBadge: {
    alignItems: 'center',
    backgroundColor: palette.coral,
    borderColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    bottom: -4,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    width: 18,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  rowTitle: {
    color: palette.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: '900',
  },
  rowMeta: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '800',
  },
  rowMessage: {
    color: palette.muted,
    fontSize: 13,
    marginTop: 5,
  },
  expiryLine: {
    color: '#8a94a6',
    fontSize: 12,
    marginTop: 6,
  },
  chatPanel: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: palette.accentSoft,
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  chatHeader: {
    alignItems: 'center',
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    padding: 16,
  },
  chatIdentity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minWidth: 0,
  },
  chatTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  chatStatus: {
    color: palette.muted,
    fontSize: 12,
    marginTop: 3,
  },
  securityChip: {
    alignItems: 'center',
    backgroundColor: palette.accentSoft,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  securityText: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '900',
  },
  retentionBar: {
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
  },
  retentionButton: {
    backgroundColor: '#f2f4f7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  retentionButtonActive: {
    backgroundColor: palette.accent,
  },
  retentionText: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '900',
  },
  retentionTextActive: {
    color: '#ffffff',
  },
  messageStack: {
    gap: 10,
    padding: 16,
    paddingBottom: 24,
  },
  messageScroller: {
    flex: 1,
  },
  messageBubble: {
    borderRadius: 8,
    maxWidth: '82%',
    padding: 12,
  },
  messageSelected: {
    borderColor: palette.warning,
    borderWidth: 2,
  },
  messageMine: {
    alignSelf: 'flex-end',
    backgroundColor: palette.accent,
  },
  messageFriend: {
    alignSelf: 'flex-start',
    backgroundColor: '#f0f3f8',
  },
  messageText: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 21,
  },
  messageTextMine: {
    color: '#ffffff',
  },
  messageMeta: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
  },
  messageMetaMine: {
    color: '#d9fffb',
  },
  attachmentCard: {
    alignItems: 'center',
    borderColor: 'rgba(17, 94, 89, 0.22)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  attachmentCardMine: {
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  attachmentTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  attachmentName: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  attachmentSize: {
    color: palette.muted,
    fontSize: 12,
    marginTop: 2,
  },
  composer: {
    alignItems: 'flex-end',
    borderTopColor: palette.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingBottom: Platform.OS === 'android' ? 18 : 12,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  selectionBar: {
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderBottomColor: '#fed7aa',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectionText: {
    color: '#9a3412',
    fontSize: 13,
    fontWeight: '900',
  },
  deleteSelectedButton: {
    alignItems: 'center',
    backgroundColor: '#b42318',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  deleteSelectedText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: palette.accentSoft,
    borderRadius: 8,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  composerInput: {
    backgroundColor: '#f7f9fc',
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    color: palette.ink,
    flex: 1,
    fontSize: 15,
    maxHeight: 110,
    minHeight: 46,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: palette.accent,
    borderRadius: 8,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  emptyState: {
    alignItems: 'center',
    gap: 7,
    padding: 34,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptyText: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  page: {
    gap: 16,
    paddingBottom: 32,
    paddingTop: 4,
  },
  addFriendBox: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 620,
    padding: 16,
  },
  searchResults: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    maxWidth: 720,
    padding: 10,
  },
  searchRow: {
    alignItems: 'center',
    borderBottomColor: '#edf0f5',
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 10,
  },
  searchActions: {
    flexDirection: 'row',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  friendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  friendList: {
    gap: 10,
    maxWidth: 820,
  },
  friendRow: {
    alignItems: 'center',
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 14,
  },
  friendCard: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 280,
    flexGrow: 1,
    gap: 16,
    padding: 14,
  },
  friendCardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  friendInfo: {
    flex: 1,
    minWidth: 0,
  },
  friendName: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  friendEmail: {
    color: palette.muted,
    fontSize: 13,
    marginTop: 3,
  },
  friendActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  smallAction: {
    alignItems: 'center',
    backgroundColor: palette.accentSoft,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  smallActionText: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  outlineAction: {
    alignItems: 'center',
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  outlineActionText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: '900',
  },
  premiumHero: {
    backgroundColor: palette.dark,
    borderRadius: 8,
    gap: 14,
    maxWidth: 720,
    padding: 24,
  },
  premiumIcon: {
    alignItems: 'center',
    backgroundColor: palette.coral,
    borderRadius: 8,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  premiumTitle: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 0,
  },
  premiumText: {
    color: '#d6deea',
    fontSize: 16,
    lineHeight: 23,
    maxWidth: 540,
  },
  featureList: {
    gap: 10,
    maxWidth: 720,
  },
  featureRow: {
    alignItems: 'flex-start',
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  featureIcon: {
    marginTop: 2,
  },
  featureCopy: {
    flex: 1,
  },
  featureTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: '900',
  },
  featureBody: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  settingsPanel: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 680,
    padding: 8,
  },
  profilePreview: {
    alignItems: 'center',
    borderBottomColor: '#edf0f5',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  settingsRow: {
    alignItems: 'center',
    borderBottomColor: '#edf0f5',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
  },
  settingsLabelWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  settingsLabel: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  settingsValue: {
    color: palette.muted,
    flexShrink: 1,
    fontSize: 14,
    textAlign: 'right',
  },
  dangerButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    padding: 14,
  },
  dangerText: {
    color: '#b42318',
    fontSize: 14,
    fontWeight: '900',
  },
  adminLayout: {
    flex: 1,
    flexDirection: 'row',
    gap: 18,
  },
  adminUsersPane: {
    maxWidth: 380,
    minWidth: 280,
    width: '34%',
  },
  adminStats: {
    gap: 8,
    marginBottom: 12,
  },
  adminStatCard: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  adminStatValue: {
    color: palette.accent,
    fontSize: 24,
    fontWeight: '900',
  },
  adminStatLabel: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  paneTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 10,
  },
  adminMessagesPane: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 14,
  },
  adminPairHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  adminUserRail: {
    gap: 8,
    paddingBottom: 12,
  },
  adminUserCard: {
    alignItems: 'center',
    backgroundColor: '#f7f9fc',
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    padding: 14,
  },
  adminActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  adminActionButton: {
    alignItems: 'center',
    backgroundColor: palette.accentSoft,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  adminDeleteButton: {
    alignItems: 'center',
    backgroundColor: '#fff1f2',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  adminDeleteText: {
    color: '#b42318',
    fontSize: 13,
    fontWeight: '900',
  },
  disabledAction: {
    opacity: 0.45,
  },
  adminEditPanel: {
    backgroundColor: '#f7f9fc',
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    maxWidth: 560,
    padding: 14,
  },
  adminMessageRow: {
    backgroundColor: '#f7f9fc',
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  deletedMessageRow: {
    backgroundColor: '#fff1f2',
    borderColor: '#fda4af',
  },
  deletedMessageText: {
    color: '#9f1239',
    textDecorationLine: 'line-through',
  },
});
