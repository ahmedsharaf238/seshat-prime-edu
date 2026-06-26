// src/lib/security/trustedDevice.js
// ============================================================
// 💻 CRYPTOGRAPHIC TRUSTED DEVICE ENGINE v3.0 (ULTIMATE)
// ============================================================

/**
 * 🔐 التحسينات الجديدة:
 * 1. دعم Nonce + Timestamp لمنع Replay Attacks.
 * 2. إضافة verifySignature للتحقق المزدوج (Client + Server).
 * 3. فصل منطق Supabase لجعل الخدمة قابلة لإعادة الاستخدام.
 * 4. تحسين معالجة الأخطاء مع رموز حالة محددة.
 */

// ------------------- دوال التحويل (كما هي) -------------------
const uint8ArrayToBase64Url = (arr) => {
  const base64 = btoa(String.fromCharCode(...arr));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlToUint8Array = (base64Url) => {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const decoded = atob(base64 + padding);
  const arr = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) arr[i] = decoded.charCodeAt(i);
  return arr;
};

// ------------------- IndexedDB (محسّن) -------------------
const DB_NAME = 'SeshatSecurity';
const KEY_STORE = 'DeviceKeys';

const getDB = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 3); // إصدار 3
  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(KEY_STORE)) {
      // تخزين userId + publicKey (لتجنب استدعاء السيرفر في كل مرة)
      db.createObjectStore(KEY_STORE, { keyPath: 'userId' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('IndexedDB blocked'));
});

// تخزين واسترجاع المفتاح الخاص والعام محلياً
const storeLocalKeys = async (userId, privateKey, publicKey) => {
  const db = await getDB();
  const tx = db.transaction(KEY_STORE, 'readwrite');
  tx.objectStore(KEY_STORE).put({ userId, privateKey, publicKey });
  await new Promise((resolve) => { tx.oncomplete = resolve; });
};

const getLocalKeys = async (userId) => {
  const db = await getDB();
  const tx = db.transaction(KEY_STORE, 'readonly');
  const request = tx.objectStore(KEY_STORE).get(userId);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(new Error('Failed to retrieve keys'));
  });
};

const deleteLocalKeys = async (userId) => {
  const db = await getDB();
  const tx = db.transaction(KEY_STORE, 'readwrite');
  tx.objectStore(KEY_STORE).delete(userId);
  await new Promise((resolve) => { tx.oncomplete = resolve; });
};

