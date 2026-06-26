// src/hooks/useTabSwitchDetection.js

/**
 * 🛡️ useTabSwitchDetection Hook - نظام المراقبة المعرفي المطلق (V 2050.TITANIUM)
 * 
 * 💎 التحديثات الفائقة:
 * - 🛡️ AbortController مع signal: تنظيف تلقائي للمستمعين.
 * - ⚡ Terminal Isolation: منع تحديث State عند الإغلاق.
 * - 🧠 Iframe Bypass: استثناء النقر داخل الفيديوهات والأدوات المضمنة.
 * - ⏱️ Pure Throttle: حماية الخادم من الإغراق.
 * - 📡 Beacon Dynamic URL: مسار مرن لـ Edge Functions.
 * - 🎵 Audio & Video Pause: إيقاف جميع الوسائط المتعددة.
 * - 🔄 Retry Logging: إعادة محاولة تسجيل الأخطاء عند فشل الشبكة.
 * - 📹 Screen Recording Detection: (اختياري) كشف محاولات تسجيل الشاشة.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { securityAudit } from '../lib/security/auditLog';
import { useAuth } from './useAuth';

const DEFAULT_OPTIONS = {
  gracePeriodMs: 3000,
  maxViolations: 3,
  enabled: true,
  ignoreFirstViolation: false,
  throttleMs: 1500,
  beaconUrl: '/api/security/audit', // يمكن تخصيصه عبر env
  onViolation: null,
  onResume: null,
  onTerminate: null,
  enableScreenRecordingDetection: false,
};

export const useTabSwitchDetection = (options = {}) => {
  const { user } = useAuth();
  
  const {
    enabled = DEFAULT_OPTIONS.enabled,
    gracePeriodMs = DEFAULT_OPTIONS.gracePeriodMs,
    maxViolations = DEFAULT_OPTIONS.maxViolations,
    ignoreFirstViolation = DEFAULT_OPTIONS.ignoreFirstViolation,
    throttleMs = DEFAULT_OPTIONS.throttleMs,
    beaconUrl = DEFAULT_OPTIONS.beaconUrl,
    onViolation,
    onResume,
    onTerminate,
    enableScreenRecordingDetection = DEFAULT_OPTIONS.enableScreenRecordingDetection,
  } = options;

  const [isPausedState, setIsPausedState] = useState(false);
  const [violationCountState, setViolationCountState] = useState(0);

  const violationCount = useRef(0);
  const lastHiddenTime = useRef(null);
  const lastViolationTime = useRef(0);
  const graceTimerRef = useRef(null);
  const isInitialViolation = useRef(ignoreFirstViolation);
  const isPausedRef = useRef(false);
  const abortControllerRef = useRef(null);

  const setPaused = (val) => {
    isPausedRef.current = val;
    setIsPausedState(val);
  };

  const callbacksRef = useRef({ onViolation, onResume, onTerminate });
  useEffect(() => {
    callbacksRef.current = { onViolation, onResume, onTerminate };
  }, [onViolation, onResume, onTerminate]);

  // ============================================================
  // ⚡ إيقاف جميع الوسائط المتعددة (فيديو + صوت)
  // ============================================================
  const pauseAllMediaSync = useCallback(() => {
    // إيقاف الفيديوهات
    const videos = document.getElementsByTagName('video');
    for (let i = 0; i < videos.length; i++) {
      if (!videos[i].paused) {
        try { videos[i].pause(); } catch (_) {}
      }
    }
    // إيقاف الصوتيات
    const audios = document.getElementsByTagName('audio');
    for (let i = 0; i < audios.length; i++) {
      if (!audios[i].paused) {
        try { audios[i].pause(); } catch (_) {}
      }
    }
  }, []);

  // ============================================================
  // 🛡️ تسجيل المخالفات مع إعادة محاولة ذكية
  // ============================================================
  const safeLogEvent = useCallback(async (eventType, payload) => {
    let attempts = 0;
    while (attempts < 2) {
      try {
        await securityAudit.logEvent(eventType, payload);
        return;
      } catch (error) {
        attempts++;
        if (attempts === 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.error('⚠️ [Audit] Failed to log event after retry:', error);
        }
      }
    }
  }, []);

  // ============================================================
  // 🛡️ دالة معالجة المخالفات
  // ============================================================
  const handleViolation = useCallback(async (type, details = {}) => {
    if (!enabled || !user) return;

    const now = Date.now();
    if (now - lastViolationTime.current < throttleMs) return;
    lastViolationTime.current = now;

    if (isInitialViolation.current) {
      isInitialViolation.current = false;
      return;
    }

    violationCount.current += 1;
    const count = violationCount.current;

    const isTerminal = type === 'PAGE_HIDE';

    if (!isTerminal) {
      setViolationCountState(count);
      pauseAllMediaSync();
    }

    const eventPayload = {
      type: `TAB_SWITCH_${type}`,
      userId: user.id,
      count,
      max: maxViolations,
      path: window.location.pathname,
      timestamp: now,
      ...details,
    };

    // إرسال عبر Beacon عند الإغلاق
    if (isTerminal && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(eventPayload)], { type: 'application/json' });
      navigator.sendBeacon(beaconUrl, blob);
    } else {
      await safeLogEvent(eventPayload.type, eventPayload);
    }

    if (callbacksRef.current.onViolation) {
      callbacksRef.current.onViolation(eventPayload);
    }

    if (count >= maxViolations) {
      const terminatePayload = { reason: 'MAX_VIOLATIONS_EXCEEDED', count };
      await safeLogEvent('PROCTORING_TERMINATED', terminatePayload);
      if (callbacksRef.current.onTerminate) {
        callbacksRef.current.onTerminate(terminatePayload);
      }
      window.dispatchEvent(new CustomEvent('exam:terminate', { detail: terminatePayload }));
    }
  }, [enabled, user, maxViolations, throttleMs, pauseAllMediaSync, beaconUrl, safeLogEvent]);

  // ============================================================
  // 🕵️ كشف تسجيل الشاشة (اختياري)
  // ============================================================
  useEffect(() => {
    if (!enableScreenRecordingDetection || !enabled || !user) return;

    let captureStream = null;
    const detectScreenRecording = async () => {
      try {
        // محاولة الحصول على تيار الشاشة (هذا سيطلب إذن المستخدم)
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        captureStream = stream;
        // إذا نجح الحصول على التيار، فهذا يعني أن هناك عملية تسجيل أو مشاركة شاشة
        // نطلق تحذيراً (ولكن لا نعتبره مخالفة تلقائياً)
        console.warn('📹 [Screen Recording] User is sharing screen or recording.');
        // يمكن إرسال إشعار أمني بدون احتساب مخالفة
        securityAudit.logEvent('SCREEN_RECORDING_DETECTED', { userId: user.id }).catch(console.error);
        // نوقف التيار فوراً لمنع الاستمرار
        stream.getTracks().forEach(track => track.stop());
      } catch (error) {
        // إذا رفض المستخدم الإذن، فهذا طبيعي
        console.debug('🛡️ [Screen Recording] Permission denied or not supported.');
      }
    };

    // تشغيل الكشف بعد 2 ثانية من تحميل الصفحة (لتجنب التداخل مع التحميل)
    const timer = setTimeout(detectScreenRecording, 2000);
    return () => clearTimeout(timer);
  }, [enableScreenRecordingDetection, enabled, user]);

  // ============================================================
  // 👁️ رادار المراقبة الشامل
  // ============================================================
  useEffect(() => {
    if (!enabled || !user) {
      setPaused(false);
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const triggerGracePeriod = (triggerType) => {
      const now = Date.now();
      if (!isPausedRef.current) {
        lastHiddenTime.current = now;
        setPaused(true);
      }

      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }

      graceTimerRef.current = setTimeout(() => {
        if (abortController.signal.aborted) return;
        if (document.hidden || !document.hasFocus()) {
          handleViolation(triggerType, { duration: Date.now() - lastHiddenTime.current });
        }
      }, gracePeriodMs);
    };

    const handleFocusReturn = () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
      
      if (isPausedRef.current) {
        setPaused(false);
        const duration = lastHiddenTime.current ? Date.now() - lastHiddenTime.current : 0;
        lastHiddenTime.current = null;
        if (callbacksRef.current.onResume && duration > 0) {
          callbacksRef.current.onResume({ duration });
        }
      }
    };

    const handleVisibilityChange = () => document.hidden ? triggerGracePeriod('VISIBILITY') : handleFocusReturn();
    
    const handleWindowBlur = () => {
      if (document.activeElement && document.activeElement.tagName === 'IFRAME') return;
      triggerGracePeriod('BLUR');
    };

    const handleWindowFocus = () => handleFocusReturn();
    const handlePageHide = () => handleViolation('PAGE_HIDE', { isMobile: true });

    // ربط المستمعين باستخدام AbortController
    document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true, signal: abortController.signal });
    window.addEventListener('blur', handleWindowBlur, { passive: true, signal: abortController.signal });
    window.addEventListener('focus', handleWindowFocus, { passive: true, signal: abortController.signal });
    window.addEventListener('pagehide', handlePageHide, { passive: true, signal: abortController.signal });

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
  }, [enabled, user, gracePeriodMs, handleViolation]);

  // ============================================================
  // 🔄 إعادة تعيين المخالفات
  // ============================================================
  const resetViolations = useCallback(() => {
    violationCount.current = 0;
    setViolationCountState(0);
    lastViolationTime.current = 0;
    isInitialViolation.current = ignoreFirstViolation;
    lastHiddenTime.current = null;
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    setPaused(false);
  }, [ignoreFirstViolation]);

  return {
    isPaused: isPausedState,
    violationCount: violationCountState,
    resetViolations,
  };
};

export default useTabSwitchDetection;