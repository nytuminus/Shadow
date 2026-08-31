import Phaser from 'phaser';

const TILE_SIZE = 32;
const MAP_KEY = 'map';
const TILESET_IMAGE_KEY = 'placeholder-tileset';
const PLAYER_KEY = 'player-placeholder';
const SPEED = 160;

/**
 * Mapa placeholder + avatar local com WASD e colisão — ainda sem rede
 * (isso entra na próxima etapa, junto com o Socket.io).
 *
 * O tileset é gerado na hora (dois quadrados desenhados por código, viram
 * uma textura) em vez de carregado de um PNG: dá pra trocar por uma arte de
 * verdade depois sem mexer no resto do código, só apontando pro arquivo.
 */
export class OfficeScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

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
  }

  update(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;

    const dir = new Phaser.Math.Vector2(
      (right ? 1 : 0) - (left ? 1 : 0),
      (down ? 1 : 0) - (up ? 1 : 0)
    );
    if (dir.length() > 0) dir.normalize().scale(SPEED);
    body.setVelocity(dir.x, dir.y);
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
