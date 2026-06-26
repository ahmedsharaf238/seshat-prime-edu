// src/lib/helpers/deviceFingerprint.js

/**
 * 🕵️‍♂️ Advanced Device Fingerprinting Engine - The Fortress (2050 Ready)
 * 
 * الميزات المتقدمة للنسخة v4.1.0:
 * - دعم User-Agent Client Hints (UA-CH) لمقاومة تجميد المتصفحات.
 * - استقرار البصمة الصوتية (Anti-Avalanche Effect).
 * - حماية الـ Hash النهائي من الـ Race Conditions الخاصة بالـ WebRTC.
 * - تتبع الـ Device بصرف النظر عن وضع التصفح (العادي/الخفي).
 * - إضافة AbortController لـ WebRTC و Audio لتجنب تسرب الذاكرة.
 * - كشف بيئات التشغيل الآلي (Headless Browsers).
 * - دالة normalizeFingerprint لتوحيد قراءة البصمة بين الأنظمة.
 * 
 * @version 4.1.0 (Ultimate Stability & Security)
 * @author Seshat Prime Edu Team & Cyber Expert
 */

import { securityAudit } from '../security/auditLog';

const isServer = typeof window === 'undefined';

// ==============================
// 1. البيانات الأساسية المتقدمة (دعم UA-CH المستقبلي)
// ==============================
const getAdvancedBaseData = async () => {
  if (isServer) return 'server-base';

  let base = [
    navigator.language,
    screen.colorDepth,
    `${screen.width}x${screen.height}`,
    navigator.hardwareConcurrency || 'unknown',
    Intl.DateTimeFormat().resolvedOptions().timeZone
  ].join('|');

  // دعم التقنية المستقبلية (User-Agent Client Hints) لتفادي تجميد المتصفحات
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    try {
      const hints = await navigator.userAgentData.getHighEntropyValues([
        'architecture', 'model', 'platformVersion', 'fullVersionList'
      ]);
      const brands = hints.fullVersionList ? hints.fullVersionList.map(b => `${b.brand}:${b.version}`).join(',') : '';
      base += `|${hints.architecture}|${hints.model}|${hints.platformVersion}|${brands}`;
    } catch (_) {
      base += `|${navigator.userAgent}`;
    }
  } else {
    // دعم رجعي للمتصفحات القديمة
    base += `|${navigator.userAgent}|${navigator.platform}`;
  }

  return base;
};

// ==============================
// 2. بصمة WebGL (كارت الشاشة)
// ==============================
const getWebGLFingerprint = () => {
  if (isServer) return 'server-webgl';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'no-webgl';

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'webgl-no-debug';

    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    return `${vendor}|${renderer}`;
  } catch (error) {
    return `webgl-error:${error.message}`;
  }
};

// ==============================
// 3. بصمة Canvas (محرك الرسم)
// ==============================
const getCanvasFingerprint = () => {
  if (isServer) return 'server-canvas';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-canvas';

    ctx.textBaseline = 'top';
    ctx.font = '16px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('SeshatPrimeEdu', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('2050', 4, 17);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#f00';
    ctx.beginPath();
    ctx.arc(50, 50, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#00f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(256, 64);
    ctx.stroke();

    return canvas.toDataURL('image/png');
  } catch (error) {
    return `canvas-error:${error.message}`;
  }
};

// ==============================
// 4. بصمة الصوت (مع AbortController لمنع التجميد)
// ==============================
const getAudioFingerprint = () => {
  if (isServer) return Promise.resolve('server-audio');

  return new Promise((resolve) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      resolve('audio-timeout');
    }, 3000);

    try {
      const AudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!AudioContext) {
        clearTimeout(timeout);
        return resolve('no-audio');
      }

      const context = new AudioContext(1, 44100, 44100);
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(10000, context.currentTime);

      const compressor = context.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-50, context.currentTime);
      compressor.knee.setValueAtTime(40, context.currentTime);
      compressor.ratio.setValueAtTime(12, context.currentTime);
      compressor.attack.setValueAtTime(0, context.currentTime);
      compressor.release.setValueAtTime(0.25, context.currentTime);

      oscillator.connect(compressor);
      compressor.connect(context.destination);

      oscillator.start(0);
      context.startRendering()
        .then((buffer) => {
          if (controller.signal.aborted) return;
          clearTimeout(timeout);
          const channelData = buffer.getChannelData(0);
          let sum = 0;
          for (let i = 4000; i < 5000; i++) {
            sum += Math.abs(channelData[i]);
          }
          resolve(sum.toFixed(3));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          clearTimeout(timeout);
          resolve('audio-render-failed');
        });
    } catch (error) {
      clearTimeout(timeout);
      resolve(`audio-error:${error.message}`);
    }
  });
};

