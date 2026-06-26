// src/lib/engine/PerformanceMonitor.js

/**
 * 📊 PerformanceMonitor - نظام التكيف الديناميكي للأداء (V 2050.ULTIMATE)
 * 
 * يقوم باكتشاف قدرات الجهاز وضبط إعدادات المحرك الرسومي بشكل ذكي،
 * مع دعم الاشتراك في تغييرات الأداء (مثل وضع البطارية) وإمكانية التجاوز يدوياً.
 * 
 * 💎 الميزات:
 * - كشف مستوى الأداء تلقائياً (HIGH/MEDIUM/LOW) بناءً على الذاكرة، الأنوية، ونوع الجهاز.
 * - تخزين النتائج مؤقتاً لتجنب إعادة الحساب المتكرر.
 * - مراقبة تغيرات البطارية لتعديل الأداء تلقائياً عند انخفاض الشحن.
 * - دعم الاشتراك (subscribe) لإعلام المكونات عند تغير المستوى.
 * - إمكانية تجاوز المستوى يدوياً (override) مع إمكانية العودة للتلقائي.
 * - توفير توصيات مفصلة للإعدادات (بيكسل راتيو، الظلال، Anti-aliasing، جودة النسيج).
 * - تهيئة تلقائية عند أول استخدام (Lazy Initialization).
 * - دعم إعادة التقييد (reEvaluate) لتحديث الإعدادات بعد تغيير العوامل الخارجية.
 * - دعم إلغاء التهيئة (destroy) لتنظيف الموارد في بيئات الاختبار.
 */

class PerformanceMonitor {
  // الحالة الداخلية (private static fields)
  static #tier = null;
  static #settings = null;
  static #subscribers = [];
  static #isInitialized = false;
  static #overrideTier = null; // لتجاوز يدوي
  static #deviceType = null; // 'mobile' أو 'desktop'
  static #wasHighTier = null; // لتخزين المستوى قبل توفير البطارية
  static #batteryListener = null; // تخزين مرجع المستمع للتنظيف

  /**
   * تهيئة النظام - تُستدعى تلقائياً عند أول استخدام (Lazy Initialization)
   * لكن يمكن استدعاؤها يدوياً للتحكم في وقت التهيئة.
   */
  static init() {
    if (this.#isInitialized) return;
    this.#isInitialized = true;

    // تحديد نوع الجهاز
    this.#deviceType = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop';

    // حساب المستوى الأولي
    this.#calculateTier();

    // مراقبة البطارية لتعديل الأداء تلقائياً
    this.#setupBatteryMonitoring();

    console.log(`✅ [PerformanceMonitor] Initialized with tier: ${this.#tier} (${this.#deviceType})`);
  }

  /**
   * حساب المستوى بناءً على مواصفات الجهاز
   */
  static #calculateTier() {
    const memory = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;

    let tier;
    // إذا كان هناك تجاوز يدوي، نستخدمه
    if (this.#overrideTier) {
      tier = this.#overrideTier;
    } else {
      // تصنيف حسب المواصفات مع مراعاة نوع الجهاز
      if (memory >= 8 && cores >= 8 && this.#deviceType === 'desktop') {
        tier = 'HIGH';
      } else if (memory >= 4 && cores >= 4) {
        tier = 'MEDIUM';
      } else {
        tier = 'LOW';
      }
    }

    this.#tier = tier;
    this.#settings = this.#buildSettings(tier);
    this.#notifySubscribers(tier, this.#settings);
  }

  /**
   * بناء الإعدادات بناءً على المستوى
   */
  static #buildSettings(tier) {
    const isHigh = tier === 'HIGH';
    const isMedium = tier === 'MEDIUM';
    const isLow = tier === 'LOW';

