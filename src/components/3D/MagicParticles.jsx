// src/components/3D/MagicParticles.jsx
import * as THREE from 'three';

/**
 * دالة لإنشاء نظام جسيمات سحرية ملونة (تحاكي كود p5.js الأصلي)
 * @param {THREE.Scene} scene - المشهد الذي ستضاف إليه الجسيمات
 * @param {number} count - عدد الجسيمات (افتراضي 800)
 * @returns {Object} { particles, update, dispose } للتحكم فيها
 */
export const createMagicParticles = (scene, count = 800) => {
  // 1. الألوان المستخدمة في الكود الأصلي
  const colorsPalette = [
    '#e84e66', '#67c69e', '#edf1f4', '#80acc9',
    '#73a8b0', '#fe817f', '#68d2a4', '#1d203f', '#c93a0d'
  ];

  // 2. إنشاء نسيج دائري (لجعل النقاط دائرية وناعمة)
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);

  // 3. إعداد البيانات
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const velocities = [];

  // نطاق التوزيع (مساحة واسعة حول الكاميرا)
  const spread = 20;

  for (let i = 0; i < count; i++) {
    // الموضع العشوائي (في فضاء ثلاثي الأبعاد)
    positions[i * 3] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread * 0.6 - 2;

    // اللون من اللوحة (مع تحويل Hex إلى RGB)
    const colorHex = colorsPalette[Math.floor(Math.random() * colorsPalette.length)];
    const color = new THREE.Color(colorHex);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    // الحجم (من 0.1 إلى 0.6، مقارب للحجم 10-30 في p5 ولكن بمقياس أصغر)
    sizes[i] = 0.1 + Math.random() * 0.5;

    // السرعة (اتجاه عشوائي + سرعة)
    velocities.push({
      x: (Math.random() - 0.5) * 0.04,
      y: (Math.random() - 0.5) * 0.04,
      z: (Math.random() - 0.5) * 0.04,
    });
  }

  // 4. إنشاء الهندسة (Geometry)
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  // 5. مادة الجسيمات (PointsMaterial مع texture دائرية)
  const material = new THREE.PointsMaterial({
    size: 0.4, // الحجم الأساسي (سيتم التحكم فيه عبر السمات لاحقاً)
    map: texture,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    vertexColors: true, // استخدام الألوان الفردية لكل جسيم
    opacity: 0.9,
    sizeAttenuation: true,
  });

  // 6. إنشاء الكائن النهائي
  const particleSystem = new THREE.Points(geometry, material);
  scene.add(particleSystem);

  // 7. دالة التحديث (تحاكي update() في الكود الأصلي)
  const updateParticles = () => {
    const posAttr = geometry.attributes.position;
    const posArray = posAttr.array;

    for (let i = 0; i < count; i++) {
      // تحديث الموضع بالسرعة
      posArray[i * 3] += velocities[i].x;
      posArray[i * 3 + 1] += velocities[i].y;
      posArray[i * 3 + 2] += velocities[i].z;

      // إعادة التدوير لو خرج الجسيم عن النطاق (يعود من الناحية الأخرى)
      // أو نعيد تعيينه عشوائياً لو اتشتت بعيداً
      const limit = 12;
      if (Math.abs(posArray[i * 3]) > limit) {
        posArray[i * 3] = (Math.random() - 0.5) * spread;
        posArray[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.6;
        posArray[i * 3 + 2] = (Math.random() - 0.5) * spread * 0.6 - 2;
        // نغير سرعته أيضاً عشان يبقى ديناميكي
        velocities[i] = {
          x: (Math.random() - 0.5) * 0.04,
          y: (Math.random() - 0.5) * 0.04,
          z: (Math.random() - 0.5) * 0.04,
        };
      }
    }

    // إعلام Three.js بتغير البيانات
    posAttr.needsUpdate = true;
  };

  // 8. دالة التنظيف (مسح من المشهد)
  const dispose = () => {
    scene.remove(particleSystem);
    geometry.dispose();
    material.dispose();
    texture.dispose();
  };

  return {
    particles: particleSystem,
    update: updateParticles,
    dispose,
  };
};