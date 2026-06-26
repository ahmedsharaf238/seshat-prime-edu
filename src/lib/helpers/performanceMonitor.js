/**
 * 🚀 Zero-Overhead Performance & Memory Profiler
 * آمن تماماً لبيئة Node.js (SSR) ويوفر قياسات دقيقة بدون تسريب للذاكرة.
 */
const isBrowser = typeof window !== 'undefined' && !!window.performance;
const globalStore = typeof globalThis !== 'undefined' ? globalThis : window;

// استخدام Map للسرعة ومنع تسريب الذاكرة (Memory Leak)
if (!globalStore._perfTrackers) {
  globalStore._perfTrackers = new Map();
}

export const measurePerformance = async (label, fn) => {
  const start = performance.now();
  const startMemory = isBrowser && performance.memory ? performance.memory.usedJSHeapSize : 0;
  
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    const endMemory = isBrowser && performance.memory ? performance.memory.usedJSHeapSize : 0;
    const memoryDiff = startMemory && endMemory ? ((endMemory - startMemory) / 1048576).toFixed(2) : 0; 
    
    if (duration > 500 || memoryDiff > 5) {
      console.warn(`⏱️ [Performance] "${label}": ${duration.toFixed(2)}ms, Memory: ${memoryDiff > 0 ? '+' + memoryDiff + ' MB' : 'N/A'}`);
      if (duration > 2000 && !isBrowser) {
        console.error(`🚨 CRITICAL LAG in ${label} (${duration.toFixed(2)}ms)`);
      }
    }
  }
};

export const performanceMonitor = {
  start: (label) => {
    globalStore._perfTrackers.set(label, performance.now());
  },
  end: (label) => {
    if (globalStore._perfTrackers.has(label)) {
      const start = globalStore._perfTrackers.get(label);
      const duration = performance.now() - start;
      if (duration > 500) {
        console.warn(`⏱️ [Performance] "${label}" took ${duration.toFixed(2)}ms`);
      }
      // تنظيف الذاكرة فوراً للحفاظ على الأداء
      globalStore._perfTrackers.delete(label);
    }
  }
};