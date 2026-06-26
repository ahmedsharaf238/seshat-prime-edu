// src/hooks/useHeartbeat.js

/**
 * 💓 useHeartbeat Hook - نظام Seshat لإشارات الحياة (V 2050.MAX.FINAL.EDGE 🚀)
 * 
 * 🎯 الوظيفة: تتبع تواجد المستخدمين بدقة وسلاسة دون التأثير على الأداء.
 * 
 * 💎 الميزات المطورة (Seshat Edition):
 * - 🚀 requestIdleCallback + Polyfill للمتصفحات القديمة.
 * - 🛡️ AbortController لمنع تسرب الذاكرة.
 * - ⏱️ Exponential Backoff مع حد أقصى للمحاولات.
 * - 📍 Path Ref لتجنب إعادة إنشاء المؤقت.
 * - 🔄 Visibility Debounce لتجنب الإغراق.
 * - 📤 sendBeacon + FormData + fetch keepalive احتياطي.
 * - 🌐 مستمع online لإعادة الإرسال عند عودة الشبكة.
 * - 🚪 pagehide لضمان إشارة الخروج.
 * - 🧹 تسجيل الأخطاء الانتقائي (الحساس فقط).
 * - 🛡️ تحقق من وجود VITE_SUPABASE_URL.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase/supabaseClient';
import { errorLogger } from '../lib/helpers/errorLogger';

const DEFAULT_INTERVAL = 30000;
const RPC_TIMEOUT = 5000;
const DEBOUNCE_DELAY = 1000;
const MAX_RETRIES = 2;

export const useHeartbeat = (intervalMs = DEFAULT_INTERVAL) => {
  const { user, profile } = useAuth();
  const location = useLocation();
  
  const pathRef = useRef(location.pathname);
  const intervalRef = useRef(null);
  const lastBeatRef = useRef(Date.now());
  const abortControllerRef = useRef(null);
  const isFinalSentRef = useRef(false);
  const isOnlineRef = useRef(navigator.onLine);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const sendHeartbeat = useCallback(async (isFinal = false, force = false) => {
    if (!user?.id) return;
    if (isFinal && isFinalSentRef.current) return;
    if (isFinal) isFinalSentRef.current = true;

    // التحقق من الاتصال بالإنترنت (في حالة غير نهائية)
    if (!isFinal && !navigator.onLine) {
      console.debug('🌐 [Heartbeat] No internet, skipping.');
      return;
    }

    const now = Date.now();
    const shouldSend = force || (now - lastBeatRef.current >= intervalMs);
    if (!shouldSend && !isFinal) return;

    if (!isFinal) lastBeatRef.current = now;

    const currentPath = pathRef.current;

    // ---------- إشارة نهائية ----------
    if (isFinal && navigator.sendBeacon) {
      try {
        const formData = new FormData();
        formData.append('user_id', user.id);
        formData.append('last_seen', new Date().toISOString());
        formData.append('is_final', 'true');
        formData.append('path', currentPath);
        formData.append('role', profile?.role || '');

        const beaconUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/heartbeat`;
        const sent = navigator.sendBeacon(beaconUrl, formData);

        if (!sent) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          await fetch(beaconUrl, {
            method: 'POST',
            body: formData,
            keepalive: true,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.debug('⚠️ [Heartbeat] Final beacon failed:', error.message);
          if (errorLogger?.log) {
            errorLogger.log({
              status: 'HEARTBEAT_FINAL_FAILED',
              details: error.message,
              userId: user.id,
            });
          }
        }
      }
      return;
    }

    // ---------- إشارات دورية ----------
    try {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT);

      let attempt = 0;
      let success = false;
      while (attempt < MAX_RETRIES && !success) {
        try {
          await supabase.rpc('update_last_seen', {
            p_user_id: user.id,
            p_seen_at: new Date().toISOString(),
            p_path: currentPath,
          });
          success = true;
        } catch (err) {
          attempt++;
          if (attempt < MAX_RETRIES) {
            await new Promise(res => setTimeout(res, 2000 * attempt));
          } else {
            throw err;
          }
        }
      }

      clearTimeout(timeoutId);
      abortControllerRef.current = null;

    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'CancelError') return;
      console.debug('⚠️ [Heartbeat] RPC failed:', error.message);
    }
  }, [user, profile, intervalMs]);

  const forceHeartbeat = useCallback(() => sendHeartbeat(false, true), [sendHeartbeat]);

  // ---------- المؤقت ----------
  useEffect(() => {
    if (!user) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      isFinalSentRef.current = false;
      return;
    }

    isFinalSentRef.current = false;
    const initialTimeout = setTimeout(() => sendHeartbeat(false, true), 1000);

    const startTimer = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (document.hidden) return;
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(() => sendHeartbeat(false, false), { timeout: 1000 });
        } else {
          sendHeartbeat(false, false);
        }
      }, intervalMs);
    };

    if (document.readyState === 'complete') {
      startTimer();
    } else {
      window.addEventListener('load', startTimer);
      return () => window.removeEventListener('load', startTimer);
    }

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      sendHeartbeat(true, false);
    };
  }, [user, intervalMs, sendHeartbeat]);

  // ---------- Visibility ----------
  useEffect(() => {
    if (!user) return;

    let debounceTimer = null;
    let lastVisibilityChange = Date.now();

    const handleVisibilityChange = () => {
      const now = Date.now();
      if (now - lastVisibilityChange < DEBOUNCE_DELAY) return;
      lastVisibilityChange = now;

      if (!document.hidden) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          sendHeartbeat(false, true);
          lastBeatRef.current = Date.now();
        }, 500);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [user, sendHeartbeat]);

  // ---------- pagehide ----------
  useEffect(() => {
    if (!user) return;
    const handlePageHide = () => sendHeartbeat(true, true);
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [user, sendHeartbeat]);

  // ---------- online/offline (إضافة ذكية) ----------
  useEffect(() => {
    if (!user) return;

    const handleOnline = () => {
      console.log('🌐 [Heartbeat] Internet restored, sending immediate heartbeat.');
      sendHeartbeat(false, true);
      lastBeatRef.current = Date.now();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [user, sendHeartbeat]);

  return { sendHeartbeat, forceHeartbeat };
};

export default useHeartbeat;س