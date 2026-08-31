export type Direction = 'up' | 'down' | 'left' | 'right';

/** Estado de um jogador conectado no escritório 2D — mantido pelo servidor. */
export interface PlayerState {
  socketId: string;
  employeeId: string;
  username: string;
  name: string;
  mapId: string;
  x: number;
  y: number;
  direction: Direction;
  moving: boolean;
}
