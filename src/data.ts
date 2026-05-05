import type { Conversation, Friend, Message, User } from './types';
import { getRetention } from './retention';

const now = Date.now();

export const demoUser: User = {
  id: 'me',
  name: 'Demo Kullanıcı',
  email: 'demo@messenger.plus',
  isPremium: true,
};

export const directory: Friend[] = [
  {
    id: 'ece',
    name: 'Ece Yılmaz',
    email: 'ece@example.com',
    status: 'online',
    avatarColor: '#0f9f8f',
    premium: true,
  },
  {
    id: 'baran',
    name: 'Baran Kaya',
    email: 'baran@example.com',
    status: 'busy',
    avatarColor: '#4067f9',
    premium: false,
  },
  {
    id: 'zeynep',
    name: 'Zeynep Arslan',
    email: 'zeynep@example.com',
    status: 'offline',
    avatarColor: '#d85b46',
    premium: true,
  },
  {
    id: 'mert',
    name: 'Mert Demir',
    email: 'mert@example.com',
    status: 'online',
    avatarColor: '#8a5cf6',
    premium: false,
  },
];

export const initialFriends = directory.slice(0, 3);

export const initialConversations: Conversation[] = [
  { id: 'chat-ece', friendId: 'ece', retentionId: '10m' },
  { id: 'chat-baran', friendId: 'baran', retentionId: '1h' },
  { id: 'chat-zeynep', friendId: 'zeynep', retentionId: '1d' },
];

function expiry(retentionId: Conversation['retentionId'], createdAt: number) {
  return createdAt + getRetention(retentionId).milliseconds;
}

export const initialMessages: Message[] = [
  {
    id: 'm1',
    conversationId: 'chat-ece',
    senderId: 'ece',
    text: 'Tasarım dosyasını gönderebilir misin?',
    createdAt: now - 4 * 60 * 1000,
    expiresAt: expiry('10m', now - 4 * 60 * 1000),
  },
  {
    id: 'm2',
    conversationId: 'chat-ece',
    senderId: 'me',
    text: 'Evet, son halini birazdan ekliyorum.',
    createdAt: now - 2 * 60 * 1000,
    expiresAt: expiry('10m', now - 2 * 60 * 1000),
  },
  {
    id: 'm3',
    conversationId: 'chat-baran',
    senderId: 'baran',
    text: 'Bugünkü toplantı notlarını burada tutalım.',
    createdAt: now - 18 * 60 * 1000,
    expiresAt: expiry('1h', now - 18 * 60 * 1000),
  },
  {
    id: 'm4',
    conversationId: 'chat-zeynep',
    senderId: 'zeynep',
    text: 'Ultra Premium için kaybolan sohbet süresini arkadaş bazlı seçmek iyi olmuş.',
    createdAt: now - 2 * 60 * 60 * 1000,
    expiresAt: expiry('1d', now - 2 * 60 * 60 * 1000),
  },
];
