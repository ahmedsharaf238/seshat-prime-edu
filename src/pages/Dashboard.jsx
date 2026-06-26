// src/pages/Dashboard.jsx

import React, { useEffect } from 'react';
import AudioManager from '../lib/audio/AudioManager'; // ✅ المسار الصحيح

export default function Dashboard() {
  useEffect(() => {
    // تهيئة مدير الصوت (مرة واحدة)
    AudioManager.init();
  }, []);

  const handleClick = () => {
    // تشغيل صوت عند النقر على زر
    AudioManager.playEffect('/sounds/click.mp3', 0.5);
    // أو تشغيل نغمة تنبيه
    AudioManager.playBeep(800, 100, 'square', 0.2);
  };

  return (
    <button onClick={handleClick}>
      🔊 اضغط لتجربة الصوت
    </button>
  );
}