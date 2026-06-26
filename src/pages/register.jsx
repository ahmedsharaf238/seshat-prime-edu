// src/app/register/page.jsx
'use client';

import { useState } from 'react';
import { registerStudent } from '@/lib/supabase/authActions';
import { getRateLimitStatus } from '@/lib/helpers/rateLimiter';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [remainingAttempts, setRemainingAttempts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // جلب حالة المحاولات المتبقية عند تغيير البريد
  const handleEmailChange = async (e) => {
    const newEmail = e.target.value;
    setEmail(newEmail);

    if (newEmail.includes('@')) {
      const status = await getRateLimitStatus(newEmail, 'registration');
      if (status) {
        setRemainingAttempts(status.remaining);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await registerStudent({
        email,
        password: '...',
        fullName: '...',
        phone: '...',
        gradeLevel: 'G10',
        ipAddress: '...', // يمكنك الحصول عليها من الـ request
        userAgent: navigator.userAgent,
      });

      // عرض رسالة نجاح
      alert('تم التسجيل بنجاح!');
    } catch (error) {
      if (error.code === 'RATE_LIMIT_EXCEEDED') {
        setError(`⏳ لقد تجاوزت الحد المسموح. حاول مرة أخرى بعد ${new Date(error.details.resetTime).toLocaleString()}`);
      } else {
        setError(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={handleEmailChange}
        placeholder="البريد الإلكتروني"
        required
      />
      {remainingAttempts !== null && (
        <p>المحاولات المتبقية: {remainingAttempts}</p>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? 'جاري التسجيل...' : 'تسجيل'}
      </button>
    </form>
  );
}