// Tipos compartilhados da área Salas.

export type ChannelType = 'text' | 'voice';

export interface Channel {
  id: string;
  roomId: string;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: string;
}

export interface Room {
  id: string;
  name: string;
  icon: string;
  color: string;
  createdAt: string;
  channels: Channel[];
}

export interface ChatMessage {
  id: string;
  channelId: string;
  userId: string | null;
  userName: string | null;
  text: string;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
  color?: string;
}

export interface PeerState {
  muted?: boolean;
  video?: boolean;
  screen?: boolean;
  deaf?: boolean;
}

export interface PeerInfo {
  id: string;
  user: User;
  state: PeerState;
}

/** Presença: canalId -> lista de participantes na chamada. */
export type Presence = Record<string, PeerInfo[]>;
