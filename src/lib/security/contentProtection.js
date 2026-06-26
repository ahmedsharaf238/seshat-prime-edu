// src/lib/security/contentProtection.js

/**
 * 🔒 Ultimate Anti-Screenshot & Anti-Recording Engine v3.0 (2050-Ready)
 * 
 * المميزات:
 * - علامة مائية جنائية تحمل (اسم الطالب، إيميله، تلفونه، تلفون ولي الأمر، الوقت).
 * - إجبار الفيديو على ملء الشاشة (لتعطيل أزرار الموبايل).
 * - كشف مغادرة الصفحة أثناء الامتحان (لوقف الفيديو فوراً).
 * - منع النسخ، الطباعة، النقر الأيمن، وأدوات المطورين (بدون debugger).
 * - دعم RTL بالكامل.
 * - زر تبديل العلامة المائية (Toggle) آمن، يعمل فقط للمعلم في الإنتاج.
 * - نظام صلاحيات متكامل (يقرأ دور المستخدم).
 * 
 * @version 3.0.0
 */

import { securityAudit } from './auditLog';

// ============================================================
// 1. الإعدادات العامة (Config)
// ============================================================

const isServer = typeof window === 'undefined';

let protectionConfig = {
  preventCopy: true,
  preventPrint: true,
  preventScreenshot: true,
  detectDevTools: true,
  devToolsDetectionInterval: 2000, // كل 2 ثانية (توفير للطاقة)
  devToolsMaxOpenTime: 5000,
  onViolation: 'report', // 'report' | 'warn' | 'lock'
  watermarkEnabled: true,
  watermarkOpacity: 0.06,
  watermarkDirection: 'ltr', // 'rtl' للغة العربية
  screenRecordingDetection: true,
  fullscreenRequired: true,
  pauseOnVisibilityChange: true,
  // 🆕 إعدادات الصلاحيات (من يسمح له بتبديل العلامة المائية)
  allowedRolesForToggle: ['teacher'], //فقط المعلم
};

// ============================================================
// 2. المتغيرات العامة (State Management)
// ============================================================

let devToolsOpenTime = 0;
let devToolsIntervalId = null;
let watermarkRAFId = null;
let watermarkElement = null;
let watermarkActive = true; // حالة العلامة المائية (ON/OFF)
let videoProtectionCleanup = null;
let isLocked = false;

// ============================================================
// 3. دوال مساعدة (Helpers)
// ============================================================

const getUserData = (userData) => {
  if (!userData) return null;
  return {
    fullName: userData.fullName || 'غير مسجل',
    email: userData.email || 'غير مسجل',
    phone: userData.phone || 'غير مسجل',
    parentPhone: userData.parentPhone || 'غير مسجل',
    role: userData.role || 'طالب',
  };
};

const getDeviceInfo = () => ({
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  screenWidth: screen.width,
  screenHeight: screen.height,
  colorDepth: screen.colorDepth,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  language: navigator.language,
});

const handleViolation = (type, details = {}) => {
  // تسجيل مفصّل مع بيانات الجهاز
  const fullDetails = {
    ...details,
    device: getDeviceInfo(),
    timestamp: new Date().toISOString(),
    page: window.location.pathname,
  };

  securityAudit.logEvent(`CONTENT_PROTECTION_VIOLATION_${type.toUpperCase()}`, fullDetails);

  switch (protectionConfig.onViolation) {
    case 'warn':
      console.warn(`[Content Protection]: Violation detected: ${type}`, fullDetails);
      alert(`⚠️ تم اكتشاف محاولة انتهاك: ${type}. سيتم تسجيل الحدث.`);
      break;
    case 'lock':
      lockPage(type);
      break;
    case 'report':
    default:
      console.info(`[Content Protection]: Violation reported: ${type}`, fullDetails);
      break;
  }
};

// ============================================================
// 4. قفل الصفحة (Lock Page) - بدون تدمير DOM
// ============================================================