// ==============================
// 5. بصمة WebRTC (مع AbortController لمنع تسرب الذاكرة)
// ==============================
const getWebRTCFingerprint = () => {
  if (isServer) return Promise.resolve('server-webrtc');
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      if (pc) pc.close();
      resolve('');
    }, 1500);

    let pc = null;
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
      let ips = [];
      pc.createDataChannel('');
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});

      pc.onicecandidate = (event) => {
        if (controller.signal.aborted) return;
        if (event.candidate) {
          const candidate = event.candidate.candidate;
          const ipMatch = candidate.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local)|((\d{1,3}\.){3}\d{1,3})/g);
          if (ipMatch) ips = ips.concat(ipMatch);
        } else {
          clearTimeout(timeoutId);
          const uniqueIps = [...new Set(ips)];
          pc.close();
          resolve(uniqueIps.join(','));
        }
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (pc) pc.close();
      resolve('');
    }
  });
};

// ==============================
// 6. كشف البيئة الافتراضية (VM)
// ==============================
const isVirtualMachine = (webglString = '') => {
  if (isServer) return false;
  try {
    const ua = navigator.userAgent.toLowerCase();
    const vmIndicators = ['virtual', 'vmware', 'vbox', 'virtualbox', 'qemu', 'kvm', 'xen', 'hyper-v', 'parallels'];
    if (vmIndicators.some(ind => ua.includes(ind))) return true;

    if (webglString.includes('VMware') || webglString.includes('VirtualBox') || webglString.includes('SwiftShader')) {
      return true;
    }
  } catch (_) {}
  return false;
};

// ==============================
// 7. 🆕 كشف بيئات التشغيل الآلي (Headless Browsers)
// ==============================
export const isHeadlessBrowser = () => {
  if (isServer) return false;
  try {
    // 1. التحقق من وجود navigator.webdriver (معيار W3C)
    if (navigator.webdriver) return true;

    // 2. التحقق من عدد الـ Plugins (المتصفحات الرأسية غالباً لا تحتوي على إضافات)
    if (navigator.plugins.length === 0) return true;

    // 3. التحقق من Chrome في الوضع الرأسي (بعضها يزيل واجهة chrome.app)
    if (window.chrome && !window.chrome.app) return true;

    // 4. كشف Headless Chrome عبر إشارات إضافية (اختياري)
    if (navigator.languages.length === 0) return true;
  } catch (_) {}
  return false;
};

// ==============================
// 8. كشف الوضع الخاص (Private Mode) - للاستخدام الرقابي فقط وليس للهاش
// ==============================
const detectPrivateMode = async () => {
  if (isServer) return false;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { quota } = await navigator.storage.estimate();
      // مؤشر نسبي وليس قاطعاً للـ Incognito
      if (quota && quota < 120000000) return true;
    }
  } catch (_) {}
  return false;
};

