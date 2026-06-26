// src/lib/supabase/supabase.js
/**
 * 🌌 THE SUPABASE QUANTUM-GUARD CLIENT (BEYOND 2050)
 * 🛡️ Security: Environment Shredding, Deep Proxy Membrane, Prototype Isolation
 * 💰 Cost: Self-Healing Circuit Breaker (Zero-Compute Waste during outages)
 * 🚀 Runtime: Fully Autonomous Omni-Runtime Engine
 */

import { createClient } from '@supabase/supabase-js';

// ==========================================
// 1. 🛡️ الجدار السيبراني الأول (Strict Sandbox)
// ==========================================
if (typeof window !== 'undefined' || typeof document !== 'undefined' || (typeof self !== 'undefined' && self.constructor?.name === 'Window')) {
  throw new Error('⚠️ CRITICAL: Quantum Guard blocked Service Role Key leak on Client-Side!');
}

// ==========================================
// 2. 🔌 قاطع الدائرة الذكي (Self-Healing Circuit Breaker State)
// ==========================================
const CIRCUIT_BREAKER = {
  failureCount: 0,
  threshold: 3,
  cooldownPeriod: 30000, // 30 ثانية فترة تبريد
  lastFailureTime: 0,
  isOpen() {
    if (this.failureCount >= this.threshold) {
      const now = Date.now();
      if (now - this.lastFailureTime < this.cooldownPeriod) return true;
      this.failureCount = 0; // إعادة التعيين تلقائياً بعد انتهاء فترة التبريد
    }
    return false;
  },
  recordSuccess() { this.failureCount = 0; },
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
  }
};

// ==========================================
// 3. 🌐 قراءة وتطهير الذاكرة فوراً (Env Shredder)
// ==========================================
const resolveAndShredEnv = () => {
  const getEnv = (k) => {
    if (typeof process !== 'undefined' && process.env?.[k]) return process.env[k];
    if (typeof Bun !== 'undefined' && Bun.env?.[k]) return Bun.env[k];
    if (typeof Deno !== 'undefined' && Deno.env?.get(k)) return Deno.env.get(k);
    if (typeof globalThis !== 'undefined' && globalThis[k]) return globalThis[k];
    return null;
  };

  const url = getEnv('SUPABASE_URL');
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) throw new Error('❌ CRITICAL CONFIG: Secure keys missing.');

  // 🔥 عملية التطهير العميقة: تدمير المفتاح السري من الذاكرة العامة فوراً لمنع سرقته لاحقاً
  if (typeof process !== 'undefined' && process.env) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = '[REDACTED_BY_QUANTUM_GUARD]';
  }
  if (typeof Bun !== 'undefined' && Bun.env) {
    Bun.env.SUPABASE_SERVICE_ROLE_KEY = '[REDACTED]';
  }

  return { url, key };
};

const { url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY } = resolveAndShredEnv();

// ==========================================
// 4. 🧠 إدارة الذاكرة الصفرية وعزل النطاق
// ==========================================
const ADMIN_CLIENT_KEY = Symbol.for('app.core.supabase.quantum.v3');

if (!globalThis[ADMIN_CLIENT_KEY]) {
  const baseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    db: { schema: 'public' },
    global: {
      fetch: async (url, options) => {
        // 🛑 إذا كان قاطع الدائرة مفتوحاً، ارفض الطلب فوراً (تكلفة صفرية للحوسبة والشبكة)
        if (CIRCUIT_BREAKER.isOpen()) {
          throw new Error('🛡️ CIRCUIT BREAKER: Database is temporarily isolated to save execution costs.');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 ثوانٍ رشيقة جداً

        try {
          const response = await fetch(url, { ...options, signal: controller.signal });
          CIRCUIT_BREAKER.recordSuccess();
          return response;
        } catch (error) {
          CIRCUIT_BREAKER.recordFailure();
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
    },
  });

  Object.defineProperty(globalThis, ADMIN_CLIENT_KEY, {
    value: baseClient,
    writable: false,
    configurable: false,
    enumerable: false,
  });
}

// ==========================================
// 5. 🧬 الغشاء الديناميكي المعزول (Immune Proxy Membrane)
// ==========================================
const createSecureMembrane = (target) => {
  // استخدام كائن معزول تماماً لتخزين الكاش الداخلي لمنع Prototype Pollution
  const shadowCache = Object.create(null);

  return new Proxy(target, {
    get(obj, prop) {
      if (prop === '__proto__' || prop === 'prototype') return null; // حجب كامل لسلسلة الوراثة
      
      const value = Reflect.get(obj, prop);
      if (typeof value === 'object' && value !== null) {
        if (!shadowCache[prop]) {
          shadowCache[prop] = createSecureMembrane(value);
        }
        return shadowCache[prop];
      }
      return typeof value === 'function' ? value.bind(obj) : value;
    },
    set() { throw new Error('🛡️ IMMUTABLE SYSTEM: Tampering blocked.'); },
    defineProperty() { throw new Error('🛡️ IMMUTABLE SYSTEM: Blocked.'); },
    deleteProperty() { throw new Error('🛡️ IMMUTABLE SYSTEM: Blocked.'); }
  });
};

export const supabaseAdmin = createSecureMembrane(globalThis[ADMIN_CLIENT_KEY]);
export const getAdminClient = () => supabaseAdmin;

// ==========================================
// 6. ⚡ الفحص الهيكلي الذكي الفائق (Zero-Table Overhead)
// ==========================================
export const verifyAdminConnection = async () => {
  try {
    const { error } = await supabaseAdmin.from('_heartbeat_').select('id').limit(1);
    // كود 42P01 يعني أن الـ Token سليم تماماً والشبكة متصلة، لكن الجدول غير موجود
    return error ? error.code === '42P01' : true;
  } catch {
    return false;
  }
};

export default supabaseAdmin;