const lockPage = (reason) => {
  if (isLocked) return;
  isLocked = true;

  // ✅ استخدام Overlay بدلاً من تدمير Body (آمن مع React)
  const overlay = document.createElement('div');
  overlay.id = 'seshat-lock-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(15, 15, 18, 0.98);
    color: #ff4a4a;
    z-index: 99999999999;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    font-family: system-ui, -apple-system, sans-serif;
    text-align: center;
    padding: 20px;
    backdrop-filter: blur(20px);
  `;
  overlay.innerHTML = `
    <h1 style="font-size: 2.5rem; margin-bottom: 1rem;">🚫 تم قفل الجلسة</h1>
    <p style="color: #a0a0ab; font-size: 1.2rem; max-width: 500px;">
      تم رصد نشاط غير مصرح به. تم قفل الصفحة حفاظاً على أمان المحتوى.
    </p>
    <p style="color: #ff6b6b; margin-top: 1rem; font-weight: bold;">
      السبب: ${reason}
    </p>
    <p style="color: #888; margin-top: 2rem; font-size: 0.9rem;">
      يرجى التواصل مع الدعم الفني.
    </p>
  `;
  document.body.appendChild(overlay);

  // إيقاف جميع المؤقتات والمستمعات
  if (devToolsIntervalId) clearInterval(devToolsIntervalId);
  if (watermarkRAFId) cancelAnimationFrame(watermarkRAFId);
  document.removeEventListener('contextmenu', preventDefault);
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('copy', preventDefault);
  document.removeEventListener('cut', preventDefault);
  document.removeEventListener('dragstart', preventDefault);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  document.removeEventListener('visibilitychange', handleVisibilityChange);

  // إزالة العلامة المائية
  const wm = document.getElementById('forensic-watermark');
  if (wm) wm.remove();
  const blocker = document.getElementById('devtools-blocker');
  if (blocker) blocker.remove();
  const printBlocker = document.getElementById('manus-print-blocker');
  if (printBlocker) printBlocker.remove();
};

// ============================================================
// 5. دوال الحماية الأساسية (Prevent Defaults)
// ============================================================

const preventDefault = (e) => {
  e.preventDefault();
  if (!isLocked) {
    handleViolation('PREVENT_ACTION', { actionType: e.type, key: e.key });
  }
};

const handleKeydown = (e) => {
  // السماح في حقول الإدخال
  if (e.target.closest('input, textarea, [contenteditable="true"]')) return;

  const isCtrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  // اختصارات الحفظ، الطباعة، فتح المصدر، النسخ، تحديد الكل
  if (isCtrl && ['s', 'p', 'u', 'c', 'a'].includes(key)) {
    e.preventDefault();
    handleViolation('KEYBOARD_SHORTCUT', { key: e.key, ctrl: true });
    return;
  }

  // أدوات المطورين (F12, Ctrl+Shift+I, J, C)
  if (e.key === 'F12' || (isCtrl && e.shiftKey && ['i', 'j', 'c'].includes(key))) {
    e.preventDefault();
    handleViolation('DEVTOOLS_SHORTCUT_ATTEMPT', { key: e.key });
    return;
  }

  // زر Print Screen
  if (e.key === 'PrintScreen') {
    e.preventDefault();
    handleViolation('PRINT_SCREEN_ATTEMPT', {});
    alert('⛔ تم تعطيل خاصية التصوير. سيتم تسجيل المحاولة.');
    return;
  }
};

// ============================================================
// 6. 🧠 كشف أدوات المطورين (بدون debugger)
// ============================================================

const detectDevTools = () => {
  if (isServer || !protectionConfig.detectDevTools) return;

  const check = () => {
    let devtoolsAreOpen = false;

    // ✅ الطريقة الذهبية 2050: الاعتماد على الأبعاد فقط (لا تستهلك CPU)
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;

    if (widthDiff > 160 || heightDiff > 160) {
      devtoolsAreOpen = true;
    }

    if (devtoolsAreOpen) {
      const now = Date.now();
      if (devToolsOpenTime === 0) {
        devToolsOpenTime = now;
      } else if (now - devToolsOpenTime > protectionConfig.devToolsMaxOpenTime) {
        handleViolation('DEVTOOLS_OPENED_LONG_TIME', { openDuration: now - devToolsOpenTime });
        devToolsOpenTime = 0; // إعادة تعيين لتجنب التكرار
      }

      // عرض الطبقة الحاجبة (Overlay)
      let blocker = document.getElementById('devtools-blocker');
      if (!blocker) {
        blocker = document.createElement('div');
        blocker.id = 'devtools-blocker';
        blocker.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.85);
          color: #ff4444;
          z-index: 9999999;
          display: flex;
          justify-content: center;
          align-items: center;
          backdrop-filter: blur(10px);
          flex-direction: column;
          padding: 20px;
          pointer-events: none; /* لا تمنع التفاعل مع الصفحة، مجرد تحذير بصري */
        `;
        blocker.innerHTML = `
          <h1 style="font-size: 2rem; margin-bottom: 0.5rem;">🚫 Developer Tools Detected</h1>
          <p style="color: #aaa;">Please close the developer console to continue.</p>
          <p style="color: #666; font-size: 0.9rem; margin-top: 1rem;">التقاط الشاشة أو تسجيل الفيديو ممنوع</p>
        `;
        document.body.appendChild(blocker);
      }
    } else {
      devToolsOpenTime = 0;
      const blocker = document.getElementById('devtools-blocker');
      if (blocker) blocker.remove();
    }
  };

  if (devToolsIntervalId) clearInterval(devToolsIntervalId);
  devToolsIntervalId = setInterval(check, protectionConfig.devToolsDetectionInterval);
};

