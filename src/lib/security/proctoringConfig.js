/**
 * ========================================================================
 * 📊  ملف التحكم بالامتحانات (Proctoring Configuration Engine) v3.0
 * ========================================================================
 *
 * 🎯  الهدف:
 *  - توفير إعدادات مرنة وقابلة للتخصيص لنظام المراقبة الذكي.
 *  - دمج نظام المخالفات مع فترة سماح (Grace Period) وإمكانية الإيقاف المؤقت.
 *  - التكامل الكامل مع نظام Audit Log.
 *  - دعم أدوار متعددة (طالب، معلم، مشرف) بصلاحيات مختلفة.
 *  - تصميم خفيف الوزن لا يستهلك موارد السيرفر.
 *
 * 🛡️  الميزات الأمنية:
 *  - تحديد عدد المخالفات المسموحة قبل إنهاء الامتحان.
 *  - فترة سماح تمنح الطالب فرصة للعودة إلى الامتحان دون احتساب مخالفة.
 *  - إيقاف الامتحان مؤقتاً عند مغادرة الصفحة واستئنافه تلقائياً عند العودة.
 *  - تسجيل كل المخالفات والأحداث في نظام Audit Log.
 *  - دعم كامل للغة العربية مع توجيه RTL.
 *
 * 🚀  جاهزية المستقبل (2050):
 *  - استخدام إعدادات ديناميكية قابلة للتعديل عبر قاعدة البيانات مستقبلاً.
 *  - دعم الذكاء الاصطناعي لتحليل سلوك الطالب (مكان للتوسع).
 *  - هيكل يسمح بإضافة أنواع جديدة من المخالفات بسهولة.
 *
 * ========================================================================
 */

import { securityAudit } from './auditLog';

// ============================================================
// 1.  الإعدادات الأساسية (Base Configuration)
// ============================================================

/**
 *  التكوين الأساسي لنظام المراقبة.
 *  يمكن تعديل هذه القيم حسب سياسة المنصة.
 */
