// The desktop bridge carries controls, never the 100 Hz motion samples.
export const hasNativeSerialBridge = () => !!window.pywebview?.api?.serial_start

export function chooseNativeSerialPort(ports) {
  return new Promise((resolve, reject) => {
    window.dispatchEvent(new CustomEvent('vault:choose-serial-port', {
      detail: { ports, resolve, reject },
    }))
  })
}

export class NativeSerial {
  constructor(onStatus, onError) {
    this.generation = 0
    this.queue = Promise.resolve()
    this.onStatus = onStatus
    this.onError = onError
    this.pollBusy = false
    this.active = false
  }

  command(method, ...args) {
    const result = this.queue.then(() => window.pywebview.api[method](...args))
    this.queue = result.catch(error => this.onError(error))
    return result
  }

  async connect(port) {
    await this.command('serial_connect', port.device)
    this.active = true
    this.poll = setInterval(async () => {
      if (this.pollBusy || !this.active) return
      this.pollBusy = true
      const generation = this.generation
      try {
        const status = await window.pywebview.api.serial_status()
        if (!this.active || generation !== this.generation) return
        if (status.error) this.onError(new Error(status.error))
        else if (!status.connected) this.onError(new Error('Serial device disconnected'))
        else if (status.generation === generation) this.onStatus(status)
      } catch (error) { if (this.active) this.onError(error) }
      finally { this.pollBusy = false }
    }, 100)
  }

  start(payload) {
    const generation = ++this.generation
    void this.command('serial_start', { ...payload, generation }).catch(() => {})
  }

  update(patch) {
    void this.command('serial_update', { ...patch, generation: this.generation }).catch(() => {})
  }

  stop() {
    const generation = ++this.generation
    // Stop bypasses queued loads/controls. The backend generation guard rejects
    // any older start that finishes parsing after this cancellation arrives.
    const stopped = Promise.resolve(window.pywebview.api.serial_stop(generation))
    this.queue = Promise.all([this.queue, stopped]).then(() => {}).catch(error => this.onError(error))
    return stopped
  }

  move(axis, position, duration) {
    // Pattern/test moves are low-rate controls. Script positions never cross
    // this bridge; the native output thread samples the whole loaded script.
    void this.command('serial_move', axis, position, duration, this.generation).catch(() => {})
  }

  async disconnect() {
    this.active = false
    clearInterval(this.poll)
    await this.stop().catch(() => {})
    await this.command('serial_disconnect')
  }
}
