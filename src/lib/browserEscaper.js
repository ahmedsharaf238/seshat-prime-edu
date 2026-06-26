// src/lib/browserEscaper.js

/**
 * 🛰️ نظام الهروب العالمي الموحد لـ Seshat Prime (Universal In-App Browser Escaper)
 * يفحص ويجبر جميع متصفحات التطبيقات الداخلية (WhatsApp, FB, Insta, Telegram, TikTok, Snapchat)
 * على الخروج فوراً لمتصفح الجهاز الرسمي لضمان تشغيل الـ 3D والصوت بكفاءة 100%.
 */
export const checkAndEscapeBrowser = () => {
  if (typeof window === 'undefined') return false;

  const ua = navigator.userAgent || navigator.vendor || window.opera;
  const currentUrl = window.location.href;

  // 1. رادار فحص شامل لجميع التطبيقات الاجتماعية الشهيرة في مصر
  const isInAppBrowser = 
    /FBAN|FBAV/i.test(ua) ||          // فيسبوك العادي
    /Messenger/i.test(ua) ||         // فيسبوك ماسنجر
    /Instagram/i.test(ua) ||         // إنستغرام
    /WhatsApp/i.test(ua) ||          // واتساب
    /Telegram/i.test(ua) ||          // تليجرام
    /TikTok/i.test(ua) ||            // تيك توك
    /Snapchat/i.test(ua) ||          // سناب شات
    /WebView|wv|Android.*Version\/[0-9.]+/i.test(ua); // أي متصفح داخلي مجهول

  if (!isInAppBrowser) return false;

  // 2. بروتوكول الهروب المخصص للأندرويد (فتح المتصفح الافتراضي للنظام)
  if (/Android/i.test(ua)) {
    const cleanUrl = currentUrl.replace(/^https?:\/\//, "");
    
    // ملاحظة هندسية: إذا حذفنا package=com.android.chrome، السيستم هيفتح المتصفح الافتراضي (Chrome أو Edge أو Mi Browser)
    // لكن بعض المتصفحات الداخلية العنيفة (مثل فيسبوك) قد تتجاهله، لذلك هجرتها بـ Intent مرن:
    window.location.href = `intent://${cleanUrl}#Intent;scheme=https;action=android.intent.action.VIEW;end`;
    
    // للاحتياط التام: إذا لم يستجب الـ Intent المرن خلال جزء من الثانية، نوجهه لكروم مباشرة لضمان تشغيل الـ WebGL
    setTimeout(() => {
      window.location.href = `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;end`;
    }, 100);
  } 
  
  // 3. بروتوكول الهروب المخصص للآيفون (iOS)
  else if (/iPhone|iPad|iPod/i.test(ua)) {
    // محاولة الهروب البرمجي المباشر لمتصفح Safari عبر بروتوكول البحث المخصص
    window.location.href = `x-web-search://?${currentUrl}`;
  }

  return true; // تأكيد أن المستخدم داخل متصفح داخلي وجاري محاولة الهروب
};