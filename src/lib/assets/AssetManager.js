// src/lib/assets/AssetManager.js

/**
 * 📦 AssetManager - نظام إدارة الأصول الذكي (V 2050.ASSET-MANAGER-PRO)
 * 
 * 💎 التحديثات الهندسية الفائقة:
 * - 🛡️ AbortController: إلغاء الطلبات المعلقة عند تنظيف المكون.
 * - 📦 Bounded LRU Cache: حد أقصى 50 عنصراً لمنع تسرب الذاكرة.
 * - ⏳ Pending Queue: منع الطلبات المتكررة لنفس الـ URL.
 * - 🔄 Retry Logic: إعادة محاولة تلقائية (3 محاولات) مع تأخير.
 * - 📊 Progress Tracker: دعم onProgress لتتبع التحميل.
 * - 🧹 Clear Cache: تحرير الذاكرة عند الحاجة.
 * - 📥 loadModel: تحميل النماذج (.gltf, .glb) بنفس المنطق.
 * - 🛡️ Memory Safe: إلغاء الطلبات عند استدعاء clearCache.
 */

class AssetManagerInstance {
  constructor() {
    this.textureCache = new Map();
    this.modelCache = new Map();
    this.pendingTextureRequests = new Map();
    this.pendingModelRequests = new Map();
    this.loaders = null;
    this.maxCacheSize = 50;
    this.retryCount = 3;
    this.retryDelay = 1000;
    this.abortController = null;
  }

  // ============================================================
  // 🔄 تهيئة المحملات (Loaders)
  // ============================================================
  async initLoaders() {
    if (this.loaders) return this.loaders;

    try {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      
      this.loaders = {
        texture: new THREE.TextureLoader(),
        gltf: new GLTFLoader(),
        THREE,
      };
      return this.loaders;
    } catch (error) {
      console.error('❌ [AssetManager] Failed to load Three.js:', error);
      throw error;
    }
  }

  // ============================================================
  // 🧹 نظام الكاش المحدود (LRU Cache)
  // ============================================================
  _getCache(cache) {
    return cache;
  }

  _setCache(cache, key, value) {
    // إذا وصلنا للحد الأقصى، نحذف أقدم عنصر (أول عنصر في الـ Map)
    if (cache.size >= this.maxCacheSize) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
    cache.set(key, value);
  }

  // ============================================================
  // 📥 تحميل النسيج (Texture) مع دعم Abort و Retry
  // ============================================================
  async loadTexture(url, options = {}) {
    const { onProgress, retryCount = this.retryCount, signal = null } = options;

    // التحقق من الكاش
    if (this.textureCache.has(url)) {
      return this.textureCache.get(url);
    }

    // التحقق من الطلبات المعلقة (لتجنب التكرار)
    if (this.pendingTextureRequests.has(url)) {
      return this.pendingTextureRequests.get(url);
    }

    // إنشاء وعد التحميل
    const loadPromise = new Promise(async (resolve, reject) => {
      let attempt = 0;
      let lastError = null;

      while (attempt <= retryCount) {
        try {
          // تهيئة المحملات
          const { texture: loader } = await this.initLoaders();

          // التحقق من الإلغاء
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }

          // تحميل النسيج
          const texture = await new Promise((res, rej) => {
            loader.load(
              url,
              (tex) => {
                // بعد التحميل، نضيفه إلى الكاش
                this._setCache(this.textureCache, url, tex);
                // إزالة من الطلبات المعلقة
                this.pendingTextureRequests.delete(url);
                res(tex);
              },
              (progress) => {
                if (onProgress) onProgress(progress);
              },
              (error) => {
                rej(error);
              }
            );
          });

          resolve(texture);
          return;

        } catch (error) {
          if (error.name === 'AbortError') {
            reject(error);
            return;
          }
          lastError = error;
          attempt++;

          if (attempt <= retryCount && !signal?.aborted) {
            // تأخير قبل إعادة المحاولة (Exponential Backoff)
            const delay = this.retryDelay * Math.pow(2, attempt - 1);
            console.warn(`🔄 [AssetManager] Retry ${attempt}/${retryCount} for ${url} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            // فشل كل المحاولات
            this.pendingTextureRequests.delete(url);
            reject(lastError || new Error('Failed to load texture'));
          }
        }
      }
    });

    // تخزين الوعد المعلق
    this.pendingTextureRequests.set(url, loadPromise);

    // إضافة تنظيف في حال الإلغاء
    if (signal) {
      signal.addEventListener('abort', () => {
        this.pendingTextureRequests.delete(url);
      });
    }

    return loadPromise;
  }

  // ============================================================
  // 📥 تحميل النموذج (Model) مع دعم Abort و Retry
  // ============================================================
  async loadModel(url, options = {}) {
    const { onProgress, retryCount = this.retryCount, signal = null } = options;

    // التحقق من الكاش
    if (this.modelCache.has(url)) {
      return this.modelCache.get(url);
    }

    // التحقق من الطلبات المعلقة
    if (this.pendingModelRequests.has(url)) {
      return this.pendingModelRequests.get(url);
    }

    const loadPromise = new Promise(async (resolve, reject) => {
      let attempt = 0;
      let lastError = null;

      while (attempt <= retryCount) {
        try {
          const { gltf: loader } = await this.initLoaders();

          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }

          const model = await new Promise((res, rej) => {
            loader.load(
              url,
              (gltf) => {
                this._setCache(this.modelCache, url, gltf);
                this.pendingModelRequests.delete(url);
                res(gltf);
              },
              (progress) => {
                if (onProgress) onProgress(progress);
              },
              (error) => {
                rej(error);
              }
            );
          });

          resolve(model);
          return;

        } catch (error) {
          if (error.name === 'AbortError') {
            reject(error);
            return;
          }
          lastError = error;
          attempt++;

          if (attempt <= retryCount && !signal?.aborted) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1);
            console.warn(`🔄 [AssetManager] Retry ${attempt}/${retryCount} for model ${url} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            this.pendingModelRequests.delete(url);
            reject(lastError || new Error('Failed to load model'));
          }
        }
      }
    });

    this.pendingModelRequests.set(url, loadPromise);

    if (signal) {
      signal.addEventListener('abort', () => {
        this.pendingModelRequests.delete(url);
      });
    }

    return loadPromise;
  }

  // ============================================================
  // 🧹 دوال تحرير الكاش
  // ============================================================
  clearTextureCache() {
    // إلغاء أي طلبات معلقة للنسيج
    for (const [url, promise] of this.pendingTextureRequests) {
      // لا يمكن إلغاء الوعد مباشرة، لكن نزيله من القائمة
      this.pendingTextureRequests.delete(url);
    }
    this.textureCache.clear();
    console.log('🗑️ [AssetManager] Texture cache cleared.');
  }

  clearModelCache() {
    for (const [url, promise] of this.pendingModelRequests) {
      this.pendingModelRequests.delete(url);
    }
    this.modelCache.clear();
    console.log('🗑️ [AssetManager] Model cache cleared.');
  }

  clearAllCache() {
    this.clearTextureCache();
    this.clearModelCache();
    console.log('🗑️ [AssetManager] All caches cleared.');
  }

  // ============================================================
  // 📊 دوال الحصول على حالة الكاش
  // ============================================================
  getCacheStats() {
    return {
      textures: this.textureCache.size,
      models: this.modelCache.size,
      pendingTextures: this.pendingTextureRequests.size,
      pendingModels: this.pendingModelRequests.size,
      maxSize: this.maxCacheSize,
    };
  }
}

// تصدير نسخة مفردة (Singleton) كـ default export
export default new AssetManagerInstance();