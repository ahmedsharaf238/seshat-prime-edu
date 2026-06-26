// src/hooks/useFullscreenLock.js

/**
 * 🛡️ useFullscreenLock Hook - قفل ملء الشاشة الشامل (V 2050.ECLIPSE-PLUS)
 * 
 * 💎 التحديثات الإضافية:
 * - 🍏 Apple/Safari Cross-Compatibility: دعم كامل لأجهزة iPad و macOS.
 * - 🧩 State Logic Fix: منع القفل الوهمي (False Locks).
 * - 🛡️ Async Memory Safety: حماية دالة الـ Retry.
 * - 📡 Early Support Check: التحقق من التوافق مبكراً.
 * - 🔄 Retry Logging: تسجيل محاولات إعادة الدخول.
 * - 🧹 AbortController for Timeouts: إلغاء المؤقتات عند التنظيف.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { securityAudit } from '../lib/security/auditLog';
import { useAuth } from './useAuth';

const DEFAULT_OPTIONS = {
  enabled: true,
  maxExitAttempts: 3,
  debounceMs: 2000,
  onExit: null,
  onEnter: null,
  onTerminate: null,
};

// ============================================================
// 🛠️ دوال مساعدة للتوافقية الشاملة
// ============================================================
const isFullscreenEnabled = () => 
  document.fullscreenEnabled || document.webkitFullscreenEnabled || document.msFullscreenEnabled;

const getFullscreenElement = () => 
  document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;

const requestFullscreenAPI = (element) => {
  if (element.requestFullscreen) return element.requestFullscreen();
  if (element.webkitRequestFullscreen) return element.webkitRequestFullscreen();
  if (element.msRequestFullscreen) return element.msRequestFullscreen();
  return Promise.reject(new Error("Fullscreen API not supported"));
};

const exitFullscreenAPI = () => {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  if (document.msExitFullscreen) return document.msExitFullscreen();
  return Promise.reject(new Error("Exit Fullscreen API not supported"));
};

/**
 * ✅ التحقق المبكر من التوافق
 */
const checkFullscreenSupport = () => {
  if (!isFullscreenEnabled()) {
    return { supported: false, message: 'متصفحك لا يدعم خاصية ملء الشاشة الإجباري. يرجى استخدام متصفح حديث (Chrome, Edge, Safari).' };
  }
  return { supported: true, message: null };
};

