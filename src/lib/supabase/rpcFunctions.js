// src/lib/supabase/rpcFunctions.js

/**
 * 📡 RPC Functions (V 2050.MAX - Titanium Ultimate Corrected)
 * * 🛡️ المميزات الأمنية والهندسية الفولاذية:
 * - True Network Abort: إجهاض حقيقي لطلب الشبكة من الجذور عبر .abortSignal() لمنع استهلاك اتصالات الـ DB.
 * - Deep Copy Protection: حماية الكاش من التلف عبر استنساخ البيانات عميقاً (structuredClone) لمنع تسريب المراجع.
 * - LRU Cache Guard: حماية الذاكرة من الانفجار بتحديد حد أقصى لحجم الكاش (Max Cache Size).
 * - Request Deduplication: منع هجمات القطيع الهائج بتجميع الطلبات المتزامنة المتطابقة في طلب شبكة واحد.
 * - Error Sanitization & Bulletproof Validation: تعقيم الأخطاء والتحقق الصارم من المعاملات.
 */

import { supabase } from './supabaseClient';

// ============================================================
// ⚙️ 1. الإعدادات العامة
// ============================================================
export const CONFIG = {
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000,
  TIMEOUT: 15000,
  CACHE_TTL: 300000,       // 5 دقائق لصلاحية الكاش
  MAX_CACHE_SIZE: 200,     // أقصى عدد سجلات في الكاش لمنع انفجار الذاكرة
};

// ============================================================
// 🧠 2. نظام الكاش الذكي الآمن والمحدود
// ============================================================
const cache = new Map();
const pendingRequests = new Map(); // لتثبيط الطلبات المتزامنة المتطابقة

// دالة للاستنساخ العميق الآمن لحماية البيانات من التعديل الخارجي
const cloneData = (data) => {
  if (!data) return data;
  try {
    return typeof structuredClone !== 'undefined' ? structuredClone(data) : JSON.parse(JSON.stringify(data));
  } catch {
    return data;
  }
};

const getCached = (key) => {
  if (!cache.has(key)) return null;
  const { data, expires } = cache.get(key);
  if (Date.now() > expires) {
    cache.delete(key);
    return null;
  }
  return cloneData(data); // إرجاع نسخة مستنسخة لحماية الكاش الأساسي
};

const setCached = (key, data, ttl = CONFIG.CACHE_TTL) => {
  // حماية الذاكرة: حذف أقدم عنصر إذا تجاوزنا الحد الأقصى
  if (cache.size >= CONFIG.MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { data: cloneData(data), expires: Date.now() + ttl });
};

// ============================================================
// 🛡️ 3. التحقق وتعقيم الأخطاء
// ============================================================
const isValidUUID = (id) => {
  if (!id || typeof id !== 'string') return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(id);
};

const validateParams = (rpcName, params = {}) => {
  if (rpcName === 'get_student_stats' || rpcName === 'get_exam_report') {
    if (!isValidUUID(params?.student_uuid)) return { valid: false, error: 'معرّف الطالب غير صحيح.' };
  }
  if (rpcName === 'get_parent_children') {
    if (!isValidUUID(params?.parent_uuid)) return { valid: false, error: 'معرّف ولي الأمر غير صحيح.' };
  }
  if (rpcName === 'verify_verification_code') {
    if (!params?.phone || params.phone.length < 10) return { valid: false, error: 'رقم الهاتف غير صحيح.' };
    if (!params?.code || params.code.length < 4) return { valid: false, error: 'رمز التحقق غير صحيح.' };
  }
  return { valid: true, error: null };
};

const sanitizeError = (error) => {
  const msg = error?.message || '';
  if (msg.includes('not found') || error?.code === 'PGRST116') return 'البيانات المطلوبة غير موجودة.';
  if (msg.includes('violates foreign key')) return 'العملية مرفوضة: البيانات مرتبطة بسجلات أخرى.';
  if (msg.includes('violates unique')) return 'هذا السجل موجود بالفعل في النظام.';
  if (msg.includes('timeout') || msg.includes('AbortError') || msg.includes('aborted')) return 'انتهت مهلة الاتصال بالسيرفر. يرجى المحاولة مرة أخرى.';
  return 'حدث خطأ داخلي أثناء معالجة الطلب.'; 
};

