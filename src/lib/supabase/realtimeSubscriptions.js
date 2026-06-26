// src/lib/supabase/realtimeSubscriptions.js
/**
 * 🔄 Realtime Subscriptions Engine (V 2050.MAX - Auto-Healing & Zero-Leak)
 * 
 * 🎯 الوظيفة: تحديث واجهة المستخدم فورياً مع أعلى درجات الخصوصية.
 * 🛡️ المميزات:
 * - Auto-Reconnect: إعادة اشتراك تلقائي عند عودة الإنترنت.
 * - Private Channels: كل مستخدم يرى بياناته هو فقط (حتى الأمنية).
 * - Smart Throttle: يمنع التهنيج بدون فقدان أي رسالة فريدة.
 * - Zero Cost: تصفية البيانات من الخادم (Filter) يقلل استهلاك الـ Bandwidth.
 */

import { supabase } from './supabaseClient';

const subscriptions = new Map();
const isBrowser = typeof window !== 'undefined' && window.document;

// ------------------- نظام Throttle الذكي -------------------
const notificationTimestamps = new Map();

const showThrottledToast = (showToastCallback, type, message, uniqueId, delay = 3000) => {
  if (!message) return;
  // المفتاح هنا هو uniqueId (مثلاً: notification_123) وليس نص الرسالة
  // هذا يضمن أن الرسائل المتطابقة ولكن بأحداث مختلفة تظهر
  const now = Date.now();
  const lastTime = notificationTimestamps.get(uniqueId) || 0;
  
  if (now - lastTime > delay) {
    showToastCallback(type, message);
    notificationTimestamps.set(uniqueId, now);
  }
};

// ------------------- نظام إعادة الاتصال التلقائي -------------------
let isReconnecting = false;
let reconnectTimeout = null;

const reconnectAllSubscriptions = () => {
  if (isReconnecting) return;
  isReconnecting = true;
  console.warn('🔄 [Realtime] محاولة إعادة الاشتراك بعد انقطاع الشبكة...');
  
  // تنظيف الاشتراكات القديمة أولاً
  subscriptions.forEach((channel, name) => {
    supabase.removeChannel(channel);
  });
  subscriptions.clear();

  // إعادة تشغيل الاشتراكات (يجب تخزين الـ Config مسبقاً)
  // نستدعي دالة إعادة التهيئة (سننشئها لاحقاً)
  if (window.__REALTIME_CONFIG) {
    startLiveUIUpdates(
      window.__REALTIME_CONFIG.showToast,
      window.__REALTIME_CONFIG.userId,
      window.__REALTIME_CONFIG.userRole
    );
  }
  
  setTimeout(() => { isReconnecting = false; }, 2000);
};

// استماع لحالة الشبكة (مع إعادة المحاولة التلقائية)
if (isBrowser) {
  window.addEventListener('online', () => {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(reconnectAllSubscriptions, 3000);
  });
}

// ------------------- إنشاء اشتراك آمن -------------------
export const createSubscription = (channelName, table, eventType, callback, filter = null) => {
  if (!isBrowser) return false;
  if (subscriptions.has(channelName)) {
    console.warn(`⚠️ [Realtime] القناة "${channelName}" مشتركة بالفعل.`);
    return false;
  }

  const changeFilter = { 
    event: eventType, 
    schema: 'public', 
    table: table,
    ...(filter && { filter }) 
  };

  let channel = supabase
    .channel(channelName)
    .on('postgres_changes', changeFilter, (payload) => {
      try {
        callback(payload);
      } catch (err) {
        console.error(`❌ [Realtime] خطأ في معالجة "${channelName}":`, err);
      }
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log(`✅ [Realtime] تم الاشتراك: ${channelName} (Filter: ${filter || 'All'})`);
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`❌ [Realtime] فشل الاشتراك في ${channelName}:`, err);
        // محاولة إعادة الاشتراك بعد 5 ثواني
        setTimeout(() => {
          if (subscriptions.has(channelName)) {
            supabase.removeChannel(subscriptions.get(channelName));
            subscriptions.delete(channelName);
            createSubscription(channelName, table, eventType, callback, filter);
          }
        }, 5000);
      }
    });

  subscriptions.set(channelName, channel);
  return true;
};

// ------------------- إلغاء الاشتراكات -------------------
export const unsubscribe = (channelName) => {
  if (subscriptions.has(channelName)) {
    supabase.removeChannel(subscriptions.get(channelName));
    subscriptions.delete(channelName);
    console.log(`🗑️ [Realtime] تم إلغاء: ${channelName}`);
  }
};

export const unsubscribeAll = () => {
  subscriptions.forEach((channel) => supabase.removeChannel(channel));
  subscriptions.clear();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  console.log('🧹 [Realtime] تم تنظيف جميع الاشتراكات.');
};

// ------------------- التشغيل الرئيسي (مع عزل الأدوار) -------------------
export const startLiveUIUpdates = (showToastCallback, userId = null, userRole = null) => {
  if (!isBrowser) return;
  
  // حفظ التكوين لإعادة الاتصال التلقائي
  window.__REALTIME_CONFIG = { showToast: showToastCallback, userId, userRole };

  // 1️⃣ 🔒 استماع للتهديدات الأمنية (خاص بالمشرفين فقط - عزل تام)
  //    الشرط: فقط لو المستخدم مشرف، وإلا نمنع الاشتراك من الأساس (Zero Data Leak)
  if (userRole === 'supervisor' && userId) {
    createSubscription(
      `ui-security-${userId}`,
      'auth_audit_logs',
      'INSERT',
      (payload) => {
        const status = payload.new?.status;
        if (['FAILED_BRUTE_FORCE', 'DEVTOOLS_DETECTED'].includes(status)) {
          // استخدام معرف فريد للـ Throttle
          showThrottledToast(
            showToastCallback, 
            'error', 
            '🚨 تم رصد تهديد أمني جديد!', 
            `security_${payload.new?.id || Date.now()}`
          );
        }
      },
      `user_id=eq.${userId}` // 🔥 الأهم: يرى فقط أحداثه الأمنية، وليس أحداث الآخرين
    );
  }

  // 2️⃣ 💬 استماع للإشعارات الشخصية (الكل يشترك فيها)
  if (userId) {
    createSubscription(
      `ui-notifications-${userId}`,
      'notifications',
      'INSERT',
      (payload) => {
        const msg = payload.new?.message || 'لديك إشعار جديد';
        showThrottledToast(
          showToastCallback, 
          'success', 
          `💬 ${msg}`, 
          `notif_${payload.new?.id || Date.now()}`
        );
      },
      `user_id=eq.${userId}` // يرى إشعاراته هو فقط
    );
  }

  // 3️⃣ 👨‍🏫 استماع لطلبات المعلم (خاص بالمعلمين)
  if (userRole === 'teacher' && userId) {
    createSubscription(
      `ui-teacher-requests-${userId}`,
      'approval_requests',
      'INSERT',
      (payload) => {
        showThrottledToast(
          showToastCallback,
          'info',
          '📝 طلب موافقة جديد ينتظر ردك',
          `req_${payload.new?.id || Date.now()}`
        );
      },
      `assigned_to=eq.${userId}` // يرى الطلبات الموجهة له فقط
    );
  }

  console.log(`🔄 [Realtime] تم تفعيل الاشتراكات للمستخدم: ${userId} (دور: ${userRole || 'غير محدد'})`);
};

// ------------------- تصدير الواجهة النهائية -------------------
export default {
  startLiveUIUpdates,
  unsubscribe,
  unsubscribeAll,
  createSubscription,
  reconnectAllSubscriptions, // للاستخدام اليدوي
};