export type RetentionId = '1m' | '10m' | '1h' | '1d' | '1w';

export type TabId = 'chats' | 'friends' | 'premium' | 'settings' | 'admin';

export type User = {
  id: string;
  name: string;
  email: string;
  isPremium: boolean;
  isAdmin?: boolean;
  protectedAccount?: boolean;
  authProvider?: 'firebase' | 'local-admin';
  photoURL?: string;
};

export type Friend = {
  id: string;
  name: string;
  email: string;
  status: 'online' | 'busy' | 'offline';
  avatarColor: string;
  premium: boolean;
  userId?: string;
  photoURL?: string;
};

export type Attachment = {
  name: string;
  size?: number;
  mimeType?: string;
  uri?: string;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId?: string;
  senderEmail?: string;
  receiverEmail?: string;
  senderName?: string;
  receiverName?: string;
  text?: string;
  attachment?: Attachment;
  createdAt: number;
  expiresAt: number;
  deletedAt?: number;
  deletedBy?: string;
  hardDeleteAfter?: number;
};

export type Conversation = {
  id: string;
  friendId: string;
  retentionId: RetentionId;
};
