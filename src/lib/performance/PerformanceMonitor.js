// src/lib/performance/PerformanceMonitor.js

/**
 * 📊 PerformanceMonitor - نظام التكيف الديناميكي الذكي (V 2050.ADAPTIVE-PRO)
 * 
 * 💎 الميزات:
 * - اختبار أداء فعلي (قياس وقت عرض المشهد).
 * - تحديث الإعدادات عند تغير الظروف (حجم الشاشة، وضع البطارية، توصيل الشاشات).
 * - دعم إضافي لـ WebGPU (في حال توفرها).
 * - إمكانية الاشتراك في تغييرات المستوى (للرد في المكونات الأخرى).
 */

export class PerformanceMonitor {
  static #instance = null;
  #tier = 'MEDIUM';
  #settings = {};
  #listeners = [];
  #performanceTestRunning = false;

  constructor() {
    if (PerformanceMonitor.#instance) {
      return PerformanceMonitor.#instance;
    }
    PerformanceMonitor.#instance = this;
    this.#initialize();
  }

  // ------------------- تهيئة المراقب -------------------
  #initialize() {
    // تقدير أولي بناءً على المواصفات
    this.#estimateTier();

    // بدء اختبار الأداء الفعلي
    this.#runPerformanceTest();

    // الاستماع لتغيرات البيئة
    this.#bindEnvironmentListeners();
  }

  // ------------------- تقدير المستوى الأولي -------------------
  #estimateTier() {
    const memory = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;

    // تحقق من وجود بطاقة رسومية قوية (تقدير تقريبي)
    let gpuScore = 0;
    if (typeof navigator.gpu !== 'undefined') {
      gpuScore = 1; // WebGPU مدعومة (غالبًا جهاز حديث)
    }

    // تحقق من وضع البطارية (توفير الطاقة)
    const isBatterySaving = this.#isBatterySavingMode();

    let score = memory + cores * 0.5 + gpuScore * 2;
    if (isBatterySaving) score *= 0.7;

    if (score >= 12) this.#tier = 'HIGH';
    else if (score >= 7) this.#tier = 'MEDIUM';
    else this.#tier = 'LOW';
  }

  // ------------------- اختبار الأداء الفعلي -------------------
  async #runPerformanceTest() {
    if (this.#performanceTestRunning) return;
    this.#performanceTestRunning = true;

    try {
      // إنشاء Canvas خفي لاختبار WebGL
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const gl = canvas.getContext('webgl');
      if (!gl) {
        // إذا لم يكن WebGL مدعومًا، نخفض المستوى إلى LOW
        this.#tier = 'LOW';
        this.#updateSettings();
        this.#performanceTestRunning = false;
        return;
      }

      // قياس وقت تنفيذ مهمة رسومية
      const start = performance.now();
      // تنفيذ عملية رسومية بسيطة (مثل مسح وتلوين)
      gl.clearColor(0.1, 0.2, 0.3, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.finish(); // انتظار الانتهاء
      const elapsed = performance.now() - start;

      // إذا كانت المهمة بطيئة جدًا (> 5ms)، نخفض المستوى
      if (elapsed > 5 && this.#tier === 'HIGH') this.#tier = 'MEDIUM';
      else if (elapsed > 10 && this.#tier === 'MEDIUM') this.#tier = 'LOW';
      
      // إذا كانت سريعة جدًا (< 1ms) وكنت في LOW، نرفع المستوى (لأجهزة قوية)
      if (elapsed < 1 && this.#tier === 'LOW') {
        const memory = navigator.deviceMemory || 4;
        if (memory >= 6) this.#tier = 'MEDIUM';
      }

      // تنظيف
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();

    } catch (_) {
      // في حال حدوث خطأ، نترك التقدير الأولي
    }

    this.#performanceTestRunning = false;
    this.#updateSettings();
    this.#notifyListeners();
  }

  // ------------------- مراقبة البيئة -------------------
  #bindEnvironmentListeners() {
    // تغيير حجم النافذة
    const resizeObserver = new ResizeObserver(() => {
      this.#onEnvironmentChange();
    });
    resizeObserver.observe(document.documentElement);

    // تغيير وضع البطارية
    if ('getBattery' in navigator) {
      navigator.getBattery().then((battery) => {
        battery.addEventListener('chargingchange', () => this.#onEnvironmentChange());
        battery.addEventListener('levelchange', () => this.#onEnvironmentChange());
      }).catch(() => {});
    }

    // تغيير دقة الشاشة (بمعدل محدود)
    let lastPixelRatio = window.devicePixelRatio;
    const checkPixelRatio = () => {
      const current = window.devicePixelRatio;
      if (current !== lastPixelRatio) {
        lastPixelRatio = current;
        this.#onEnvironmentChange();
      }
      requestAnimationFrame(checkPixelRatio);
    };
    // نبدأ بعد 1 ثانية لتجنب التأثير على التحميل الأولي
    setTimeout(checkPixelRatio, 1000);
  }

  #onEnvironmentChange() {
    // نعيد تقدير المستوى مع احترام تغيرات البيئة
    this.#estimateTier();
    // نعيد الاختبار الفعلي (باستخدام setTimeout لتجنب التكرار السريع)
    clearTimeout(this._envTimeout);
    this._envTimeout = setTimeout(() => {
      this.#runPerformanceTest();
    }, 500);
  }

  // ------------------- دعم وضع توفير الطاقة -------------------
  #isBatterySavingMode() {
    // نفترض أن توفير الطاقة مفعل إذا كان الجهاز على البطارية والمستوى منخفض
    // سيتم تحديثه ديناميكيًا عبر الأحداث
    try {
      const battery = navigator.getBattery?.();
      if (battery && !battery.charging && battery.level < 0.3) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  // ------------------- حساب الإعدادات الرسومية المتقدمة -------------------
  #updateSettings() {
    const tier = this.#tier;
    const baseSettings = {
      tier,
      pixelRatio: this.#getOptimalPixelRatio(),
      enableShadows: tier !== 'LOW',
      antialias: tier === 'HIGH',
      textureQuality: tier === 'HIGH' ? 'ultra' : tier === 'MEDIUM' ? 'high' : 'compressed',
      maxAnisotropy: tier === 'HIGH' ? 16 : tier === 'MEDIUM' ? 8 : 4,
      drawDistance: tier === 'HIGH' ? 1000 : tier === 'MEDIUM' ? 500 : 200,
      particleCount: tier === 'HIGH' ? 1000 : tier === 'MEDIUM' ? 500 : 100,
      postProcessing: tier === 'HIGH',
    };

    this.#settings = baseSettings;
  }

  #getOptimalPixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const tier = this.#tier;
    if (tier === 'HIGH') return Math.min(dpr, 2);
    if (tier === 'MEDIUM') return Math.min(dpr, 1.5);
    return 1;
  }

  // ------------------- نظام الاستماع للأحداث -------------------
  #notifyListeners() {
    for (const listener of this.#listeners) {
      try {
        listener(this.#tier, this.#settings);
      } catch (_) {}
    }
  }

  subscribe(callback) {
    if (typeof callback === 'function') {
      this.#listeners.push(callback);
      // إرسال القيم الحالية فورًا
      callback(this.#tier, this.#settings);
    }
  }

  unsubscribe(callback) {
    this.#listeners = this.#listeners.filter(cb => cb !== callback);
  }

  // ------------------- واجهات عامة ثابتة -------------------
  static getInstance() {
    if (!PerformanceMonitor.#instance) {
      new PerformanceMonitor();
    }
    return PerformanceMonitor.#instance;
  }

  static getTier() {
    return PerformanceMonitor.getInstance().#tier;
  }

  static getEngineSettings() {
    return PerformanceMonitor.getInstance().#settings;
  }

  static getSettings() {
    // تطابق الاسم القديم للحفاظ على التوافق
    return PerformanceMonitor.getEngineSettings();
  }

  // ------------------- إعادة الاختبار يدويًا -------------------
  static reEvaluate() {
    const instance = PerformanceMonitor.getInstance();
    instance.#estimateTier();
    instance.#runPerformanceTest();
  }
}

// تصدير نسخة مفردة جاهزة للاستخدام
const monitor = PerformanceMonitor.getInstance();
export default monitor;