    return {
      tier,
      pixelRatio: isHigh ? Math.min(window.devicePixelRatio, 2) : (isMedium ? Math.min(window.devicePixelRatio, 1.5) : 1),
      enableShadows: !isLow,
      antialias: isHigh,
      textureQuality: isHigh ? 'ultra' : (isMedium ? 'high' : 'compressed'),
      particleCount: isHigh ? 1000 : (isMedium ? 500 : 150),
      maxAnisotropy: isHigh ? 16 : (isMedium ? 8 : 4),
    };
  }

  /**
   * إعداد مراقبة البطارية
   */
  static async #setupBatteryMonitoring() {
    if (!('getBattery' in navigator)) return;
    try {
      const battery = await navigator.getBattery();
      if (this.#batteryListener) {
        battery.removeEventListener('levelchange', this.#batteryListener);
        battery.removeEventListener('chargingchange', this.#batteryListener);
      }

      // دالة معالجة تغيرات البطارية
      this.#batteryListener = () => {
        // إذا كانت البطارية منخفضة (أقل من 20%) ولم يكن هناك تجاوز يدوي
        if (battery.level < 0.2 && !this.#overrideTier) {
          if (this.#tier !== 'LOW') {
            // تخزين المستوى الحالي للاستعادة لاحقاً
            this.#wasHighTier = this.#tier;
            // خفض المستوى إلى LOW لتوفير الطاقة
            this.#tier = 'LOW';
            this.#settings = this.#buildSettings('LOW');
            this.#notifySubscribers('LOW', this.#settings);
            console.log('🔋 [PerformanceMonitor] Battery saver mode activated (LOW)');
          }
        } else if (battery.level >= 0.25 && !this.#overrideTier) {
          // إذا كانت البطارية أعلى من 25%، نعيد التقييم
          if (this.#wasHighTier && this.#tier === 'LOW') {
            // استعادة المستوى السابق
            this.#tier = this.#wasHighTier;
            this.#settings = this.#buildSettings(this.#tier);
            this.#notifySubscribers(this.#tier, this.#settings);
            this.#wasHighTier = null;
            console.log(`🔄 [PerformanceMonitor] Performance restored to ${this.#tier}`);
          } else {
            // إعادة حساب تلقائي
            this.#calculateTier();
          }
        }
        // إذا كانت البطارية تشحن، نعيد الأداء الطبيعي
        if (battery.charging && !this.#overrideTier) {
          if (this.#wasHighTier && this.#tier === 'LOW') {
            this.#tier = this.#wasHighTier;
            this.#settings = this.#buildSettings(this.#tier);
            this.#notifySubscribers(this.#tier, this.#settings);
            this.#wasHighTier = null;
            console.log(`🔌 [PerformanceMonitor] Performance restored to ${this.#tier} (charging)`);
          } else {
            this.#calculateTier();
          }
        }
      };

      battery.addEventListener('levelchange', this.#batteryListener);
      battery.addEventListener('chargingchange', this.#batteryListener);

      // فحص أولي للبطارية
      if (battery.level < 0.2 && !this.#overrideTier) {
        if (this.#tier !== 'LOW') {
          this.#wasHighTier = this.#tier;
          this.#tier = 'LOW';
          this.#settings = this.#buildSettings('LOW');
          this.#notifySubscribers('LOW', this.#settings);
          console.log('🔋 [PerformanceMonitor] Battery saver mode activated on init (LOW)');
        }
      }
    } catch (_) {
      // تجاهل أخطاء Battery API
    }
  }

  /**
   * الحصول على المستوى الحالي
   * @returns {string} 'HIGH' | 'MEDIUM' | 'LOW'
   */
  static getTier() {
    if (!this.#isInitialized) this.init();
    return this.#tier;
  }

  /**
   * الحصول على إعدادات المحرك الحالية
   * @returns {Object} إعدادات الأداء
   */
  static getEngineSettings() {
    if (!this.#isInitialized) this.init();
    return { ...this.#settings };
  }

  /**
   * تجاوز المستوى يدوياً (للمستخدم أو المشرف)
   * @param {string|null} tier - 'HIGH' | 'MEDIUM' | 'LOW' | null (null للعودة للتلقائي)
   */
  static overrideTier(tier) {
    if (tier && !['HIGH', 'MEDIUM', 'LOW'].includes(tier)) {
      throw new Error('Invalid tier. Must be HIGH, MEDIUM, LOW, or null.');
    }
    this.#overrideTier = tier;
    // إذا تم إلغاء التجاوز، نعيد الحساب التلقائي
    if (!tier) {
      this.#wasHighTier = null;
    }
    this.#calculateTier();
    console.log(`🛠️ [PerformanceMonitor] Tier overridden to: ${tier || 'auto'}`);
  }

  /**
   * الاشتراك في تغييرات الأداء
   * @param {function} callback - function(newTier, newSettings)
   * @returns {function} - دالة لإلغاء الاشتراك
   */
  static subscribe(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    if (!this.#isInitialized) this.init();
    this.#subscribers.push(callback);
    // إرجاع دالة لإلغاء الاشتراك
    return () => {
      const index = this.#subscribers.indexOf(callback);
      if (index !== -1) this.#subscribers.splice(index, 1);
    };
  }

  /**
   * إعلام المشتركين بالتغيير
   */
  static #notifySubscribers(tier, settings) {
    for (const cb of this.#subscribers) {
      try {
        cb(tier, { ...settings });
      } catch (e) {
        console.warn('[PerformanceMonitor] Subscriber error:', e);
      }
    }
  }

  /**
   * الحصول على معلومات مفصلة عن الجهاز
   * @returns {Object} معلومات الجهاز
   */
  static getDeviceInfo() {
    return {
      deviceType: this.#deviceType,
      memory: navigator.deviceMemory || 'unknown',
      cores: navigator.hardwareConcurrency || 'unknown',
      pixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
    };
  }

  /**
   * إعادة تقييم الأداء يدوياً (مثل بعد تغيير إعدادات المستخدم)
   */
  static reEvaluate() {
    if (!this.#isInitialized) this.init();
    this.#calculateTier();
    console.log('🔄 [PerformanceMonitor] Re-evaluated performance settings.');
  }

  /**
   * إعادة تعيين النظام (للاستخدام في الاختبارات أو تصحيح الأخطاء)
   */
  static reset() {
    // إزالة مستمع البطارية
    if (this.#batteryListener && 'getBattery' in navigator) {
      navigator.getBattery().then(battery => {
        battery.removeEventListener('levelchange', this.#batteryListener);
        battery.removeEventListener('chargingchange', this.#batteryListener);
      }).catch(() => {});
    }
    this.#subscribers = [];
    this.#isInitialized = false;
    this.#tier = null;
    this.#settings = null;
    this.#overrideTier = null;
    this.#wasHighTier = null;
    this.#batteryListener = null;
    // إعادة التهيئة
    this.init();
    console.log('🔄 [PerformanceMonitor] Reset completed.');
  }

  /**
   * إلغاء التهيئة بالكامل (للاستخدام في بيئات الاختبار)
   */
  static destroy() {
    if (this.#batteryListener && 'getBattery' in navigator) {
      navigator.getBattery().then(battery => {
        battery.removeEventListener('levelchange', this.#batteryListener);
        battery.removeEventListener('chargingchange', this.#batteryListener);
      }).catch(() => {});
    }
    this.#subscribers = [];
    this.#isInitialized = false;
    this.#tier = null;
    this.#settings = null;
    this.#overrideTier = null;
    this.#wasHighTier = null;
    this.#batteryListener = null;
    this.#deviceType = null;
    console.log('🗑️ [PerformanceMonitor] Destroyed.');
  }
}

export default PerformanceMonitor;