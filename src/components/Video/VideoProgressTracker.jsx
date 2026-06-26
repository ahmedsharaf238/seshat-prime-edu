// src/components/VideoPlayer.jsx
import React, { useEffect, useRef, useState } from 'react';

const VideoPlayer = ({ videoUrl, userData, onTimeUpdate }) => {
  const iframeRef = useRef(null);
  const watermarkRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // تحديث التوقيت كل ثانية للختم المائي
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // منع التفاعل مع الفيديو (النقر الأيمن، التحميل، فتح في تطبيق خارجي)
  useEffect(() => {
    const handleContextMenu = (e) => e.preventDefault();
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener('contextmenu', handleContextMenu);
      // منع فتح الفيديو في تطبيق خارجي (مثل VLC)
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    }
    return () => {
      if (iframe) iframe.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // إنشاء الختم المائي الديناميكي (يتحرك عشوائياً)
  useEffect(() => {
    const watermark = watermarkRef.current;
    if (!watermark) return;

    let x = 10, y = 10;
    let dx = 0.5, dy = 0.3;
    let animationFrame;

    const moveWatermark = () => {
      const rect = watermark.getBoundingClientRect();
      const container = watermark.parentElement.getBoundingClientRect();

      x += dx;
      y += dy;

      // ارتداد عند الحواف
      if (x + rect.width > container.width || x < 0) dx *= -1;
      if (y + rect.height > container.height || y < 0) dy *= -1;

      watermark.style.left = `${x}px`;
      watermark.style.top = `${y}px`;

      animationFrame = requestAnimationFrame(moveWatermark);
    };

    moveWatermark();

    return () => cancelAnimationFrame(animationFrame);
  }, []);

  // تنسيق الوقت (للعرض في الختم)
  const formattedTime = currentTime.toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      {/* فيديو يوتيوب */}
      <iframe
        ref={iframeRef}
        src={videoUrl}
        title="Protected Video"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={{ width: '100%', aspectRatio: '16/9', pointerEvents: 'auto' }}
      />

      {/* طبقة الختم المائي (تظهر فوق الفيديو) */}
      <div
        ref={watermarkRef}
        style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          pointerEvents: 'none', // مهم: لا تمنع التفاعل مع الفيديو
          zIndex: 9999,
          color: 'rgba(255, 255, 255, 0.6)',
          fontSize: '14px',
          fontFamily: 'monospace',
          textShadow: '0 0 10px rgba(0,0,0,0.8)',
          background: 'rgba(0,0,0,0.3)',
          padding: '8px 12px',
          borderRadius: '4px',
          backdropFilter: 'blur(4px)',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          transform: 'rotate(-5deg)',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
          🛡️ Seshat Prime Edu
        </div>
        <div>
          {userData.fullName} | {userData.email}
        </div>
        <div style={{ fontSize: '12px', opacity: 0.8 }}>
          📱 {userData.phone} | 👨‍👦 {userData.parentPhone}
        </div>
        <div style={{ fontSize: '12px', opacity: 0.7, direction: 'ltr' }}>
          ⏱️ {formattedTime}
        </div>
      </div>

      {/* طبقة شفافة لحماية النقر الأيمن (اختياري) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 9998,
        }}
      />
    </div>
  );
};

export default VideoPlayer;