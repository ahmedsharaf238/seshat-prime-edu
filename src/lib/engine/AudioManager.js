// src/lib/engine/AudioManager.js

/**
 * 🎵 AudioManager - نظام إدارة الصوتيات الذكي (V 2050.AUDIO-MANAGER-PRO)
 * 
 * 💎 التحديثات الهندسية الفائقة:
 * - 🛡️ AbortController: إلغاء الطلبات المعلقة.
 * - 📦 Bounded LRU Cache: حد أقصى 30 عنصراً لمنع تسرب الذاكرة.
 * - ⏳ Pending Queue: منع الطلبات المتكررة لنفس الملف.
 * - 🔄 Retry Logic: إعادة محاولة تلقائية (3 محاولات) مع تأخير.
 * - 🔊 Volume Control: التحكم في مستوى الصوت عبر GainNode.
 * - 🎵 playBeep: توليد نغمات تنبيهية بدون ملفات خارجية.
 * - 🔓 Auto-Unlock: إعادة محاولة فك قفل الصوت في كل تشغيل.
 * - 🧹 clearCache: تحرير الذاكرة عند الحاجة.
 * - 📡 onError Callback: الإبلاغ عن الأخطاء.
 */

class AudioManagerInstance {
  constructor() {
    this.context = null;
    this.isUnlocked = false;
    this.sounds = new Map(); // Cache: url -> AudioBuffer
    this.pendingRequests = new Map(); // Pending: url -> Promise
    this.maxCacheSize = 30;
    this.retryCount = 3;
    this.retryDelay = 1000;
    this.initialized = false;
    this.errorCallback = null;
  }

  // ============================================================
  // 🎛️ التهيئة (تُستدعى مرة واحدة)
  // ============================================================
  init() {
    if (this.initialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContext();
      this.initialized = true;
      
      // محاولة فك القفل عند أول تفاعل
      this._setupUnlockListeners();
    } catch (error) {
      console.warn('⚠️ [AudioManager] Web Audio API not supported:', error);
      this.initialized = false;
    }
  }

