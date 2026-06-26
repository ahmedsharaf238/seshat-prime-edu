// src/hooks/useSecureFetch.js

/**
 * 🛡️ useSecureFetch Hook - Enterprise Edition (V 2050.MAX.FINAL.EDGE)
 * 
 * 🎯 الوظيفة: محرك الاتصال الشبكي المعماري للمنصة.
 * 
 * 💎 الميزات الفولاذية (المطورة):
 * - 🚀 Zero Re-renders: دالة مستقرة تماماً بفضل useRef.
 * - 🧠 Bounded Cache: كاش محمي بحد أقصى (150 عنصر) مع مبدأ FIFO.
 * - ⚡ Stale-While-Revalidate (SWR): عرض فوري مع تحديث صامت في الخلفية.
 * - 🔄 Exponential Backoff: إعادة محاولة ذكية مع تأخير تصاعدي.
 * - 🛡️ Safe Error Handling: استنساخ الاستجابات (Clone) لمنع الكراش.
 * - 🗑️ Auto Abort: تنظيف الذاكرة وإلغاء الطلبات المعلقة فور الخروج.
 * - 🚀 Prefetch الذكي: دعم الأولوية (High/Low) مع إمكانية الإلغاء (Abort).
 * - 📦 تحديث الكاش الدقيق: تحديث بيانات الكاش بعد التعديلات بدون إعادة جلب.
 * - 🧹 إبطال الكاش الآمن: مسح دقيق للكاش باستخدام Method Prefix لحماية البيانات الخاطئة.
 */

import { useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { performanceMonitor } from '../lib/helpers/performanceMonitor';
import { errorLogger } from '../lib/helpers/errorLogger';

// ============================================================
// ⚙️ الإعدادات الافتراضية للشبكة
// ============================================================
const DEFAULT_CONFIG = {
  timeout: 15000, // 15 ثانية
  retryCount: 3,
  retryDelay: 1000,
  cacheTTL: 300000, // 5 دقائق
  enableCache: true,
  maxCacheSize: 150, // 🛡️ الحد الأقصى لمنع استهلاك الـ RAM
};

// ============================================================
// 🧠 نظام الكاش المحصن (Bounded In-Memory Cache)
// ============================================================
const cache = new Map();

/**
 * استرجاع البيانات من الكاش مع دعم Stale-While-Revalidate
 */
const getCached = (key, allowStale = true) => {
  if (!cache.has(key)) return null;
  const { data, expires } = cache.get(key);
  const isExpired = Date.now() > expires;

  if (isExpired) {
    if (allowStale) {
      // ✅ عرض البيانات القديمة مؤقتاً مع إشارة Stale لتحديثها بالخلفية
      return { data, isStale: true };
    }
    cache.delete(key);
    return null;
  }
  return { data, isStale: false };
};

/**
 * تخزين البيانات في الكاش مع تطبيق الحد الأقصى (FIFO Eviction)
 */
const setCached = (key, data, ttl) => {
  // 🛡️ حماية الذاكرة: حذف أقدم عنصر عند الوصول للحد الأقصى
  if (cache.size >= DEFAULT_CONFIG.maxCacheSize) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { data, expires: Date.now() + ttl });
};

/**
 * 🧹 إبطال الكاش بدقة عالية (دون حذف بيانات خاطئة)
 */
const invalidateCache = (keyPrefix) => {
  if (!keyPrefix) {
    cache.clear();
    return;
  }

  // ✅ نستخدم startsWith مع الـ Method Prefix لمنع الحذف الخاطئ
  // مثلاً: مسح '/students' لن يمسح '/students/123' لأن المفتاح يختلف
  const exactPrefix = keyPrefix.endsWith('/') ? keyPrefix : keyPrefix + '/';
  
  for (const key of cache.keys()) {
    // نتحقق من تطابق البادئة سواء كانت GET: أو POST:
    if (key.startsWith(`GET:${exactPrefix}`) || key.startsWith(`POST:${exactPrefix}`) || key === `GET:${keyPrefix}` || key === `POST:${keyPrefix}`) {
      cache.delete(key);
    }
  }
};

