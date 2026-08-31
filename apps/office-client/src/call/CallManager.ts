// Gerenciador de chamada WebRTC em malha (mesh), portado de web/src/lib/call.ts
// (Salas antigas) pro escritório 2D. Mesma mecânica — "perfect negotiation",
// vaga de vídeo única reaproveitada por câmera/tela, detecção de fala — só
// troca o gatilho: em vez de "entrar num canal", o Phaser chama connectTo()/
// disconnectFrom() quando o servidor avisa que dois avatares ficaram perto
// (proximity:enter/leave) ou se afastaram.

import type { OfficeSocket } from '../net/socket.js';

interface PeerConn {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteStream: MediaStream;
  videoSender: RTCRtpSender | null;
}

export interface CallState {
  muted: boolean;
  video: boolean;
  screen: boolean;
}

type StreamCb = (peerId: string, stream: MediaStream) => void;
type RemoveCb = (peerId: string) => void;
type LocalCb = (stream: MediaStream | null, state: CallState) => void;
type StateCb = (state: CallState) => void;

export class CallManager {
  private peers = new Map<string, PeerConn>();
  private localStream: MediaStream | null = null; // microfone
  private micRequest: Promise<MediaStream | null> | null = null;
  private camTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  state: CallState = { muted: false, video: false, screen: false };

  onPeerStream: StreamCb | null = null;
  onPeerRemoved: RemoveCb | null = null;
  onLocalStream: LocalCb | null = null;
  onState: StateCb | null = null;
  onSpeaking: ((ids: Set<string>) => void) | null = null;

  // Detecção de quem está falando (glow nos tiles).
  private audioCtx: AudioContext | null = null;
  private analysers = new Map<string, { node: AnalyserNode; data: Uint8Array<ArrayBuffer> }>();
  private speaking = new Set<string>();
  private speakSince = new Map<string, number>();
  private rafId = 0;

  constructor(
    private socket: OfficeSocket,
    private iceServers: RTCIceServer[]
  ) {
    this.socket.on('webrtc:signal', ({ from, data }) => this.onSignal(from, data));
  }

  private get selfId(): string {
    return this.socket.id || '';
  }

