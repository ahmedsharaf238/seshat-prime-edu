// src/hooks/useVideoProgress.js

/**
 * 🎯 useVideoProgress Hook - نسخة مشغل اليوتيوب المحصنة (V 2050.YOUTUBE-PROGRESS-GUARDIAN)
 * 
 * 💎 التحديثات المعمارية لبيئة اليوتيوب:
 * - 📡 YouTube Player API Support: التحكم الكامل والمراقبة عبر كائن مشغل اليوتيوب.
 * - ⏱️ Intelligent Polling Engine: مؤقت فحص دوري يعمل فقط أثناء التشغيل.
 * - 🔒 Decoupled Identifiers: فصل كامل بين UUID الخاص بقاعدة البيانات ومعرف اليوتيوب.
 * - 🛡️ Value Sanitization: التحقق من صحة القيم المحفوظة (NaN, Infinity, منطقية).
 * - 📋 Error Handling: معالجة أخطاء المشغل وتسجيلها.
 * - 🚀 Keepalive Micro-Sync: حماية ترحيل البيانات حتى عند إغلاق التبويب.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from './useAuth';
import { useOnlineStatus } from './useOnlineStatus';
import { supabase } from '../lib/supabase/supabaseClient';
import { securityAudit } from '../lib/security/auditLog';

const DEFAULT_OPTIONS = Object.freeze({
  saveInterval: 5000,
  minProgressDelta: 2,
  retryCount: 2,
  retryDelay: 3000,
  rpcSchema: 'public',
  pollingInterval: 1000,
});

const STORAGE_KEY_PREFIX = 'seshat_video_progress_';

const isValidUUID = (id) => {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

const delayWithSignal = (ms, signal) => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort);
  });
};

/**
 * التحقق من صحة القيم الرقمية (نطاق معقول)
 */
const isValidProgress = (value) => {
  return typeof value === 'number' && isFinite(value) && value >= 0;
};

