// src/lib/helpers/rateLimiter.js

/**
 * 🛡️ Rate Limiter Engine - The Titanium Vault Edition
 * 
 * الميزات المتقدمة (v4.0.0):
 * 1. حماية الـ Negative Caching: الكاش يخزن الحظر فقط لمنع استنزاف السيرفر، مع ضمان تسجيل كل محاولة شرعية.
 * 2. الفحص قبل الإدخال (Check-Before-Insert): لحماية قاعدة البيانات من التضخم المتعمد (DDoS).
 * 3. القائمة السوداء التلقائية (Auto-Blocklist) مع تسجيل أمني متكامل.
 * 4. سياسة Fallback Hybrid: في حال فشل قاعدة البيانات، لا يسقط النظام بل يعتمد على درع محلي صارم.
 * 
 * @version 4.0.0 (Strict Security Mode)
 * @author Seshat Prime Edu Team & Cyber Expert
 */

import { supabase } from '../supabase/supabaseClient';
import { errorLogger } from './errorLogger';
import { securityAudit } from '../security/auditLog';

const isServer = typeof window === 'undefined';

// ==============================
// 1. الثوابت والإعدادات
// ==============================

export const CONFIG = {
  LIMITS: {
    registration: { maxAttempts: 3, windowHours: 1 },
    login: { maxAttempts: 5, windowHours: 1 },
    password_reset: { maxAttempts: 3, windowHours: 1 },
    otp_verification: { maxAttempts: 5, windowHours: 24 },
    exam_attempt: { maxAttempts: 2, windowHours: 24 },
    content_download: { maxAttempts: 10, windowHours: 24 },
    default: { maxAttempts: 3, windowHours: 1 },
  },
  ENABLE_BLOCKLIST: true,
  BLOCKLIST_THRESHOLD: 10, // عدد التجاوزات قبل الحظر التلقائي
  BLOCKLIST_DURATION: 86400000, // 24 ساعة (بالمللي ثانية)
  LOCAL_SHIELD_TTL: 300000, // 5 دقائق حظر محلي في حال انقطاع DB
};

// ==============================
// 2. نظام الـ Negative Cache (للحظر فقط)
// ==============================

/**
 * يتم تخزين فقط حالات الحظر في الكاش المحلي
 * هذا يقلل استهلاك الذاكرة ويجعل الفحص أسرع
 */
const negativeCache = new Map();

/**
 * تخزين حظر مؤقت في الكاش المحلي
 * @param {string} identifier - معرف المستخدم (بريد أو رقم هاتف)
 * @param {string} resetTime - وقت انتهاء الحظر بصيغة ISO
 */
const setNegativeCache = (identifier, resetTime) => {
  negativeCache.set(identifier, { blockedUntil: new Date(resetTime).getTime() });
};

/**
 * التحقق مما إذا كان المستخدم محظوراً محلياً
 * @param {string} identifier - معرف المستخدم
 * @returns {boolean} true إذا كان محظوراً
 */
const isBlockedLocally = (identifier) => {
  if (!negativeCache.has(identifier)) return false;
  const data = negativeCache.get(identifier);
  if (Date.now() > data.blockedUntil) {
    negativeCache.delete(identifier);
    return false;
  }
  return true;
};

// ==============================
// 3. إدارة القائمة السوداء (Blocklist)
// ==============================

/**
 * التحقق من القائمة السوداء في قاعدة البيانات
 * @param {string} identifier - معرف المستخدم
 * @returns {Promise<Object|null>} بيانات الحظر أو null
 */
