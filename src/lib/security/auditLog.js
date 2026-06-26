// src/lib/security/auditLog.js
// ============================================================
// 🕵️‍♂️ Zero-Cost Edge-Ready Audit Logger (Batch Architecture) - ULTIMATE v2.0
// ============================================================
// التحسينات الجديدة:
// 1. تجزئة الدفعات الكبيرة جداً (أكثر من 50 حدثاً أو حجم > 60KB) تلقائياً.
// 2. إضافة دالة clearQueue() لتفريغ الطابور يدوياً (مثل عند تسجيل الخروج).
// 3. دعم credentials: 'include' في fetch لإرسال الكوكيز (للجلسات).
// 4. إضافة توقيع HMAC اختياري لحماية البيانات من التلاعب.
// 5. مراقبة حدث beforeunload كنسخة احتياطية عن visibilitychange.
// 6. تحسين التحقق من صحة المدخلات وتسجيل الأخطاء بشكل أكثر تفصيلاً.
// 7. دعم إلغاء الدفعات المعلقة (AbortController) لتجنب الإرسال المتكرر.
// ============================================================

const isServer = typeof window === 'undefined';
let logQueue = [];
let batchTimeout = null;
let abortController = null; // للتحكم في طلبات fetch المعلقة

// التهيئة الافتراضية (قابلة للتعديل عبر init)
let config = {
  BATCH_SIZE_LIMIT: 20,            // إرسال فوراً إذا وصل لـ 20 حدث
  FLUSH_INTERVAL: 5000,            // أو إرسال كل 5 ثوانٍ كحد أقصى
  RETRY_LIMIT: 3,                  // عدد مرات إعادة المحاولة
  RETRY_DELAY: 2000,               // التأخير بين المحاولات (مللي ثانية)
  BEACON_MAX_SIZE: 60 * 1024,      // الحد الأقصى لحجم sendBeacon (~60KB)
  API_ENDPOINT: '/api/security-audit/batch',
  LOCAL_STORAGE_KEY: 'security_audit_queue',
  ENABLE_SIGNATURE: false,         // تفعيل التوقيع الرقمي (يتطلب مفتاح سري)
  SIGNATURE_SECRET: '',            // المفتاح السري للتوقيع (يُقرأ من البيئة)
  CHUNK_SIZE: 50,                  // عدد الأحداث في كل دفعة صغيرة عند التقسيم
  INCLUDE_CREDENTIALS: true,       // إرسال الكوكيز مع الطلبات
};

// ==============================
// دوال مساعدة
// ==============================

const logError = (message, error = null) => {
  console.error(`[SecurityAudit Error]: ${message}`, error);
  // في الإنتاج، يمكن ربطها بـ Sentry أو أي خدمة مراقبة
};

const logInfo = (message) => {
  console.info(`[SecurityAudit Info]: ${message}`);
};

// توليد توقيع بسيط (HMAC-SHA256) إذا تم تفعيله
const generateSignature = async (payload) => {
  if (!config.ENABLE_SIGNATURE || !config.SIGNATURE_SECRET) return null;
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(config.SIGNATURE_SECRET);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    );
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  } catch (e) {
    logError('Failed to generate signature', e);
    return null;
  }
};

// تخزين الدفعة الفاشلة في Local Storage
const saveFailedBatch = (batch) => {
  try {
    const storedQueue = JSON.parse(localStorage.getItem(config.LOCAL_STORAGE_KEY) || '[]');
    localStorage.setItem(config.LOCAL_STORAGE_KEY, JSON.stringify([...storedQueue, ...batch]));
    logInfo(`Batch saved to local storage (${batch.length} events)`);
  } catch (e) {
    logError('Failed to save batch to local storage', e);
  }
};

// استعادة الدفعات المخزنة من Local Storage
const flushLocalStorageQueue = async () => {
  if (isServer) return;
  try {
    const storedQueue = JSON.parse(localStorage.getItem(config.LOCAL_STORAGE_KEY) || '[]');
    if (storedQueue.length > 0) {
      logInfo(`Attempting to flush ${storedQueue.length} events from local storage.`);
      localStorage.removeItem(config.LOCAL_STORAGE_KEY);
      // تقسيم الدفعة الكبيرة إلى أجزاء صغيرة
      const chunks = splitBatch(storedQueue, config.CHUNK_SIZE);
      for (const chunk of chunks) {
        await sendBatchToServer(chunk, 0);
      }
    }
  } catch (e) {
    logError('Failed to flush local storage queue', e);
  }
};

