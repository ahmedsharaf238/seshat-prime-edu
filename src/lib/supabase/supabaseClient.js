// src/lib/supabase/supabaseClient.js
/**
 * 🌐 THE UNBREAKABLE SUPABASE OMNI-CLIENT ENGINE (2050-READY)
 * 🛡️ Security: Sealed Proxy Membrane, Sanitized Storage Safeguard, XSS Shield
 * 💰 Cost/Performance: Active Realtime Throttling & Non-Blocking Safe Queue
 * 📡 Resilience: Non-Serializable Safe Offline Queuing
 */

import { createClient } from '@supabase/supabase-js';
import { errorLogger } from '../helpers/errorLogger';

// ==========================================
// 1. 🌐 كاشف البيئة الذكي (Universal Environment Detector)
// ==========================================
const isServer = typeof window === 'undefined' || typeof document === 'undefined';
const isBrowser = !isServer;

const getClientEnv = (key) => {
  if (isBrowser && window.__ENV__?.[key]) return window.__ENV__[key];
  if (typeof import.meta !== 'undefined' && import.meta.env?.[key]) return import.meta.env[key];
  if (process.env?.[key]) return process.env[key];
  return null;
};

const SUPABASE_URL = getClientEnv('VITE_SUPABASE_URL') || getClientEnv('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_ANON_KEY = getClientEnv('VITE_SUPABASE_ANON_KEY') || getClientEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('❌ CRITICAL: Supabase Public Keys are missing from environment.');
}

// ==========================================
// 2. 📡 إدارة طابور الشبكة الآمن (Sanitized Offline Buffer)
// ==========================================
const OFFLINE_QUEUE_KEY = 'core_sys_spb_queue_v3';

/**
 * فلترة وتطهير البيانات قبل تخزينها لمنع تسريب التوكنز والبيانات الحساسة
 * وتجنب انهيار التطبيق بسبب الكائنات غير القابلة للتسلسل (Non-Serializable)
 */
const sanitizeAndQueue = (url, options) => {
  try {
    if (!isBrowser) return;

    // منع تخزين عمليات التوثيق الحساسة ككلمات المرور لتجنب سرقتها من الكاش
    if (url.includes('/auth/v1/token') || url.includes('/auth/v1/signup')) return;

    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    
    // استخلاص البيانات القابلة للتسلسل فقط بدلاً من تمرير كائن options بالكامل
    const sanitizedItem = {
      url,
      method: options?.method || 'GET',
      body: options?.body ? String(options.body) : null,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      timestamp: Date.now()
    };

    queue.push(sanitizedItem);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    if (typeof errorLogger?.log === 'function') {
      errorLogger.log({ status: 'OFFLINE_QUEUE_ERROR', details: err.message });
    }
  }
};

const flushOfflineQueue = async () => {
  if (!isBrowser || !navigator.onLine) return;
  
  try {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    if (queue.length === 0) return;

    localStorage.removeItem(OFFLINE_QUEUE_KEY); // قفل الطابور مؤقتاً لتجنب تكرار العمليات (Race Condition)

    for (const req of queue) {
      try {
        // عدم إرسال طلبات مضى عليها أكثر من 24 ساعة لضمان سلامة البيانات (Data Freshness)
        if (Date.now() - req.timestamp > 86400000) continue; 

        await fetch(req.url, {
          method: req.method,
          body: req.body,
          headers: req.headers
        });
      } catch (_) {
        // إعادة إدخال الطلب الفاشل مجدداً في الخلفية
        sanitizeAndQueue(req.url, req);
      }
    }
  } catch (_) { /* حماية صامتة ضد الأخطاء الكارثية */ }
};

