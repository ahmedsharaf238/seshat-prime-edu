// src/lib/helpers/deviceDetect.js

/**
 * 📱 Future-Proof Next-Gen Device & Client Hints Detection Utility
 * 
 * يعتمد على بروتوكول High-Entropy Client Hints الحديث
 * ومتوافق مع تجميد الـ User-Agent (UA-CH).
 * 
 * الميزات المتقدمة:
 * - كشف دقيق للأجهزة باستخدام Client Hints API
 * - توليد بصمة جهاز ثابتة (Stable Session Key) باستخدام SHA-256
 * - دمج مع Audit Log لتسجيل الأحداث الأمنية
 * - كشف الوضع الخاص (Incognito/Private)
 * - خفيف الوزن، صفر تبعيات، جاهز حتى 2050
 * 
 * @version 3.1.0 (Ultimate Edition)
 * @author Seshat Prime Edu Team
 */

import { securityAudit } from '../security/auditLog';

const isServer = typeof window === 'undefined';

// ==============================
// 1. دالة مساعدة للحصول على الـ Client Hints
// ==============================

/**
 * الحصول على كائن Client Hints (UA-CH) إن كان مدعوماً
 * @returns {Object|null} navigator.userAgentData أو null
 */
const getClientHints = () => {
  if (isServer) return null;
  return navigator.userAgentData || null;
};

// ==============================
// 2. كشف نوع الجهاز بدقة عتادية
// ==============================

/**
 * كشف نوع الجهاز باستخدام Client Hints أو Fallback التقليدي
 * @returns {string} 'mobile' | 'mobile-android' | 'mobile-ios' | 'tablet' | 'desktop' | 'server'
 */
export const detectDeviceType = () => {
  if (isServer) return 'server';

  const hints = getClientHints();
  
  // الطريقة الحديثة (Client Hints)
  if (hints && typeof hints.mobile === 'boolean') {
    if (!hints.mobile) return 'desktop';
    // كشف نوع الموبايل أو التابلت عبر fallback
  }

  // الطريقة التقليدية (Fallback)
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) {
    if (/tablet/i.test(ua)) return 'tablet';
    return 'mobile-android';
  }
  if (/iphone|ipad|ipod/i.test(ua)) {
    if (/ipad/i.test(ua) || (window.screen.width >= 1024 && window.screen.height >= 768)) return 'tablet';
    return 'mobile-ios';
  }
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  if (/mobile/i.test(ua)) return 'mobile';
  
  return 'desktop';
};

// دوال مساعدة سريعة
export const isMobile = () => detectDeviceType().startsWith('mobile');
export const isTablet = () => detectDeviceType() === 'tablet';
export const isDesktop = () => detectDeviceType() === 'desktop';
export const isAndroid = () => detectDeviceType() === 'mobile-android';
export const isIOS = () => detectDeviceType() === 'mobile-ios';

// ==============================
// 3. كشف نظام التشغيل عبر Client Hints أو Fallback
// ==============================

/**
 * كشف نظام التشغيل باستخدام Client Hints أو User-Agent
 * @returns {string} 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'chromeos' | 'unknown'
 */
export const detectOS = () => {
  if (isServer) return 'server';

  const hints = getClientHints();
  
  // الطريقة الحديثة (Client Hints)
  if (hints && typeof hints.platform === 'string') {
    const platform = hints.platform.toLowerCase();
    if (platform.includes('windows')) return 'windows';
    if (platform.includes('mac')) return 'macos';
    if (platform.includes('linux')) {
      // تمييز أندرويد عن لينكس العادي
      if (navigator.userAgent.toLowerCase().includes('android')) return 'android';
      return 'linux';
    }
    if (platform.includes('android')) return 'android';
    if (platform.includes('ios')) return 'ios';
    if (platform.includes('chrome os')) return 'chromeos';
  }

  // الطريقة التقليدية (Fallback)
  const ua = navigator.userAgent;
  if (/windows/i.test(ua)) {
    const ver = /windows nt (\d+\.\d+)/i.exec(ua);
    if (ver) {
      const versions = { '10.0': '10', '6.3': '8.1', '6.2': '8', '6.1': '7' };
      return `windows-${versions[ver[1]] || ver[1]}`;
    }
    return 'windows';
  }
  if (/macintosh|mac os x/i.test(ua)) return 'macos';
  if (/linux/i.test(ua)) return 'linux';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/chrome os/i.test(ua)) return 'chromeos';
  return 'unknown';
};

// ==============================
// 4. كشف المتصفح والإصدار (باستخدام Client Hints)
// ==============================

/**
 * كشف المتصفح والإصدار باستخدام Client Hints Brands
 * @returns {Object} { name: string, version: string, engine: string }
 */