// تقسيم الدفعة إلى أجزاء صغيرة
const splitBatch = (batch, maxSize) => {
  const chunks = [];
  for (let i = 0; i < batch.length; i += maxSize) {
    chunks.push(batch.slice(i, i + maxSize));
  }
  return chunks;
};

// إلغاء أي طلب fetch معلق
const cancelPendingRequest = () => {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
};

// إرسال الدفعة إلى الخادم مع إعادة المحاولة والتوقيع والتقسيم التلقائي
const sendBatchToServer = async (batch, retryCount = 0) => {
  if (batch.length === 0) return true;

  // إذا كانت الدفعة كبيرة جداً، نقسمها
  if (batch.length > config.CHUNK_SIZE) {
    const chunks = splitBatch(batch, config.CHUNK_SIZE);
    const results = await Promise.all(chunks.map(chunk => sendBatchToServer(chunk, retryCount)));
    return results.every(r => r === true);
  }

  const payload = JSON.stringify({ logs: batch });
  const blob = new Blob([payload], { type: 'application/json' });

  // التحقق من حجم الدفعة قبل sendBeacon
  if (blob.size > config.BEACON_MAX_SIZE) {
    logError(`Batch size (${blob.size} bytes) exceeds sendBeacon limit. Splitting further.`);
    // تقسيم الدفعة إلى قطع أصغر (بناءً على عدد الأحداث)
    const chunks = splitBatch(batch, Math.max(1, Math.floor(batch.length / 2)));
    const results = await Promise.all(chunks.map(chunk => sendBatchToServer(chunk, retryCount)));
    return results.every(r => r === true);
  }

  try {
    // إلغاء أي طلب سابق معلق
    cancelPendingRequest();

    // إضافة توقيع إذا كان مفعلاً
    let signature = null;
    if (config.ENABLE_SIGNATURE && config.SIGNATURE_SECRET) {
      signature = await generateSignature(payload);
    }

    // استخدام sendBeacon إذا كان ممكناً وحجماً مناسباً
    if (navigator.sendBeacon && blob.size <= config.BEACON_MAX_SIZE) {
      const success = navigator.sendBeacon(config.API_ENDPOINT, blob);
      if (!success) {
        throw new Error('sendBeacon failed to enqueue');
      }
      logInfo(`Batch sent via sendBeacon (${batch.length} events)`);
      return true;
    }

    // استخدام fetch مع keepalive و credentials
    abortController = new AbortController();
    const fetchOptions = {
      method: 'POST',
      body: blob,
      keepalive: true,
      signal: abortController.signal,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (config.INCLUDE_CREDENTIALS) {
      fetchOptions.credentials = 'include';
    }
    if (signature) {
      fetchOptions.headers['X-Audit-Signature'] = signature;
    }

    const response = await fetch(config.API_ENDPOINT, fetchOptions);
    abortController = null;

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    logInfo(`Batch sent via fetch (${batch.length} events)`);
    return true;
  } catch (error) {
    // إذا كان الخطأ بسبب الإلغاء، نعتبره ناجحاً (لأنه تم استبداله بطلب أحدث)
    if (error.name === 'AbortError') {
      logInfo('Request was aborted due to new batch.');
      return true;
    }

    logError(`Failed to send batch (attempt ${retryCount + 1}/${config.RETRY_LIMIT})`, error);

    if (retryCount < config.RETRY_LIMIT - 1) {
      await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY));
      return sendBatchToServer(batch, retryCount + 1);
    } else {
      logError('Max retries reached. Saving batch to local storage.');
      saveFailedBatch(batch);
      return false;
    }
  }
};

// ==============================
// الواجهة العامة (API)
// ==============================

