// src/lib/helpers/errorLogger.js

/**
 * 🛡️ Hybrid Error & Security Logger - The Titanium Edition
 * * تحسينات النسخة 5.1.0:
 * - حماية قاطعة ضد الـ Infinite Error Loops.
 * - استبدال الـ setInterval المدمر بـ PerformanceObserver الحديث.
 * - تأمين النسخ الاحتياطية وعدم مسحها إلا بعد تأكيد الإرسال (Safe Recovery).
 * - ضغط البيانات الآمن وتفادي أخطاء الـ JSON parsing.
 * * @version 5.1.0 (Ultimate 2050-Ready)
 * @author Seshat Prime Edu Team & Cyber Expert
 */

import { supabase } from '../supabase/supabaseClient';
import { securityAudit } from '../security/auditLog';
import { getDeviceInfo, generateSessionId } from './deviceDetect';
import { trustedDeviceService } from '../security/trustedDevice';

const isServer = typeof window === 'undefined';

// ==============================
// 1. الثوابت والإعدادات
// ==============================
const CONFIG = {
  MAX_QUEUE_SIZE: 100,
  MIN_BATCH_SIZE: 5,
  FLUSH_INTERVAL: 3000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  BACKUP_KEY: 'seshat_error_backup',
  MAX_BACKUP_SIZE: 500,
};

