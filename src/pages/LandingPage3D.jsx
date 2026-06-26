// src/pages/LandingPage3D.jsx
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FaVolumeUp, FaVolumeMute } from 'react-icons/fa';
import '../styles/landing.css';

// ============================================================
// 🎬 روابط الملفات (تم التحديث بالروابط الجديدة)
// ============================================================
const VIDEO_URL = 'https://ljmtbfkkqguaduzjscfi.supabase.co/storage/v1/object/public/assets/live.mp4';
const AUDIO1_URL = 'https://ljmtbfkkqguaduzjscfi.supabase.co/storage/v1/object/public/assets/arabic.mp3';
const AUDIO2_URL = 'https://ljmtbfkkqguaduzjscfi.supabase.co/storage/v1/object/public/assets/english.mp3';

// رابط الشعار من Supabase
const LOGO_URL = 'https://ljmtbfkkqguaduzjscfi.supabase.co/storage/v1/object/public/assets/logoo.png';

const LandingPage3D = () => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // مراجع للعناصر الصوتية والفيديو
  const audio1Ref = useRef(null);
  const audio2Ref = useRef(null);
  const videoRef = useRef(null);

  // ----- 1. شريط التقدم -----
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 0 : prev + 0.5));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // ----- 2. تشغيل الصوت التلقائي (الملف الأول ثم الثاني) -----
  useEffect(() => {
    const playAudio = async () => {
      try {
        if (audio1Ref.current) {
          await audio1Ref.current.play();
        }
      } catch (err) {
        console.log('Auto-play prevented by browser:', err);
      }
    };
    playAudio();
  }, []);

  // عند انتهاء الملف الأول → نبدأ الثاني
  const handleAudio1End = () => {
    if (audio2Ref.current) {
      audio2Ref.current.play().catch(err => console.log('Error playing audio2:', err));
    }
  };

  // عند انتهاء الملف الثاني → نعيد الأول (حلقة لا نهائية)
  const handleAudio2End = () => {
    if (audio1Ref.current) {
      audio1Ref.current.play().catch(err => console.log('Error playing audio1 (loop):', err));
    }
  };

  // ----- 3. تبديل كتم الصوت -----
  const toggleMute = () => {
    const newMuteState = !isMuted;
    setIsMuted(newMuteState);
    if (audio1Ref.current) audio1Ref.current.muted = newMuteState;
    if (audio2Ref.current) audio2Ref.current.muted = newMuteState;
    if (videoRef.current) videoRef.current.muted = true;
  };

  // ----- 4. إدارة الفيديو (خلفية مكتومة وتتكرر تلقائياً) -----
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.loop = true;
      videoRef.current.playsInline = true;
      videoRef.current.play().catch(err => console.log('Video autoplay error:', err));
    }
  }, []);

  return (
    <>
      {/* ============================================================ */}
      {/* 1. خلفية الفيديو                                              */}
      {/* ============================================================ */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
          overflow: 'hidden',
          background: '#070b17',
        }}
      >
        <video
          ref={videoRef}
          src={VIDEO_URL}
          autoPlay
          loop
          muted
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        {/* طبقة تعتيم فوق الفيديو عشان البطاقة تبان */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'radial-gradient(ellipse at center, rgba(7,11,23,0.2) 0%, rgba(7,11,23,0.7) 100%)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      </div>

      {/* ============================================================ */}
      {/* 2. عناصر الصوت (مخفية)                                       */}
      {/* ============================================================ */}
      <audio
        ref={audio1Ref}
        src={AUDIO1_URL}
        onEnded={handleAudio1End}
        preload="auto"
        style={{ display: 'none' }}
      />
      <audio
        ref={audio2Ref}
        src={AUDIO2_URL}
        onEnded={handleAudio2End}
        preload="auto"
        style={{ display: 'none' }}
      />

      {/* ============================================================ */}
      {/* 3. أيقونة السماعة (الزاوية العلوية اليمنى)                  */}
      {/* ============================================================ */}
      <div
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 20,
          cursor: 'pointer',
          color: '#d4af37',
          fontSize: '2.2rem',
          transition: 'all 0.3s ease',
          background: 'rgba(7,11,23,0.5)',
          backdropFilter: 'blur(12px)',
          padding: '12px',
          borderRadius: '50%',
          border: '1px solid rgba(212,175,55,0.2)',
          boxShadow: '0 0 30px rgba(212,175,55,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={toggleMute}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.1)';
          e.currentTarget.style.boxShadow = '0 0 50px rgba(212,175,55,0.2)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 0 30px rgba(212,175,55,0.1)';
        }}
      >
        {isMuted ? <FaVolumeMute /> : <FaVolumeUp />}
      </div>

      {/* ============================================================ */}
      {/* 4. البطاقة الزجاجية (نفس التصميم السابق)                    */}
      {/* ============================================================ */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          pointerEvents: 'none',
          padding: '20px',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            maxWidth: '860px',
            width: '100%',
            padding: '40px 38px',
            background: 'rgba(7, 11, 23, 0.45)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
            border: '2px solid rgba(255,255,255,0.05)',
            borderRadius: '24px',
            boxShadow: `
              0 0 20px rgba(212,175,55,0.15),
              0 0 40px rgba(212,175,55,0.08),
              0 0 80px rgba(212,175,55,0.04),
              0 0 20px rgba(74,124,255,0.12),
              0 0 50px rgba(74,124,255,0.06),
              0 0 20px rgba(180,80,200,0.10),
              0 0 40px rgba(180,80,200,0.05),
              0 20px 60px rgba(0,0,0,0.6),
              inset 0 0 60px rgba(212,175,55,0.02)
            `,
            outline: '1px solid rgba(212,175,55,0.08)',
            outlineOffset: '4px',
            animation: 'neonBorderPulse 4s ease-in-out infinite alternate',
            position: 'relative',
          }}
        >
          {/* زوايا فرعونية */}
          <div style={{
            position: 'absolute',
            top: '-8px',
            left: '-8px',
            width: '30px',
            height: '30px',
            borderTop: '3px solid rgba(212,175,55,0.3)',
            borderLeft: '3px solid rgba(212,175,55,0.3)',
            borderRadius: '8px 0 0 0',
            pointerEvents: 'none',
            zIndex: 3,
          }} />
          <div style={{
            position: 'absolute',
            top: '-8px',
            right: '-8px',
            width: '30px',
            height: '30px',
            borderTop: '3px solid rgba(74,124,255,0.3)',
            borderRight: '3px solid rgba(74,124,255,0.3)',
            borderRadius: '0 8px 0 0',
            pointerEvents: 'none',
            zIndex: 3,
          }} />
          <div style={{
            position: 'absolute',
            bottom: '-8px',
            left: '-8px',
            width: '30px',
            height: '30px',
            borderBottom: '3px solid rgba(180,80,200,0.3)',
            borderLeft: '3px solid rgba(180,80,200,0.3)',
            borderRadius: '0 0 0 8px',
            pointerEvents: 'none',
            zIndex: 3,
          }} />
          <div style={{
            position: 'absolute',
            bottom: '-8px',
            right: '-8px',
            width: '30px',
            height: '30px',
            borderBottom: '3px solid rgba(212,175,55,0.3)',
            borderRight: '3px solid rgba(212,175,55,0.3)',
            borderRadius: '0 0 8px 0',
            pointerEvents: 'none',
            zIndex: 3,
          }} />

          {/* ===== تخطيط الشبكة (لوجو يمين - بيانات شمال) ===== */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '40px',
              alignItems: 'center',
              position: 'relative',
              zIndex: 2,
            }}
          >
            {/* ===== الجانب الأيسر: النصوص + الفورم ===== */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <div style={{ textAlign: 'left' }}>
                <h2
                  style={{
                    fontSize: 'clamp(1.4rem, 3.2vw, 2.2rem)',
                    fontWeight: 700,
                    margin: 0,
                    letterSpacing: '4px',
                    color: '#d4af37',
                    textShadow: `
                      0 0 20px rgba(212,175,55,0.3),
                      0 0 40px rgba(212,175,55,0.15),
                      0 0 80px rgba(212,175,55,0.05)
                    `,
                    fontFamily: "'Cinzel', 'Times New Roman', serif",
                  }}
                >
                  ⚜ WELCOME BACK ⚜
                </h2>
                <p
                  style={{
                    fontSize: '0.85rem',
                    color: 'rgba(166,180,208,0.7)',
                    margin: '4px 0 0 0',
                    letterSpacing: '1px',
                    fontFamily: "'Cinzel', 'Times New Roman', serif",
                  }}
                >
                  𓂀 Enter the temple of wisdom
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  navigate('/dashboard');
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                <input
                  type="email"
                  placeholder="✧ Email"
                  required
                  style={{
                    width: '100%',
                    padding: '15px 20px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(212,175,55,0.15)',
                    borderRadius: '14px',
                    color: '#e8e0d8',
                    fontSize: '0.95rem',
                    outline: 'none',
                    fontFamily: "'Cinzel', 'Times New Roman', serif",
                    boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.2), 0 0 20px rgba(212,175,55,0.02)',
                    transition: 'all 0.4s ease',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#d4af37';
                    e.target.style.boxShadow = 'inset 0 2px 10px rgba(0,0,0,0.2), 0 0 30px rgba(212,175,55,0.08), 0 0 60px rgba(74,124,255,0.04)';
                    e.target.style.background = 'rgba(255,255,255,0.07)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(212,175,55,0.15)';
                    e.target.style.boxShadow = 'inset 0 2px 10px rgba(0,0,0,0.2), 0 0 20px rgba(212,175,55,0.02)';
                    e.target.style.background = 'rgba(255,255,255,0.04)';
                  }}
                />

                <input
                  type="password"
                  placeholder="✧ Password"
                  required
                  style={{
                    width: '100%',
                    padding: '15px 20px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(212,175,55,0.15)',
                    borderRadius: '14px',
                    color: '#e8e0d8',
                    fontSize: '0.95rem',
                    outline: 'none',
                    fontFamily: "'Cinzel', 'Times New Roman', serif",
                    boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.2), 0 0 20px rgba(212,175,55,0.02)',
                    transition: 'all 0.4s ease',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#4a7cff';
                    e.target.style.boxShadow = 'inset 0 2px 10px rgba(0,0,0,0.2), 0 0 30px rgba(74,124,255,0.08), 0 0 60px rgba(212,175,55,0.04)';
                    e.target.style.background = 'rgba(255,255,255,0.07)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(212,175,55,0.15)';
                    e.target.style.boxShadow = 'inset 0 2px 10px rgba(0,0,0,0.2), 0 0 20px rgba(212,175,55,0.02)';
                    e.target.style.background = 'rgba(255,255,255,0.04)';
                  }}
                />

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '2px',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      color: 'rgba(166,180,208,0.6)',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      fontFamily: "'Cinzel', 'Times New Roman', serif",
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{
                        accentColor: '#d4af37',
                        width: '16px',
                        height: '16px',
                        cursor: 'pointer',
                      }}
                    />
                    𓂀 Remember
                  </label>
                  <Link
                    to="/forgot-password"
                    style={{
                      color: 'rgba(212,175,55,0.7)',
                      fontSize: '0.8rem',
                      textDecoration: 'none',
                      transition: 'all 0.3s ease',
                      fontFamily: "'Cinzel', 'Times New Roman', serif",
                      borderBottom: '1px solid rgba(212,175,55,0.1)',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.color = '#d4af37';
                      e.target.style.borderBottomColor = '#d4af37';
                      e.target.style.textShadow = '0 0 20px rgba(212,175,55,0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.color = 'rgba(212,175,55,0.7)';
                      e.target.style.borderBottomColor = 'rgba(212,175,55,0.1)';
                      e.target.style.textShadow = 'none';
                    }}
                  >
                    𓂀 Forgot Scroll?
                  </Link>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                  <button
                    type="submit"
                    style={{
                      flex: 1,
                      padding: '15px 10px',
                      background: 'linear-gradient(135deg, rgba(212,175,55,0.15), rgba(212,175,55,0.05))',
                      border: '1px solid rgba(212,175,55,0.25)',
                      borderRadius: '14px',
                      color: '#d4af37',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                      letterSpacing: '2px',
                      textTransform: 'uppercase',
                      fontFamily: "'Cinzel', 'Times New Roman', serif",
                      boxShadow: `
                        0 0 20px rgba(212,175,55,0.05),
                        inset 0 2px 10px rgba(0,0,0,0.2)
                      `,
                      textShadow: '0 0 20px rgba(212,175,55,0.1)',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.transform = 'translateY(-3px) scale(1.03)';
                      e.target.style.background = 'linear-gradient(135deg, rgba(212,175,55,0.25), rgba(212,175,55,0.1))';
                      e.target.style.borderColor = '#d4af37';
                      e.target.style.boxShadow = `
                        0 0 30px rgba(212,175,55,0.2),
                        0 0 60px rgba(212,175,55,0.1),
                        inset 0 2px 10px rgba(0,0,0,0.2)
                      `;
                      e.target.style.textShadow = '0 0 30px rgba(212,175,55,0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = 'translateY(0) scale(1)';
                      e.target.style.background = 'linear-gradient(135deg, rgba(212,175,55,0.15), rgba(212,175,55,0.05))';
                      e.target.style.borderColor = 'rgba(212,175,55,0.25)';
                      e.target.style.boxShadow = '0 0 20px rgba(212,175,55,0.05), inset 0 2px 10px rgba(0,0,0,0.2)';
                      e.target.style.textShadow = '0 0 20px rgba(212,175,55,0.1)';
                    }}
                  >
                    ⚔ Sign In
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate('/register')}
                    style={{
                      flex: 1,
                      padding: '15px 10px',
                      background: 'linear-gradient(135deg, rgba(74,124,255,0.12), rgba(74,124,255,0.04))',
                      border: '1px solid rgba(74,124,255,0.2)',
                      borderRadius: '14px',
                      color: 'rgba(74,124,255,0.8)',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                      letterSpacing: '2px',
                      textTransform: 'uppercase',
                      fontFamily: "'Cinzel', 'Times New Roman', serif",
                      boxShadow: `
                        0 0 20px rgba(74,124,255,0.04),
                        inset 0 2px 10px rgba(0,0,0,0.2)
                      `,
                      textShadow: '0 0 20px rgba(74,124,255,0.05)',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.transform = 'translateY(-3px) scale(1.03)';
                      e.target.style.background = 'linear-gradient(135deg, rgba(74,124,255,0.2), rgba(74,124,255,0.08))';
                      e.target.style.borderColor = '#4a7cff';
                      e.target.style.boxShadow = `
                        0 0 30px rgba(74,124,255,0.2),
                        0 0 60px rgba(74,124,255,0.1),
                        inset 0 2px 10px rgba(0,0,0,0.2)
                      `;
                      e.target.style.color = '#4a7cff';
                      e.target.style.textShadow = '0 0 30px rgba(74,124,255,0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = 'translateY(0) scale(1)';
                      e.target.style.background = 'linear-gradient(135deg, rgba(74,124,255,0.12), rgba(74,124,255,0.04))';
                      e.target.style.borderColor = 'rgba(74,124,255,0.2)';
                      e.target.style.boxShadow = '0 0 20px rgba(74,124,255,0.04), inset 0 2px 10px rgba(0,0,0,0.2)';
                      e.target.style.color = 'rgba(74,124,255,0.8)';
                      e.target.style.textShadow = '0 0 20px rgba(74,124,255,0.05)';
                    }}
                  >
                    ⚔ Sign Up
                  </button>
                </div>
              </form>

              {/* شريط التقدم */}
              <div style={{ marginTop: '6px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    color: 'rgba(166,180,208,0.4)',
                    fontSize: '0.7rem',
                    fontVariantNumeric: 'tabular-nums',
                    fontFamily: "'Cinzel', 'Times New Roman', serif",
                  }}
                >
                  <span>◄ 0:00</span>
                  <div
                    style={{
                      flex: 1,
                      height: '4px',
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: '4px',
                      position: 'relative',
                      overflow: 'visible',
                      boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.3)',
                    }}
                  >
                    <div
                      style={{
                        width: `${progress}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #b8860b, #d4af37, #f9e281)',
                        borderRadius: '4px',
                        transition: 'width 0.1s linear',
                        boxShadow: '0 0 20px rgba(212,175,55,0.3)',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: `${progress}%`,
                        transform: 'translate(-50%, -50%)',
                        width: '14px',
                        height: '14px',
                        background: 'radial-gradient(circle, #f9e281, #b8860b)',
                        borderRadius: '50%',
                        boxShadow: '0 0 30px rgba(212,175,55,0.5)',
                        transition: 'left 0.1s linear',
                        border: '2px solid rgba(7,11,23,0.5)',
                      }}
                    />
                  </div>
                  <span>0:10 ►</span>
                </div>
              </div>

              <div
                style={{
                  marginTop: '2px',
                  textAlign: 'left',
                  fontSize: '0.5rem',
                  color: 'rgba(166,180,208,0.15)',
                  letterSpacing: '3px',
                  fontFamily: "'Cinzel', 'Times New Roman', serif",
                }}
              >
                © 2026 · Seshat-Prime · 𓂀
              </div>
            </div>

            {/* ===== الجانب الأيمن: اللوجو 3D ===== */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              {/* هالة خلفية */}
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 'clamp(250px, 36vw, 420px)',
                  height: 'clamp(250px, 36vw, 420px)',
                  background: `
                    radial-gradient(circle, rgba(212,175,55,0.15) 0%, transparent 45%),
                    radial-gradient(circle at 30% 70%, rgba(74,124,255,0.10) 0%, transparent 55%),
                    radial-gradient(circle at 70% 30%, rgba(180,80,200,0.08) 0%, transparent 55%)
                  `,
                  borderRadius: '50%',
                  pointerEvents: 'none',
                  zIndex: 0,
                  animation: 'glowPulse 3s ease-in-out infinite alternate',
                }}
              />

              <img
                src={LOGO_URL}
                alt="Seshat Prime Logo"
                style={{
                  height: 'clamp(190px, 30vw, 320px)',
                  width: 'auto',
                  display: 'block',
                  position: 'relative',
                  zIndex: 1,
                  imageRendering: 'auto',
                  backfaceVisibility: 'hidden',
                  transform: 'perspective(800px) rotateX(4deg) rotateY(8deg) scale(1)',
                  transition: 'transform 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275), filter 0.6s ease',
                  filter: `
                    drop-shadow(0 0 15px rgba(212,175,55,0.8))
                    drop-shadow(0 0 35px rgba(74,124,255,0.5))
                    drop-shadow(0 0 60px rgba(180,80,200,0.3))
                    brightness(1.2) contrast(1.12) saturate(1.15)
                  `,
                  animation: 'cinematicNeon 4s ease-in-out infinite alternate, floatLogo 6s ease-in-out infinite',
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale(1.1)';
                  e.target.style.filter =
                    'drop-shadow(0 0 25px #f9e281) ' +
                    'drop-shadow(0 0 55px #4a7cff) ' +
                    'drop-shadow(0 0 90px #b850c8) ' +
                    'brightness(1.3) contrast(1.18) saturate(1.2)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'perspective(800px) rotateX(4deg) rotateY(8deg) scale(1)';
                  e.target.style.filter = `
                    drop-shadow(0 0 15px rgba(212,175,55,0.8))
                    drop-shadow(0 0 35px rgba(74,124,255,0.5))
                    drop-shadow(0 0 60px rgba(180,80,200,0.3))
                    brightness(1.2) contrast(1.12) saturate(1.15)
                  `;
                }}
              />

              <div
                style={{
                  marginTop: '10px',
                  fontSize: '1.2rem',
                  color: 'rgba(212,175,55,0.15)',
                  letterSpacing: '12px',
                  fontFamily: "'Cinzel', 'Times New Roman', serif",
                  textShadow: '0 0 30px rgba(212,175,55,0.05)',
                }}
              >
                𓋴 𓂀 𓃥
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 🎨 Keyframes                                                */}
      {/* ============================================================ */}
      <style>{`
        @keyframes cinematicNeon {
          0% {
            filter: drop-shadow(0 0 15px #d4af37) 
                    drop-shadow(0 0 35px #4a7cff) 
                    drop-shadow(0 0 60px #b850c8) 
                    brightness(1.2) contrast(1.12) saturate(1.15);
          }
          33% {
            filter: drop-shadow(0 0 20px #4a7cff) 
                    drop-shadow(0 0 45px #b850c8) 
                    drop-shadow(0 0 70px #d4af37) 
                    brightness(1.25) contrast(1.15) saturate(1.18);
          }
          66% {
            filter: drop-shadow(0 0 18px #b850c8) 
                    drop-shadow(0 0 40px #d4af37) 
                    drop-shadow(0 0 65px #4a7cff) 
                    brightness(1.22) contrast(1.13) saturate(1.16);
          }
          100% {
            filter: drop-shadow(0 0 25px #d4af37) 
                    drop-shadow(0 0 50px #4a7cff) 
                    drop-shadow(0 0 80px #b850c8) 
                    brightness(1.28) contrast(1.18) saturate(1.2);
          }
        }

        @keyframes neonBorderPulse {
          0% {
            box-shadow: 
              0 0 20px rgba(212,175,55,0.15),
              0 0 40px rgba(212,175,55,0.08),
              0 0 80px rgba(212,175,55,0.04),
              0 0 20px rgba(74,124,255,0.12),
              0 0 50px rgba(74,124,255,0.06),
              0 0 20px rgba(180,80,200,0.10),
              0 0 40px rgba(180,80,200,0.05),
              0 20px 60px rgba(0,0,0,0.6),
              inset 0 0 60px rgba(212,175,55,0.02);
          }
          50% {
            box-shadow: 
              0 0 30px rgba(212,175,55,0.25),
              0 0 60px rgba(212,175,55,0.12),
              0 0 100px rgba(212,175,55,0.06),
              0 0 30px rgba(74,124,255,0.20),
              0 0 70px rgba(74,124,255,0.10),
              0 0 30px rgba(180,80,200,0.18),
              0 0 60px rgba(180,80,200,0.08),
              0 20px 60px rgba(0,0,0,0.6),
              inset 0 0 80px rgba(212,175,55,0.04);
          }
          100% {
            box-shadow: 
              0 0 25px rgba(212,175,55,0.20),
              0 0 50px rgba(212,175,55,0.10),
              0 0 90px rgba(212,175,55,0.05),
              0 0 25px rgba(74,124,255,0.16),
              0 0 55px rgba(74,124,255,0.08),
              0 0 25px rgba(180,80,200,0.14),
              0 0 50px rgba(180,80,200,0.06),
              0 20px 60px rgba(0,0,0,0.6),
              inset 0 0 70px rgba(212,175,55,0.03);
          }
        }

        @keyframes glowPulse {
          0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.5; }
          100% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
        }

        @keyframes floatLogo {
          0% { transform: perspective(800px) rotateX(4deg) rotateY(8deg) translateY(0px); }
          50% { transform: perspective(800px) rotateX(2deg) rotateY(12deg) translateY(-14px); }
          100% { transform: perspective(800px) rotateX(6deg) rotateY(6deg) translateY(0px); }
        }
      `}</style>
    </>
  );
};

export default LandingPage3D;