// ============================================================
// 🚀 4. المُنفذ الذكي الأساسي (Core Executor)
// ============================================================
const executeRPC = async (rpcName, params = {}, options = {}) => {
  const validation = validateParams(rpcName, params);
  if (!validation.valid) {
    console.warn(`[RPC Validation Failed] "${rpcName}": ${validation.error}`);
    return { success: false, error: validation.error, data: null };
  }

  const cacheKey = `${rpcName}:${JSON.stringify(params)}`;
  const cacheable = options.cache === true;
  const forceRefresh = options.forceRefresh === true;

  // 1. فحص الكاش
  if (cacheable && !forceRefresh) {
    const cachedData = getCached(cacheKey);
    if (cachedData) {
      return { success: true, error: null, data: cachedData, fromCache: true };
    }
  }

  // 2. تثبيط الطلبات المتزامنة (Deduplication)
  if (pendingRequests.has(cacheKey) && !forceRefresh) {
    console.log(`🔗 [RPC Deduplication] دمج الطلب المتزامن لـ "${rpcName}"`);
    return pendingRequests.get(cacheKey);
  }

  // صياغة الوعد (Promise) الخاص بالطلب الحالي
  const requestPromise = (async () => {
    const retryCount = options.retries ?? CONFIG.RETRY_COUNT;
    const retryDelay = options.retryDelay ?? CONFIG.RETRY_DELAY;
    const timeoutMs = options.timeout ?? CONFIG.TIMEOUT;

    let lastError = null;
    let attempt = 0;

    while (attempt < retryCount) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const startTime = performance.now();

        // ✅ الاستخدام الصحيح والوحيد للإجهاض الحقيقي في Supabase v2
        const { data, error } = await supabase
          .rpc(rpcName, params)
          .abortSignal(controller.signal);

        clearTimeout(timeoutId);
        const duration = Math.round(performance.now() - startTime);
        console.log(`⏱️ [RPC Success] "${rpcName}" in ${duration}ms (Attempt ${attempt})`);

        if (error) {
          console.error(`[RPC Server Error - ${rpcName}]:`, error.message);
          lastError = sanitizeError(error);
          
          if (error.code === 'PGRST116' || error.message.includes('not found') || error.message.includes('violates')) {
            return { success: false, error: lastError, data: null };
          }
          throw new Error(error.message);
        }

        if (cacheable) setCached(cacheKey, data);
        return { success: true, error: null, data: cloneData(data) };

      } catch (err) {
        clearTimeout(timeoutId);
        
        const isAbort = err.name === 'AbortError' || err.message?.includes('aborted');
        if (isAbort) {
          console.warn(`⏰ [RPC Timeout] "${rpcName}" exceeded ${timeoutMs}ms`);
          lastError = sanitizeError({ message: 'timeout' });
        } else {
          console.error(`[RPC Critical - ${rpcName}]:`, err);
          lastError = sanitizeError(err);
        }

        if (attempt < retryCount) {
          const delay = retryDelay * Math.pow(2, attempt - 1);
          console.warn(`🔄 [RPC Retry] "${rpcName}" Attempt ${attempt + 1} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    console.error(`❌ [RPC Failed] "${rpcName}" after ${retryCount} attempts.`);
    return { success: false, error: lastError || 'تعذر الاتصال بالسيرفر.', data: null };
  })();

  // تسجيل الطلب في قائمة الانتظار، وحذفه فور انتهائه لضمان انسيابية البيانات
  pendingRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally { // ✅ تم تصحيحها لتكون finally فقط
    pendingRequests.delete(cacheKey);
  }
};

// ============================================================
// 📦 5. تصدير دوال RPC
// ============================================================
export const getStudentStats = async (studentId, options = {}) => 
  executeRPC('get_student_stats', { student_uuid: studentId }, { cache: true, ...options });

export const getParentChildren = async (parentId, options = {}) => 
  executeRPC('get_parent_children', { parent_uuid: parentId }, { cache: true, ...options });

export const getExamReport = async (studentId, examId, options = {}) => 
  executeRPC('get_exam_report', { student_uuid: studentId, exam_uuid: examId }, { cache: true, ...options });

export const generateVerificationCode = async (phone) => 
  executeRPC('generate_verification_code', { phone }, { cache: false });

export const verifyCode = async (phone, code) => 
  executeRPC('verify_verification_code', { phone, code }, { cache: false });

export const resetSupervisorPassword = async (supervisorId) => 
  executeRPC('reset_supervisor_password', { supervisor_uuid: supervisorId }, { cache: false, retries: 2 });

export const cleanOldSessions = async (daysOld = 30) => 
  executeRPC('clean_old_sessions', { days_old: daysOld }, { cache: false, retries: 1, timeout: 30000 });

// ============================================================
// 🛠️ 6. دوال إدارة الكاش
// ============================================================
export const clearCache = (rpcName = null) => {
  if (rpcName) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${rpcName}:`)) cache.delete(key);
    }
    console.log(`🗑️ [Cache Cleared] RPC: "${rpcName}"`);
  } else {
    cache.clear();
    console.log('🗑️ [Cache Cleared] All caches wiped.');
  }
};

export const getCacheStats = () => ({
  size: cache.size,
  pending: pendingRequests.size,
  keys: Array.from(cache.keys()),
});

export default {
  generateVerificationCode,
  verifyCode,
  getStudentStats,
  getExamReport,
  getParentChildren,
  resetSupervisorPassword,
  cleanOldSessions,
  clearCache,
  getCacheStats,
};