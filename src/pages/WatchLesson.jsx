// src/pages/WatchLesson.jsx
import React from 'react';
import VideoPlayer from '../components/video/VideoPlayer';

function WatchLesson() {
  // هذه البيانات تأتي ديناميكياً من قاعدة البيانات عند تحميل الصفحة
  const lessonData = {
    id: "123e4567-e89b-12d3-a456-426614174000", // الـ UUID الصالح الخاص بالمنصة
    encryptedUrl: "dGhlX2VuY3J5cHRlZF9pZF9oZXJl" // الرابط أو المعرف المشفر
  };

  // دالة فك التشفير الخاصة بك (تُنفذ في طبقة الواجهة قبل التشغيل)
  const decryptVideoId = (encryptedData) => {
    // منطق فك التشفير الخاص بك هنا لإنتاج معرف يوتيوب النقي (مثال: dQw4w9WgXcQ)
    return "dQw4w9WgXcQ"; 
  };

  const decryptedId = decryptVideoId(lessonData.encryptedUrl);

  return (
    <div className="lesson-page-layout" style={{ padding: '20px' }}>
      <h1>عنوان الدرس البرمجي</h1>
      
      {/* استدعاء مكون المشغل وتمرير البيانات المحصنة له */}
      <VideoPlayer 
        videoUuid={lessonData.id} 
        decryptedYoutubeId={decryptedId} 
      />
      
      <div className="lesson-description">
        <p>وصف الدرس ومصادر التحميل...</p>
      </div>
    </div>
  );
}

export default WatchLesson;