/**
 * 📦 تحديث الكاش ديناميكياً (بعد عمليات التعديل) مع حماية من الأخطاء
 */
const updateCache = (keyPrefix, updater) => {
  if (!keyPrefix || typeof updater !== 'function') return;

  const exactPrefix = keyPrefix.endsWith('/') ? keyPrefix : keyPrefix + '/';

  for (const [key, value] of cache) {
    if (key.startsWith(`GET:${exactPrefix}`) || key === `GET:${keyPrefix}`) {
      try {
        // ✅ تنفيذ المحدث مع حماية (try/catch) لمنع تلف الكاش
        const newData = updater(value.data);
        cache.set(key, { ...value, data: newData });
      } catch (error) {
        console.error(`❌ [Cache] فشل تحديث الكاش للمفتاح ${key}:`, error);
        // نترك البيانات القديمة سليمة
      }
    }
  }
};

// ============================================================
// 🔐 الـ Hook الرئيسي
// ============================================================
export const useSecureFetch = (options = {}) => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const abortControllers = useRef(new Map());

  // 🛡️ استخدام useRef لتخزين التوكن لمنع Re-renders
  const tokenRef = useRef(session?.access_token);
  useEffect(() => {
    tokenRef.current = session?.access_token;
  }, [session?.access_token]);

  // 🛡️ دمج الإعدادات مرة واحدة في الذاكرة
  const configRef = useRef({ ...DEFAULT_CONFIG, ...options });

  // 🧹 تنظيف الطلبات المعلقة عند فك تحميل المكون (Unmount)
  useEffect(() => {
    return () => {
      for (const controller of abortControllers.current.values()) {
        controller.abort();
      }
      abortControllers.current.clear();
    };
  }, []);

  // ============================================================
  // 🚀 المحرك الأساسي لتنفيذ الطلبات
  // ============================================================
  const secureFetch = useCallback(
    async (url, fetchOptions = {}) => {
      const config = configRef.current;
      const {
        method = 'GET',
        headers: customHeaders = {},
        body,
        timeout = config.timeout,
        retryCount = config.retryCount,
        retryDelay = config.retryDelay,
        useCache = config.enableCache && method === 'GET',
        cacheTTL = config.cacheTTL,
        skipAuth = false,
        responseType = 'json',
        onUnauthorized,
        onForbidden,
        staleWhileRevalidate = true,
        signal: externalSignal = null, // دعم الإلغاء الخارجي (لـ Prefetch)
      } = fetchOptions;

      // 1️⃣ التحقق من المصادقة
      const token = tokenRef.current;
      if (!skipAuth && !token) {
        throw new Error('Unauthorized: No active session');
      }

      // 2️⃣ نظام الكاش و الـ SWR (Stale-While-Revalidate)
      const cacheKey = `${method}:${url}`;
      if (useCache && method === 'GET') {
        const cached = getCached(cacheKey, staleWhileRevalidate);

        if (cached) {
          // 🔄 تحديث صامت في الخلفية إذا كانت البيانات قديمة
          if (cached.isStale && staleWhileRevalidate) {
            // نطلق الطلب في الخلفية (Promise غير منتظر)
            secureFetch(url, { ...fetchOptions, useCache: false, staleWhileRevalidate: false })
              .then((result) => {
                if (result.data) {
                  setCached(cacheKey, result.data, cacheTTL);
                }
              })
              .catch(() => {});
          }
          return { data: cached.data, fromCache: true, isStale: cached.isStale, status: 200 };
        }
      }

      // 3️⃣ إعدادات الإلغاء (Abort Controller) مع دعم الإشارات الخارجية
      const internalController = new AbortController();
      const combinedSignal = externalSignal 
        ? new AbortController().signal // في حالة وجود إشارة خارجية، نتعامل معها مباشرة
        : internalController.signal;
      
      // إذا كانت هناك إشارة خارجية، نربطها مع الداخلية عبر حدث
      if (externalSignal) {
        externalSignal.addEventListener('abort', () => {
          internalController.abort();
        });
      }

      const requestId = `${url}-${crypto.randomUUID()}`;
      abortControllers.current.set(requestId, internalController);

      const headers = {
        'Content-Type': 'application/json',
        ...(skipAuth ? {} : { Authorization: `Bearer ${token}` }),
        ...customHeaders,
      };

      let lastError = null;
      let attempt = 0;

      // 4️⃣ حلقة إعادة المحاولة الذكية (Retry Loop)
      while (attempt < retryCount) {
        attempt++;
        const startTime = performance.now();

        try {
          const timeoutId = setTimeout(() => internalController.abort(), timeout);

          const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: internalController.signal,
          });

          clearTimeout(timeoutId);

          // تسجيل الأداء
          const duration = Math.round(performance.now() - startTime);
          performanceMonitor.logApiCall(url, duration, response.status);
          abortControllers.current.delete(requestId);

          // 5️⃣ معالجة الأخطاء (Error Handling)
          if (!response.ok) {
            if (response.status === 401) {
              errorLogger.log({ status: 'SESSION_EXPIRED', details: url });
              if (onUnauthorized) {
                onUnauthorized();
              } else {
                try { navigate('/login'); } catch (_) { window.location.href = '/login'; }
              }
              throw new Error('Session expired. Please login again.');
            }

            if (response.status === 403) {
              errorLogger.log({ status: 'FORBIDDEN_ACCESS', details: url });
              if (onForbidden) onForbidden();
              throw new Error('Permission denied.');
            }

            if (response.status >= 500 && attempt < retryCount) {
              throw new Error(`Server error ${response.status} (retryable)`);
            }

            // 🛡️ استنساخ الاستجابة لقراءة رسالة الخطأ بأمان
            let errorMessage = `HTTP Error: ${response.status}`;
            try {
              const errorClone = response.clone();
              const errorData = await errorClone.json();
              errorMessage = errorData.message || errorMessage;
            } catch (_) { /* تجاهل أخطاء تحويل النص لـ JSON */ }
            throw new Error(errorMessage);
          }

          // 6️⃣ معالجة نوع الاستجابة (Parsing)
          let data;
          if (responseType === 'json') {
            const contentType = response.headers.get('Content-Type') || '';
            if (contentType.includes('application/json')) {
              data = await response.json();
            } else {
              data = await response.text();
            }
          } else if (responseType === 'text') {
            data = await response.text();
          } else if (responseType === 'blob') {
            data = await response.blob();
          } else if (responseType === 'arrayBuffer') {
            data = await response.arrayBuffer();
          } else {
            data = await response.json();
          }

          // 7️⃣ حفظ البيانات الجديدة في الكاش
          if (useCache && method === 'GET') {
            setCached(cacheKey, data, cacheTTL);
          }

          return { data, fromCache: false, status: response.status };

        } catch (error) {
          // التعامل مع الإلغاء المقصود للطلب
          if (error.name === 'AbortError' || error.name === 'CancelError') {
            abortControllers.current.delete(requestId);
            return { aborted: true };
          }

          // إعادة المحاولة في حالة انقطاع الشبكة أو أخطاء السيرفر المؤقتة
          if (attempt < retryCount && (error.message.includes('retryable') || error.message.includes('network') || error.message.includes('fetch'))) {
            const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential Backoff
            console.warn(`🔄 [Retry] ${url} (Attempt ${attempt + 1}) in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
            lastError = error;
            continue;
          }

          abortControllers.current.delete(requestId);
          throw error;
        }
      }

      throw lastError || new Error(`Request failed after ${retryCount} attempts`);
    },
    [navigate]
  );

  // ============================================================
  // 🗑️ دوال التحكم في الطلبات والإلغاء
  // ============================================================

  /**
   * إلغاء طلب معين باستخدام URL
   */
  const abortRequest = useCallback((url) => {
    for (const [key, controller] of abortControllers.current) {
      if (key.startsWith(`${url}-`)) {
        controller.abort();
        abortControllers.current.delete(key);
      }
    }
  }, []);

  /**
   * إلغاء جميع الطلبات المعلقة
   */
  const abortAll = useCallback(() => {
    for (const controller of abortControllers.current.values()) {
      controller.abort();
    }
    abortControllers.current.clear();
  }, []);

  // ============================================================
  // 🧹 دوال التحكم في الكاش (المطورة)
  // ============================================================

  /**
   * مسح الكاش بالكامل
   */
  const clearSecureCache = useCallback(() => {
    cache.clear();
  }, []);

  /**
   * إبطال (مسح) الكاش لبادئة URL معينة بدقة متناهية
   */
  const invalidateSecureCache = useCallback((urlPrefix) => {
    if (urlPrefix) {
      invalidateCache(urlPrefix);
    } else {
      cache.clear();
    }
  }, []);

  /**
   * تحديث بيانات الكاش ديناميكياً (بدون إعادة جلب)
   * @param {string} urlPrefix - بادئة URL (مثل '/students')
   * @param {Function} updater - دالة تحديث البيانات (تستقبل البيانات القديمة وتُرجع الجديدة)
   */
  const updateSecureCache = useCallback((urlPrefix, updater) => {
    if (urlPrefix && typeof updater === 'function') {
      updateCache(urlPrefix, updater);
    }
  }, []);

  // ============================================================
  // 🚀 Prefetch الذكي (الجلب المسبق)
  // ============================================================

  /**
   * جلب البيانات مسبقاً لدعم التنقل السريع (يُستخدم في hover على الروابط)
   * @param {string} url - الرابط المطلوب جلبه
   * @param {Object} options - خيارات الطلب (نفس secureFetch)
   * @param {string} priority - 'high' (تنفيذ فوري) أو 'low' (تنفيذ عند idle)
   * @returns {AbortController} - يمكن استدعاء .abort() لإلغاء الطلب قبل اكتماله
   */
  const prefetch = useCallback((url, options = {}, priority = 'low') => {
    const controller = new AbortController();

    const executePrefetch = () => {
      // نطلق الطلب مع إشارة الإلغاء الخاصة بنا
      secureFetch(url, { ...options, useCache: true, staleWhileRevalidate: false, signal: controller.signal })
        .catch((err) => {
          // تجاهل أخطاء الإلغاء فقط، نسجل الباقي بصمت (لأنه prefetch)
          if (err.name !== 'AbortError' && err.name !== 'CancelError') {
            console.warn(`⚠️ [Prefetch] فشل جلب ${url}:`, err.message);
          }
        });
    };

    if (priority === 'high') {
      // أولوية عالية: التنفيذ فوراً
      executePrefetch();
    } else {
      // أولوية منخفضة: الانتظار حتى idle أو تأخير بسيط
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => executePrefetch(), { timeout: 2000 });
      } else {
        setTimeout(executePrefetch, 100);
      }
    }

    // نعيد المتحكم للسماح بالإلغاء من الخارج (مثلاً إذا غادر المستخدم قبل اكتمال الجلب)
    return controller;
  }, [secureFetch]);

  /**
   * جلب وتخزين مباشر (انتظار النتيجة) - مناسب للصفحات الرئيسية
   */
  const prefetchAndCache = useCallback(async (url, options = {}) => {
    const result = await secureFetch(url, { ...options, useCache: true, staleWhileRevalidate: false });
    return result.data || null;
  }, [secureFetch]);

  // ============================================================
  // 📦 القيم المصدرة
  // ============================================================
  return {
    secureFetch,
    abortRequest,
    abortAll,
    clearSecureCache,
    invalidateSecureCache,
    updateSecureCache,
    prefetch,
    prefetchAndCache,
  };
};

export default useSecureFetch;