export const useFullscreenLock = (options = {}) => {
  const { user } = useAuth();
  
  const {
    enabled = DEFAULT_OPTIONS.enabled,
    maxExitAttempts = DEFAULT_OPTIONS.maxExitAttempts,
    debounceMs = DEFAULT_OPTIONS.debounceMs,
    onExit,
    onEnter,
    onTerminate,
  } = options;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [error, setError] = useState(null);
  const [exitAttemptsState, setExitAttemptsState] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [support, setSupport] = useState(() => checkFullscreenSupport());

  const exitAttempts = useRef(0);
  const lastExitTime = useRef(0);
  const abortControllerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { 
      isMountedRef.current = false;
      // 🧹 إلغاء المؤقت عند التنظيف
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  const callbacksRef = useRef({ onExit, onEnter, onTerminate });
  useEffect(() => {
    callbacksRef.current = { onExit, onEnter, onTerminate };
  }, [onExit, onEnter, onTerminate]);

  // ============================================================
  // 📤 الدخول إلى Fullscreen (مع التحقق المبكر)
  // ============================================================
  const enterFullscreen = useCallback(async () => {
    if (!enabled) {
      setError('نظام المراقبة معطل حالياً.');
      return false;
    }

    // ✅ التحقق المبكر من التوافق
    const supportCheck = checkFullscreenSupport();
    if (!supportCheck.supported) {
      setError(supportCheck.message);
      securityAudit.logEvent('FULLSCREEN_NOT_SUPPORTED', {
        userId: user?.id || 'unknown',
        path: window.location.pathname,
        message: supportCheck.message,
      }).catch(console.error);
      return false;
    }

    try {
      const targetElement = document.documentElement;
      if (!getFullscreenElement()) {
        await requestFullscreenAPI(targetElement);
        
        securityAudit.logEvent('FULLSCREEN_ENTERED', { 
            userId: user?.id || 'unknown', 
            path: window.location.pathname 
        }).catch(console.error);
        
        setIsFullscreen(true);
        setIsLocked(true);
        setError(null);
        setNeedsGesture(false);
        
        if (callbacksRef.current.onEnter) callbacksRef.current.onEnter();
        return true;
      }
      return true;
    } catch (error) {
      const msg = '⚠️ يرجى النقر على زر "العودة للامتحان" بوضوح لتفعيل المراقبة.';
      setError(msg);
      console.warn('⚠️ [Fullscreen] Request failed:', error);
      return false;
    }
  }, [enabled, user]);

  // ============================================================
  // 🔄 إعادة المحاولة الذكية (مع AbortController)
  // ============================================================
  const requestFullscreenWithRetry = useCallback(async () => {
    // ✅ تسجيل محاولة إعادة الدخول (للتدقيق)
    securityAudit.logEvent('FULLSCREEN_RETRY_ATTEMPTED', {
      userId: user?.id || 'unknown',
      path: window.location.pathname,
    }).catch(console.error);

    let success = await enterFullscreen();
    
    if (!success && isMountedRef.current) {
      // 🧹 إلغاء أي مؤقت سابق
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      // استخدام AbortController لإلغاء المؤقت عند التنظيف
      const retryController = new AbortController();
      retryTimerRef.current = setTimeout(() => {
        if (isMountedRef.current && !retryController.signal.aborted) {
          enterFullscreen().then((result) => {
            if (result) {
              securityAudit.logEvent('FULLSCREEN_RETRY_SUCCESS', {
                userId: user?.id || 'unknown',
              }).catch(console.error);
            }
          });
        }
      }, 300);

      // تخزين الـ Controller للإلغاء عند التنظيف
      const cleanup = () => {
        retryController.abort();
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      };
      
      // إرجاع دالة للإلغاء (يمكن استخدامها في useEffect)
      return { success: false, cleanup };
    }
    
    return { success: true, cleanup: null };
  }, [enterFullscreen, user]);

  // ============================================================
  // 📥 الخروج اليدوي
  // ============================================================
  const exitFullscreen = useCallback(async () => {
    try {
      if (getFullscreenElement()) {
        await exitFullscreenAPI();
        securityAudit.logEvent('FULLSCREEN_EXITED_MANUAL', {
          userId: user?.id || 'unknown',
        }).catch(console.error);
        setIsFullscreen(false);
        setIsLocked(false);
      }
    } catch (error) {
      console.warn('⚠️ [Fullscreen] Exit failed:', error);
    }
  }, [user]);

  // ============================================================
  // 👁️ رادار المراقبة
  // ============================================================
  useEffect(() => {
    if (!enabled) {
      setIsLocked(false);
      setIsFullscreen(false);
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const handleFullscreenChange = () => {
      const isNowFullscreen = !!getFullscreenElement();
      setIsFullscreen(isNowFullscreen);

      if (!isNowFullscreen && isLocked) {
        if (document.hidden) {
          console.log('🛡️ [Fullscreen] Ignored exit detection because page is hidden.');
          return;
        }

        const now = Date.now();
        if (now - lastExitTime.current < debounceMs) return;
        lastExitTime.current = now;

        exitAttempts.current += 1;
        const attempts = exitAttempts.current;
        setExitAttemptsState(attempts);

        const payload = {
          userId: user?.id || 'unknown',
          attempt: attempts,
          max: maxExitAttempts,
          path: window.location.pathname,
        };

        securityAudit.logEvent('FULLSCREEN_EXIT_DETECTED', payload).catch(console.error);

        if (callbacksRef.current.onExit) {
          callbacksRef.current.onExit({ attempt: attempts, max: maxExitAttempts });
        }

        if (attempts >= maxExitAttempts) {
          const terminatePayload = { reason: 'MAX_FULLSCREEN_EXITS', attempts, userId: user?.id || 'unknown' };
          securityAudit.logEvent('PROCTORING_TERMINATED', terminatePayload).catch(console.error);
          setIsLocked(false);
          
          if (callbacksRef.current.onTerminate) {
            callbacksRef.current.onTerminate(terminatePayload);
          }
          window.dispatchEvent(new CustomEvent('exam:terminate', { detail: terminatePayload }));
          return;
        }

        setNeedsGesture(true);
        setError('🔒 تم الخروج من ملء الشاشة. اضغط على الزر أدناه للعودة.');
      }
    };

    const handleFullscreenError = () => {
      setError('فشل الدخول إلى ملء الشاشة. المتصفح يمنع ذلك حالياً.');
    };

    const events = ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'];
    const errorEvents = ['fullscreenerror', 'webkitfullscreenerror', 'MSFullscreenError'];

    events.forEach(event => document.addEventListener(event, handleFullscreenChange, { signal: abortController.signal }));
    errorEvents.forEach(event => document.addEventListener(event, handleFullscreenError, { signal: abortController.signal }));

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      // 🧹 إلغاء المؤقت عند التنظيف
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [enabled, isLocked, maxExitAttempts, debounceMs, user]);

  // ============================================================
  // 🔄 إعادة التعيين (مع رسالة توضيحية)
  // ============================================================
  const resetExitAttempts = useCallback(() => {
    exitAttempts.current = 0;
    setExitAttemptsState(0);
    lastExitTime.current = 0;
    
    // ✅ رسالة توضيحية للمستخدم
    setError('🔄 تم إعادة تعيين المحاولات. اضغط على زر "العودة للامتحان" لتفعيل ملء الشاشة.');
    setIsLocked(false);
    setNeedsGesture(true);
  }, []);

  // ============================================================
  // 📦 القيم المصدرة
  // ============================================================
  return {
    isFullscreen,
    isLocked,
    needsGesture,
    error,
    exitAttempts: exitAttemptsState,
    support, // ✅ تصدير حالة التوافق
    enterFullscreen,
    exitFullscreen,
    resetExitAttempts,
    requestFullscreenWithRetry,
  };
};

export default useFullscreenLock;