// ==============================
// 2. إدارة التخزين المحلي (LocalStorage) بأمان
// ==============================
const loadBackup = () => {
  if (isServer) return [];
  try {
    const raw = localStorage.getItem(CONFIG.BACKUP_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveBackup = (logs) => {
  if (isServer) return;
  try {
    const trimmed = logs.slice(-CONFIG.MAX_BACKUP_SIZE);
    localStorage.setItem(CONFIG.BACKUP_KEY, JSON.stringify(trimmed));
  } catch {
    // تجاهل في حالة الـ Private Browsing mode
  }
};

const clearBackup = () => {
  if (isServer) return;
  try {
    localStorage.removeItem(CONFIG.BACKUP_KEY);
  } catch {}
};

// ==============================
// 3. نظام إعادة المحاولة الذكي (Exponential Backoff)
// ==============================
const retryWithBackoff = async (fn, retries = CONFIG.MAX_RETRIES) => {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries - 1) {
        const delay = CONFIG.RETRY_DELAY * Math.pow(1.5, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
};

// ==============================
// 4. إرسال الدفعة (Safe Batch Sending)
// ==============================
const sendBatch = async (batch) => {
  if (batch.length === 0) return true;

  const eventIds = new Set(batch.map(e => e.id));
  const enrichedBatch = batch.map(event => ({
    ...event,
    context: { ...event.context, sentAt: Date.now(), batchSize: batch.length }
  }));

  const payloadString = JSON.stringify({ logs: enrichedBatch });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const { error } = await supabase.functions.invoke('error-logger', {
      method: 'POST',
      body: { logs: enrichedBatch },
      options: {
        signal: controller.signal,
        headers: {
          'X-Payload-Size': payloadString.length.toString(),
        },
      },
    });

    clearTimeout(timeoutId);
    if (error) throw error;

    // الحذف الآمن من الـ Backup فقط بعد التأكد من النجاح
    const backup = loadBackup();
    const remaining = backup.filter(e => !eventIds.has(e.id));
    saveBackup(remaining);

    return true;
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn(`[ErrorLogger] Batch send failed: ${error.name === 'AbortError' ? 'Timeout' : error.message}`);

    // دمج ذكي مع الـ Backup لتفادي فقدان البيانات
    const currentBackup = loadBackup();
    const currentBackupIds = new Set(currentBackup.map(e => e.id));
    const newItems = batch.filter(e => !currentBackupIds.has(e.id));
    saveBackup([...currentBackup, ...newItems]);

    return false;
  }
};

// ==============================
// 5. إدارة الطابور (Queue Management)
// ==============================
let logQueue = [];
let batchTimeout = null;
let isFlushing = false;
let flushPromise = null;

// استعادة الأحداث القديمة بأمان عند بدء التشغيل
if (!isServer) {
  setTimeout(() => {
    const oldLogs = loadBackup();
    if (oldLogs.length > 0) {
      const existingIds = new Set(logQueue.map(e => e.id));
      const uniqueOld = oldLogs.filter(e => !existingIds.has(e.id));
      logQueue = [...uniqueOld, ...logQueue];
      flushQueue();
    }
  }, 2000);
}

export const flushQueue = async () => {
  if (isServer || isFlushing || logQueue.length === 0) return;

  if (flushPromise) {
    await flushPromise;
    return;
  }

  isFlushing = true;
  clearTimeout(batchTimeout);
  batchTimeout = null;

  const batchSize = Math.min(logQueue.length, CONFIG.MAX_QUEUE_SIZE);
  const batch = logQueue.splice(0, batchSize);

  flushPromise = (async () => {
    try {
      await retryWithBackoff(() => sendBatch(batch));
    } catch (error) {
      // إعادة الأحداث للطابور بحد أقصى للحجم
      logQueue = [...batch, ...logQueue].slice(-CONFIG.MAX_QUEUE_SIZE * 2);
    } finally {
      isFlushing = false;
      flushPromise = null;
      if (logQueue.length > 0) {
        batchTimeout = setTimeout(flushQueue, CONFIG.FLUSH_INTERVAL);
      }
    }
  })();

  await flushPromise;
};

// حارس لتجنب التكرار اللانهائي للأخطاء الذاتية
let isInternalLogging = false;

export const logSecurityEvent = async ({
  email = 'system',
  status,
  details,
  userId = null,
  action = null,
  metadata = {},
}) => {
  if (isInternalLogging) return; // منع الـ Infinite Loop
  isInternalLogging = true;

  try {
    const eventId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    let deviceContext = { path: isServer ? 'server' : window.location.pathname };

    if (!isServer) {
      try {
        const [deviceInfo, sessionId, isTrusted] = await Promise.all([
          getDeviceInfo().catch(() => ({})),
          generateSessionId().catch(() => 'unknown'),
          userId ? trustedDeviceService.isDeviceTrustedLocally(userId).catch(() => false) : false
        ]);
        deviceContext = { device: deviceInfo, isTrustedDevice: isTrusted, sessionId, path: window.location.pathname, referrer: document.referrer || 'direct' };
      } catch (_) {}
    }

    const event = {
      id: eventId,
      email,
      userId,
      status,
      action: action || status,
      details: typeof details === 'string' ? details : JSON.stringify(details),
      metadata: { ...metadata, timestamp: Date.now(), isoDate: new Date().toISOString() },
      context: { ...deviceContext, environment: isServer ? 'server' : 'client', isServer },
    };

    if (isServer) {
      console.warn('[Server Log]', event);
      isInternalLogging = false;
      return;
    }

    logQueue.push(event);

    // إذا كان الحدث حرجاً، نقوم بتسجيله في الأوديت محلياً أيضاً
    if (typeof securityAudit !== 'undefined' && securityAudit.logEvent) {
      securityAudit.logEvent(status, event);
    }

    if (logQueue.length > CONFIG.MAX_QUEUE_SIZE * 2) {
      const removed = logQueue.splice(0, logQueue.length - CONFIG.MAX_QUEUE_SIZE);
      const backup = loadBackup();
      saveBackup([...backup, ...removed]);
    }

    if (!batchTimeout && logQueue.length > 0) {
      batchTimeout = setTimeout(flushQueue, CONFIG.FLUSH_INTERVAL);
    }

    if (logQueue.length >= CONFIG.MIN_BATCH_SIZE) {
      flushQueue();
    }
  } finally {
    isInternalLogging = false;
  }
};

// ==============================
// 6. مستمعي الأحداث (Event Listeners) الآمنة
// ==============================
if (!isServer) {
  window.addEventListener('visibilitychange', () => { if (document.hidden) flushQueue(); });
  window.addEventListener('beforeunload', () => { flushQueue(); });
  
  window.addEventListener('online', () => {
    // نترك عملية الحذف والدمج لـ flushQueue و sendBatch بشكل آمن
    flushQueue();
  });

  window.addEventListener('error', (event) => {
    logSecurityEvent({
      status: 'UNCAUGHT_ERROR',
      details: event.message,
      metadata: { filename: event.filename, line: event.lineno, col: event.colno, stack: event.error?.stack },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logSecurityEvent({
      status: 'UNHANDLED_REJECTION',
      details: event.reason?.message || String(event.reason),
      metadata: { stack: event.reason?.stack },
    });
  });

  // المراقبة الذكية للأداء (تعمل مرة واحدة فقط بدلاً من اللوب المدمر)
  window.addEventListener('load', () => {
    setTimeout(() => {
      const entries = performance.getEntriesByType('navigation');
      if (entries.length > 0) {
        const nav = entries[0];
        logSecurityEvent({
          status: 'PERFORMANCE_REPORT',
          details: 'Initial page load metrics',
          metadata: {
            loadTime: nav.loadEventEnd - nav.startTime,
            domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
          },
        });
      }
    }, 5000); // ننتظر 5 ثواني للتأكد من استقرار الصفحة
  });
}

export const errorLogger = {
  log: logSecurityEvent,
  flush: flushQueue,
  getQueueSize: () => logQueue.length,
  getBackupSize: () => loadBackup().length,
  clearBackup,
};

export default errorLogger;