  /** Pede o microfone uma única vez (na primeira aproximação) e reaproveita depois. */
  private async ensureMic(): Promise<MediaStream | null> {
    if (this.localStream) return this.localStream;
    if (!this.micRequest) {
      this.micRequest = navigator.mediaDevices
        .getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        })
        .then((stream) => {
          this.localStream = stream;
          if (this.state.muted) stream.getAudioTracks().forEach((t) => (t.enabled = false));
          this.addAnalyser('self', stream);
          this.emitLocal();
          return stream;
        })
        .catch(() => null); // sem microfone: entra só ouvindo
    }
    return this.micRequest;
  }

  private currentVideoTrack(): MediaStreamTrack | null {
    return this.screenTrack || this.camTrack || null;
  }

  // ---------- Proximidade: liga/desliga por peer ----------
  async connectTo(peerId: string): Promise<void> {
    if (this.peers.has(peerId)) return;
    await this.ensureMic();
    this.createPeer(peerId);
  }

  disconnectFrom(peerId: string): void {
    this.removePeer(peerId);
  }

  /** Encerra tudo — usado ao sair do escritório (fechar a página/deslogar). */
  disconnectAll(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.teardownAudio();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.camTrack?.stop();
    this.screenTrack?.stop();
    this.localStream = null;
    this.micRequest = null;
    this.camTrack = null;
    this.screenTrack = null;
  }

  // ---------- Malha de pares ----------
  private createPeer(peerId: string): PeerConn {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry: PeerConn = {
      pc,
      polite: this.selfId < peerId, // exatamente um dos lados é "educado"
      makingOffer: false,
      ignoreOffer: false,
      remoteStream: new MediaStream(),
      videoSender: null,
    };

    if (this.localStream) {
      for (const t of this.localStream.getAudioTracks()) pc.addTrack(t, this.localStream);
    }
    // Vaga de vídeo fixa (câmera OU tela) — evita renegociar ao ligar/desligar.
    const vt = pc.addTransceiver('video', { direction: 'sendrecv' });
    entry.videoSender = vt.sender;
    const cur = this.currentVideoTrack();
    if (cur) vt.sender.replaceTrack(cur);

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(peerId, { description: pc.localDescription });
      } catch (err) {
        console.error('[call] negotiation', err);
      } finally {
        entry.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peerId, { candidate });
    };
    pc.ontrack = (ev) => {
      entry.remoteStream.addTrack(ev.track);
      this.onPeerStream?.(peerId, entry.remoteStream);
      if (ev.track.kind === 'audio') this.addAnalyser(peerId, entry.remoteStream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        try { pc.restartIce(); } catch { /* */ }
      }
    };

    this.peers.set(peerId, entry);
    return entry;
  }

  private removePeer(peerId: string): void {
    const e = this.peers.get(peerId);
    if (!e) return;
    try { e.pc.close(); } catch { /* */ }
    this.peers.delete(peerId);
    this.analysers.delete(peerId);
    this.onPeerRemoved?.(peerId);
  }

  // ---------- Detecção de fala ----------
  private addAnalyser(key: string, stream: MediaStream): void {
    if (this.analysers.has(key)) return;
    if (stream.getAudioTracks().length === 0) return;
    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
        this.startLevelLoop();
      }
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
      const src = this.audioCtx.createMediaStreamSource(stream);
      const node = this.audioCtx.createAnalyser();
      node.fftSize = 512;
      node.smoothingTimeConstant = 0.82;
      src.connect(node);
      this.analysers.set(key, { node, data: new Uint8Array(new ArrayBuffer(node.frequencyBinCount)) });
    } catch {
      /* navegador sem WebAudio: sem glow, sem drama */
    }
  }

  private startLevelLoop(): void {
    const loop = () => {
      let changed = false;
      const now = performance.now();
      for (const [key, a] of this.analysers) {
        a.node.getByteTimeDomainData(a.data);
        let sum = 0;
        for (let i = 0; i < a.data.length; i++) {
          const v = (a.data[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / a.data.length);
        const id = key === 'self' ? this.selfId || 'self' : key;
        const talking = rms > 0.05 && !(key === 'self' && this.state.muted);
        if (talking) {
          this.speakSince.set(id, now);
          if (!this.speaking.has(id)) {
            this.speaking.add(id);
            changed = true;
          }
        } else if (this.speaking.has(id) && now - (this.speakSince.get(id) || 0) > 300) {
          this.speaking.delete(id);
          changed = true;
        }
      }
      if (changed) this.onSpeaking?.(new Set(this.speaking));
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private teardownAudio(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.analysers.clear();
    this.speaking.clear();
    this.speakSince.clear();
    try { this.audioCtx?.close(); } catch { /* */ }
    this.audioCtx = null;
    this.onSpeaking?.(new Set());
  }

  private signal(to: string, data: unknown): void {
    this.socket.emit('webrtc:signal', { to, data });
  }

  private async onSignal(from: string, data: any): Promise<void> {
    const entry = this.createPeer(from);
    const { pc } = entry;
    try {
      if (data.description) {
        const collision =
          data.description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && collision;
        if (entry.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!entry.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('[call] signal', err);
    }
  }

  // ---------- Controles ----------
  toggleMute(): void {
    this.state.muted = !this.state.muted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !this.state.muted));
    this.onState?.(this.state);
  }

  async setCamera(on: boolean): Promise<void> {
    if (on) {
      if (this.screenTrack) await this.setScreen(false); // vaga única de vídeo
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      this.camTrack = s.getVideoTracks()[0]!;
      this.camTrack.onended = () => { void this.setCamera(false); };
      this.state.video = true;
    } else {
      this.camTrack?.stop();
      this.camTrack = null;
      this.state.video = false;
    }
    this.applyVideoToAll();
    this.emitLocal();
    this.onState?.(this.state);
  }

  async setScreen(on: boolean): Promise<void> {
    if (on) {
      if (this.camTrack) await this.setCamera(false);
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      this.screenTrack = s.getVideoTracks()[0]!;
      this.screenTrack.onended = () => { void this.setScreen(false); };
      this.state.screen = true;
    } else {
      this.screenTrack?.stop();
      this.screenTrack = null;
      this.state.screen = false;
    }
    this.applyVideoToAll();
    this.emitLocal();
    this.onState?.(this.state);
  }

  private applyVideoToAll(): void {
    const track = this.currentVideoTrack();
    for (const e of this.peers.values()) {
      try { e.videoSender?.replaceTrack(track); } catch { /* */ }
    }
  }

  private emitLocal(): void {
    const track = this.currentVideoTrack();
    const stream = track ? new MediaStream([track]) : null;
    this.onLocalStream?.(stream, this.state);
  }
}
