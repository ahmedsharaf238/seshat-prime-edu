// src/lib/engine/MasterSceneEngine.js

/**
 * 🎬 MasterSceneEngine - المحرك السينمائي الأساسي (V 2050.MASTER-ENGINE-PRO)
 * 
 * 💎 التحديثات الهندسية الفائقة:
 * - 🛡️ AbortController: إلغاء المؤقتات والمستمعات عند التدمير.
 * - 🔄 True Render-on-Demand: إيقاف التصيير تماماً عند عدم الحركة.
 * - 📦 AssetManager Integration: تحميل النماذج والنسيج خارجياً.
 * - 🎛️ Customizable Options: تخصيص الألوان، الإضاءة، والمجسم.
 * - 🧹 Complete Cleanup: تحرير controls, renderer, observers.
 * - 🔧 Real Pause/Resume: إيقاف وإعادة تشغيل حلقة التصيير.
 * - 📊 onProgress: تتبع تحميل الأصول.
 * - 🎬 Cinematic Lighting: Key + Fill + Rim Lights.
 */

import { PerformanceMonitor } from './PerformanceMonitor';
import AssetManager from './AssetManager';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_OPTIONS = Object.freeze({
  backgroundColor: 0x0a0a0a,
  fogColor: 0x0a0a0a,
  fogDensity: 0.02,
  cameraPosition: [0, 2, 8],
  keyLightColor: 0xffb700,
  keyLightIntensity: 20,
  fillLightColor: 0x4488ff,
  fillLightIntensity: 0.5,
  rimLightColor: 0xff8800,
  rimLightIntensity: 0.3,
  autoRotate: true,
  autoRotateSpeed: 0.002,
  meshUrl: null, // URL لملف GLTF (اختياري)
  textureUrl: null, // URL للنسيج (اختياري)
  meshColor: 0xffaa00,
  metalness: 1.0,
  roughness: 0.15,
  enableShadows: true,
  toneMappingExposure: 1.2,
});

export class MasterSceneEngine {
  constructor(container, options = {}) {
    this.container = container;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.settings = PerformanceMonitor.getEngineSettings();
    this.needsUpdate = true;
    this.animationFrameId = null;
    this.isPaused = false;
    this.isDisposed = false;
    this.abortController = new AbortController();
    this.loadingProgress = 0;
    this.onProgressCallback = null;

    // تخزين مراجع للتنظيف
    this._animationFrameId = null;
    this._resizeObserver = null;
    this._controls = null;
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._mesh = null;

    // تهيئة المشهد
    this.initScene();
    this.loadAssets();
  }

  // ============================================================
  // 🎬 تهيئة المشهد
  // ============================================================
  initScene() {
    const { backgroundColor, fogColor, fogDensity, cameraPosition, enableShadows, toneMappingExposure } = this.options;

    // 1. المشهد
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(backgroundColor);
    this._scene.fog = new THREE.FogExp2(fogColor, fogDensity);

    // 2. الكاميرا
    this._camera = new THREE.PerspectiveCamera(
      45,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      100
    );
    this._camera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
    this._camera.lookAt(0, 0, 0);

    // 3. المصير (Renderer)
    this._renderer = new THREE.WebGLRenderer({
      antialias: this.settings.antialias,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this._renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this._renderer.setPixelRatio(this.settings.pixelRatio);
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = toneMappingExposure;

    if (this.settings.enableShadows && enableShadows) {
      this._renderer.shadowMap.enabled = true;
      this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.container.appendChild(this._renderer.domElement);

    // 4. الإضاءة السينمائية (Key + Fill + Rim)
    this._setupLighting();

    // 5. المجسم الأساسي (سيكون مؤقتاً حتى تحميل النموذج)
    this._createPlaceholderMesh();

    // 6. التحكم المداري
    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.05;
    this._controls.addEventListener('change', () => this.requestRender(), { signal: this.abortController.signal });

    // 7. مراقب الحجم
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);

    // 8. بدء حلقة التصيير
    this._startRenderLoop();
  }

  // ============================================================
  // 💡 الإضاءة السينمائية
  // ============================================================
  _setupLighting() {
    const {
      keyLightColor,
      keyLightIntensity,
      fillLightColor,
      fillLightIntensity,
      rimLightColor,
      rimLightIntensity,
      enableShadows,
    } = this.options;

    // Ambient Light (إضاءة محيطة خفيفة)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this._scene.add(ambientLight);

    // Key Light (الإضاءة الرئيسية - ذهبية)
    const keyLight = new THREE.SpotLight(keyLightColor, keyLightIntensity);
    keyLight.position.set(5, 5, 5);
    keyLight.angle = Math.PI / 6;
    keyLight.penumbra = 0.5;
    if (this.settings.enableShadows && enableShadows) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
    }
    this._scene.add(keyLight);

    // Fill Light (إضاءة تعبوية - باردة لتباين مع الذهب)
    const fillLight = new THREE.DirectionalLight(fillLightColor, fillLightIntensity);
    fillLight.position.set(-3, 1, 2);
    this._scene.add(fillLight);

    // Rim Light (إضاءة خلفية - دافئة)
    const rimLight = new THREE.DirectionalLight(rimLightColor, rimLightIntensity);
    rimLight.position.set(-2, 0, -5);
    this._scene.add(rimLight);

    // تخزين المراجع للتعديل المستقبلي
    this._lights = { keyLight, fillLight, rimLight, ambientLight };
  }

  // ============================================================
  // 🎨 المجسم المؤقت (Placeholder)
  // ============================================================
  _createPlaceholderMesh() {
    const { meshColor, metalness, roughness } = this.options;

    const geometry = new THREE.TorusKnotGeometry(1.5, 0.4, 128, 32);
    const material = new THREE.MeshStandardMaterial({
      color: meshColor,
      metalness,
      roughness,
    });
    this._mesh = new THREE.Mesh(geometry, material);
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = true;
    this._scene.add(this._mesh);
  }

  // ============================================================
  // 📦 تحميل الأصول (باستخدام AssetManager)
  // ============================================================
  async loadAssets() {
    const { meshUrl, textureUrl, autoRotate } = this.options;

    if (!meshUrl && !textureUrl) {
      // لا يوجد أصول للتحميل، نكتفي بالمجسم المؤقت
      return;
    }

    try {
      // تحميل النسيج (إذا وُجد)
      let texture = null;
      if (textureUrl) {
        texture = await AssetManager.loadTexture(textureUrl, {
          signal: this.abortController.signal,
          onProgress: (p) => this._updateProgress(p),
        });
      }

      // تحميل النموذج (إذا وُجد)
      if (meshUrl) {
        const gltf = await AssetManager.loadModel(meshUrl, {
          signal: this.abortController.signal,
          onProgress: (p) => this._updateProgress(p),
        });

        // استبدال المجسم المؤقت بالنموذج المحمّل
        this._scene.remove(this._mesh);
        this._mesh = gltf.scene;

        // تطبيق النسيج على النموذج (إذا وُجد)
        if (texture && this._mesh) {
          this._mesh.traverse((child) => {
            if (child.isMesh && child.material) {
              // إذا كانت المادة من نوع Standard، نطبق النسيج
              if (child.material instanceof THREE.MeshStandardMaterial) {
                child.material.map = texture;
                child.material.needsUpdate = true;
              }
            }
          });
        }

        this._mesh.castShadow = true;
        this._mesh.receiveShadow = true;
        this._scene.add(this._mesh);
        console.log('✅ [MasterSceneEngine] Model loaded successfully.');
      }

      this.requestRender();

    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('❌ [MasterSceneEngine] Failed to load assets:', error);
        // نكتفي بالمجسم المؤقت في حال الفشل
      }
    }
  }