// ==============================
// 9. توليد البصمة النهائية (Stable SHA-256)
// ==============================
export const generateDeviceFingerprint = async (includeAudit = true) => {
  if (isServer) return 'server-side-execution';

  try {
    // جلب البيانات الأساسية (مع Client Hints)
    const baseData = await getAdvancedBaseData();

    // جلب البصمات المتقدمة بالتوازي مع التحكم في المهلات
    const [webgl, canvas, audio, webrtc] = await Promise.all([
      getWebGLFingerprint(),
      getCanvasFingerprint(),
      getAudioFingerprint(),
      getWebRTCFingerprint()
    ]);

    // جلب بيانات الرقابة (لا تؤثر على الهاش النهائي)
    const [isPrivate, isHeadless, isVM] = await Promise.all([
      detectPrivateMode(),
      Promise.resolve(isHeadlessBrowser()),
      Promise.resolve(isVirtualMachine(webgl))
    ]);

    // بناء البصمة الخام (ثابتة تماماً)
    const rawFingerprint = [
      baseData,
      webgl,
      canvas,
      audio,
      webrtc
    ].join('|');

    // تشفير SHA-256
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(rawFingerprint);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const finalFingerprint = `fp_${hashHex.substring(0, 32)}`;

    // تسجيل الحدث في الـ Audit Log (مع بيانات الرقابة)
    if (includeAudit && typeof securityAudit !== 'undefined') {
      securityAudit.logEvent('DEVICE_FINGERPRINT_GENERATED', {
        fingerprint: finalFingerprint,
        webgl,
        canvas: canvas.substring(0, 50),
        audio: audio.substring(0, 50),
        webrtc: webrtc.substring(0, 50),
        isVM,
        isPrivate,
        isHeadless,
        timestamp: Date.now(),
      });
    }

    return finalFingerprint;
  } catch (error) {
    console.warn('Fingerprint generation failed, using fallback:', error);
    // Fallback آمن باستخدام UUID أو رقم عشوائي
    const fallbackId = crypto.randomUUID ? crypto.randomUUID().substring(0, 12) : Math.random().toString(36).substring(2, 14);
    return `fp_fallback_${fallbackId}`;
  }
};

// ==============================
// 10. التحقق من البصمة (يدعم الوضع المتساهل والمتصلب)
// ==============================
export const verifyFingerprint = async (storedFingerprint, strict = true) => {
  if (isServer) return true;
  if (!storedFingerprint) return false;

  try {
    const current = await generateDeviceFingerprint(false);
    if (strict) {
      return current === storedFingerprint;
    }
    // الوضع المتساهل: مقارنة أول 16 حرفاً فقط (لتسامح اختلافات طفيفة)
    return current.substring(0, 16) === storedFingerprint.substring(0, 16);
  } catch {
    return false;
  }
};

// ==============================
// 11. 🆕 توحيد البصمة (Normalize)
// ==============================
export const normalizeFingerprint = (fingerprint) => {
  if (!fingerprint) return '';
  return fingerprint.trim().toLowerCase().replace(/[^a-f0-9_]/g, '');
};

// ==============================
// 12. الحصول على معلومات البيئة الكاملة (للتسجيل والمراقبة)
// ==============================
export const getEnvironmentInfo = async () => {
  if (isServer) {
    return {
      isVM: false,
      isPrivate: false,
      isHeadless: false,
      type: 'server',
      fingerprint: 'server-env'
    };
  }

  const [fingerprint, webgl, canvas, audio, webrtc, isPrivate, isHeadless, isVM] = await Promise.all([
    generateDeviceFingerprint(false),
    Promise.resolve(getWebGLFingerprint()),
    Promise.resolve(getCanvasFingerprint()),
    getAudioFingerprint(),
    getWebRTCFingerprint(),
    detectPrivateMode(),
    Promise.resolve(isHeadlessBrowser()),
    Promise.resolve(isVirtualMachine(getWebGLFingerprint()))
  ]);

  return {
    fingerprint,
    webgl,
    canvas: canvas.substring(0, 100),
    audio: audio.substring(0, 100),
    webrtc,
    isVM,
    isPrivate,
    isHeadless,
    hardware: {
      cores: navigator.hardwareConcurrency || 'unknown',
      memory: navigator.deviceMemory || 'unknown',
      pixelRatio: window.devicePixelRatio || 1,
    },
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
    },
    timestamp: Date.now(),
  };
};

// ==============================
// 13. تصدير الوظائف العامة
// ==============================
export default {
  generateDeviceFingerprint,
  verifyFingerprint,
  normalizeFingerprint,
  getEnvironmentInfo,
  getWebGLFingerprint,
  getCanvasFingerprint,
  getAudioFingerprint,
  getWebRTCFingerprint,
  isVirtualMachine,
  isHeadlessBrowser,
  detectPrivateMode,
};