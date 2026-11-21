import { CapacitorHttp } from '@capacitor/core';

export class ESP32Client {
  private ip: string;
  private lastTriggerState: boolean | null = null;
  private isRequestPending = false;

  constructor(defaultIp = '192.168.4.1') {
    this.ip = localStorage.getItem('esp32_ip') || defaultIp;
  }

  public getIP(): string {
    return this.ip;
  }

  public setIP(newIp: string) {
    this.ip = newIp.trim();
    localStorage.setItem('esp32_ip', this.ip);
  }

  public async checkConnection(): Promise<{ connected: boolean; angle?: number; error?: string }> {
    try {
      // Use native CapacitorHttp to completely bypass browser CORS/Mixed Content restrictions!
      const res = await CapacitorHttp.get({
        url: `http://${this.ip}/status`,
        connectTimeout: 2000,
        readTimeout: 2000,
      });

      if (res.status === 200) {
        const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        return { connected: true, angle: data.servo_angle };
      }
      return { connected: false, error: `HTTP ${res.status}` };
    } catch (err: any) {
      // Fallback to fetch if running in pure browser
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`http://${this.ip}/status`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          return { connected: true, angle: data.servo_angle };
        }
      } catch (e) {
        // silent
      }
      return { connected: false, error: err.message || 'Offline' };
    }
  }

  public async trigger(helmetDetected: boolean, force = false): Promise<boolean> {
    if (!force && this.lastTriggerState === helmetDetected) {
      return true;
    }
    if (this.isRequestPending) {
      return false;
    }

    this.isRequestPending = true;
    const stateStr = helmetDetected ? 'on' : 'off';

    try {
      // Native CapacitorHttp request direct from Android layer
      const res = await CapacitorHttp.get({
        url: `http://${this.ip}/trigger?state=${stateStr}`,
        connectTimeout: 2500,
        readTimeout: 2500,
      });

      if (res.status === 200) {
        this.lastTriggerState = helmetDetected;
        this.isRequestPending = false;
        return true;
      }
    } catch (err) {
      // Fallback to browser fetch
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`http://${this.ip}/trigger?state=${stateStr}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          this.lastTriggerState = helmetDetected;
          this.isRequestPending = false;
          return true;
        }
      } catch (e) {
        console.warn(`[ESP32] Request failed:`, e);
      }
    } finally {
      this.isRequestPending = false;
    }
    return false;
  }
}

export const esp32 = new ESP32Client();
