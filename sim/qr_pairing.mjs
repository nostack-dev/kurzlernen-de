import qrcode from "qrcode-generator";
import jsQR from "jsqr";

export function renderQr(image, text) {
  if (!image) throw new Error("QR image element missing");
  if (!text) throw new Error("No pairing payload available");
  const qr = qrcode(0, "L");
  qr.addData(text, "Byte");
  qr.make();
  image.src = qr.createDataURL(6, 4);
  image.hidden = false;
}

export class QrScanner {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.stream = null;
    this.running = false;
    this.frame = 0;
    this.lastCode = "";
    this.lastCodeAt = 0;
  }

  async start(onCode) {
    await this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not available in this browser.");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", "");
    this.video.muted = true;
    await this.video.play();
    this.running = true;

    const scan = async () => {
      if (!this.running) return;
      if (this.video.readyState >= 2 && this.video.videoWidth && this.video.videoHeight) {
        const maxWidth = 960;
        const scale = Math.min(1, maxWidth / this.video.videoWidth);
        const width = Math.max(1, Math.round(this.video.videoWidth * scale));
        const height = Math.max(1, Math.round(this.video.videoHeight * scale));
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;
        const context = this.canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(this.video, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        const result = jsQR(image.data, width, height, { inversionAttempts: "dontInvert" });
        if (result?.data) {
          const now = performance.now();
          if (result.data !== this.lastCode || now - this.lastCodeAt > 1500) {
            this.lastCode = result.data;
            this.lastCodeAt = now;
            const accepted = await onCode(result.data);
            if (accepted !== false) {
              await this.stop();
              return;
            }
          }
        }
      }
      if (this.running) this.frame = requestAnimationFrame(scan);
    };
    this.frame = requestAnimationFrame(scan);
  }

  async stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    try { this.video?.pause(); } catch {}
    if (this.video) this.video.srcObject = null;
    for (const track of this.stream?.getTracks?.() || []) {
      try { track.stop(); } catch {}
    }
    this.stream = null;
  }
}