// ============================================================
// 7. 🎥 كشف تسجيل الشاشة (خفيف بدون تفتيش النصوص)
// ============================================================

const detectScreenRecording = () => {
  if (isServer || !protectionConfig.screenRecordingDetection) return;

  // فقط نراقب تغيير الحجم بشكل خفيف (لا نفتش innerText)
  let lastWidth = window.innerWidth;
  let lastHeight = window.innerHeight;
  const checkSize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (Math.abs(w - lastWidth) > 100 || Math.abs(h - lastHeight) > 100) {
      // تغيير كبير في الحجم، قد يكون فتح تطبيق تسجيل
      handleViolation('SCREEN_SIZE_CHANGE_SUSPICIOUS', {
        diffWidth: w - lastWidth,
        diffHeight: h - lastHeight,
      });
    }
    lastWidth = w;
    lastHeight = h;
  };
  const intervalId = setInterval(checkSize, 3000);
  return intervalId;
};

let screenRecordingIntervalId = null;

// ============================================================
// 8. 🎨 العلامة المائية الجنائية (مع دعم RTL)
// ============================================================

const createForensicWatermark = (userData) => {
  if (!userData || !protectionConfig.watermarkEnabled) return null;

  const data = getUserData(userData);
  const isRTL = protectionConfig.watermarkDirection === 'rtl';

  const watermarkDiv = document.createElement('div');
  watermarkDiv.id = 'forensic-watermark';
  watermarkDiv.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 999998;
    overflow: hidden;
    opacity: ${protectionConfig.watermarkOpacity};
    font-family: 'Courier New', monospace, 'Arial';
    font-weight: bold;
    color: #000000;
    display: ${watermarkActive ? 'flex' : 'none'};
    justify-content: center;
    align-items: center;
    transform: rotate(-20deg) scale(1.5);
    user-select: none;
    -webkit-user-select: none;
    text-shadow: 0 0 5px rgba(0, 0, 0, 0.1);
    white-space: pre-wrap;
    word-break: break-all;
    direction: ${isRTL ? 'rtl' : 'ltr'};
    text-align: ${isRTL ? 'right' : 'left'};
  `;

  const updateWatermark = (timestamp) => {
    const timeStr = timestamp || new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
    const text = `🛡️ ${data.fullName} | ${data.email} | ت: ${data.phone} | ولي: ${data.parentPhone} | ${timeStr} | Seshat-Prime `;
    const finalText = isRTL ? `${text} ${text}`.repeat(25) : text.repeat(50);
    watermarkDiv.innerText = finalText;
  };

  // تحديث أولي
  updateWatermark();
  document.body.appendChild(watermarkDiv);

  // حفظ المرجع للتبديل
  watermarkElement = watermarkDiv;

  // تحديث كل 60 ثانية باستخدام requestAnimationFrame (توفير الطاقة)
  let lastUpdate = Date.now();
  const scheduleUpdate = () => {
    if (!watermarkActive) {
      watermarkRAFId = requestAnimationFrame(scheduleUpdate);
      return;
    }
    const now = Date.now();
    if (now - lastUpdate >= 60000) {
      const timeStr = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
      updateWatermark(timeStr);
      lastUpdate = now;
    }
    watermarkRAFId = requestAnimationFrame(scheduleUpdate);
  };
  scheduleUpdate();

  // تخزين الدالة للتحديث اليدوي
  window._watermarkUpdate = updateWatermark;

  return watermarkDiv;
};

// ============================================================
// 9. 🎛️ تبديل العلامة المائية (Toggle Watermark - آمن 100%)
// ============================================================

/**
 * تبديل حالة العلامة المائية (إظهار/إخفاء)
 * @param {boolean} show - true للإظهار، false للإخفاء
 * @param {string} userId - معرف المستخدم (للتحقق من الصلاحية)
 * @param {string} userRole - دور المستخدم (للتحقق من الصلاحية)
 * @returns {boolean} - الحالة الجديدة للعلامة المائية
 */
export const toggleWatermark = (show, userId = null, userRole = null) => {
  if (isServer) return false;

  const isProduction = window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1');

  // 🔥 التحقق من الصلاحيات في بيئة الإنتاج
  if (isProduction) {
    // إذا لم يتم تمرير دور المستخدم، نرفض الطلب
    if (!userRole) {
      securityAudit.logEvent('WATERMARK_TOGGLE_ATTEMPT', {
        status: 'REJECTED',
        reason: 'No user role provided in production',
        userId: userId || 'unknown',
      });
      console.warn('[Security] Watermark toggle rejected: No user role provided.');
      return watermarkActive;
    }

    // التحقق مما إذا كان الدور مسموحاً له (معلم أو مشرف)
    const isAuthorized = protectionConfig.allowedRolesForToggle.includes(userRole.toLowerCase());

    if (!isAuthorized) {
      securityAudit.logEvent('WATERMARK_TOGGLE_ATTEMPT', {
        status: 'UNAUTHORIZED',
        userId,
        userRole,
        reason: 'User does not have permission to toggle watermark',
      });
      console.warn(`[Security] Watermark toggle rejected: User role "${userRole}" not allowed.`);
      return watermarkActive;
    }

    // تسجيل نجاح التبديل (لمن يملك الصلاحية)
    securityAudit.logEvent('WATERMARK_TOGGLED', {
      userId,
      userRole,
      newState: show !== undefined ? show : !watermarkActive,
      environment: 'production',
    });
  } else {
    // في بيئة التطوير (localhost)، نسمح بدون قيود ونسجل فقط
    securityAudit.logEvent('WATERMARK_TOGGLED', {
      userId: userId || 'developer',
      newState: show !== undefined ? show : !watermarkActive,
      environment: 'development',
    });
  }

  // تنفيذ التبديل
  watermarkActive = (show !== undefined) ? show : !watermarkActive;

  if (watermarkElement) {
    watermarkElement.style.display = watermarkActive ? 'flex' : 'none';
  } else {
    // إذا كان العنصر غير موجود (قد يكون لم يُنشأ بعد)، نبحث عنه
    const wm = document.getElementById('forensic-watermark');
    if (wm) {
      wm.style.display = watermarkActive ? 'flex' : 'none';
      watermarkElement = wm;
    }
  }

  // إدارة حلقة التحديث (RAF) لتوفير الطاقة عند الإخفاء
  if (!watermarkActive && watermarkRAFId) {
    cancelAnimationFrame(watermarkRAFId);
    watermarkRAFId = null;
  } else if (watermarkActive && !watermarkRAFId) {
    // إعادة تشغيل التحديث إذا كان معطلاً
    const updateFn = window._watermarkUpdate;
    if (updateFn) {
      let lastUpdate = Date.now();
      const scheduleUpdate = () => {
        if (!watermarkActive) {
          watermarkRAFId = requestAnimationFrame(scheduleUpdate);
          return;
        }
        const now = Date.now();
        if (now - lastUpdate >= 60000) {
          updateFn(new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }));
          lastUpdate = now;
        }
        watermarkRAFId = requestAnimationFrame(scheduleUpdate);
      };
      scheduleUpdate();
    }
  }

  return watermarkActive;
};

// ============================================================
// 10. 🎥 حماية الفيديو المتقدمة
// ============================================================

const handleFullscreenChange = () => {};
const handleVisibilityChange = () => {};

const protectVideo = (videoElement) => {
  if (!videoElement || !(videoElement instanceof HTMLVideoElement)) return;

  const video = videoElement;
  const cleanupFunctions = [];

  // منع قائمة السياق على الفيديو
  const contextHandler = (e) => {
    e.preventDefault();
    handleViolation('VIDEO_CONTEXT_MENU', {});
  };
  video.addEventListener('contextmenu', contextHandler);
  cleanupFunctions.push(() => video.removeEventListener('contextmenu', contextHandler));

  // تعطيل Picture-in-Picture
  video.disablePictureInPicture = true;

  // تعطيل التنزيل والتحكم في التشغيل
  video.controlsList = 'nodownload noremoteplayback noplaybackrate';

  // إجبار ملء الشاشة
  if (protectionConfig.fullscreenRequired) {
    const forceFullscreen = async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen?.();
        }
      } catch (_) {}
    };
    video.addEventListener('loadedmetadata', forceFullscreen);
    video.addEventListener('play', forceFullscreen);
    cleanupFunctions.push(() => video.removeEventListener('loadedmetadata', forceFullscreen));
    cleanupFunctions.push(() => video.removeEventListener('play', forceFullscreen));

    // مراقبة الخروج من ملء الشاشة
    const fullscreenHandler = () => {
      if (!document.fullscreenElement && video && !video.paused) {
        video.pause();
        handleViolation('FULLSCREEN_EXIT_DURING_PLAYBACK', {});
        alert('⛔ تم إيقاف الفيديو لأنك خرجت من وضع ملء الشاشة. يُرجى العودة للوضع الملء.');
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    document.addEventListener('fullscreenchange', fullscreenHandler);
    cleanupFunctions.push(() => document.removeEventListener('fullscreenchange', fullscreenHandler));
  }

  // كشف مغادرة الصفحة
  if (protectionConfig.pauseOnVisibilityChange) {
    const visibilityHandler = () => {
      if (document.hidden && video && !video.paused) {
        video.pause();
        handleViolation('PAGE_LEFT_DURING_VIDEO', {});
        alert('⛔ تم إيقاف الفيديو لأنك غادرت الصفحة. تم تسجيل المحاولة.');
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    cleanupFunctions.push(() => document.removeEventListener('visibilitychange', visibilityHandler));
  }

  // تخزين دوال التنظيف
  videoProtectionCleanup = () => {
    cleanupFunctions.forEach(fn => fn());
  };
};

// ============================================================
// 11. 🛡️ الوظيفة الرئيسية (Enable)
// ============================================================

export const enableContentProtection = (userData = null, videoElement = null, options = {}) => {
  if (isServer) return () => {};

  // دمج الخيارات
  protectionConfig = { ...protectionConfig, ...options };

  // تنظيف أي حماية سابقة
  disableContentProtection();

  // إعادة تعيين حالة القفل
  isLocked = false;

  // --- 1. منع النقر الأيمن والنسخ ---
  if (protectionConfig.preventCopy) {
    document.addEventListener('contextmenu', preventDefault);
    document.addEventListener('copy', preventDefault);
    document.addEventListener('cut', preventDefault);
    document.addEventListener('dragstart', preventDefault);
  }

  // --- 2. منع اختصارات لوحة المفاتيح ---
  if (protectionConfig.preventCopy || protectionConfig.preventPrint || protectionConfig.detectDevTools) {
    document.addEventListener('keydown', handleKeydown);
  }

  // --- 3. منع الطباعة باستخدام CSS ---
  if (protectionConfig.preventPrint) {
    const styleBlock = document.createElement('style');
    styleBlock.id = 'manus-print-blocker';
    styleBlock.innerHTML = `
      @media print { body { display: none !important; } }
      body {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        user-select: none !important;
        -webkit-touch-callout: none !important;
      }
      video {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-picture-in-picture: none !important;
        picture-in-picture: none !important;
      }
    `;
    document.head.appendChild(styleBlock);
  }

  // --- 4. كشف أدوات المطورين ---
  if (protectionConfig.detectDevTools) {
    detectDevTools();
  }

  // --- 5. كشف تسجيل الشاشة ---
  if (protectionConfig.screenRecordingDetection) {
    if (screenRecordingIntervalId) clearInterval(screenRecordingIntervalId);
    screenRecordingIntervalId = detectScreenRecording();
  }

  // --- 6. العلامة المائية الجنائية ---
  if (protectionConfig.watermarkEnabled && userData) {
    createForensicWatermark(userData);
    // إعادة تعيين حالة العلامة المائية إلى مفعلة
    watermarkActive = true;
  }

  // --- 7. حماية الفيديو ---
  if (videoElement) {
    protectVideo(videoElement);
  }

  // --- 8. دالة التنظيف ---
  return () => {
    disableContentProtection();
  };
};

// ============================================================
// 12. 🧹 دالة التنظيف (Disable)
// ============================================================

export const disableContentProtection = () => {
  if (isServer) return;

  // إزالة المستمعات
  document.removeEventListener('contextmenu', preventDefault);
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('copy', preventDefault);
  document.removeEventListener('cut', preventDefault);
  document.removeEventListener('dragstart', preventDefault);

  // إيقاف المؤقتات
  if (devToolsIntervalId) clearInterval(devToolsIntervalId);
  devToolsIntervalId = null;
  if (watermarkRAFId) cancelAnimationFrame(watermarkRAFId);
  watermarkRAFId = null;
  if (screenRecordingIntervalId) clearInterval(screenRecordingIntervalId);
  screenRecordingIntervalId = null;
  devToolsOpenTime = 0;

  // إزالة عناصر الحماية
  const printBlocker = document.getElementById('manus-print-blocker');
  if (printBlocker) printBlocker.remove();

  const watermark = document.getElementById('forensic-watermark');
  if (watermark) watermark.remove();
  watermarkElement = null;

  const blocker = document.getElementById('devtools-blocker');
  if (blocker) blocker.remove();

  const lockOverlay = document.getElementById('seshat-lock-overlay');
  if (lockOverlay) lockOverlay.remove();
  isLocked = false;

  // تنظيف حماية الفيديو
  if (videoProtectionCleanup) {
    videoProtectionCleanup();
    videoProtectionCleanup = null;
  }

  // إعادة تفعيل التحديد
  document.body.style.userSelect = '';
  document.body.style.webkitUserSelect = '';
  document.body.style.mozUserSelect = '';
  document.body.style.msUserSelect = '';

  // إزالة أي متغيرات عامة
  delete window._watermarkUpdate;
};

// ============================================================
// 13. تصدير افتراضي
// ============================================================

export default {
  enable: enableContentProtection,
  disable: disableContentProtection,
  toggleWatermark,
};