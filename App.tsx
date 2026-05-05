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
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  pruneExpiredMessages,
  saveConversation,
  saveFriend,
  saveMessage,
  subscribeConversations,
  subscribeFriends,
  subscribeMessages,
  updateConversationRetention,
  uploadAttachment,
  upsertUserProfile,
} from './src/chatStore';
import { demoUser, directory, initialConversations, initialFriends, initialMessages } from './src/data';
import { auth } from './src/firebase';
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
  { id: 'chats', label: 'Sohbetler', icon: 'chatbubbles-outline' },
  { id: 'friends', label: 'Arkadaşlar', icon: 'people-outline' },
  { id: 'premium', label: 'Ultra', icon: 'diamond-outline' },
  { id: 'settings', label: 'Ayarlar', icon: 'shield-checkmark-outline' },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [friends, setFriends] = useState<Friend[]>(initialFriends);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [activeTab, setActiveTab] = useState<TabId>('chats');
  const [selectedConversationId, setSelectedConversationId] = useState(initialConversations[0].id);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
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
    if (!user) {
      return undefined;
    }

    const unsubscribers = [
      subscribeFriends(user.id, setFriends),
      subscribeConversations(user.id, (items) => {
        setConversations(items);
        if (items.length > 0 && !items.some((item) => item.id === selectedConversationId)) {
          setSelectedConversationId(items[0].id);
        }
      }),
      subscribeMessages(user.id, setMessages),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [selectedConversationId, user]);

  useEffect(() => {
    const timer = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      setMessages((current) => current.filter((message) => message.expiresAt > tick));
      if (user) {
        pruneExpiredMessages(user.id, tick).catch(() => undefined);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [user]);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.expiresAt > now),
    [messages, now],
  );

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
            <Ionicons color="#ffffff" name="chatbubble-ellipses" size={30} />
          </View>
          <Text style={styles.brandTitle}>Messenger+</Text>
          <Text style={styles.authTitle}>Firebase oturumu hazırlanıyor</Text>
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

  const addFriend = (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    const existing = friends.find((friend) => friend.email.toLowerCase() === cleanEmail);

    if (existing) {
      setSelectedConversationId(`chat-${existing.id}`);
      setActiveTab('chats');
      return 'Bu kişi zaten arkadaş listende.';
    }

    const fromDirectory = directory.find((friend) => friend.email.toLowerCase() === cleanEmail);
    const newFriend: Friend =
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
      retentionId: user.isPremium ? '1d' : '10m',
    };

    setFriends((current) => [...current, newFriend]);
    setConversations((current) => [...current, newConversation]);
    saveFriend(user.id, newFriend).catch(() => undefined);
    saveConversation(user.id, newConversation).catch(() => undefined);
    setSelectedConversationId(newConversation.id);
    setActiveTab('chats');
    return `${newFriend.name} arkadaş olarak eklendi.`;
  };

  const sendMessage = (conversationId: string, text: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation || !text.trim()) {
      return;
    }

    const createdAt = Date.now();
    const retention = getRetention(conversation.retentionId);

    const nextMessage: Message = {
      id: `msg-${createdAt}`,
      conversationId,
      senderId: user.id,
      text: text.trim(),
      createdAt,
      expiresAt: createdAt + retention.milliseconds,
    };

    setMessages((current) => [...current, nextMessage]);
    saveMessage(user.id, nextMessage).catch(() => undefined);
  };

  const sendFile = async (conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
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
      attachment: localAttachment,
      createdAt,
      expiresAt: createdAt + retention.milliseconds,
    };

    setMessages((current) => [...current, nextMessage]);

    try {
      const uploadedAttachment = await uploadAttachment(user.id, conversationId, localAttachment);
      await saveMessage(user.id, { ...nextMessage, attachment: uploadedAttachment });
    } catch {
      await saveMessage(user.id, nextMessage);
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
    updateConversationRetention(user.id, conversationId, retentionId).catch(() => undefined);

    setMessages((current) =>
      current.map((message) => {
        const nextMessage =
          message.conversationId === conversationId
            ? { ...message, expiresAt: changedAt + retention.milliseconds }
            : message;
        if (nextMessage !== message) {
          saveMessage(user.id, nextMessage).catch(() => undefined);
        }
        return nextMessage;
      }),
    );
  };

  const activatePremium = () => {
    setUser((current) => (current ? { ...current, isPremium: true } : current));
  };

  return (
    <>
      <StatusBar style="dark" />
      <AppShell
        activeTab={activeTab}
        conversations={conversations}
        friends={friends}
        messages={visibleMessages}
        now={now}
        onActivatePremium={activatePremium}
        onAddFriend={addFriend}
        onChangeRetention={updateRetention}
        onLogout={() => signOut(auth)}
        onSelectConversation={(conversationId) => {
          setSelectedConversationId(conversationId);
          setActiveTab('chats');
        }}
        onSendFile={sendFile}
        onSendMessage={sendMessage}
        onSetTab={setActiveTab}
        selectedConversationId={selectedConversationId}
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
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      const message = error instanceof Error ? error.message : 'Firebase oturumu açılamadı.';
      setNotice(message.replace('Firebase: ', ''));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.authRoot}>
      <View style={styles.authBrand}>
        <View style={styles.logoMark}>
          <Ionicons color="#ffffff" name="chatbubble-ellipses" size={30} />
        </View>
        <Text style={styles.brandTitle}>Messenger+</Text>
        <Text style={styles.authTitle}>Ultra güvenli, süreli mesajlaşma</Text>
      </View>

      <View style={styles.authCard}>
        <View style={styles.modeSwitch}>
          <SegmentButton active={mode === 'register'} label="Üye ol" onPress={() => setMode('register')} />
          <SegmentButton active={mode === 'login'} label="Giriş yap" onPress={() => setMode('login')} />
        </View>

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
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setMode('login');
            setEmail(demoUser.email);
            setPassword('Messenger123');
            setNotice('Demo için Firebase Auth üzerinde demo@messenger.plus / Messenger123 hesabı gerekir.');
          }}
          style={({ pressed }) => [styles.demoButton, pressed && styles.pressed]}
        >
          <Ionicons color={palette.accent} name="flash-outline" size={18} />
          <Text style={styles.demoButtonText}>Demo Ultra hesaba gir</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function AppShell({
  activeTab,
  conversations,
  friends,
  messages,
  now,
  onActivatePremium,
  onAddFriend,
  onChangeRetention,
  onLogout,
  onSelectConversation,
  onSendFile,
  onSendMessage,
  onSetTab,
  selectedConversationId,
  user,
}: {
  activeTab: TabId;
  conversations: Conversation[];
  friends: Friend[];
  messages: Message[];
  now: number;
  onActivatePremium: () => void;
  onAddFriend: (email: string) => string;
  onChangeRetention: (conversationId: string, retentionId: RetentionId) => void;
  onLogout: () => void;
  onSelectConversation: (conversationId: string) => void;
  onSendFile: (conversationId: string) => Promise<void>;
  onSendMessage: (conversationId: string, text: string) => void;
  onSetTab: (tab: TabId) => void;
  selectedConversationId: string;
  user: User;
}) {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) ?? conversations[0];

  return (
    <View style={styles.root}>
      <View style={[styles.sidebar, !isWide && styles.mobileHeader]}>
        <View style={styles.userBlock}>
          <View style={styles.logoMarkSmall}>
            <Ionicons color="#ffffff" name="chatbubble-ellipses" size={20} />
          </View>
          <View style={styles.userText}>
            <Text numberOfLines={1} style={styles.appName}>
              Messenger+
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

        <View style={[styles.nav, !isWide && styles.navMobile]}>
          {tabs.map((tab) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.id }}
              key={tab.id}
              onPress={() => onSetTab(tab.id)}
              style={({ pressed }) => [
                styles.navItem,
                activeTab === tab.id && styles.navItemActive,
                !isWide && styles.navItemMobile,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons color={activeTab === tab.id ? '#ffffff' : palette.muted} name={tab.icon} size={20} />
              <Text style={[styles.navLabel, activeTab === tab.id && styles.navLabelActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>

        {isWide ? (
          <Pressable accessibilityRole="button" onPress={onLogout} style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}>
            <Ionicons color={palette.muted} name="log-out-outline" size={19} />
            <Text style={styles.logoutText}>Çıkış</Text>
          </Pressable>
        ) : null}
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
            onSelectConversation={onSelectConversation}
            onSendFile={onSendFile}
            onSendMessage={onSendMessage}
            selectedConversation={selectedConversation}
            user={user}
          />
        ) : null}
        {activeTab === 'friends' ? (
          <FriendsView
            conversations={conversations}
            friends={friends}
            onAddFriend={onAddFriend}
            onSelectConversation={onSelectConversation}
          />
        ) : null}
        {activeTab === 'premium' ? <PremiumView onActivatePremium={onActivatePremium} user={user} /> : null}
        {activeTab === 'settings' ? <SettingsView onLogout={onLogout} user={user} /> : null}
      </View>
    </View>
  );
}