// ------------------- الخدمة الأساسية (معزولة عن Supabase) -------------------
export const createTrustedDeviceService = (supabaseClient) => {
  
  const service = {
    
    /**
     * 1. التحقق من دعم WebAuthn
     */
    isSupported: () => {
      return typeof window !== 'undefined' && !!window.PublicKeyCredential;
    },

    /**
     * 2. تسجيل جهاز جديد
     */
    async registerDevice({ userId, deviceFingerprint, userAgent, ipAddress, onSavePublicKey }) {
      if (!this.isSupported()) throw new Error('WebAuthn not supported.');
      if (!userId) throw new Error('User ID required');

      // التحقق من السيرفر عبر الـ Callback
      const existing = await onSavePublicKey({ userId, deviceFingerprint, action: 'check' });
      if (existing) {
        // نعيد المفتاح العام المخزن محلياً أيضاً (لتجنب الاتصال بالسيرفر)
        return { publicKey: existing.publicKey, alreadyRegistered: true };
      }

      // توليد المفاتيح
      const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"]
      );

      // استخراج المفاتيح
      const exportedPublic = await crypto.subtle.exportKey("spki", keyPair.publicKey);
      const publicBase64 = uint8ArrayToBase64Url(new Uint8Array(exportedPublic));

      // حفظ المفتاح الخاص + العام محلياً
      await storeLocalKeys(userId, keyPair.privateKey, publicBase64);

      // حفظ المفتاح العام في السيرفر عبر الـ Callback
      const saved = await onSavePublicKey({
        userId,
        deviceFingerprint,
        publicKey: publicBase64,
        userAgent,
        ipAddress,
        action: 'save'
      });

      if (!saved) {
        await deleteLocalKeys(userId);
        throw new Error('Failed to save public key on server.');
      }

      return { publicKey: publicBase64, alreadyRegistered: false };
    },

    /**
     * 3. إثبات ملكية الجهاز (مع التحقق من Nonce)
     */
    async proveDeviceTrust({ userId, serverChallenge, timestamp, nonce }) {
      if (!this.isSupported()) throw new Error('WebAuthn not supported.');
      
      // 1. التحقق من صلاحية التحدي (يجب أن يكون خلال 5 دقائق)
      const now = Date.now();
      if (now - timestamp > 5 * 60 * 1000) {
        throw new Error('CHALLENGE_EXPIRED');
      }

      // 2. استرجاع المفتاح الخاص محلياً
      const localKeys = await getLocalKeys(userId);
      if (!localKeys || !localKeys.privateKey) {
        throw new Error('DEVICE_NOT_TRUSTED');
      }

      // 3. إنشاء التحدي الكامل (Challenge + Nonce + Timestamp) لمنع إعادة الاستخدام
      const encoder = new TextEncoder();
      const challengeData = encoder.encode(serverChallenge + '|' + nonce + '|' + timestamp);

      // 4. التوقيع
      const signatureBuffer = await crypto.subtle.sign(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        localKeys.privateKey,
        challengeData
      );

      return uint8ArrayToBase64Url(new Uint8Array(signatureBuffer));
    },

    /**
     * 4. التحقق من التوقيع محلياً (بدون الاتصال بالسيرفر)
     * 🆕 ميزة جديدة: تتيح للعميل التأكد من صحة التوقيع قبل إرساله
     */
    async verifySignatureLocally({ userId, challenge, signature, nonce, timestamp }) {
      const localKeys = await getLocalKeys(userId);
      if (!localKeys || !localKeys.publicKey) {
        throw new Error('No public key stored locally.');
      }

      // استيراد المفتاح العام
      const publicKeyBuffer = base64UrlToUint8Array(localKeys.publicKey);
      const publicKey = await crypto.subtle.importKey(
        "spki",
        publicKeyBuffer,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );

      // إعادة بناء التحدي الكامل
      const encoder = new TextEncoder();
      const challengeData = encoder.encode(challenge + '|' + nonce + '|' + timestamp);
      const signatureBuffer = base64UrlToUint8Array(signature);

      // التحقق
      const isValid = await crypto.subtle.verify(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        publicKey,
        signatureBuffer,
        challengeData
      );

      return isValid;
    },

    /**
     * 5. حذف الجهاز
     */
    async unregisterDevice({ userId, deviceFingerprint = null, onDelete }) {
      await deleteLocalKeys(userId);
      await onDelete({ userId, deviceFingerprint });
    },

    /**
     * 6. التحقق المحلي السريع
     */
    async isDeviceTrustedLocally(userId) {
      try { return !!(await getLocalKeys(userId)); } catch { return false; }
    },

    /**
     * 7. الحصول على المفتاح العام المخزن محلياً
     */
    async getLocalPublicKey(userId) {
      const keys = await getLocalKeys(userId);
      return keys?.publicKey || null;
    }
  };

  return service;
};

// ------------------- تكامل Supabase (الربط الفعلي) -------------------
import { supabase } from '../supabase/supabaseClient';

// إنشاء الخدمة مع تكامل Supabase
export const trustedDeviceService = createTrustedDeviceService(supabase);

// إضافة دوال الربط الخاصة بـ Supabase داخل الخدمة نفسها
trustedDeviceService.registerDeviceWithSupabase = async (userId, deviceFingerprint, userAgent, ipAddress) => {
  return trustedDeviceService.registerDevice({
    userId,
    deviceFingerprint,
    userAgent,
    ipAddress,
    onSavePublicKey: async ({ userId, deviceFingerprint, publicKey, userAgent, ipAddress, action }) => {
      if (action === 'check') {
        const { data } = await supabase
          .from('device_credentials')
          .select('public_key')
          .eq('user_id', userId)
          .eq('device_fingerprint', deviceFingerprint)
          .maybeSingle();
        return data || null;
      }
      
      if (action === 'save') {
        const { error } = await supabase
          .from('device_credentials')
          .insert([{
            user_id: userId,
            public_key: publicKey,
            device_fingerprint: deviceFingerprint,
            user_agent: userAgent,
            ip_address: ipAddress,
            last_used: new Date().toISOString(),
          }]);
        return !error;
      }
    }
  });
};

trustedDeviceService.proveDeviceTrustWithSupabase = async (userId, serverChallenge, timestamp, nonce) => {
  return trustedDeviceService.proveDeviceTrust({ userId, serverChallenge, timestamp, nonce });
};

trustedDeviceService.unregisterDeviceWithSupabase = async (userId, deviceFingerprint = null) => {
  return trustedDeviceService.unregisterDevice({
    userId,
    deviceFingerprint,
    onDelete: async ({ userId, deviceFingerprint }) => {
      let query = supabase.from('device_credentials').delete().eq('user_id', userId);
      if (deviceFingerprint) query = query.eq('device_fingerprint', deviceFingerprint);
      await query;
    }
  });
};

export default trustedDeviceService;