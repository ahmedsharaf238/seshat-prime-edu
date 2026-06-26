// src/components/video/VideoPlayer.jsx
import React from 'react';
import YouTube from 'react-youtube';
import { useVideoProgress } from '../../hooks/useVideoProgress'; // المسار الصحيح للـ Hook

export function VideoPlayer({ videoUuid, decryptedYoutubeId }) {
  // استدعاء الـ Hook وتمرير UUID الخاص بقاعدة البيانات لقراءة وحفظ التقدم
  const { 
    percent, 
    handleYouTubeReady, 
    handleYouTubeStateChange 
  } = useVideoProgress(videoUuid); 

  const opts = {
    height: '450',
    width: '100%', // ليكون متجاوباً مع جميع الشاشات
    playerVars: {
      rel: 0,              // منع إظهار فيديوهات مقترحة من قنوات أخرى عند الإيقاف
      modestbranding: 1,   // إخفاء شعار يوتيوب الكبير لحماية هوية المنصة
      controls: 1,         // إظهار أزرار التحكم الافتراضية
    },
  };

  return (
    <div className="video-player-container" style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <YouTube 
        videoId={decryptedYoutubeId} // معرف اليوتيوب المفكوك تشفيره
        opts={opts} 
        onReady={handleYouTubeReady} 
        onStateChange={handleYouTubeStateChange} 
      />
      
      {/* شريط تقدم مخصص أو مؤشر رقمي يظهر للمستخدم أسفل الفيديو */}
      <div style={{ marginTop: '10px', background: '#eee', borderRadius: '4px', height: '6px', width: '100%' }}>
        <div style={{ width: `${percent}%`, background: '#0070f3', height: '100%', borderRadius: '4px', transition: 'width 0.3s ease' }} />
      </div>
      <p style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>اكتمل من الدرس: {Math.round(percent)}%</p>
    </div>
  );
}

export default VideoPlayer;