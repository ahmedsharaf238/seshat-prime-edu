// src/hooks/usePoints.js

/**
 * 🎯 usePoints Hook - نظام النقاط الذكي والآمن والمستقبلي (V 2050.GAMIFY-PREMIUM-CORE)
 * * 💎 التحديثات الهندسية والأمنية الفائقة:
 * - ⚛️ Perfect State Reconciliation: تأجيل التراجع التفاؤلي حتى استنفاد كافة المحاولات نهائياً لمنع وميض رصيد النقاط.
 * - 🔄 True Exponential Backoff: تأخير تصاعدي مضاعف لإعادة المحاولة لحماية السيرفر من الاختناق أثناء فترات الضغط العالي.
 * - 🔒 Idempotency Tokens: توليد معرفات فريدة لكل عملية إضافة لمنع تكرار تسجيل النقاط في قاعدة البيانات (Replay Attacks).
 * - 🛡️ Micro-Validation: فحص دقيق للقيم المدخلة لمنع تمرير قيم غير منطقية أو قيم NaN الكارثية للحسابات.
 * - 🧹 Absolute Leaks Prevention: تنظيف شامل ومضمون لكافة اشتراكات المؤقتات والطلبات المعلقة عند خروج المكون.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { useOnlineStatus } from './useOnlineStatus';
import { supabase } from '../lib/supabase/supabaseClient';
import { securityAudit } from '../lib/security/auditLog';

const DEFAULT_OPTIONS = Object.freeze({
  batchInterval: 5000,
  batchThreshold: 50,
  maxRetries: 3,
  retryDelay: 3000,
});

const STORAGE_KEY = 'seshat_pending_points';

export const usePoints = (options = {}) => {
  const { user } = useAuth();
  const isOnline = useOnlineStatus();

  const {
    batchInterval = DEFAULT_OPTIONS.batchInterval,
    batchThreshold = DEFAULT_OPTIONS.batchThreshold,
    maxRetries = DEFAULT_OPTIONS.maxRetries,
    retryDelay = DEFAULT_OPTIONS.retryDelay,
  } = options;

  const [points, setPoints] = useState(0);
  const [level, setLevel] = useState(0);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [isOfflineWarning, setIsOfflineWarning] = useState(false);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);
  const batchTimerRef = useRef(null);
  const pointsQueueRef = useRef([]);
  const retryTimeoutRef = useRef(null);
  const isSyncingRef = useRef(false);
  const retryCountRef = useRef(0);

  // حماية دورة حياة المكون وتنظيف الموارد تلقائياً عند الخروج
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // 💾 إدارة التخزين المحلي الاحتياطي لدعم وضع العمل دون اتصال
  const loadPendingFromStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (Array.isArray(data) && data.length > 0) {
          pointsQueueRef.current = data;
          setPendingPoints(data.reduce((sum, item) => sum + item.amount, 0));
        }
      }
    } catch (_) {}
  }, []);

  const savePendingToStorage = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pointsQueueRef.current));
    } catch (_) {}
  }, []);

  // 📤 جلب المجموع الموثق من السيرفر ومزامنته تفاؤلياً مع الطابور المحلي
  const fetchPoints = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('points, level')
        .eq('id', user.id)
        .single()
        .abortSignal(controller.signal);

      if (fetchError) throw fetchError;
      
      if (data && isMountedRef.current) {
        const localPending = pointsQueueRef.current.reduce((sum, item) => sum + item.amount, 0);
        setPoints((data.points || 0) + localPending);
        setLevel(data.level || 0);
        setError(null);
      }
    } catch (err) {
      if (err.name !== 'AbortError' && isMountedRef.current) {
        setError(err.message);
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }, [user]);

  // 📤 معالجة وإرسال الدفعات إلى السيرفر مع تأمين ثبات الحالات
  const flushQueue = useCallback(async () => {
    if (pointsQueueRef.current.length === 0 || !user || isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const queueCopy = [...pointsQueueRef.current];
    pointsQueueRef.current = [];
    setPendingPoints(0);
    savePendingToStorage();

    const totalAmount = queueCopy.reduce((sum, item) => sum + item.amount, 0);

    try {
      const { error: rpcError } = await supabase.rpc('add_user_points_batch', {
        user_id: user.id,
        total_points: totalAmount,
        reasons: queueCopy.map(item => item.reason),
        token_ids: queueCopy.map(item => item.id), // كروت أمنية لمنع تكرار المعاملة بالسيرفر
        signal: controller.signal,
      });

      if (rpcError) throw rpcError;

      retryCountRef.current = 0;
      if (isMountedRef.current) setError(null);

      securityAudit.logEvent('POINTS_BATCH_ADDED', {
        userId: user.id, totalAmount, count: queueCopy.length, timestamp: new Date().toISOString(),
      }).catch(console.error);

    } catch (err) {
      if (err.name === 'AbortError') {
        pointsQueueRef.current = [...queueCopy, ...pointsQueueRef.current];
        savePendingToStorage();
        if (isMountedRef.current) {
          setPendingPoints(pointsQueueRef.current.reduce((sum, item) => sum + item.amount, 0));
        }
        return;
      }

      console.error('Failed to flush queue:', err);
      
      pointsQueueRef.current = [...queueCopy, ...pointsQueueRef.current];
      savePendingToStorage();
      
      const currentPending = pointsQueueRef.current.reduce((sum, item) => sum + item.amount, 0);
      if (isMountedRef.current) setPendingPoints(currentPending);

      // محرك إعادة المحاولة بالتأخير التصاعدي المضاعف (Exponential Backoff)
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current += 1;
        if (isMountedRef.current) {
          setError(`⚠️ خطأ في المزامنة. جاري إعادة المحاولة الفورية (${retryCountRef.current}/${maxRetries})...`);
        }
        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) flushQueue();
        }, retryDelay * Math.pow(2, retryCountRef.current - 1)); // 3s -> 6s -> 12s
      } else {
        // الفشل النهائي بعد استنفاد كافة المحاولات: هنا فقط نقوم بالتراجع التفاؤلي الآمن
        if (isMountedRef.current) {
          if (isOnline) {
            setPoints(prev => Math.max(0, prev - totalAmount));
            setError('❌ فشلت مزامنة النقاط تماماً. تم التراجع محلياً لحماية نزاهة رصيدك.');
          } else {
            setError('ℹ️ تعذر الاتصال بالسيرفر. تم تأمين نقاطك محلياً وسيتم ترحيلها فور العودة للإنترنت.');
          }
        }
      }
    } finally {
      isSyncingRef.current = false;
      if (isMountedRef.current) setIsSyncing(false);
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }, [user, maxRetries, retryDelay, isOnline, savePendingToStorage]);

  // ⏱️ جدولة دورية لتفريغ الطابور تلقائياً
  const scheduleFlush = useCallback(() => {
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    batchTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) flushQueue();
    }, batchInterval);
  }, [flushQueue, batchInterval]);

  // ➕ إضافة النقاط التفاؤلية المستقرة والمحمية بصرياً وأمنياً
  const addPoints = useCallback((amount, reason = 'general') => {
    if (!user) {
      console.warn('Security Alert: Attempted to add points for unauthenticated user.');
      return;
    }
    // فحص صارم للمدخلات لمنع قيم NaN أو الأرقام السالبة
    if (typeof amount !== 'number' || amount <= 0 || isNaN(amount)) {
      console.error('Security Rejection: Invalid points amount injection.');
      return;
    }

    if (!isOnline) {
      setIsOfflineWarning(true);
    }

    // 1. تحديث تفاؤلي مستقر وفوري لواجهة المستخدم
    setPoints(prev => prev + amount);

    // 2. إدخال المعاملة للطابور المرجعي مع رمز تعريف فريد (Idempotency Token)
    const transactionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    pointsQueueRef.current.push({ amount, reason, id: transactionId, timestamp: Date.now() });
    
    const totalPending = pointsQueueRef.current.reduce((sum, item) => sum + item.amount, 0);
    setPendingPoints(totalPending);
    savePendingToStorage();

    // 3. التحقق من الوصول لعتبة الإرسال الفوري أو الجدولة الزمنية
    if (totalPending >= batchThreshold) {
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      flushQueue();
    } else {
      scheduleFlush();
    }

    securityAudit.logEvent('POINTS_QUEUED', {
      userId: user.id, amount, reason, pendingTotal: totalPending, online: isOnline,
    }).catch(console.error);

  }, [user, batchThreshold, isOnline, savePendingToStorage, flushQueue, scheduleFlush]);

  // مراقبة شبكة المستخدم وإطلاق التزامن التلقائي الفوري فور العودة للإنترنت
  useEffect(() => {
    if (isOnline) {
      setIsOfflineWarning(false);
      if (pointsQueueRef.current.length > 0) {
        flushQueue();
      }
    }
  }, [isOnline, flushQueue]);

  // التهيئة والتحضير الأولي للخطاف عند تحميل المكون لأول مرة
  useEffect(() => {
    if (user) {
      loadPendingFromStorage();
      fetchPoints();
    }
  }, [user, fetchPoints, loadPendingFromStorage]);

  // معالجة الحساب المستقل للمستويات لضمان كفاءة معالجة الرندرة
  useEffect(() => {
    const calculatedLevel = Math.floor(points / 100);
    setLevel(calculatedLevel);
  }, [points]);

  const progressToNextLevel = points > 0 ? (points % 100) / 100 : 0;

  return {
    points,
    level,
    pendingPoints,
    isSyncing,
    loading,
    error,
    isOfflineWarning,
    addPoints,
    fetchPoints,
    flushQueue, 
    nextLevelPoints: (level + 1) * 100,
    progressToNextLevel: Math.min(progressToNextLevel, 1),
  };
};

export default usePoints;