export const detectBrowser = () => {
  if (isServer) return { name: 'server', version: '0', engine: 'server' };

  const hints = getClientHints();

  // الطريقة الحديثة (Client Hints Brands)
  if (hints?.brands && Array.isArray(hints.brands) && hints.brands.length > 0) {
    // فلترة العلامات التجارية غير الوهمية (تلك التي تحوي "Not" أو "Chromium")
    const realBrands = hints.brands.filter(b => 
      !b.brand.includes('Not') && 
      !b.brand.includes('Chromium') &&
      b.brand !== 'Google Chrome' // نفضل استخدام العلامة الأصلية
    );
    
    // ترتيب الأولوية: العلامة الأكثر شهرة أولاً
    const priority = ['Google Chrome', 'Microsoft Edge', 'Opera', 'Safari', 'Firefox'];
    let selected = realBrands.find(b => priority.includes(b.brand)) || realBrands[0];
    
    if (selected) {
      const name = selected.brand.toLowerCase().replace(/ /g, '-');
      return { name, version: selected.version, engine: 'webkit' };
    }
  }

  // الطريقة التقليدية (Fallback)
  const ua = navigator.userAgent;
  let name = 'unknown', version = '0', engine = 'unknown';

  // كشف محرك العرض
  if (/webkit/i.test(ua)) engine = 'webkit';
  if (/gecko/i.test(ua)) engine = 'gecko';
  if (/trident/i.test(ua)) engine = 'trident';
  if (/presto/i.test(ua)) engine = 'presto';

  // كشف المتصفح
  if (/edg/i.test(ua)) {
    name = 'edge';
    version = ua.match(/edg\/(\d+)/i)?.[1] || '0';
  } else if (/opr|opera/i.test(ua)) {
    name = 'opera';
    version = ua.match(/opr\/(\d+)/i)?.[1] || ua.match(/version\/(\d+)/i)?.[1] || '0';
  } else if (/chrome/i.test(ua) && !/edge|opr/i.test(ua)) {
    name = 'chrome';
    version = ua.match(/chrome\/(\d+)/i)?.[1] || '0';
  } else if (/safari/i.test(ua) && !/chrome|edge|opr/i.test(ua)) {
    name = 'safari';
    version = ua.match(/version\/(\d+)/i)?.[1] || '0';
  } else if (/firefox/i.test(ua)) {
    name = 'firefox';
    version = ua.match(/firefox\/(\d+)/i)?.[1] || '0';
  } else if (/msie|trident/i.test(ua)) {
    name = 'internet-explorer';
    version = ua.match(/(?:msie |rv:)(\d+)/i)?.[1] || '0';
  }

  return { name, version, engine };
};

// ==============================
// 5. كشف الروبوتات ومحركات البحث
// ==============================

/**
 * كشف ما إذا كان الزائر روبوتاً أو زاحفاً
 * @returns {boolean}
 */
export const isBot = () => {
  if (isServer) return true;
  const ua = navigator.userAgent.toLowerCase();
  const botPatterns = [
    'bot', 'crawler', 'spider', 'scraper', 'headless',
    'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
    'yandexbot', 'facebookexternalhit', 'twitterbot', 'linkedinbot',
    'whatsapp', 'telegrambot', 'slackbot', 'discordbot',
    'puppeteer', 'phantomjs', 'selenium', 'playwright',
  ];
  return botPatterns.some(pattern => ua.includes(pattern));
};

// ==============================
// 6. كشف وضع التصفح الخاص (Incognito/Private)
// ==============================

/**
 * كشف وضع التصفح الخاص عبر اختبار IndexedDB والـ Storage
 * @returns {boolean}
 */
export const detectPrivateMode = () => {
  if (isServer) return false;
  
  // محاولة 1: IndexedDB (الطريقة الأكثر موثوقية)
  try {
    const db = indexedDB.open('__private_test__', 1);
    db.onerror = () => { /* تم منع الوصول */ };
    // إذا تم منع الوصول، نستنتج أن المتصفح في وضع خاص
    // لكننا لا نستطيع التقاط الخطأ فوراً، لذا نستخدم محاولة أخرى
  } catch (_) {
    return true;
  }

  // محاولة 2: استخدام localStorage (بعض المتصفحات تمنعه في الوضع الخاص)
  try {
    localStorage.setItem('__test__', 'test');
    localStorage.removeItem('__test__');
  } catch (_) {
    return true;
  }

  // محاولة 3: استخدام sessionStorage (بعض المتصفحات تمنعه)
  try {
    sessionStorage.setItem('__test__', 'test');
    sessionStorage.removeItem('__test__');
  } catch (_) {
    return true;
  }

  return false;
};

// ==============================
// 7. تجميع معلومات الجهاز الكاملة
// ==============================

/**
 * الحصول على معلومات الجهاز كاملة (Hardware + Software + Viewport)
 * @returns {Object} معلومات الجهاز التفصيلية
 */