const checkDatabaseBlocklist = async (identifier) => {
  if (!CONFIG.ENABLE_BLOCKLIST) return null;
  try {
    const { data, error } = await supabase
      .from('rate_limit_blocklist')
      .select('blocked_until, reason')
      .eq('identifier', identifier)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const blockTime = new Date(data.blocked_until).getTime();
    if (Date.now() < blockTime) {
      // تحديث الكاش المحلي لتسريع الفحص المستقبلي
      setNegativeCache(identifier, data.blocked_until);
      return data;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * إضافة مستخدم إلى القائمة السوداء
 * @param {string} identifier - معرف المستخدم
 * @param {string} reason - سبب الحظر
 * @param {Object} metadata - بيانات إضافية للتسجيل
 */
const addToBlocklist = async (identifier, reason, metadata = {}) => {
  if (!CONFIG.ENABLE_BLOCKLIST) return;

  const blockedUntil = new Date(Date.now() + CONFIG.BLOCKLIST_DURATION).toISOString();

  // حظر فوري محلياً (حتى قبل أن يسجل في DB)
  setNegativeCache(identifier, blockedUntil);

  try {
    // تسجيل في قاعدة البيانات
    await supabase.from('rate_limit_blocklist').insert([{
      identifier,
      blocked_until: blockedUntil,
      reason,
    }]);

    // تسجيل في Audit Log
    if (typeof securityAudit !== 'undefined' && securityAudit.logEvent) {
      securityAudit.logEvent('RATE_LIMIT_BLOCKLIST_ADDED', {
        identifier,
        reason,
        blockedUntil,
        ...metadata,
      });
    }

    // تسجيل في Error Logger
    errorLogger.log({
      status: 'USER_BLOCKED',
      details: reason,
      metadata: { identifier, blockedUntil, ...metadata },
    });
  } catch (err) {
    console.error('[RateLimiter] Failed to add to DB blocklist:', err);
  }
};

/**
 * إزالة مستخدم من القائمة السوداء يدوياً
 * @param {string} identifier - معرف المستخدم
 * @returns {Promise<boolean>} true إذا نجحت العملية
 */
export const removeFromBlocklist = async (identifier) => {
  negativeCache.delete(identifier);
  try {
    const { error } = await supabase
      .from('rate_limit_blocklist')
      .delete()
      .eq('identifier', identifier);

    if (error) return false;

    if (typeof securityAudit !== 'undefined' && securityAudit.logEvent) {
      securityAudit.logEvent('RATE_LIMIT_BLOCKLIST_REMOVED', { identifier });
    }
    return true;
  } catch {
    return false;
  }
};

// ==============================
// 4. المحرك الأساسي (التحقق والتسجيل)
// ==============================

/**
 * التحقق من الحد الأقصى للمحاولات وتسجيل محاولة جديدة
 * @param {string} identifier - المعرف (البريد الإلكتروني، رقم الهاتف، أو بصمة الجهاز)
 * @param {string} actionType - نوع الإجراء (login, registration, reset_password, etc)
 * @param {Object} options - خيارات إضافية
 * @param {string} options.ipAddress - عنوان IP (للتوثيق)
 * @param {Object} options.metadata - بيانات إضافية للتسجيل
 * @returns {Promise<{allowed: boolean, count: number, remaining: number, resetTime: string, blocklist: boolean, error?: string}>}
 */
export const checkAndLogRateLimit = async (identifier, actionType = 'default', options = {}) => {
  // في بيئة السيرفر، نسمح مؤقتاً (سيتم التعامل معه في الطبقات الأخرى)
  if (isServer) {
    return { allowed: true, count: 0, remaining: 1, resetTime: new Date().toISOString() };
  }

  if (!identifier) {
    throw new Error('Security Error: Identifier is required for rate limiting.');
  }

  const { ipAddress = 'unknown', metadata = {} } = options;
  const config = CONFIG.LIMITS[actionType] || CONFIG.LIMITS.default;

  // ---- 1. الفحص الفوري من الـ Negative Cache المحلي (صفر استعلام) ----
  if (isBlockedLocally(identifier)) {
    const blockData = negativeCache.get(identifier);
    return {
      allowed: false,
      count: config.maxAttempts,
      remaining: 0,
      resetTime: new Date(blockData.blockedUntil).toISOString(),
      blocklist: true,
    };
  }

  try {
    // ---- 2. الفحص من قائمة الحظر في قاعدة البيانات ----
    const dbBlock = await checkDatabaseBlocklist(identifier);
    if (dbBlock) {
      return {
        allowed: false,
        count: config.maxAttempts,
        remaining: 0,
        resetTime: dbBlock.blocked_until,
        blocklist: true,
      };
    }

    // ---- 3. حساب المحاولات السابقة (Check BEFORE Insert) ----
    const windowStart = new Date(Date.now() - config.windowHours * 3600000).toISOString();
    const { count, error: countError } = await supabase
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('identifier', identifier)
      .eq('action_type', actionType)
      .gte('executed_at', windowStart);

    if (countError) throw countError;

    const currentAttempts = count || 0;

    // ---- 4. الرفض الفوري إذا تجاوز الحد (حماية الداتابيز من الإدخال) ----
    if (currentAttempts >= config.maxAttempts) {
      const resetTime = new Date(Date.now() + config.windowHours * 3600000).toISOString();
      setNegativeCache(identifier, resetTime); // حظر محلي مؤقت

      // التحقق من تجاوز حد الـ Blocklist (التجاوزات المتكررة)
      if (currentAttempts >= CONFIG.BLOCKLIST_THRESHOLD) {
        await addToBlocklist(identifier, `Exceeded rate limit (${currentAttempts}) for ${actionType}`, metadata);
        return {
          allowed: false,
          count: currentAttempts,
          remaining: 0,
          resetTime,
          blocklist: true,
        };
      }

      // تسجيل تجاوز الحد (للمراقبة)
      errorLogger.log({
        status: 'RATE_LIMIT_EXCEEDED',
        details: `Limit exceeded for ${actionType}`,
        metadata: { identifier, actionType, attempts: currentAttempts, maxAttempts: config.maxAttempts, ...metadata },
      });

      return {
        allowed: false,
        count: currentAttempts,
        remaining: 0,
        resetTime,
        blocklist: false,
      };
    }

    // ---- 5. التسجيل الآمن (الآن تأكدنا أنه لم يتجاوز الحد) ----
    const { error: insertError } = await supabase
      .from('rate_limits')
      .insert([{
        identifier,
        action_type: actionType,
        ip_address: ipAddress,
        executed_at: new Date().toISOString(),
      }]);

    if (insertError) throw insertError;

    const total = currentAttempts + 1;
    return {
      allowed: total <= config.maxAttempts,
      count: total,
      remaining: Math.max(0, config.maxAttempts - total),
      resetTime: new Date(Date.now() + config.windowHours * 3600000).toISOString(),
      blocklist: false,
    };
  } catch (error) {
    // ---- 6. 🛡️ تفعيل الدرع المحلي في حال فشل قاعدة البيانات (Fail-Closed) ----
    console.error('[RateLimiter] DB Connection Error, engaging Local Shield:', error);

    // تسجيل فشل الاتصال (للمراقبة)
    errorLogger.log({
      status: 'RATE_LIMITER_FALLBACK_ACTIVATED',
      details: `Supabase connection failed for ${identifier}`,
      metadata: { actionType, error: error.message },
    });

    // سياسة Fail-Closed: نرفض جميع المحاولات حتى يتم استعادة الاتصال
    return {
      allowed: false,
      count: config.maxAttempts,
      remaining: 0,
      resetTime: new Date(Date.now() + CONFIG.LOCAL_SHIELD_TTL).toISOString(),
      error: 'Security verification degraded. Please try again in 5 minutes.',
      blocklist: false,
    };
  }
};

// ==============================
// 5. دوال مساعدة للإدارة والصيانة
// ==============================

/**
 * إعادة تعيين المحاولات (يُستدعى بعد نجاح الإجراء)
 * @param {string} identifier - معرف المستخدم
 * @param {string} actionType - نوع الإجراء
 * @returns {Promise<boolean>} true إذا نجحت العملية
 */
export const resetRateLimit = async (identifier, actionType = 'default') => {
  negativeCache.delete(identifier);
  try {
    const { error } = await supabase
      .from('rate_limits')
      .delete()
      .eq('identifier', identifier)
      .eq('action_type', actionType);

    if (error) return false;
    return true;
  } catch {
    return false;
  }
};

/**
 * دالة مدمجة للتحقق من الحد ورمي خطأ مباشر (للاستخدام في authActions)
 * @param {string} identifier - معرف المستخدم
 * @param {string} actionType - نوع الإجراء
 * @param {Object} options - خيارات إضافية
 * @returns {Promise<Object>} نتيجة التحقق
 * @throws {Error} إذا تم تجاوز الحد
 */
export const checkRateLimitOrThrow = async (identifier, actionType = 'default', options = {}) => {
  const result = await checkAndLogRateLimit(identifier, actionType, options);

  if (!result.allowed) {
    const error = new Error(
      result.blocklist
        ? 'Account temporarily blocked due to suspicious activity. Please contact support.'
        : 'Too many attempts. Please wait before trying again.'
    );
    error.code = 'RATE_LIMIT_EXCEEDED';
    error.details = result;
    throw error;
  }

  return result;
};

/**
 * الحصول على حالة الحدود الحالية (بدون تسجيل محاولة جديدة)
 * @param {string} identifier - معرف المستخدم
 * @param {string} actionType - نوع الإجراء
 * @returns {Promise<Object|null>} حالة الحدود أو null
 */
export const getRateLimitStatus = async (identifier, actionType = 'default') => {
  if (!identifier || isServer) return null;

  const config = CONFIG.LIMITS[actionType] || CONFIG.LIMITS.default;
  const windowStart = new Date(Date.now() - config.windowHours * 3600000).toISOString();

  // التحقق من الكاش المحلي أولاً
  if (isBlockedLocally(identifier)) {
    const blockData = negativeCache.get(identifier);
    return {
      count: config.maxAttempts,
      remaining: 0,
      resetTime: new Date(blockData.blockedUntil).toISOString(),
      blocked: true,
    };
  }

  try {
    const { count, error } = await supabase
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('identifier', identifier)
      .eq('action_type', actionType)
      .gte('executed_at', windowStart);

    if (error) return null;
    const total = count || 0;
    return {
      count: total,
      remaining: Math.max(0, config.maxAttempts - total),
      maxAttempts: config.maxAttempts,
      windowHours: config.windowHours,
      resetTime: new Date(Date.now() + config.windowHours * 3600000).toISOString(),
      blocked: false,
    };
  } catch {
    return null;
  }
};

/**
 * الحصول على حالة القائمة السوداء لمستخدم معين
 * @param {string} identifier - معرف المستخدم
 * @returns {Promise<Object|null>} حالة الحظر أو null
 */
export const getBlocklistStatus = async (identifier) => {
  try {
    const { data, error } = await supabase
      .from('rate_limit_blocklist')
      .select('blocked_until, reason')
      .eq('identifier', identifier)
      .gt('blocked_until', new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;
    return {
      blockedUntil: data.blocked_until,
      reason: data.reason,
    };
  } catch {
    return null;
  }
};

/**
 * تنظيف المحاولات القديمة (للصيانة الدورية)
 * @param {number} olderThanDays - عدد الأيام التي مضت
 * @returns {Promise<{success: boolean, deleted: number}>}
 */
export const cleanOldRateLimits = async (olderThanDays = 7) => {
  try {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('rate_limits')
      .delete({ count: 'exact' })
      .lt('executed_at', cutoff);

    if (error) return { success: false, deleted: 0 };
    return { success: true, deleted: count || 0 };
  } catch {
    return { success: false, deleted: 0 };
  }
};

/**
 * إدارة الكاش المحلي (للمشرفين)
 */
export const rateLimiterCache = {
  clear: () => negativeCache.clear(),
  size: () => negativeCache.size,
  getBlocked: () => Array.from(negativeCache.keys()),
};

// ==============================
// 6. تصدير الكائن الرئيسي
// ==============================

export default {
  checkAndLogRateLimit,
  checkRateLimitOrThrow,
  getRateLimitStatus,
  resetRateLimit,
  removeFromBlocklist,
  getBlocklistStatus,
  cleanOldRateLimits,
  rateLimiterCache,
  CONFIG,
};