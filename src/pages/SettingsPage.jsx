// src/pages/SettingsPage.jsx

import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase/supabaseClient';

const SettingsPage = () => {
  const { user, profile } = useAuth();
  const [settings, setSettings] = useState({
    theme: 'dark',
    language: 'ar',
    notifications: true,
    twoFactor: false,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // تحميل الإعدادات من localStorage أو قاعدة البيانات
    const saved = localStorage.getItem('seshat-settings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        console.warn('Failed to parse settings');
      }
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // حفظ في localStorage
      localStorage.setItem('seshat-settings', JSON.stringify(settings));
      
      // حفظ في قاعدة البيانات (إذا كان المستخدم مسجلاً)
      if (user) {
        await supabase
          .from('profiles')
          .update({ settings: settings })
          .eq('id', user.id);
      }
      
      // تطبيق الثيم
      document.documentElement.setAttribute('data-theme', settings.theme);
      
      setMessage('✅ تم حفظ الإعدادات بنجاح');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('❌ فشل حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>⚙️ الإعدادات</h1>
      
      <div style={styles.card}>
        <div style={styles.settingItem}>
          <label style={styles.label}>المظهر</label>
          <select 
            value={settings.theme} 
            onChange={(e) => handleChange('theme', e.target.value)}
            style={styles.select}
          >
            <option value="dark">🌙 داكن</option>
            <option value="light">☀️ فاتح</option>
            <option value="system">🔄 تلقائي (حسب النظام)</option>
          </select>
        </div>

        <div style={styles.settingItem}>
          <label style={styles.label}>اللغة</label>
          <select 
            value={settings.language} 
            onChange={(e) => handleChange('language', e.target.value)}
            style={styles.select}
          >
            <option value="ar">🇸🇦 العربية</option>
            <option value="en">🇬🇧 English</option>
          </select>
        </div>

        <div style={styles.settingItem}>
          <label style={styles.label}>الإشعارات</label>
          <input 
            type="checkbox" 
            checked={settings.notifications} 
            onChange={(e) => handleChange('notifications', e.target.checked)}
            style={styles.checkbox}
          />
          <span style={styles.checkboxLabel}>تفعيل الإشعارات</span>
        </div>

        <div style={styles.settingItem}>
          <label style={styles.label}>المصادقة الثنائية</label>
          <input 
            type="checkbox" 
            checked={settings.twoFactor} 
            onChange={(e) => handleChange('twoFactor', e.target.checked)}
            style={styles.checkbox}
          />
          <span style={styles.checkboxLabel}>تفعيل المصادقة الثنائية (2FA)</span>
        </div>

        <button 
          onClick={handleSave} 
          disabled={saving}
          style={styles.button}
        >
          {saving ? 'جاري الحفظ...' : '💾 حفظ الإعدادات'}
        </button>

        {message && <p style={styles.message}>{message}</p>}
      </div>

      <div style={styles.securitySection}>
        <h3>🔐 الأمان</h3>
        <p>آخر تسجيل دخول: {new Date().toLocaleString('ar-EG')}</p>
        <p>الأجهزة النشطة: 2</p>
        <button style={styles.dangerButton}>تسجيل الخروج من جميع الأجهزة</button>
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '800px',
    margin: '40px auto',
    padding: '20px',
    color: '#ffffff',
  },
  title: {
    fontSize: '2rem',
    marginBottom: '30px',
    color: '#6366f1',
  },
  card: {
    background: '#1a1a24',
    padding: '30px',
    borderRadius: '16px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
  },
  settingItem: {
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    flexWrap: 'wrap',
  },
  label: {
    minWidth: '120px',
    fontWeight: 'bold',
    color: '#a0a0ab',
  },
  select: {
    padding: '10px 15px',
    borderRadius: '8px',
    background: '#0f0f12',
    color: '#ffffff',
    border: '1px solid #2a2a35',
    flex: 1,
    minWidth: '200px',
  },
  checkbox: {
    width: '20px',
    height: '20px',
    accentColor: '#6366f1',
  },
  checkboxLabel: {
    color: '#a0a0ab',
  },
  button: {
    padding: '12px 30px',
    background: '#6366f1',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.3s',
    marginTop: '10px',
  },
  message: {
    marginTop: '15px',
    color: '#22c55e',
    fontSize: '14px',
  },
  securitySection: {
    marginTop: '30px',
    padding: '20px',
    background: '#1a1a24',
    borderRadius: '16px',
  },
  dangerButton: {
    padding: '10px 20px',
    background: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    marginTop: '10px',
  },
};

export default SettingsPage;