function ChatsView({
  conversations,
  friends,
  isWide,
  messages,
  now,
  onChangeRetention,
  onSelectConversation,
  onSendFile,
  onSendMessage,
  selectedConversation,
  user,
}: {
  conversations: Conversation[];
  friends: Friend[];
  isWide: boolean;
  messages: Message[];
  now: number;
  onChangeRetention: (conversationId: string, retentionId: RetentionId) => void;
  onSelectConversation: (conversationId: string) => void;
  onSendFile: (conversationId: string) => Promise<void>;
  onSendMessage: (conversationId: string, text: string) => void;
  selectedConversation: Conversation;
  user: User;
}) {
  return (
    <View style={[styles.chatLayout, !isWide && styles.chatLayoutMobile]}>
      <ConversationList
        conversations={conversations}
        friends={friends}
        messages={messages}
        now={now}
        onSelectConversation={onSelectConversation}
        selectedConversationId={selectedConversation.id}
      />
      <ChatPanel
        conversation={selectedConversation}
        friend={friends.find((friend) => friend.id === selectedConversation.friendId)}
        messages={messages.filter((message) => message.conversationId === selectedConversation.id)}
        now={now}
        onChangeRetention={onChangeRetention}
        onSendFile={onSendFile}
        onSendMessage={onSendMessage}
        user={user}
      />
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
              <Avatar color={friend?.avatarColor} label={friend?.name ?? '?'} premium={friend?.premium} />
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
  onChangeRetention,
  onSendFile,
  onSendMessage,
  user,
}: {
  conversation: Conversation;
  friend?: Friend;
  messages: Message[];
  now: number;
  onChangeRetention: (conversationId: string, retentionId: RetentionId) => void;
  onSendFile: (conversationId: string) => Promise<void>;
  onSendMessage: (conversationId: string, text: string) => void;
  user: User;
}) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    onSendMessage(conversation.id, draft);
    setDraft('');
  };

  return (
    <View style={styles.chatPanel}>
      <View style={styles.chatHeader}>
        <View style={styles.chatIdentity}>
          <Avatar color={friend?.avatarColor} label={friend?.name ?? '?'} premium={friend?.premium} />
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

      <ScrollView contentContainerStyle={styles.messageStack} showsVerticalScrollIndicator={false}>
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
                <View key={message.id} style={[styles.messageBubble, mine ? styles.messageMine : styles.messageFriend]}>
                  {message.text ? <Text style={[styles.messageText, mine && styles.messageTextMine]}>{message.text}</Text> : null}
                  {message.attachment ? <AttachmentCard attachment={message.attachment} mine={mine} /> : null}
                  <Text style={[styles.messageMeta, mine && styles.messageMetaMine]}>
                    {new Date(message.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · {formatRemaining(message.expiresAt, now)}
                  </Text>
                </View>
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
  conversations,
  friends,
  onAddFriend,
  onSelectConversation,
}: {
  conversations: Conversation[];
  friends: Friend[];
  onAddFriend: (email: string) => string;
  onSelectConversation: (conversationId: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');

  const submit = () => {
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!validEmail) {
      setNotice('Geçerli bir e-posta adresi gir.');
      return;
    }

    setNotice(onAddFriend(email));
    setEmail('');
  };

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
          label="Arkadaş e-postası"
          onChangeText={setEmail}
          placeholder="ece@example.com"
          value={email}
        />
        <PrimaryButton icon="person-add" label="Arkadaş ekle" onPress={submit} />
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </View>

      <View style={styles.friendGrid}>
        {friends.map((friend) => {
          const conversation = conversations.find((item) => item.friendId === friend.id);
          return (
            <View key={friend.id} style={styles.friendCard}>
              <View style={styles.friendCardTop}>
                <Avatar color={friend.avatarColor} label={friend.name} premium={friend.premium} />
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

function PremiumView({ onActivatePremium, user }: { onActivatePremium: () => void; user: User }) {
  const features = [
    ['Kaybolan sohbet', '1 dakika ile 1 hafta arasında arkadaş bazlı saklama.'],
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

function SettingsView({ onLogout, user }: { onLogout: () => void; user: User }) {
  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <Text style={styles.screenTitle}>Ayarlar</Text>
        <Text style={styles.screenSubtitle}>Hesap, gizlilik ve oturum tercihleri.</Text>
      </View>

      <View style={styles.settingsPanel}>
        <SettingsRow icon="mail-outline" label="E-posta" value={user.email} />
        <SettingsRow icon="diamond-outline" label="Plan" value={user.isPremium ? 'Ultra Premium' : 'Standart'} />
        <SettingsRow icon="timer-outline" label="Varsayılan süre" value={user.isPremium ? '1 gün' : '10 dakika'} />
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

function SegmentButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.segmentButton, active && styles.segmentButtonActive]}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Avatar({ color, label, premium }: { color?: string; label: string; premium?: boolean }) {
  return (
    <View style={[styles.avatar, { backgroundColor: color ?? palette.accent }]}>
      <Text style={styles.avatarText}>{label.slice(0, 1).toUpperCase()}</Text>
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
    <View style={[styles.attachmentCard, mine && styles.attachmentCardMine]}>
      <Ionicons color={mine ? '#ffffff' : palette.accent} name="document-attach-outline" size={22} />
      <View style={styles.attachmentTextWrap}>
        <Text numberOfLines={1} style={[styles.attachmentName, mine && styles.messageTextMine]}>
          {attachment.name}
        </Text>
        <Text style={[styles.attachmentSize, mine && styles.messageMetaMine]}>{size}</Text>
      </View>
    </View>
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
    flexDirection: 'row',
  },
  authRoot: {
    alignItems: 'center',
    backgroundColor: palette.soft,
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  authBrand: {
    alignItems: 'center',
    marginBottom: 26,
  },
  logoMark: {
    alignItems: 'center',
    backgroundColor: palette.accent,
    borderRadius: 20,
    height: 64,
    justifyContent: 'center',
    marginBottom: 14,
    width: 64,
  },
  brandTitle: {
    color: palette.ink,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0,
  },
  authTitle: {
    color: palette.muted,
    fontSize: 16,
    marginTop: 6,
    textAlign: 'center',
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
    padding: 20,
  },
  chatLayout: {
    flex: 1,
    flexDirection: 'row',
    gap: 18,
  },
  chatLayoutMobile: {
    flexDirection: 'column',
    paddingTop: 114,
  },
  conversationList: {
    maxWidth: 390,
    minWidth: 300,
    width: '32%',
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
  },
  messageBubble: {
    borderRadius: 8,
    maxWidth: '82%',
    padding: 12,
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
    padding: 12,
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
  friendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
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
});