export const useVideoProgress = (videoId, options = {}) => {
  const { user, session } = useAuth();
  const isOnline = useOnlineStatus();
  
  const {
    saveInterval = DEFAULT_OPTIONS.saveInterval,
    minProgressDelta = DEFAULT_OPTIONS.minProgressDelta,
    retryCount = DEFAULT_OPTIONS.retryCount,
    retryDelay = DEFAULT_OPTIONS.retryDelay,
    rpcSchema = DEFAULT_OPTIONS.rpcSchema,
    pollingInterval = DEFAULT_OPTIONS.pollingInterval,
  } = options;

  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [percent, setPercent] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);
  const saveTimerRef = useRef(null);
  const pollingTimerRef = useRef(null);
  const playerInstanceRef = useRef(null);
  const lastSavedPercentRef = useRef(0);
  const lastUpdateTimeRef = useRef(0);
  const liveSnapshotRef = useRef({ currentTime: 0, duration: 0 });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // 📥 جلب التقدم المحفوظ من السيرفر
  const fetchSavedProgress = useCallback(async () => {
    if (!user || !videoId || !isValidUUID(videoId)) {
      if (isMountedRef.current) setLoading(false);
      return;
    }

    setLoading(true);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const { data, error: fetchError } = await supabase
        .from('video_progress')
        .select('progress, is_complete, current_time')
        .eq('user_id', user.id)
        .eq('video_id', videoId)
        .maybeSingle()
        .abortSignal(controller.signal);

      if (fetchError) throw fetchError;

      if (data && isMountedRef.current) {
        const savedPercent = isValidProgress(data.progress) ? data.progress : 0;
        const savedTime = isValidProgress(data.current_time) ? data.current_time : 0;
        const savedComplete = !!data.is_complete;
        
        setProgress(savedTime);
        setPercent(savedPercent);
        setIsComplete(savedComplete);
        lastSavedPercentRef.current = savedPercent;
        liveSnapshotRef.current = { currentTime: savedTime, duration: liveSnapshotRef.current.duration };

        if (playerInstanceRef.current && typeof playerInstanceRef.current.seekTo === 'function') {
          playerInstanceRef.current.seekTo(savedTime, true);
        }

        if (savedComplete) {
          securityAudit.logEvent('VIDEO_ALREADY_COMPLETED', {
            userId: user.id, videoId, progress: savedPercent,
          }).catch(console.error);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError' && isMountedRef.current) {
        setError(err.message);
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }, [user, videoId]);

  // 💾 حفظ التقدم
  const saveProgress = useCallback(async (currentTime, videoDuration, isFinal = false) => {
    if (!user || !videoId || !isValidUUID(videoId) || !isMountedRef.current) return;
    if (!isValidProgress(currentTime) || !isValidProgress(videoDuration) || videoDuration <= 0) return;

    const percentToSave = (currentTime / videoDuration) * 100;
    if (!isFinal && Math.abs(percentToSave - lastSavedPercentRef.current) < minProgressDelta) return;

    const complete = percentToSave >= 95;
    lastSavedPercentRef.current = percentToSave;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let attempt = 0;
    let lastError = null;

    while (attempt <= retryCount) {
      try {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const rpcCall = rpcSchema === 'public' 
          ? supabase.rpc('update_video_progress', {
              p_user_id: user.id, p_video_id: videoId, p_progress: percentToSave, p_current_time: currentTime, p_is_complete: complete,
            }, { signal: controller.signal })
          : supabase.schema(rpcSchema).rpc('update_video_progress', {
              p_user_id: user.id, p_video_id: videoId, p_progress: percentToSave, p_current_time: currentTime, p_is_complete: complete,
            }, { signal: controller.signal });

        const { error: rpcError } = await rpcCall;
        if (rpcError) throw rpcError;

        if (complete && !isComplete && isMountedRef.current) {
          setIsComplete(true);
          securityAudit.logEvent('VIDEO_COMPLETED', {
            userId: user.id, videoId, totalDuration: videoDuration, timeSpent: currentTime,
          }).catch(console.error);
        }

        if (isFinal) {
          try { localStorage.removeItem(`${STORAGE_KEY_PREFIX}${videoId}`); } catch (_) {}
        }
        return;

      } catch (err) {
        if (err.name === 'AbortError') return;
        lastError = err;
        attempt++;
        if (attempt <= retryCount && isMountedRef.current) {
          try { await delayWithSignal(retryDelay * attempt, controller.signal); } catch (e) { if (e.name === 'AbortError') return; }
        }
      }
    }

    if (isMountedRef.current) {
      setError(lastError?.message || 'Failed to save video progress');
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${videoId}`, JSON.stringify({
          currentTime: Math.round(currentTime * 10) / 10,
          duration: Math.round(videoDuration * 10) / 10,
          percent: Math.round(percentToSave * 10) / 10,
          timestamp: Date.now(),
        }));
      } catch (_) {}
    }
  }, [user, videoId, isComplete, minProgressDelta, retryCount, retryDelay, rpcSchema]);

  const scheduleSave = useCallback((currentTime, videoDuration) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) saveProgress(currentTime, videoDuration, false);
    }, saveInterval);
  }, [saveProgress, saveInterval]);

  // ⏱️ تتبع تقدم اليوتيوب
  const trackYouTubeProgress = useCallback(() => {
    const player = playerInstanceRef.current;
    if (!player || typeof player.getCurrentTime !== 'function' || !isMountedRef.current) return;

    const currentTime = player.getCurrentTime();
    const videoDuration = player.getDuration() || duration;

    // التحقق من صحة القيم قبل التحديث
    if (!isValidProgress(currentTime) || !isValidProgress(videoDuration)) return;

    liveSnapshotRef.current = { currentTime, duration: videoDuration };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (isMountedRef.current) {
          setProgress(currentTime);
          if (videoDuration > 0) {
            setDuration(videoDuration);
            setPercent((currentTime / videoDuration) * 100);
          }
        }
      });
    } else {
      setProgress(currentTime);
      if (videoDuration > 0) {
        setDuration(videoDuration);
        setPercent((currentTime / videoDuration) * 100);
      }
    }

    const now = Date.now();
    if (now - lastUpdateTimeRef.current > saveInterval / 2) {
      lastUpdateTimeRef.current = now;
      scheduleSave(currentTime, videoDuration);
    }
  }, [duration, scheduleSave, saveInterval]);

  // 🎬 أحداث مشغل اليوتيوب
  const handleYouTubeStateChange = useCallback((event) => {
    if (!isMountedRef.current) return;
    
    const playerState = event.data;

    if (playerState === 1) { // PLAYING
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = setInterval(trackYouTubeProgress, pollingInterval);
    } else { // PAUSED / ENDED / BUFFERING
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      
      if (playerState === 0) { // ENDED
        const { currentTime, duration: snapDuration } = liveSnapshotRef.current;
        const finalTime = snapDuration > 0 ? snapDuration : currentTime;
        if (isValidProgress(finalTime)) {
          saveProgress(finalTime, finalTime, true);
        }
      }
    }
  }, [trackYouTubeProgress, pollingInterval, saveProgress]);

  const handleYouTubeReady = useCallback((event) => {
    playerInstanceRef.current = event.target;
    const videoDuration = event.target.getDuration();
    if (isValidProgress(videoDuration) && videoDuration > 0) {
      setDuration(videoDuration);
      liveSnapshotRef.current = { currentTime: liveSnapshotRef.current.currentTime, duration: videoDuration };
    }
    if (isValidProgress(progress) && progress > 0) {
      event.target.seekTo(progress, true);
    }
  }, [progress]);

  // 📋 معالج الأخطاء (إضافة)
  const handleYouTubeError = useCallback((event) => {
    const errorCode = event.data;
    let errorMessage = 'Unknown YouTube player error';
    if (errorCode === 2) errorMessage = 'Invalid video ID';
    else if (errorCode === 5) errorMessage = 'HTML5 player error';
    else if (errorCode === 100) errorMessage = 'Video not found';
    else if (errorCode === 101) errorMessage = 'Embedding disabled by video owner';
    else if (errorCode === 150) errorMessage = 'Embedding disabled by video owner (alternative)';
    
    setError(`YouTube Error: ${errorMessage}`);
    securityAudit.logEvent('YOUTUBE_PLAYER_ERROR', {
      userId: user?.id,
      videoId,
      errorCode,
      errorMessage,
    }).catch(console.error);
  }, [videoId, user]);

  // 🔄 تبديل الفيديو
  useEffect(() => {
    if (!videoId) return;

    fetchSavedProgress();

    if (isMountedRef.current) {
      setProgress(0);
      setPercent(0);
      setIsComplete(false);
      setError(null);
    }

    if (!isOnline) {
      try {
        const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${videoId}`);
        if (stored) {
          const data = JSON.parse(stored);
          if (isValidProgress(data.percent) && data.percent > 0) {
            setPercent(data.percent);
            setProgress(isValidProgress(data.currentTime) ? data.currentTime : 0);
            if (data.percent >= 95) setIsComplete(true);
          }
        }
      } catch (_) {}
    }

    return () => {
      const { currentTime, duration: snapDuration } = liveSnapshotRef.current;
      if (isValidProgress(currentTime) && isValidProgress(snapDuration) && snapDuration > 0 && isMountedRef.current) {
        saveProgress(currentTime, snapDuration, true);
      }
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      playerInstanceRef.current = null;
    };
  }, [videoId, fetchSavedProgress, isOnline, saveProgress]);

  // 🔄 إعادة المحاولة عند عودة الاتصال
  useEffect(() => {
    if (!isOnline || !videoId || !isValidUUID(videoId)) return;
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${videoId}`);
      if (stored) {
        const data = JSON.parse(stored);
        if (isValidProgress(data.percent) && data.percent > 0 && data.percent > lastSavedPercentRef.current) {
          saveProgress(
            isValidProgress(data.currentTime) ? data.currentTime : 0,
            isValidProgress(data.duration) ? data.duration : 0,
            true
          ).catch(console.error);
        }
      }
    } catch (_) {}
  }, [isOnline, videoId, saveProgress]);

  // 🚪 Keepalive عند إغلاق التبويب
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { currentTime, duration: snapDuration } = liveSnapshotRef.current;
      if (!user || !videoId || !isValidUUID(videoId) || !isValidProgress(currentTime) || !isValidProgress(snapDuration) || snapDuration <= 0) return;

      const percentToSave = (currentTime / snapDuration) * 100;
      const complete = percentToSave >= 95;
      const accessToken = session?.access_token;

      if (!accessToken) {
        try {
          localStorage.setItem(`${STORAGE_KEY_PREFIX}${videoId}`, JSON.stringify({
            currentTime: Math.round(currentTime * 10) / 10,
            duration: Math.round(snapDuration * 10) / 10,
            percent: Math.round(percentToSave * 10) / 10,
            timestamp: Date.now(),
          }));
        } catch (_) {}
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '';
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || '';
      if (!supabaseUrl || !supabaseKey) return;

      const payload = JSON.stringify({
        p_user_id: user.id, p_video_id: videoId, p_progress: percentToSave, p_current_time: currentTime, p_is_complete: complete,
      });

      const endpoint = rpcSchema === 'public'
        ? `${supabaseUrl}/rest/v1/rpc/update_video_progress`
        : `${supabaseUrl}/rest/v1/rpc/update_video_progress?schema=${rpcSchema}`;

      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${accessToken}`,
        },
        body: payload,
        keepalive: true,
      }).catch(() => {
        try {
          localStorage.setItem(`${STORAGE_KEY_PREFIX}${videoId}`, JSON.stringify({
            currentTime: Math.round(currentTime * 10) / 10,
            duration: Math.round(snapDuration * 10) / 10,
            percent: Math.round(percentToSave * 10) / 10,
            timestamp: Date.now(),
          }));
        } catch (_) {}
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [videoId, user, session, rpcSchema]);

  return {
    progress,
    duration,
    percent,
    isComplete,
    loading,
    error,
    handleYouTubeReady,
    handleYouTubeStateChange,
    handleYouTubeError, // ✅ إضافة معالج الأخطاء
    saveProgressNow: () => {
      const { currentTime, duration: snapDuration } = liveSnapshotRef.current;
      if (isValidProgress(snapDuration) && snapDuration > 0) {
        saveProgress(currentTime, snapDuration, true);
      }
    },
    resetProgress: () => {
      setProgress(0);
      setPercent(0);
      setIsComplete(false);
      lastSavedPercentRef.current = 0;
      liveSnapshotRef.current = { currentTime: 0, duration: liveSnapshotRef.current.duration };
      if (playerInstanceRef.current && typeof playerInstanceRef.current.seekTo === 'function') {
        playerInstanceRef.current.seekTo(0, true);
      }
      try { localStorage.removeItem(`${STORAGE_KEY_PREFIX}${videoId}`); } catch (_) {}
    },
  };
};

export default useVideoProgress;