// src/hooks/useCinematicEngine.js

/**
 * 🌉 useCinematicEngine Hook - جسر التواصل الذكي بين React والمحرك (V 2050.CINEMATIC-ENGINE-BRIDGE-PRO)
 * 
 * 💎 التحديثات الهندسية الفائقة:
 * - 🎛️ دعم options: تخصيص المحرك بالكامل (الألوان، الإضاءة، النموذج).
 * - 🔄 إعادة التهيئة التلقائية عند تغير options.
 * - 📊 حالة loading و progress: عرض تقدم تحميل الأصول.
 * - 🎯 threshold قابل للتخصيص لـ IntersectionObserver.
 * - 🛡️ معالجة أخطاء AudioManager.init().
 * - 📦 إرجاع engine و loading و progress.
 * - 🔧 استخدام useState لتخزين المحرك.
 */

import { useEffect, useRef, useState } from 'react';
import { MasterSceneEngine } from '../lib/engine/MasterSceneEngine';
import AudioManager from '../lib/engine/AudioManager';

const DEFAULT_OPTIONS = {
  threshold: 0.1,
  autoPause: true,
  backgroundColor: 0x0a0a0a,
  keyLightColor: 0xffb700,
  keyLightIntensity: 20,
  meshUrl: null,
  textureUrl: null,
  autoRotate: true,
  autoRotateSpeed: 0.002,
};

export const useCinematicEngine = (options = {}) => {
  const containerRef = useRef(null);
  const [engine, setEngine] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const observerRef = useRef(null);

  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const { threshold, autoPause } = mergedOptions;

  // ============================================================
  // 🔄 تهيئة المحرك وإعادة التهيئة عند تغير الخيارات
  // ============================================================
  useEffect(() => {
    if (!containerRef.current) return;

    // تهيئة AudioManager (مع معالجة الأخطاء)
    try {
      AudioManager.init();
    } catch (error) {
      console.warn('⚠️ [useCinematicEngine] AudioManager init failed:', error);
    }

    // تدمير المحرك القديم إن وجد
    if (engine) {
      engine.dispose();
      setEngine(null);
    }

    setLoading(true);
    setProgress(0);

    // إنشاء المحرك الجديد
    const newEngine = new MasterSceneEngine(containerRef.current, mergedOptions);

    // تتبع تقدم التحميل
    newEngine.setProgressCallback((p) => {
      setProgress(Math.round(p * 100));
      if (p >= 1) {
        setLoading(false);
      }
    });

    setEngine(newEngine);

    // مراقبة الرؤية (IntersectionObserver)
    if (autoPause) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            newEngine.resume();
          } else {
            newEngine.pause();
          }
        },
        { threshold, rootMargin: '0px' }
      );

      observer.observe(containerRef.current);
      observerRef.current = observer;
    }

    // ============================================================
    // 🧹 التنظيف عند فك المكون أو تغير الخيارات
    // ============================================================
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (newEngine) {
        newEngine.dispose();
      }
      // لا نُحدث state هنا لأن المكون قد يكون غير مثبت
    };
  }, [
    // إعادة التهيئة عند تغير أي خيار يؤثر على المحرك
    mergedOptions.backgroundColor,
    mergedOptions.keyLightColor,
    mergedOptions.keyLightIntensity,
    mergedOptions.meshUrl,
    mergedOptions.textureUrl,
    mergedOptions.autoRotate,
    mergedOptions.autoRotateSpeed,
    threshold,
    autoPause,
  ]);

  // ============================================================
  // 📦 القيم المصدرة
  // ============================================================
  return {
    containerRef,
    engine,
    loading,
    progress,
    isPaused: engine?.isPaused || false,
  };
};

export default useCinematicEngine;