export const proctoringConfig = {
  // ==================== إعدادات المخالفات ====================
  /**
   *  الحد الأقصى لعدد المخالفات المسموحة قبل إنهاء الامتحان.
   *  - القيمة 0 تعني إنهاء فوري عند أول مخالفة.
   *  - القيمة -1 تعني لا يوجد حد (غير موصى به).
   */
  maxViolations: 3,

  /**
   *  فترة السماح (بالمللي ثانية) للعودة إلى الامتحان قبل احتساب المخالفة.
   *  - توفر للطالب فرصة للعودة إلى الامتحان في حال الخروج العرضي.
   *  - القيمة الموصى بها: 3000 (3 ثوانٍ).
   */
  gracePeriodMs: 3000,

  /**
   *  الإجراء المتخذ عند حدوث مخالفة.
   *  - 'warn':  عرض تحذير فقط (بدون تسجيل مخالفة).
   *  - 'count':  تسجيل المخالفة وزيادة العداد.
   *  - 'pause':  إيقاف الامتحان مؤقتاً.
   *  - 'lock':   إنهاء الامتحان فوراً وقفل الصفحة.
   */
  violationAction: 'count',

  // ==================== إعدادات الشاشة الكاملة ====================
  /**
   *  هل يجب إجبار الطالب على وضع ملء الشاشة؟
   *  - true:  سيتم إجبار الطالب على الدخول في وضع ملء الشاشة،
   *           وسيتم تسجيل مخالفة عند الخروج منه.
   *  - false: لا يتم إجبار الطالب، ولكن يتم تنبيهه للدخول.
   */
  requireFullscreen: true,

  /**
   *  الإجراء المتخذ عند الخروج من وضع ملء الشاشة.
   *  - 'warn':     عرض تحذير فقط.
   *  - 'count':    تسجيل مخالفة.
   *  - 'pause':    إيقاف الامتحان مؤقتاً.
   *  - 'lock':     إنهاء الامتحان فوراً.
   */
  fullscreenExitAction: 'count',

  // ==================== إعدادات تغيير التبويب ====================
  /**
   *  الإجراء المتخذ عند تغيير التبويب (Tab Switch).
   *  - 'warn':  عرض تحذير فقط.
   *  - 'count': تسجيل مخالفة.
   *  - 'pause': إيقاف الامتحان مؤقتاً.
   *  - 'lock':  إنهاء الامتحان فوراً.
   */
  tabSwitchAction: 'pause',

  // ==================== إعدادات الفيديو ====================
  /**
   *  هل يجب إيقاف الفيديو عند مغادرة الصفحة؟
   *  - true:  سيتم إيقاف الفيديو فوراً عند مغادرة الصفحة.
   *  - false: سيستمر الفيديو في التشغيل (غير موصى به).
   */
  pauseVideoOnTabSwitch: true,

  /**
   *  هل يجب إيقاف الفيديو عند الخروج من وضع ملء الشاشة؟
   *  - true:  سيتم إيقاف الفيديو فوراً عند الخروج من ملء الشاشة.
   *  - false: سيستمر الفيديو في التشغيل.
   */
  pauseVideoOnFullscreenExit: true,

  // ==================== الرسائل ====================
  /**
   *  الرسائل التي تظهر للطالب في حالات مختلفة.
   *  يمكن تخصيصها حسب لغة المنصة.
   */
  messages: {
    tabSwitch: '⚠️  يرجى عدم مغادرة صفحة الامتحان. هذه المحاولة مسجلة.',
    fullscreenExit: '⛔  يرجى العودة إلى وضع ملء الشاشة لمواصلة الامتحان.',
    maxViolations: '🚫  تم تجاوز الحد الأقصى للمخالفات. تم إنهاء الامتحان.',
    pause: '⏸️  تم إيقاف الامتحان مؤقتاً. يرجى العودة إلى الصفحة.',
    resume: '▶️  تم استئناف الامتحان.',
    warning: '⚠️  تنبيه: يرجى الالتزام بتعليمات الامتحان.',
  },

  // ==================== إعدادات إضافية ====================
  /**
   *  مدة انتظار (بالمللي ثانية) قبل إغلاق الامتحان تلقائياً
   *  في حال عدم نشاط الطالب.
   *  - القيمة 0 تعني إلغاء هذه الميزة.
   */
  inactivityTimeoutMs: 0,

  /**
   *  تمكين مراقبة الوجه (Face Detection) - للمستقبل.
   *  - يتطلب تكامل مع مكتبات مثل TensorFlow.js أو Face-api.js.
   *  - قيمة افتراضية: false.
   */
  enableFaceDetection: false,

  /**
   *  تمكين مشاركة الشاشة (Screen Sharing) - للمستقبل.
   *  - يتطلب WebRTC.
   *  - قيمة افتراضية: false.
   */
  enableScreenShare: false,

  /**
   *  تمكين كشف أدوات المطورين - من خلال contentProtection.
   *  - قيمة افتراضية: true.
   */
  detectDevTools: true,
};

// ============================================================
// 2.  إعدادات الأدوار (Role-Based Configuration)
// ============================================================

/**
 *  دالة لتعديل الإعدادات حسب دور المستخدم.
 *  - الطالب:  تطبيق الإعدادات الكاملة للمراقبة.
 *  - المعلم:  إلغاء المراقبة (لأن المعلم يدير الامتحان).
 *  - المشرف:  مراقبة خفيفة (للإشراف العام).
 *  - الضيف:   لا توجد مراقبة.
 *
 *  @param {string} userRole - دور المستخدم (student, teacher, supervisor, admin).
 *  @returns {Object}  الإعدادات المعدلة حسب الدور.
 */
