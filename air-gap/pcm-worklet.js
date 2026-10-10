'use strict';
class SignalCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(512); this.count = 0; this.active = true;
    this.port.onmessage = event => { if (event.data === 'stop') this.active = false; };
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (!this.active) return false;
    const input = inputs[0]?.[0]; if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      if (this.count === 0) this.startSample = currentFrame + i;
      this.buffer[this.count++] = input[i];
      if (this.count === this.buffer.length) {
        this.port.postMessage({ pcm: this.buffer, startSample: this.startSample }, [this.buffer.buffer]); this.buffer = new Float32Array(512); this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor('signal-capture', SignalCapture);
