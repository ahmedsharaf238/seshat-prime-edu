// src/pages/ExamPage.jsx

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom'; // لاستقبال معرف الامتحان من الرابط
import { enableContentProtection } from '../lib/security/contentProtection';
import { useAuth } from '../hooks/useAuth'; // الخطاف الخاص بالمصادقة
import { supabase } from '../lib/supabase/supabaseClient';

const ExamPage = () => {
  const { examId } = useParams(); // مثلاً: /exam/123
  const { user, profile } = useAuth(); // لجلب بيانات المستخدم الحقيقية
  const [videoUrl, setVideoUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const videoContainerRef = useRef(null); // المرجع الخاص بحاوية الفيديو

  // 1. جلب رابط الفيديو من قاعدة البيانات بناءً على examId
  useEffect(() => {
    const fetchExamVideo = async () => {
      if (!examId) return;
      
      // افترض أن لديك جدول exams يحتوي على عمود youtube_link
      const { data, error } = await supabase
        .from('exams')
        .select('youtube_link, title')
        .eq('id', examId)
        .single();

      if (error) {
        console.error('خطأ في جلب الفيديو:', error);
        setLoading(false);
        return;
      }

      // استخراج الرابط وتجهيزه للـ Embed (إزالة جزء watch?v= وتحويله إلى embed/)
      let embedLink = data.youtube_link;
      if (embedLink.includes('watch?v=')) {
        const videoId = embedLink.split('v=')[1]?.split('&')[0];
        embedLink = `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&controls=1&disablekb=1&fs=0`;
      }
      
      setVideoUrl(embedLink);
      setLoading(false);
    };

    fetchExamVideo();
  }, [examId]);

  // 2. تفعيل الحماية (العلامة المائية ومنع التصوير) عند تحميل الصفحة وتحديثها
  useEffect(() => {
    // لا نمرر عنصر الفيديو لأننا سنستخدم iframe، لكن نمرر بيانات المستخدم
    // وسنعدل دالة enableContentProtection لتعمل مع iframe (عن طريق إضافة العلامة المائية على الحاوية)
    if (profile && videoContainerRef.current) {
      // نمرر الحاوية التي تحتوي على iframe كعنصر بديل للفيديو
      const cleanup = enableContentProtection(profile, videoContainerRef.current);
      
      // تنظيف الحماية عند مغادرة الصفحة
      return cleanup;
    }
  }, [profile, videoContainerRef.current]); // يعاد تشغيله عندما تتغير البيانات أو يتم تحميل الحاوية

  // إذا كان لا يزال يحمل أو لم يتم تسجيل الدخول
  if (loading || !profile) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <p>جاري تحميل الامتحان...</p>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '900px', margin: '0 auto', background: '#000' }}>
      
      {/* حاوية الفيديو التي ستُطبق عليها العلامة المائية */}
      <div 
        ref={videoContainerRef} 
        style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', height: 0, overflow: 'hidden' }}
      >
        {/* إطار الفيديو من يوتيوب */}
        <iframe
          src={videoUrl}
          title="امتحان"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
        />
        
        {/* 
          🔥 طبقة العلامة المائية الجنائية (ستتم إضافتها بواسطة دالة enableContentProtection)
          لكن يمكننا أيضاً وضعها يدوياً هنا كـ (Overlay) احتياطي 
        */}
      </div>

      {/* تعليمات للطالب (اختيارية) */}
      <div style={{ color: '#fff', padding: '10px', textAlign: 'center', background: '#1a1a1a' }}>
        <p style={{ fontSize: '14px', color: '#aaa' }}>
          ⚠️ هذا الامتحان مسجل باسم: {profile.full_name} | ولي الأمر: {profile.parent_phone || 'غير مسجل'}
        </p>
      </div>
    </div>
  );
};

export default ExamPage;