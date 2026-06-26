// src/hooks/useImpersonation.js

/**
 * 🛡️ useImpersonation Hook - نظام التقمص المترابط النهائي (V 2050.NEXUS-PLUS)
 * 
 * 💎 التحديثات الفائقة:
 * - 🧩 Lifecycle Safety: إزالة فخ الـ useEffect مع إدارة آمنة للمؤقتات.
 * - ⏱️ Stale-Closure Fix: إصلاح مؤقت الانتهاء ليعمل بدقة متناهية.
 * - 🚪 Safe Unload: استخدام `beforeunload` مع `sendBeacon` لتسجيل الأحداث.
 * - 👮 Unified RBAC: توافق كامل مع هيكلية الصلاحيات المدمجة.
 * - 🔄 AbortController شامل: إلغاء جميع الطلبات المعلقة.
 * - 🔒 Re-validation على الاستعادة: التحقق من صلاحية المستخدم عند استعادة الجلسة.
 * - 📡 Beacon Logging: إرسال إشارة الإنتهاء حتى عند إغلاق المتصفح.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { useRole } from './useRole';
import { supabase } from '../lib/supabase/supabaseClient';
import { securityAudit } from '../lib/security/auditLog';

const DEFAULT_OPTIONS = {
  expiryMs: 30 * 60 * 1000, // 30 دقيقة
  retryCount: 1,
  retryDelay: 1000,
};

const STORAGE_KEY = 'seshat_impersonation';

export const useImpersonation = (options = {}) => {
  const { user, profile } = useAuth();
  const { isTeacher, isSupervisor } = useRole();
  const {
    expiryMs = DEFAULT_OPTIONS.expiryMs,
    retryCount = DEFAULT_OPTIONS.retryCount,
    retryDelay = DEFAULT_OPTIONS.retryDelay,
  } = options;

  const [impersonatedUser, setImpersonatedUser] = useState(null);
  const [impersonatedProfile, setImpersonatedProfile] = useState(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Refs للحفاظ على القيم الحالية وتجنب مشاكل الإغلاق
  const abortControllerRef = useRef(null);
  const expiryTimerRef = useRef(null);
  const isImpersonatingRef = useRef(isImpersonating);
  const impersonatedUserRef = useRef(impersonatedUser);

  // تحديث الـ Refs عند تغير الـ State
  useEffect(() => {
    isImpersonatingRef.current = isImpersonating;
    impersonatedUserRef.current = impersonatedUser;
  }, [isImpersonating, impersonatedUser]);

  const canImpersonate = isTeacher || isSupervisor;

  // ============================================================
  // 🧹 دالة التنظيف الموحدة
  // ============================================================
  const clearImpersonationTimers = useCallback(() => {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // ============================================================
  // 🛑 إنهاء التقمص (مع دعم sendBeacon للخروج المفاجئ)
  // ============================================================
  const stopImpersonation = useCallback(async (reason = 'MANUAL', isUnload = false) => {
    if (!isImpersonatingRef.current) return;

    // استخدام الـ Ref للحصول على أحدث البيانات
    const targetId = impersonatedUserRef.current?.id;
    const startTime = impersonatedUserRef.current?.startTime;
    const duration = startTime ? Date.now() - startTime : 0;

    const payload = {
      impersonatorId: user?.id,
      impersonatorRole: profile?.role,
      targetId: targetId,
      duration,
      reason,
      timestamp: new Date().toISOString(),
    };

    // إذا كان السبب هو إغلاق المتصفح، نستخدم sendBeacon لضمان التسجيل
    if (isUnload && navigator.sendBeacon) {
      try {
        const blob = new Blob(
          [JSON.stringify({ event: 'IMPERSONATION_STOPPED', ...payload })],
          { type: 'application/json' }
        );
        navigator.sendBeacon('/api/security/audit', blob);
      } catch (_) {}
    } else {
      // التسجيل العادي
      await securityAudit.logEvent('IMPERSONATION_STOPPED', payload).catch(console.error);
    }

    // تنظيف الموارد المحلية (مؤقتات، طلبات، تخزين)
    clearImpersonationTimers();
    setImpersonatedUser(null);
    setImpersonatedProfile(null);
    setIsImpersonating(false);
    sessionStorage.removeItem(STORAGE_KEY);

    window.dispatchEvent(new CustomEvent('impersonation:stop', { 
      detail: { reason } 
    }));
  }, [user, profile, clearImpersonationTimers]);

  // ============================================================
  // 🔄 استعادة الحالة من sessionStorage (مع إعادة التحقق من الصلاحية)
  // ============================================================
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      const data = JSON.parse(saved);
      // التحقق من الصلاحية: هل المستخدم لا يزال يملك صلاحية التقمص؟
      if (!canImpersonate) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }

      if (data.startTime && Date.now() - data.startTime < expiryMs) {
        setImpersonatedUser({ id: data.userId, email: data.email, startTime: data.startTime });
        setImpersonatedProfile(data.profile);
        setIsImpersonating(true);

        window.dispatchEvent(new CustomEvent('impersonation:restore', {
          detail: { studentId: data.userId, studentData: data.profile }
        }));

        const remainingTime = expiryMs - (Date.now() - data.startTime);
        expiryTimerRef.current = setTimeout(() => {
          console.warn('⏰ [Impersonation] Session expired automatically.');
          stopImpersonation('EXPIRED');
        }, remainingTime);
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch (_) {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [canImpersonate, expiryMs, stopImpersonation]);

  // ============================================================
  // 📤 دالة جلب بيانات الطالب (مع Abort + Retry)
  // ============================================================
  const fetchStudentData = useCallback(async (studentId, signal) => {
    let attempt = 0;
    while (attempt <= retryCount) {
      try {
        const { data, error: fetchError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', studentId)
          .eq('role', 'student')
          .single()
          .abortSignal(signal);

        if (fetchError) throw fetchError;
        return data;
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'CancelError') throw err;
        if (attempt < retryCount) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
          attempt++;
        } else {
          throw err;
        }
      }
    }
  }, [retryCount, retryDelay]);

  // ============================================================
  // 🛑 إنهاء التقمص (النسخة الخالية من الثغرات)
  // ============================================================
  const stopImpersonation = useCallback(async (reason = 'MANUAL', isUnload = false) => {
    if (!isImpersonatingRef.current) return;

    const targetId = impersonatedUserRef.current?.id;
    const startTime = impersonatedUserRef.current?.startTime;
    const duration = startTime ? Date.now() - startTime : 0;

    const payload = {
      impersonatorId: user?.id,
      impersonatorRole: profile?.role,
      targetId: targetId,
      duration,
      reason,
      timestamp: new Date().toISOString(),
    };

    if (isUnload) {
      // 🌟 الحل السحري: استخدام fetch مع keepalive لدعم Supabase Auth
      try {
        fetch('/api/security/audit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // استبدل user.access_token بالطريقة التي تجلب بها التوكن في مشروعك
            'Authorization': `Bearer ${user?.access_token || ''}`, 
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY // إذا لزم الأمر
          },
          body: JSON.stringify({ event: 'IMPERSONATION_STOPPED', ...payload }),
          keepalive: true 
        }).catch(() => {}); // تجاهل أخطاء الشبكة أثناء الإغلاق
      } catch (_) {}

      // 🚫 الأهم: نقوم بعمل return هنا فوراً!
      // لا نمسح sessionStorage ولا نغير الـ State، لكي تنجح الاستعادة لو كان هذا مجرد Refresh.
      return; 
    }

    // --- مسار الإنهاء العادي والإرادي (MANUAL / EXPIRED) ---
    await securityAudit.logEvent('IMPERSONATION_STOPPED', payload).catch(console.error);
    
    clearImpersonationTimers();
    setImpersonatedUser(null);
    setImpersonatedProfile(null);
    setIsImpersonating(false);
    sessionStorage.removeItem(STORAGE_KEY); // نمسح التخزين هنا فقط

    window.dispatchEvent(new CustomEvent('impersonation:stop', { 
      detail: { reason } 
    }));
  }, [user, profile, clearImpersonationTimers]);
  // ============================================================
  // 🔄 تحديث بيانات الطالب (مع إلغاء الطلب السابق)
  // ============================================================
  const refreshImpersonatedData = useCallback(async () => {
    if (!isImpersonatingRef.current || !impersonatedUserRef.current?.id) {
      throw new Error('Not currently impersonating');
    }

    setLoading(true);
    try {
      // إلغاء الطلب السابق (إن وجد)
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const studentData = await fetchStudentData(impersonatedUserRef.current.id, controller.signal);
      setImpersonatedProfile(studentData);

      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          data.profile = studentData;
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
      } catch (_) {}

      window.dispatchEvent(new CustomEvent('impersonation:refresh', { detail: { studentData } }));
      return studentData;
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'CancelError') return null;
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
      if (abortControllerRef.current) abortControllerRef.current = null;
    }
  }, [fetchStudentData]);

  // ============================================================
  // 🚪 معالجة إغلاق المتصفح (مع sendBeacon)
  // ============================================================
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isImpersonatingRef.current) {
        // إرسال حدث الإنتهاء باستخدام sendBeacon
        stopImpersonation('PAGE_UNLOAD', true);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearImpersonationTimers();
    };
  }, [stopImpersonation, clearImpersonationTimers]);

  // ============================================================
  // 📦 القيم المصدرة
  // ============================================================
  return {
    startImpersonation,
    stopImpersonation,
    refreshImpersonatedData,
    isImpersonating,
    impersonatedUser,
    impersonatedProfile,
    loading,
    error,
    canImpersonate,
    impersonationExpiry: impersonatedUser?.startTime 
      ? Math.max(0, expiryMs - (Date.now() - impersonatedUser.startTime))
      : 0,
  };
};

export default useImpersonation;