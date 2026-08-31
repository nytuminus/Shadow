// Camada de vídeo por cima do canvas do Phaser — DOM puro, sem React.
// Posição é atualizada A CADA FRAME pelo próprio update() do Phaser (não por
// um requestAnimationFrame separado do React, que ficaria um frame atrasado
// e tremeria) e escrita direto em style.transform, nunca via state — re-
// renderizar N tiles a 60fps pelo React seria caro à toa.

export class VideoOverlay {
  private container: HTMLDivElement;
  private tiles = new Map<string, HTMLVideoElement>();

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:absolute; inset:0; overflow:hidden; pointer-events:none;';
    parent.appendChild(this.container);
  }

  setStream(peerId: string, stream: MediaStream): void {
    let video = this.tiles.get(peerId);
    if (!video) {
      video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = false;
      video.style.cssText =
        'position:absolute; left:0; top:0; width:96px; height:72px; border-radius:8px; ' +
        'border:2px solid #8b7bff; object-fit:cover; background:#0a0410; will-change:transform;';
      this.container.appendChild(video);
      this.tiles.set(peerId, video);
    }
    if (video.srcObject !== stream) video.srcObject = stream;
  }

  remove(peerId: string): void {
    const video = this.tiles.get(peerId);
    if (!video) return;
    video.srcObject = null;
    video.remove();
    this.tiles.delete(peerId);
  }

  /**
   * Posiciona o tile em coordenadas de TELA (já projetadas pela câmera do
   * Phaser). Sem tile pra esse peer (sem chamada ativa com ele), não faz nada.
   */
  setPosition(peerId: string, screenX: number, screenY: number): void {
    const video = this.tiles.get(peerId);
    if (!video) return;
    video.style.transform = `translate(${screenX - 48}px, ${screenY - 88}px)`; // centralizado, acima do avatar
  }

  destroy(): void {
    for (const video of this.tiles.values()) {
      video.srcObject = null;
      video.remove();
    }
    this.tiles.clear();
    this.container.remove();
  }
}