export const securityAudit = {
  /**
   * تهيئة النظام بإعدادات مخصصة.
   * @param {Object} options - خيارات التهيئة (جميع المفاتيح اختيارية).
   */
  init(options = {}) {
    config = { ...config, ...options };
    // محاولة تفريغ الأحداث المخزنة محلياً
    flushLocalStorageQueue();
  },

  /**
   * تسجيل حدث جديد في الطابور.
   * @param {string} action - نوع الحدث (مثل 'EXAM_STARTED', 'DEVTOOLS_OPENED').
   * @param {Object} metadata - بيانات إضافية (اختياري).
   */
  logEvent(action, metadata = {}) {
    // التحقق من صحة المدخلات
    if (typeof action !== 'string' || action.trim() === '') {
      logError('Invalid action: must be a non-empty string.');
      return;
    }
    if (typeof metadata !== 'object' || metadata === null) {
      logError('Invalid metadata: must be an object.');
      return;
    }

    const event = {
      action,
      timestamp: Date.now(),
      path: isServer ? 'server' : window.location.pathname,
      userAgent: isServer ? 'server' : navigator.userAgent,
      payload: metadata,
    };

    // في بيئة السيرفر، نستخدم errorLogger إن وجد
    if (isServer) {
      import('../helpers/errorLogger')
        .then(({ errorLogger }) => {
          errorLogger.log({ status: action, details: JSON.stringify(metadata) });
        })
        .catch(e => logError('Failed to import errorLogger on server', e));
      return;
    }

    // في العميل، نضيف إلى الطابور
    logQueue.push(event);

    // إذا وصلنا للحد الأقصى، نرسل فوراً
    if (logQueue.length >= config.BATCH_SIZE_LIMIT) {
      this.flushQueue();
    } else if (!batchTimeout) {
      // وإلا نضبط مؤقتاً للإرسال الدوري
      batchTimeout = setTimeout(() => this.flushQueue(), config.FLUSH_INTERVAL);
    }
  },

  /**
   * تفريغ الطابور الحالي وإرساله للخادم.
   */
  async flushQueue() {
    if (logQueue.length === 0 || isServer) return;

    // نسخ الطابور وإعادة تعيينه فوراً لتجنب فقدان الأحداث الجديدة
    const currentBatch = [...logQueue];
    logQueue = [];
    clearTimeout(batchTimeout);
    batchTimeout = null;

    // إلغاء أي طلب سابق (لأننا سنرسل دفعة أحدث)
    cancelPendingRequest();

    await sendBatchToServer(currentBatch);
  },

  /**
   * إفراغ الطابور يدوياً (مفيد عند تسجيل الخروج).
   */
  async clearQueue() {
    if (isServer) return;
    // إلغاء أي طلب معلق
    cancelPendingRequest();
    // تفريغ الطابور الحالي
    await this.flushQueue();
    // مسح localStorage
    try {
      localStorage.removeItem(config.LOCAL_STORAGE_KEY);
      logInfo('Queue cleared manually.');
    } catch (e) {
      logError('Failed to clear local storage queue', e);
    }
  },

  /**
   * الحصول على عدد الأحداث المعلقة في الطابور.
   */
  getQueueSize() {
    return logQueue.length;
  },

  /**
   * الحصول على عدد الأحداث المخزنة في Local Storage.
   */
  getStoredQueueSize() {
    if (isServer) return 0;
    try {
      const stored = JSON.parse(localStorage.getItem(config.LOCAL_STORAGE_KEY) || '[]');
      return stored.length;
    } catch {
      return 0;
    }
  },
};

// ==============================
// أحداث المتصفح (لضمان الإرسال عند الإغلاق)
// ==============================

if (!isServer) {
  // عند تغيير حالة الرؤية (تبويب مخفي أو مغلق)
  window.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      securityAudit.flushQueue();
    }
  });

  // عند إغلاق الصفحة أو التبويب (نسخة احتياطية)
  window.addEventListener('beforeunload', () => {
    securityAudit.flushQueue();
  });

  // محاولة تفريغ التخزين المحلي عند تحميل الصفحة
  window.addEventListener('load', () => {
    securityAudit.init();
  });

  // إذا كان هناك أحداث معلقة عند إعادة التحميل، نحاول إرسالها
  window.addEventListener('unload', () => {
    securityAudit.flushQueue();
  });
}

// ==============================
// تصدير افتراضي للتوافق
// ==============================
export default securityAudit;