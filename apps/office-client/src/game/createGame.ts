import Phaser from 'phaser';
import type { EmployeeInfo } from '@shadow/shared';
import { OfficeScene } from './OfficeScene.js';
import type { OfficeSocket } from '../net/socket.js';

export interface GameOptions {
  socket: OfficeSocket;
  employee: EmployeeInfo;
}

export function createGame(parent: HTMLElement, options: GameOptions): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 960,
    height: 640,
    backgroundColor: '#0a0410',
    pixelArt: true,
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [OfficeScene],
  });
  // Registry sobrevive à troca de cena e existe antes do create() da 1ª cena rodar.
  game.registry.set('socket', options.socket);
  game.registry.set('employee', options.employee);
  return game;
}