  // ============================================================
  // 🔓 إعداد مستمعات فك القفل
  // ============================================================
  _setupUnlockListeners() {
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

  // ============================================================
  // 🔓 محاولة فك القفل عند التشغيل (احتياطي)
  // ============================================================
  _ensureUnlocked() {
    if (!this.isUnlocked && this.context) {
      if (this.context.state === 'suspended') {
        this.context.resume().catch(() => {});
      }
      // إذا كان لا يزال معلقاً، نعيد محاولة الفتح
      if (this.context.state === 'suspended') {
        this._setupUnlockListeners();
        return false;
      }
      this.isUnlocked = true;
    }
    return this.isUnlocked;
  }

  // ============================================================
  // 🔊 تشغيل مؤثر صوتي من ملف (مع Retry و Abort)
  // ============================================================
  async playEffect(url, options = {}) {
    const {
      volume = 1,
      onError = null,
      signal = null,
      retryCount = this.retryCount,
    } = options;

    // إذا لم يتم التهيئة، نحاول التهيئة
    if (!this.initialized) this.init();
    
    // محاولة فك القفل
    if (!this._ensureUnlocked()) {
      console.warn('⚠️ [AudioManager] Audio not unlocked yet.');
      if (onError) onError(new Error('Audio not unlocked'));
      return;
    }

    if (!this.context) {
      if (onError) onError(new Error('AudioContext not available'));
      return;
    }

    // التحقق من الكاش
    if (this.sounds.has(url)) {
      const buffer = this.sounds.get(url);
      this._playBuffer(buffer, volume);
      return;
    }

    // التحقق من الطلبات المعلقة
    if (this.pendingRequests.has(url)) {
      try {
        const buffer = await this.pendingRequests.get(url);
        this._playBuffer(buffer, volume);
        return;
      } catch (error) {
        this.pendingRequests.delete(url);
        throw error;
      }
    }

    // إنشاء وعد التحميل
    const loadPromise = new Promise(async (resolve, reject) => {
      let attempt = 0;
      let lastError = null;

      while (attempt <= retryCount) {
        try {
          // التحقق من الإلغاء
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }

          const response = await fetch(url, { signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = await this.context.decodeAudioData(arrayBuffer);

          // تخزين في الكاش (مع تطبيق الحد الأقصى)
          this._setCache(url, buffer);
          this.pendingRequests.delete(url);
          resolve(buffer);
          return;

        } catch (error) {
          if (error.name === 'AbortError') {
            reject(error);
            return;
          }
          lastError = error;
          attempt++;

          if (attempt <= retryCount && !signal?.aborted) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1);
            console.warn(`🔄 [AudioManager] Retry ${attempt}/${retryCount} for ${url} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            this.pendingRequests.delete(url);
            reject(lastError || new Error('Failed to load audio'));
          }
        }
      }
    });

    this.pendingRequests.set(url, loadPromise);

    // إضافة تنظيف في حال الإلغاء
    if (signal) {
      signal.addEventListener('abort', () => {
        this.pendingRequests.delete(url);
      });
    }

    try {
      const buffer = await loadPromise;
      this._playBuffer(buffer, volume);
    } catch (error) {
      if (onError) onError(error);
      throw error;
    }
  }

  // ============================================================
  // ▶️ تشغيل المخزن المؤقت (Buffer) مع التحكم في الصوت
  // ============================================================
  _playBuffer(buffer, volume = 1) {
    if (!this.context || !this.isUnlocked) return;

    try {
      const source = this.context.createBufferSource();
      source.buffer = buffer;

      // التحكم في مستوى الصوت
      const gainNode = this.context.createGain();
      gainNode.gain.value = Math.min(volume, 1);

      source.connect(gainNode);
      gainNode.connect(this.context.destination);
      source.start(0);
    } catch (error) {
      console.warn('⚠️ [AudioManager] Failed to play buffer:', error);
    }
  }

  // ============================================================
  // 🎵 تشغيل نغمة تنبيهية (بدون ملف خارجي)
  // ============================================================
  playBeep(frequency = 440, duration = 150, type = 'sine', volume = 0.3) {
    if (!this.initialized) this.init();
    if (!this._ensureUnlocked() || !this.context) return;

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
    } catch (error) {
      console.warn('⚠️ [AudioManager] Failed to play beep:', error);
    }
  }

  // ============================================================
  // 📦 إدارة الكاش (LRU)
  // ============================================================
  _setCache(url, buffer) {
    if (this.sounds.size >= this.maxCacheSize) {
      const oldestKey = this.sounds.keys().next().value;
      this.sounds.delete(oldestKey);
    }
    this.sounds.set(url, buffer);
  }

  clearCache() {
    // إلغاء أي طلبات معلقة
    for (const [url, promise] of this.pendingRequests) {
      // لا يمكن إلغاء الوعد مباشرة، لكن نزيله من القائمة
      this.pendingRequests.delete(url);
    }
    this.sounds.clear();
    console.log('🗑️ [AudioManager] Cache cleared.');
  }

  // ============================================================
  // 📊 دوال الحصول على حالة الكاش
  // ============================================================
  getCacheStats() {
    return {
      size: this.sounds.size,
      maxSize: this.maxCacheSize,
      pending: this.pendingRequests.size,
      isUnlocked: this.isUnlocked,
      contextState: this.context?.state || 'null',
    };
  }

  // ============================================================
  // 📡 تسجيل دالة معالجة الأخطاء العامة
  // ============================================================
  setErrorCallback(callback) {
    if (typeof callback === 'function') {
      this.errorCallback = callback;
    }
  }
}

// تصدير نسخة مفردة (Singleton) كـ default export
export default new AudioManagerInstance();