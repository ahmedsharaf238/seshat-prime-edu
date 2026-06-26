// src/lib/audio/AudioManager.js

/**
 * 🎵 AudioManager (Singleton) - الإدارة المركزية للصوتيات (V 2050)
 * يدير تشغيل المؤثرات الصوتية مع فك قفل الصوت تلقائياً.
 */
class AudioManagerInstance {
  constructor() {
    this.context = null;
    this.isUnlocked = false;
    this.sounds = new Map();
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContext();
    } catch (_) {
      console.warn('⚠️ [Audio] Web Audio API not supported.');
      return;
    }

    // فك قفل الصوت عند أول تفاعل (النقر أو اللمس)
    const unlock = () => {
      if (this.context && this.context.state === 'suspended') {
        this.context.resume().catch(() => {});
      }
      this.isUnlocked = true;
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('keydown', unlock);
    };
    
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    document.addEventListener('keydown', unlock);
  }

  // تشغيل مؤثر صوتي من ملف (url) مع تخزينه مؤقتاً
  async playEffect(url, volume = 1) {
    if (!this.context || !this.isUnlocked) {
      // إذا لم يتم فتح الصوت، نحاول التهيئة ثم نعيد المحاولة
      if (!this.initialized) this.init();
      if (!this.isUnlocked) {
        console.warn('⚠️ [Audio] Audio not unlocked yet.');
        return;
      }
    }

    try {
      let buffer = this.sounds.get(url);
      if (!buffer) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        buffer = await this.context.decodeAudioData(arrayBuffer);
        this.sounds.set(url, buffer);
      }

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      
      // التحكم في مستوى الصوت
      const gainNode = this.context.createGain();
      gainNode.gain.value = Math.min(volume, 1);
      source.connect(gainNode);
      gainNode.connect(this.context.destination);
      
      source.start(0);
    } catch (error) {
      console.warn('⚠️ [Audio] Failed to play effect:', error);
    }
  }

  // تشغيل صوت تفاعلي قصير (بدون تحميل ملف خارجي) - مثلاً نغمة تنبيه
  playBeep(frequency = 440, duration = 150, type = 'sine', volume = 0.3) {
    if (!this.context || !this.isUnlocked) {
      if (!this.initialized) this.init();
      if (!this.isUnlocked) return;
    }

    try {
      const oscillator = this.context.createOscillator();
      const gainNode = this.context.createGain();
      
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      
      gainNode.gain.value = volume;
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration / 1000);
      
      oscillator.connect(gainNode);
      gainNode.connect(this.context.destination);
      
      oscillator.start();
      oscillator.stop(this.context.currentTime + duration / 1000);
    } catch (_) {}
  }
}

// تصدير نسخة مفردة (Singleton) كـ default export
export default new AudioManagerInstance();