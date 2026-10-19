const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

class AlertStore {
  constructor(file) {
    this.file = file;
    this.state = { version: 1, devices: [], alerts: [] };
    this.pending = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const state = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.devices) || !Array.isArray(state.alerts)) {
        throw new Error('Invalid secure alert store');
      }
      this.state = state;
    } catch (error) {
      // Fail closed on corruption/permission errors. Never overwrite a damaged store.
      if (error.code !== 'ENOENT') throw error;
    }
    await this.transaction(() => {});
  }

  prune(state) {
    const now = Date.now();
    state.devices = state.devices.filter(device => device.expiresAt > now);
    const owners = new Set(state.devices.map(device => device.ownerHash));
    state.alerts = state.alerts.filter(alert => owners.has(alert.ownerHash) &&
      Date.parse(alert.updatedAt || alert.createdAt) > now - RETENTION_MS);
  }

  transaction(change) {
    const operation = this.pending.then(async () => {
      const next = structuredClone(this.state);
      this.prune(next);
      const result = await change(next);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(next), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, this.file);
      } catch (error) {
        await fs.unlink(temporary).catch(() => {});
        throw error;
      }
      this.state = next;
      return result;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}

module.exports = { AlertStore, RETENTION_MS };