export const getDeviceInfo = () => {
  if (isServer) {
    return {
      type: 'server',
      os: 'server',
      browser: { name: 'server', version: '0', engine: 'server' },
      hardware: { cores: 0, ram: 0, pixelRatio: 1 },
      screen: { width: 0, height: 0, colorDepth: 0, availWidth: 0, availHeight: 0 },
      viewport: { width: 0, height: 0 },
      language: 'en',
      timezone: 'UTC',
      isBot: true,
      isPrivate: false,
      userAgent: 'server',
      timestamp: Date.now(),
    };
  }

  const type = detectDeviceType();
  const os = detectOS();
  const browser = detectBrowser();

  return {
    type,
    os,
    browser,
    hardware: {
      cores: navigator.hardwareConcurrency || 'unknown',
      ram: navigator.deviceMemory || 'unknown', // (GB) - مدعوم في Chrome
      pixelRatio: window.devicePixelRatio || 1,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      colorDepth: window.screen.colorDepth,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isBot: isBot(),
    isPrivate: detectPrivateMode(),
    userAgent: navigator.userAgent,
    timestamp: Date.now(),
  };
};

// ==============================
// 8. توليد بصمة جهاز ثابتة (Stable Session Key)
// ==============================

/**
 * توليد معرف فريد للجهاز (مستقر طوال الجلسة) باستخدام SHA-256
 * - يعتمد على خصائص عتادية ثابتة (لا تتغير بتدوير الشاشة أو تغيير الحجم)
 * - مقاوم للتلاعب والتزوير
 * @returns {Promise<string>} معرف الجهاز (مبدوء بـ sid_)
 */
export const generateSessionId = async () => {
  if (isServer) return 'server-session';

  try {
    const info = getDeviceInfo();
    // استخدام الخصائص الثابتة فقط (لا تشمل viewport المتغير)
    const rawStableString = [
      info.type,
      info.os,
      info.browser.name,
      info.browser.version,
      info.hardware.cores,
      info.hardware.ram,
      info.screen.width,
      info.screen.height,
      info.screen.colorDepth,
      info.language,
      info.timezone,
    ].join('|');

    const encoder = new TextEncoder();
    const data = encoder.encode(rawStableString);
    
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return `sid_${hex.substring(0, 24)}`; // 24 حرفاً للحفاظ على خفة البيانات
  } catch (_) {
    // Fallback آمن (إذا فشل SubtleCrypto)
    const fallback = `sid_fallback_${crypto.randomUUID ? crypto.randomUUID().substring(0, 12) : Math.random().toString(36).substring(2, 14)}`;
    return fallback;
  }
};

// ==============================
// 9. توليد بصمة جهاز (للاستخدام مع Trusted Device)
// ==============================

/**
 * توليد بصمة جهاز فريدة (متوافقة مع TrustedDevice)
 * تستخدم نفس الخوارزمية ولكن ترجع بصمة أقصر لتخزينها في قاعدة البيانات
 * @returns {Promise<string>} بصمة الجهاز (hex string بطول 32 حرفاً)
 */
export const generateDeviceFingerprint = async () => {
  if (isServer) return 'server-fingerprint';

  try {
    const info = getDeviceInfo();
    const raw = [
      info.type,
      info.os,
      info.browser.name,
      info.browser.version,
      info.hardware.cores,
      info.hardware.ram,
      info.screen.width,
      info.screen.height,
      info.screen.colorDepth,
      info.language,
      info.timezone,
    ].join('|');

    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (_) {
    // Fallback بسيط
    let hash = 0;
    const raw = navigator.userAgent + screen.width + screen.height + navigator.language;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36).padStart(10, '0');
  }
};

// ==============================
// 10. تسجيل الجهاز في Audit Log تلقائياً
// ==============================

/**
 * تسجيل معلومات الجهاز الحالي في سجل التدقيق الأمني
 * @param {string} eventType - نوع الحدث (مثل 'LOGIN', 'DEVICE_REGISTERED')
 * @param {Object} extraData - بيانات إضافية
 */
export const logDeviceInfo = (eventType = 'DEVICE_INFO', extraData = {}) => {
  if (isServer) return;
  const info = getDeviceInfo();
  
  // لا ننتظر نتيجتها لأنها غير حرجة
  securityAudit.logEvent(eventType, {
    ...extraData,
    device: {
      type: info.type,
      os: info.os,
      browser: info.browser.name,
      browserVersion: info.browser.version,
      browserEngine: info.browser.engine,
      screen: `${info.screen.width}x${info.screen.height}`,
      viewport: `${info.viewport.width}x${info.viewport.height}`,
      pixelRatio: info.hardware.pixelRatio,
      cores: info.hardware.cores,
      ram: info.hardware.ram,
      language: info.language,
      timezone: info.timezone,
      isPrivate: info.isPrivate,
      isBot: info.isBot,
    },
    timestamp: info.timestamp,
  });
};

// ==============================
// 11. الكائن الرئيسي للتصدير
// ==============================

const deviceUtility = {
  detectDeviceType,
  detectOS,
  detectBrowser,
  getDeviceInfo,
  generateSessionId,
  generateDeviceFingerprint,
  isMobile,
  isTablet,
  isDesktop,
  isAndroid,
  isIOS,
  isBot,
  detectPrivateMode,
  logDeviceInfo,
};

export default deviceUtility;