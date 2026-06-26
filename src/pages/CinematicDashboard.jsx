// src/pages/CinematicDashboard.jsx

import React from 'react';
import { useAdaptive3D } from '@/hooks/useAdaptive3D';

export default function CinematicDashboard() {
  const {
    containerRef,
    isReady,
    isLoading,
    progress,
    isPaused,
    error,
    quality,
    setQuality,
    deviceTier,
    fps,
    pause,
    resume,
    togglePause,
    reload,
    setLOD,
  } = useAdaptive3D({
    meshUrl: '/models/main_scene.gltf',
    textureUrl: '/textures/environment.jpg',
    autoRotate: true,
    autoRotateSpeed: 0.002,
    keyLightIntensity: 25,
    enableLOD: true,
    quality: 'auto',
  });

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0a0a0a' }}>
      {/* Overlay التحميل */}
      {isLoading && (
        <div style={styles.loadingOverlay}>
          <div style={styles.loadingBox}>
            <div style={styles.loadingTitle}>🎬 جاري تحميل المشهد السينمائي</div>
            <div style={styles.progressBarContainer}>
              <div style={{ ...styles.progressBar, width: `${progress}%` }} />
            </div>
            <div style={styles.progressText}>{progress}%</div>
          </div>
        </div>
      )}

      {/* لوحة التحكم (Admin/Power User) */}
      <div style={styles.controlPanel}>
        <div style={styles.controlGroup}>
          <button onClick={togglePause} style={styles.ctrlBtn}>
            {isPaused ? '▶️ تشغيل' : '⏸️ إيقاف مؤقت'}
          </button>
          <button onClick={reload} style={styles.ctrlBtn}>🔄 إعادة تحميل</button>
        </div>
        <div style={styles.controlGroup}>
          <label style={styles.label}>🎛️ الجودة:</label>
          <select value={quality} onChange={(e) => setQuality(e.target.value)} style={styles.select}>
            <option value="auto">🔄 تلقائي ({deviceTier})</option>
            <option value="high">⚡ عالي</option>
            <option value="medium">⚡ متوسط</option>
            <option value="low">⚡ منخفض</option>
          </select>
        </div>
        <div style={styles.controlGroup}>
          <label style={styles.label}>📐 LOD:</label>
          <input type="checkbox" defaultChecked onChange={(e) => setLOD(e.target.checked)} />
        </div>
        <div style={styles.stats}>
          <span>📊 FPS: {fps}</span>
          <span>🖥️ الجهاز: {deviceTier}</span>
        </div>
      </div>

      {error && (
        <div style={styles.errorOverlay}>
          ❌ {error}
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

// أنماط سريعة (يمكن نقلها إلى CSS)
const styles = {
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.85)',
    zIndex: 100,
    backdropFilter: 'blur(10px)',
  },
  loadingBox: {
    textAlign: 'center',
    color: '#ffb700',
    fontFamily: 'serif',
    padding: '40px',
  },
  loadingTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '20px',
    textShadow: '0 0 20px rgba(255,183,0,0.3)',
  },
  progressBarContainer: {
    width: '300px',
    height: '4px',
    background: '#333',
    borderRadius: '2px',
    margin: '10px auto',
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #ffb700, #ff8800)',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '14px',
    opacity: 0.7,
  },
  controlPanel: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 50,
    background: 'rgba(0,0,0,0.8)',
    backdropFilter: 'blur(10px)',
    padding: '12px 20px',
    borderRadius: '12px',
    border: '1px solid rgba(255,183,0,0.2)',
    display: 'flex',
    gap: '20px',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#e0e0e0',
    fontSize: '13px',
  },
  controlGroup: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  ctrlBtn: {
    background: 'transparent',
    border: '1px solid #ffb700',
    color: '#ffb700',
    padding: '4px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.2s',
  },
  select: {
    background: '#222',
    color: '#e0e0e0',
    border: '1px solid #444',
    borderRadius: '6px',
    padding: '4px 8px',
    fontSize: '12px',
  },
  label: {
    opacity: 0.7,
    fontSize: '12px',
  },
  stats: {
    display: 'flex',
    gap: '16px',
    fontSize: '12px',
    opacity: 0.6,
  },
  errorOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 200,
    color: '#ff4444',
    background: 'rgba(0,0,0,0.9)',
    padding: '20px 40px',
    borderRadius: '12px',
    border: '1px solid #ff4444',
  },
};