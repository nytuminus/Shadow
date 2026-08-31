import Phaser from 'phaser';
import type { Direction, PlayerState } from '@shadow/shared';
import type { OfficeSocket } from '../net/socket.js';
import type { CallManager } from '../call/CallManager.js';
import type { VideoOverlay } from '../call/VideoOverlay.js';

const TILE_SIZE = 32;
const MAP_KEY = 'map';
const TILESET_IMAGE_KEY = 'placeholder-tileset';
const PLAYER_KEY = 'player-placeholder';
const SPEED = 160;
const MOVE_SEND_MS = 100; // ~10Hz — mesmo ritmo do tick do servidor

/**
 * Mapa + avatar local com WASD e colisão, sincronizado por Socket.io: manda
 * a posição própria em intervalos fixos e desenha os outros jogadores a
 * partir do snapshot do servidor (com um tween curto pra não "teleportar"
 * de um snapshot pro outro). Proximidade liga/desliga a chamada por peer
 * (CallManager) e o tile de vídeo de cada um segue o avatar na tela.
 */
export class OfficeScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private socket?: OfficeSocket;
  private callManager?: CallManager;
  private videoOverlay?: VideoOverlay;
  private remotePlayers = new Map<string, Phaser.GameObjects.Sprite>();
  private currentDirection: Direction = 'down';
  private moveSendTimer = 0;

  constructor() {
    super('office');
  }

  preload(): void {
    // Caminho relativo à base do Vite (/office/ em produção) — um caminho
    // começando com "/" ignoraria a base e buscaria na raiz do site, dando
    // 404 silencioso e deixando a tela preta (foi exatamente o que aconteceu).
    this.load.tilemapTiledJSON(MAP_KEY, `${import.meta.env.BASE_URL}maps/map.json`);
  }

  create(): void {
    this.createPlaceholderTileset();
    this.createPlayerTexture();

    const map = this.make.tilemap({ key: MAP_KEY });
    const tileset = map.addTilesetImage('placeholder', TILESET_IMAGE_KEY, TILE_SIZE, TILE_SIZE)!;
    map.createLayer('chao', tileset, 0, 0);
    const paredes = map.createLayer('paredes', tileset, 0, 0)!;
    paredes.setCollisionByExclusion([-1]); // tudo que não é vazio colide (só a parede, aqui)

    this.player = this.physics.add.sprite(map.widthInPixels / 2, map.heightInPixels / 2, PLAYER_KEY);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, paredes);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true);
    this.cameras.main.setZoom(1.5);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd;

    this.socket = this.registry.get('socket') as OfficeSocket | undefined;
    this.callManager = this.registry.get('callManager') as CallManager | undefined;
    this.videoOverlay = this.registry.get('videoOverlay') as VideoOverlay | undefined;

    if (this.socket) {
      this.socket.on('players:snapshot', (players) => this.onSnapshot(players));
      this.socket.on('player:left', ({ socketId }) => this.removeRemote(socketId));
      this.socket.on('proximity:enter', ({ peerId }) => { void this.callManager?.connectTo(peerId); });
      this.socket.on('proximity:leave', ({ peerId }) => {
        this.callManager?.disconnectFrom(peerId);
        this.videoOverlay?.remove(peerId);
      });
    }
    if (this.callManager) {
      this.callManager.onPeerStream = (peerId, stream) => this.videoOverlay?.setStream(peerId, stream);
      this.callManager.onPeerRemoved = (peerId) => this.videoOverlay?.remove(peerId);
    }
  }

  update(time: number, delta: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;

    const dir = new Phaser.Math.Vector2(
      (right ? 1 : 0) - (left ? 1 : 0),
      (down ? 1 : 0) - (up ? 1 : 0)
    );
    const moving = dir.length() > 0;
    if (moving) {
      dir.normalize();
      this.currentDirection =
        Math.abs(dir.x) > Math.abs(dir.y) ? (dir.x > 0 ? 'right' : 'left') : dir.y > 0 ? 'down' : 'up';
      dir.scale(SPEED);
    }
    body.setVelocity(dir.x, dir.y);

    this.moveSendTimer += delta;
    if (this.socket && this.moveSendTimer >= MOVE_SEND_MS) {
      this.moveSendTimer = 0;
      this.socket.emit('player:move', {
        x: this.player.x,
        y: this.player.y,
        direction: this.currentDirection,
        moving,
      });
    }

    this.updateVideoTilePositions();
  }

  /**
   * Projeta a posição de cada jogador remoto (mundo) pra tela, usando a
   * transformação da câmera — feito aqui, no update() do próprio Phaser, pra
   * nunca ficar um frame atrasado em relação ao desenho do canvas.
   *
   * Simplificação de MVP: assume canvas 1:1 com o CSS (Scale Manager em modo
   * padrão, sem responsivo). Se um dia o jogo passar a escalar com a janela,
   * isso precisa entrar na conta (canvas.getBoundingClientRect() + escala).
   */
  private updateVideoTilePositions(): void {
    if (!this.videoOverlay) return;
    const cam = this.cameras.main;
    for (const [peerId, sprite] of this.remotePlayers) {
      const screenX = (sprite.x - cam.scrollX) * cam.zoom;
      const screenY = (sprite.y - cam.scrollY) * cam.zoom;
      this.videoOverlay.setPosition(peerId, screenX, screenY);
    }
  }

  private onSnapshot(players: PlayerState[]): void {
    const selfId = this.socket?.id;
    const seen = new Set<string>();
    for (const p of players) {
      if (p.socketId === selfId) continue;
      seen.add(p.socketId);
      let sprite = this.remotePlayers.get(p.socketId);
      if (!sprite) {
        sprite = this.add.sprite(p.x, p.y, PLAYER_KEY).setTint(0x4ade80);
        this.remotePlayers.set(p.socketId, sprite);
      }
      this.tweens.add({ targets: sprite, x: p.x, y: p.y, duration: MOVE_SEND_MS, ease: 'Linear' });
    }
    // Quem não veio nesse snapshot saiu do mapa (desconectou ou trocou de sala).
    for (const [id, sprite] of this.remotePlayers) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.remotePlayers.delete(id);
        this.videoOverlay?.remove(id);
      }
    }
  }

  private removeRemote(socketId: string): void {
    this.remotePlayers.get(socketId)?.destroy();
    this.remotePlayers.delete(socketId);
    this.videoOverlay?.remove(socketId);
  }

  private createPlaceholderTileset(): void {
    const g = this.add.graphics();
    // índice 0 (GID 1): chão
    g.fillStyle(0x1b1330, 1);
    g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    g.lineStyle(1, 0x2a1f4a, 1);
    g.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
    // índice 1 (GID 2): parede
    g.fillStyle(0x4a3d6b, 1);
    g.fillRect(TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
    g.lineStyle(1, 0x6b5a94, 1);
    g.strokeRect(TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
    g.generateTexture(TILESET_IMAGE_KEY, TILE_SIZE * 2, TILE_SIZE);
    g.destroy();
  }

  private createPlayerTexture(): void {
    const g = this.add.graphics();
    const r = TILE_SIZE / 2 - 2;
    g.fillStyle(0x8b7bff, 1);
    g.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, r);
    g.lineStyle(2, 0xffffff, 1);
    g.strokeCircle(TILE_SIZE / 2, TILE_SIZE / 2, r);
    g.generateTexture(PLAYER_KEY, TILE_SIZE, TILE_SIZE);
    g.destroy();
  }
}