  // ============================================================
  // 📊 تتبع التقدم
  // ============================================================
  _updateProgress(progress) {
    if (progress.total) {
      this.loadingProgress = progress.loaded / progress.total;
    }
    if (this.onProgressCallback) {
      this.onProgressCallback(this.loadingProgress);
    }
  }

  setProgressCallback(callback) {
    if (typeof callback === 'function') {
      this.onProgressCallback = callback;
    }
  }

  // ============================================================
  // 🔄 نظام Render-on-Demand
  // ============================================================
  requestRender() {
    if (this.isDisposed) return;
    this.needsUpdate = true;
  }

  // ============================================================
  // 🏃 حلقة التصيير
  // ============================================================
  _startRenderLoop() {
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
    }

    const renderLoop = () => {
      if (this.isDisposed) return;

      if (this.isPaused) {
        this._animationFrameId = requestAnimationFrame(renderLoop);
        return;
      }

      // تدوير المجسم (إذا كان مفعّلاً)
      if (this.options.autoRotate && this._mesh) {
        this._mesh.rotation.y += this.options.autoRotateSpeed;
        this.needsUpdate = true; // لأن المجسم يتحرك
      }

      // التصيير عند الحاجة فقط
      if (this.needsUpdate) {
        if (this._controls) this._controls.update();
        if (this._renderer && this._scene && this._camera) {
          this._renderer.render(this._scene, this._camera);
        }
        this.needsUpdate = false;
      }

      this._animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
  }

  // ============================================================
  // 📐 تغيير الحجم
  // ============================================================
  resize() {
    if (this.isDisposed || !this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(width, height);
    this.requestRender();
  }

  // ============================================================
  // ⏸️/▶️ الإيقاف والاستئناف
  // ============================================================
  pause() {
    if (this.isPaused) return;
    this.isPaused = true;
    console.log('⏸️ [MasterSceneEngine] Paused.');
  }

  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.requestRender();
    console.log('▶️ [MasterSceneEngine] Resumed.');
  }

  // ============================================================
  // 🔄 تغيير المجسم ديناميكياً
  // ============================================================
  setMesh(mesh) {
    if (this._mesh) {
      this._scene.remove(this._mesh);
    }
    this._mesh = mesh;
    if (mesh) {
      this._scene.add(mesh);
      this.requestRender();
    }
  }

  // ============================================================
  // 🧹 التدمير الكامل (التنظيف)
  // ============================================================
  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;

    // 1. إلغاء AbortController
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // 2. إلغاء حلقة التصيير
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }

    // 3. إلغاء ResizeObserver
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // 4. تحرير OrbitControls
    if (this._controls) {
      this._controls.dispose();
      this._controls = null;
    }

    // 5. تحرير Renderer
    if (this._renderer) {
      this._renderer.dispose();
      if (this._renderer.domElement && this._renderer.domElement.parentNode) {
        this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
      }
      this._renderer = null;
    }

    // 6. تنظيف المشهد
    if (this._scene) {
      this._scene.clear();
      this._scene = null;
    }

    this._camera = null;
    this._mesh = null;

    console.log('🗑️ [MasterSceneEngine] Disposed successfully.');
  }

  // ============================================================
  // 📊 الحصول على حالة المحرك
  // ============================================================
  getStats() {
    return {
      isPaused: this.isPaused,
      isDisposed: this.isDisposed,
      needsUpdate: this.needsUpdate,
      loadingProgress: this.loadingProgress,
      fps: this._fps || 0,
      settings: this.settings,
    };
  }
}