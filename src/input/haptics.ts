/**
 * Tiny taps of vibration on phones. Android uses the Vibration API; iPhone (iOS 18+) has no
 * web vibration, but toggling a native `switch` checkbox plays the system haptic tick.
 */
export class Haptics {
  enabled: boolean;
  private label: HTMLLabelElement | null = null;
  private readonly android = typeof navigator.vibrate === 'function';
  readonly supported: boolean;

  constructor() {
    const phone = Math.min(screen.width, screen.height) < 500 && matchMedia('(pointer: coarse)').matches;
    const ios = /iPhone|iPod/.test(navigator.userAgent);
    this.supported = phone && (this.android || ios);
    this.enabled = this.supported;
    if (ios && !this.android) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      this.label = label;
    }
  }

  tap(strength = 1): void {
    if (!this.enabled) return;
    if (this.android) {
      navigator.vibrate(Math.round(6 + strength * 8));
    } else if (this.label) {
      this.label.click();
    }
  }
}
