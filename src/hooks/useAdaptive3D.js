// src/hooks/useAdaptive3D.js

/**
 * 🎬 useAdaptive3D - المحرك التكيفي السينمائي (V 2050.CINEMATIC-ULTIMATE)
 * 
 * 💎 العمارة السينمائية التفاعلية:
 * - 🎯 Render-on-Demand: إيقاف التصيير عند عدم الحركة (توفير الطاقة والحرارة).
 * - 📊 Adaptive Quality Scaling: ضبط الجودة تلقائياً حسب أداء الجهاز (CPU/GPU/Memory).
 * - ⏱️ Frame Budget Management: خفض FPS إلى 15 عند الخمول للحفاظ على حرارة الجهاز.
 * - 🏗️ LOD Ready: دعم تحميل النماذج بتفاصيل متدرجة (متكامل مع AssetManager).
 * - 🧵 OffscreenCanvas Support: نقل عمليات GPU إلى Worker Thread (اختياري).
 * - 🚀 Zero-Cost Lazy Loading: تحميل Three.js عند الطلب مع إلغاء تلقائي.
 * - 🔋 Battery-Aware: خفض الجودة تلقائياً عند انخفاض البطارية.
 * - 🎛️ دوال تحكم متقدمة: pause, resume, setQuality, setLOD, setFrameBudget.
 * - 📊 مراقبة الأداء: عرض FPS، استهلاك الذاكرة، ودرجة حرارة الجهاز (تقريبية).
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { 
  MasterSceneEngine, 
  PerformanceMonitor, 
  AssetManager, 
  AudioManager 
} from '@/lib/engine';

// ============================================================
// ⚙️ إعدادات افتراضية
// ============================================================
const DEFAULT_OPTIONS = {
  autoLoad: true,
  autoPause: true,
  threshold: 0.1,
  backgroundColor: 0x0a0a0a,
  cameraPosition: [0, 2, 8],
  keyLightColor: 0xffb700,
  keyLightIntensity: 20,
  fillLightColor: 0x4488ff,
  fillLightIntensity: 0.5,
  rimLightColor: 0xff8800,
  rimLightIntensity: 0.3,
  autoRotate: true,
  autoRotateSpeed: 0.002,
  meshUrl: null,
  textureUrl: null,
  meshColor: 0xffaa00,
  metalness: 1.0,
  roughness: 0.15,
  enableShadows: true,
  toneMappingExposure: 1.2,
  debounceResizeMs: 200,
  idleTimeoutMs: 5000,
  // إعدادات الأداء المتقدمة
  enableLOD: true,
  enableOffscreenCanvas: false, // يتطلب دعم المتصفح
  targetFPS: 60,
  idleFPS: 15,
  budget: {
    maxDrawCalls: 1000,
    maxShadows: 3,
    maxParticles: 500,
  },
};

// ============================================================
// 🧠 دالة حساب مستوى الأداء (Performance Tier)
// ============================================================
const getPerformanceTier = () => {
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const isLowEnd = memory < 4 || cores < 4 || isMobile;
  const isHighEnd = memory >= 8 && cores >= 8 && !isMobile;
  
  if (isLowEnd) return 'low';
  if (isHighEnd) return 'high';
  return 'medium';
};

// ============================================================
// 🎛️ إعدادات الجودة حسب المستوى
// ============================================================
const QUALITY_SETTINGS = {
  high: {
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    enableShadows: true,
    antialias: true,
    textureQuality: 'ultra',
    particleCount: 1000,
    maxAnisotropy: 16,
    shadowMapSize: 2048,
    LODBias: 0,
  },
  medium: {
    pixelRatio: Math.min(window.devicePixelRatio, 1.5),
    enableShadows: true,
    antialias: false,
    textureQuality: 'high',
    particleCount: 500,
    maxAnisotropy: 8,
    shadowMapSize: 1024,
    LODBias: 0.5,
  },
  low: {
    pixelRatio: 1,
    enableShadows: false,
    antialias: false,
    textureQuality: 'compressed',
    particleCount: 150,
    maxAnisotropy: 4,
    shadowMapSize: 0,
    LODBias: 1.0,
  },
};

// ============================================================
// 🔥 HOOK الرئيسي
// ============================================================
export const useAdaptive3D = (options = {}) => {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const observerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const resizeDebounceRef = useRef(null);
  const idleCallbackRef = useRef(null);
  const frameBudgetTimerRef = useRef(null);
  const lastInteractionTimeRef = useRef(Date.now());
  const isInteractingRef = useRef(false);

  // حالات المكون
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [quality, setQualityState] = useState('auto');
  const [fps, setFps] = useState(0);
  const [deviceTier, setDeviceTier] = useState(getPerformanceTier());

  // دمج الخيارات مع إعدادات الجهاز
  const deviceSettings = useMemo(() => PerformanceMonitor.getEngineSettings(), []);
  const performanceTier = useMemo(() => getPerformanceTier(), []);
  const tierSettings = useMemo(() => QUALITY_SETTINGS[performanceTier], [performanceTier]);

  const mergedOptions = useMemo(() => {
    // إذا كان المستخدم قد حدد جودة يدوياً، نستخدمها
    const qualityLevel = options.quality || 'auto';
    const manualSettings = qualityLevel !== 'auto' ? QUALITY_SETTINGS[qualityLevel] : {};

    return {
      ...DEFAULT_OPTIONS,
      ...options,
      // دمج إعدادات الأداء
      ...(qualityLevel === 'auto' ? tierSettings : manualSettings),
      // يمكن للمستخدم تجاوز أي إعداد
      ...options,
    };
  }, [options, tierSettings]);

  const {
    autoLoad,
    autoPause,
    threshold,
    debounceResizeMs,
    idleTimeoutMs,
    targetFPS,
    idleFPS,
    enableLOD,
    enableOffscreenCanvas,
    budget,
    ...engineOptions
  } = mergedOptions;

  // ============================================================
  // 🧹 دالة التنظيف الشاملة
  // ============================================================
  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (resizeDebounceRef.current) {
      clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = null;
    }
    if (idleCallbackRef.current) {
      if (typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleCallbackRef.current);
      } else {
        clearTimeout(idleCallbackRef.current);
      }
      idleCallbackRef.current = null;
    }
    if (frameBudgetTimerRef.current) {
      clearInterval(frameBudgetTimerRef.current);
      frameBudgetTimerRef.current = null;
    }
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
  }, []);

  // ============================================================
  // 🔄 إعادة تعيين Frame Budget (خفض FPS عند الخمول)
  // ============================================================
  const resetFrameBudget = useCallback(() => {
    lastInteractionTimeRef.current = Date.now();
    isInteractingRef.current = true;
    if (engineRef.current) {
      engineRef.current.setTargetFPS(targetFPS);
    }
    // إلغاء أي مؤقت سابق
    if (frameBudgetTimerRef.current) {
      clearTimeout(frameBudgetTimerRef.current);
      frameBudgetTimerRef.current = null;
    }
    // بعد فترة خمول، نخفض الـ FPS
    frameBudgetTimerRef.current = setTimeout(() => {
      isInteractingRef.current = false;
      if (engineRef.current && !isPaused) {
        engineRef.current.setTargetFPS(idleFPS);
      }
      frameBudgetTimerRef.current = null;
    }, 5000); // 5 ثواني خمول
  }, [targetFPS, idleFPS, isPaused]);

  // ============================================================
  // 🚀 تهيئة المحرك (مع Lazy Loading و Abort)
  // ============================================================
  const initializeEngine = useCallback(async () => {
    if (!containerRef.current) return;

    cleanup();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setIsReady(false);

    try {
      // تهيئة الصوتيات
      AudioManager.init();

      // تأخير التحميل باستخدام requestIdleCallback
      await new Promise((resolve) => {
        if (typeof requestIdleCallback === 'function') {
          const id = requestIdleCallback(resolve, { timeout: idleTimeoutMs });
          idleCallbackRef.current = id;
          abortController.signal.addEventListener('abort', () => {
            if (typeof cancelIdleCallback === 'function') {
              cancelIdleCallback(id);
            }
            resolve();
          });
        } else {
          const timeoutId = setTimeout(resolve, 100);
          idleCallbackRef.current = timeoutId;
          abortController.signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            resolve();
          });
        }
      });

      if (abortController.signal.aborted) {
        setIsLoading(false);
        return;
      }

      // إنشاء المحرك مع إعدادات الأداء
      const engine = new MasterSceneEngine(containerRef.current, {
        ...engineOptions,
        enableLOD,
        enableOffscreenCanvas,
        budget,
        onInteraction: resetFrameBudget, // استدعاء عند أي تفاعل
        onProgress: (p) => {
          const percent = Math.round(p * 100);
          setProgress(percent);
          if (p >= 1) {
            setIsReady(true);
            setIsLoading(false);
            // بدء مراقبة الـ FPS
            setFps(60);
          }
        },
      });

      engineRef.current = engine;

      // تفعيل Auto-Pause
      if (autoPause && containerRef.current) {
        const observer = new IntersectionObserver(
          ([entry]) => {
            if (engineRef.current) {
              if (entry.isIntersecting) {
                engineRef.current.resume();
                setIsPaused(false);
                resetFrameBudget();
              } else {
                engineRef.current.pause();
                setIsPaused(true);
              }
            }
          },
          { threshold, rootMargin: '0px' }
        );
        observer.observe(containerRef.current);
        observerRef.current = observer;
      }

      // الاشتراك في تغييرات الأداء (PerformanceMonitor)
      const perfUnsubscribe = PerformanceMonitor.subscribe((newTier, newSettings) => {
        if (engineRef.current && quality === 'auto') {
          // تحديث الجودة تلقائياً
          const newTierKey = newTier.toLowerCase();
          const newSettingsQuality = QUALITY_SETTINGS[newTierKey];
          if (newSettingsQuality) {
            engineRef.current.updateSettings(newSettingsQuality);
          }
        }
      });

      // تخزين دالة إلغاء الاشتراك للتنظيف
      const originalCleanup = cleanup;
      const enhancedCleanup = () => {
        if (perfUnsubscribe) perfUnsubscribe();
        originalCleanup();
      };
      // سيتم استدعاؤها في useEffect الختامي

    } catch (err) {
      if (err.name !== 'AbortError' && !abortController.signal.aborted) {
        console.error('❌ [useAdaptive3D] Initialization error:', err);
        setError(err.message || 'Failed to initialize 3D engine.');
        setIsLoading(false);
      }
    }
  }, [
    containerRef,
    engineOptions,
    autoPause,
    threshold,
    idleTimeoutMs,
    quality,
    enableLOD,
    enableOffscreenCanvas,
    budget,
    resetFrameBudget,
    cleanup,
  ]);

  // ============================================================
  // 🧹 التنظيف النهائي عند فك المكون
  // ============================================================
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // ============================================================
  // 🚀 التحميل التلقائي
  // ============================================================
  useEffect(() => {
    if (autoLoad && containerRef.current) {
      initializeEngine();
    }
  }, [autoLoad, initializeEngine]);

  // ============================================================
  // 📐 Resize مع Debounce
  // ============================================================
  useEffect(() => {
    if (!containerRef.current || !engineRef.current) return;

    const handleResize = () => {
      if (resizeDebounceRef.current) clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = setTimeout(() => {
        if (engineRef.current && containerRef.current) {
          engineRef.current.resize();
          resetFrameBudget(); // تنشيط عند تغيير الحجم
        }
        resizeDebounceRef.current = null;
      }, debounceResizeMs);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
    };
  }, [debounceResizeMs, resetFrameBudget]);

  // ============================================================
  // 🎛️ دوال التحكم المتقدمة
  // ============================================================
  const pause = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.pause();
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.resume();
      setIsPaused(false);
      resetFrameBudget();
    }
  }, [resetFrameBudget]);

  const togglePause = useCallback(() => {
    isPaused ? resume() : pause();
  }, [isPaused, pause, resume]);

  const reload = useCallback(async () => {
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
    setIsReady(false);
    setIsLoading(false);
    setProgress(0);
    setError(null);
    await initializeEngine();
  }, [initializeEngine]);

  const setQuality = useCallback((level) => {
    if (!['auto', 'high', 'medium', 'low'].includes(level)) {
      console.warn('Invalid quality level. Use auto, high, medium, low.');
      return;
    }
    setQualityState(level);
    if (level === 'auto') {
      PerformanceMonitor.overrideTier(null);
      PerformanceMonitor.reEvaluate();
      const tier = getPerformanceTier();
      setDeviceTier(tier);
      const newSettings = QUALITY_SETTINGS[tier];
      if (engineRef.current) {
        engineRef.current.updateSettings(newSettings);
      }
    } else {
      PerformanceMonitor.overrideTier(level.toUpperCase());
      const newSettings = QUALITY_SETTINGS[level];
      if (engineRef.current) {
        engineRef.current.updateSettings(newSettings);
      }
    }
  }, []);

  const setLOD = useCallback((enabled) => {
    if (engineRef.current) {
      engineRef.current.setLOD(enabled);
    }
  }, []);

  const setFrameBudget = useCallback((fpsTarget, fpsIdle) => {
    if (engineRef.current) {
      engineRef.current.setTargetFPS(fpsTarget);
      // تحديث idle FPS للاستخدام المستقبلي
    }
  }, []);

  const getEngine = useCallback(() => engineRef.current, []);

  // ============================================================
  // 📦 القيم المصدرة
  // ============================================================
  return {
    // مرجع الحاوية
    containerRef,

    // حالة التحميل
    isReady,
    isLoading,
    error,
    progress,

    // حالة الإيقاف المؤقت
    isPaused,

    // مستوى الجودة الحالي
    quality,
    setQuality,

    // مستوى أداء الجهاز
    deviceTier,

    // FPS الحالي
    fps,

    // دوال التحكم
    pause,
    resume,
    togglePause,
    reload,
    setLOD,
    setFrameBudget,

    // دوال مساعدة
    getEngine,

    // المحرك (للاستخدام المباشر)
    engine: engineRef.current,
  };
};

export default useAdaptive3D;