export const getProctoringOptions = (userRole = 'student') => {
  // نسخ عميقة للإعدادات الأساسية لتجنب التعديل على الكائن الأصلي.
  const config = JSON.parse(JSON.stringify(proctoringConfig));

  switch (userRole?.toLowerCase()) {
    case 'teacher':
    case 'instructor':
      // المعلم: لا توجد مراقبة، ولا إجبار على Fullscreen.
      config.maxViolations = 999; // عدد كبير جداً (عملياً لا حدود).
      config.requireFullscreen = false;
      config.tabSwitchAction = 'warn'; // فقط تحذير.
      config.fullscreenExitAction = 'warn';
      config.pauseVideoOnTabSwitch = false;
      config.pauseVideoOnFullscreenExit = false;
      config.detectDevTools = false;
      config.messages = {
        ...config.messages,
        tabSwitch: '⚠️  أنت معلم، يمكنك تغيير التبويبات بحرية.',
      };
      break;

    case 'supervisor':
    case 'admin':
      // المشرف: مراقبة خفيفة، بدون إجبار على Fullscreen.
      config.maxViolations = 10;
      config.requireFullscreen = false;
      config.tabSwitchAction = 'warn';
      config.fullscreenExitAction = 'warn';
      config.pauseVideoOnTabSwitch = false;
      config.pauseVideoOnFullscreenExit = false;
      config.detectDevTools = false;
      break;

    case 'guest':
      // الضيف: لا توجد مراقبة.
      config.maxViolations = -1;
      config.requireFullscreen = false;
      config.tabSwitchAction = 'warn';
      config.fullscreenExitAction = 'warn';
      config.pauseVideoOnTabSwitch = false;
      config.pauseVideoOnFullscreenExit = false;
      config.detectDevTools = false;
      break;

    case 'student':
    default:
      // الطالب: تطبيق الإعدادات الكاملة (لا تغيير).
      break;
  }

  return config;
};

// ============================================================
// 3.  إعدادات المخالفات (Violation Types)
// ============================================================

/**
 *  أنواع المخالفات المدعومة في النظام.
 *  يمكن إضافة أنواع جديدة مستقبلاً.
 */
export const VIOLATION_TYPES = {
  TAB_SWITCH: 'TAB_SWITCH',
  FULLSCREEN_EXIT: 'FULLSCREEN_EXIT',
  DEVTOOLS_OPENED: 'DEVTOOLS_OPENED',
  PRESS_PRINT_SCREEN: 'PRESS_PRINT_SCREEN',
  INACTIVITY: 'INACTIVITY',
  FACE_DETECTION_FAILED: 'FACE_DETECTION_FAILED',
  SCREEN_SHARE_DETECTED: 'SCREEN_SHARE_DETECTED',
};

/**
 *  الحالة الحالية للمخالفات (تُستخدم في نظام المراقبة).
 */
export const violationState = {
  count: 0,
  max: proctoringConfig.maxViolations,
  violations: [],
  isPaused: false,
  isTerminated: false,
  lastViolationTime: 0,
};

// ============================================================
// 4.  دوال مساعدة (Helper Functions)
// ============================================================

/**
 *  دالة لتسجيل مخالفة جديدة في Audit Log.
 *  @param {string} type - نوع المخالفة (من VIOLATION_TYPES).
 *  @param {Object} details - تفاصيل إضافية.
 */
export const logProctoringEvent = (type, details = {}) => {
  securityAudit.logEvent(`PROCTORING_${type}`, {
    timestamp: Date.now(),
    ...details,
  });
};

/**
 *  دالة لتحديث حالة المخالفات.
 *  @param {Object} newState - الحالة الجديدة.
 */
export const updateViolationState = (newState) => {
  Object.assign(violationState, newState);
};

/**
 *  دالة إعادة تعيين حالة المخالفات (لبدء امتحان جديد).
 */
export const resetViolationState = () => {
  violationState.count = 0;
  violationState.violations = [];
  violationState.isPaused = false;
  violationState.isTerminated = false;
  violationState.lastViolationTime = 0;
};

// ============================================================
// 5.  التصدير الافتراضي
// ============================================================

export default proctoringConfig;