// ==========================================
// 3. 🧠 الشبكة الذكية (Adaptive Jitter Fetch)
// ==========================================
const smartFetch = async (url, options, retries = 2, delay = 1000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000); // 7 ثوانٍ مثالية لسرعة استجابة المستخدم

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...options?.headers,
        'X-Client-Platform': 'Universal-Web-Membrane',
        'X-Engine-Version': '2050.3.1',
      }
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    const isTimeout = error.name === 'AbortError' || error.name === 'TimeoutError';
    const isOffline = isBrowser && !navigator.onLine;

    if (isOffline && options?.method !== 'GET') {
      sanitizeAndQueue(url, options);
      // نرمي خطأ شبكة طبيعي ليفهم الـ SDK أن العميل أوفلاين ويدير حالته الداخلية دون تدمير الـ State
      throw new TypeError('Network request failed due to offline state. Buffered in local membrane.');
    }

    if (typeof errorLogger?.log === 'function') {
      errorLogger.log({
        status: 'NETWORK_EXCEPTION',
        details: `Fetch failure at ${url}`,
        metadata: { message: error.message, isTimeout }
      });
    }

    // الارتداد الأسي الذكي مع الـ Jitter العشوائي لمنع اختناق السيرفر
    if ((isTimeout || error.message?.includes('Failed to fetch')) && retries > 0) {
      const jitter = Math.random() * 250;
      await new Promise((res) => setTimeout(res, delay + jitter));
      return smartFetch(url, options, retries - 1, delay * 2);
    }

    throw error;
  }
};

// ==========================================
// 4. 🧬 تهيئة محرك العميل وعزله
// ==========================================
const CLIENT_SYMBOL = Symbol.for('app.core.supabase.client.v3');

if (!globalThis[CLIENT_SYMBOL]) {
  globalThis[CLIENT_SYMBOL] = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: isBrowser,
      persistSession: isBrowser, // 🛡️ حماية حاسمة للـ SSR من تسريب الجلسات
      detectSessionInUrl: isBrowser,
      flowType: 'pkce',
      storageKey: 'sb-universal-auth-shield',
    },
    realtime: { params: { eventsPerSecond: 2 } },
    db: { schema: 'public' },
    global: {
      fetch: (url, options) => smartFetch(url, options),
    },
  });
}

// ==========================================
// 5. 🛡️ غشاء الـ Proxy المعزول ضد الـ XSS والـ Prototype Pollution
// ==========================================
const createClientMembrane = (target) => {
  const shadowCache = Object.create(null);

  return new Proxy(target, {
    get(obj, prop) {
      if (prop === '__proto__' || prop === 'prototype' || prop === 'constructor') {
        return undefined; // حظر فوري وقاطع لمحاولات تلوث النموذج البدئي
      }

      const value = Reflect.get(obj, prop);
      if (value && typeof value === 'object') {
        if (!shadowCache[prop]) {
          shadowCache[prop] = createClientMembrane(value);
        }
        return shadowCache[prop];
      }
      return typeof value === 'function' ? value.bind(obj) : value;
    },
    set() { return false; }, // تجميد كامل ضد محاولات الحقن والتعديل الخارجي
    defineProperty() { return false; },
    deleteProperty() { return false; },
  });
};

export const supabase = createClientMembrane(globalThis[CLIENT_SYMBOL]);
export const supabaseClient = supabase;

// ==========================================
// 6. 📡 الإدارة الحركية للـ Realtime والشبكة (Resource Optimization)
// ==========================================
if (isBrowser) {
  // تفريغ الطابور فور عودة الإنترنت
  window.addEventListener('online', () => {
    flushOfflineQueue();
  });

  /**
   * التوفير الصارم للموارد والبطارية (Visibility-Aware Engine):
   * عندما يغلق المستخدم شاشة الهاتف أو يخفي التبويب، نقوم بفصل اتصالات الـ Realtime
   * لتقليل استهلاك البطارية والشبكة والحد من الحوسبة السحابية غير الضرورية (Zero-Cost Optimization).
   */
  document.addEventListener('visibilitychange', () => {
    const channels = supabase.getChannels?.() || [];
    if (document.hidden) {
      // فصل قنوات البث الحي مؤقتاً لتوفير الطاقة
      channels.forEach(ch => ch.unsubscribe());
    } else {
      // إعادة ربط القنوات حياً بمجرد عودة المستخدم للموقع
      channels.forEach(ch => ch.subscribe());
      flushOfflineQueue();
    }
  });
}

export default supabaseClient;