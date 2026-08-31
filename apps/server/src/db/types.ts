// Formas de dados e a interface que TODO adaptador de banco (JSON, MySQL) tem
// que implementar — trocar um pelo outro (server/db/index.js) não pode mudar
// nada além disso.

export interface DbUser {
  id: string;
  name: string;
  avatar: string;
  color: string;
  updatedAt: string;
}

export interface DbRoom {
  id: string;
  name: string;
  icon: string;
  color: string;
  createdAt: string;
}

export type ChannelType = 'text' | 'voice';

export interface DbChannel {
  id: string;
  roomId: string;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: string;
}

export interface DbMessage {
  id: string;
  channelId: string;
  userId: string | null;
  userName: string | null;
  text: string;
  createdAt: string;
}

export interface RoomPatch {
  name?: string;
  icon?: string;
  color?: string;
}

export interface DbStore {
  kind: 'json' | 'mysql';
  init(): Promise<DbStore>;

  upsertUser(user: { id?: string; name: string; avatar?: string; color?: string }): Promise<DbUser>;
  getUser(id: string): Promise<DbUser | null>;

  createRoom(room: { name: string; icon?: string; color?: string }): Promise<DbRoom>;
  listRooms(): Promise<DbRoom[]>;
  getRoom(id: string): Promise<DbRoom | null>;
  updateRoom(id: string, patch: RoomPatch): Promise<DbRoom | null>;
  deleteRoom(id: string): Promise<boolean>;

  createChannel(roomId: string, channel: { name: string; type?: ChannelType }): Promise<DbChannel>;
  listChannels(roomId: string): Promise<DbChannel[]>;
  getChannel(id: string): Promise<DbChannel | null>;
  deleteChannel(id: string): Promise<boolean>;

  addMessage(
    channelId: string,
    message: { userId?: string | null; userName?: string | null; text: string }
  ): Promise<DbMessage>;
  listMessages(channelId: string, limit?: number): Promise<DbMessage[]>;
}
