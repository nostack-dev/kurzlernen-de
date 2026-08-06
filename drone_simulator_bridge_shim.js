(() => {
  if ("serial" in navigator) return;

  class AsyncByteQueue {
    constructor() {
      this.items = [];
      this.waiters = [];
      this.closed = false;
      this.error = null;
    }

    push(value) {
      if (this.closed) return;
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve({ value, done: false });
      else this.items.push(value);
    }

    close(error = null) {
      this.closed = true;
      this.error = error;
      while (this.waiters.length) {
        const waiter = this.waiters.shift();
        if (error) waiter.reject(error);
        else waiter.resolve({ value: undefined, done: true });
      }
    }

    read() {
      if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
      if (this.error) return Promise.reject(this.error);
      if (this.closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }
  }

  function defaultBridgeUrl() {
    const query = new URLSearchParams(location.search).get("bridge");
    if (query) return query;
    const saved = localStorage.getItem("arondight45BridgeUrl");
    if (saved) return saved;
    if (location.protocol === "http:" && location.port) return `ws://${location.host}/hil`;
    if (location.protocol === "https:" && location.port) return `wss://${location.host}/hil`;
    return "";
  }

  class BridgeSerialPort {
    constructor(url) {
      this.url = url;
      this.socket = null;
      this.queue = new AsyncByteQueue();
      this.readable = {
        getReader: () => ({
          read: () => this.queue.read(),
          cancel: async () => this.queue.close(),
          releaseLock: () => {},
        }),
      };
      this.writable = {
        getWriter: () => ({
          write: async value => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
              throw new Error("S31 LAN bridge is not connected");
            }
            this.socket.send(value);
          },
          releaseLock: () => {},
        }),
      };
    }

    async open() {
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(this.url);
        socket.binaryType = "arraybuffer";
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error("S31 LAN bridge connection timed out"));
        }, 5000);
        socket.onopen = () => {
          clearTimeout(timer);
          this.socket = socket;
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error(`Could not connect to S31 bridge at ${this.url}`));
        };
        socket.onmessage = event => this.queue.push(new Uint8Array(event.data));
        socket.onclose = () => this.queue.close(new Error("S31 LAN bridge disconnected"));
      });
    }

    async close() {
      this.queue.close();
      if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
        this.socket.close(1000, "client disconnect");
      }
      this.socket = null;
    }
  }

  const bridgeSerial = {
    __arondightBridgeShim: true,
    defaultBridgeUrl,
    async requestPort() {
      let url = defaultBridgeUrl();
      if (!url) {
        url = window.prompt(
          "S31 LAN bridge WebSocket URL",
          "ws://192.168.1.20:8765/hil",
        ) || "";
      }
      url = url.trim();
      if (!/^wss?:\/\//i.test(url)) {
        throw new Error("Bridge URL must begin with ws:// or wss://");
      }
      if (location.protocol === "https:" && url.startsWith("ws://")) {
        throw new Error(
          "Open the HTTP URL printed by the S31 bridge on this iPhone. " +
          "An HTTPS page cannot connect to an insecure ws:// LAN bridge.",
        );
      }
      localStorage.setItem("arondight45BridgeUrl", url);
      return new BridgeSerialPort(url);
    },
  };

  Object.defineProperty(navigator, "serial", {
    configurable: true,
    enumerable: true,
    value: bridgeSerial,
  });
})();