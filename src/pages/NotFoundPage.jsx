// src/pages/NotFoundPage.jsx

import React from 'react';
import { Link } from 'react-router-dom';

const NotFoundPage = () => {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.code}>404</h1>
        <h2 style={styles.title}>الصفحة غير موجودة</h2>
        <p style={styles.description}>
          عذراً، الصفحة التي تبحث عنها غير متوفرة أو تم نقلها.
        </p>
        <Link to="/dashboard" style={styles.button}>
          العودة إلى لوحة التحكم
        </Link>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    background: '#0f0f12',
    color: '#ffffff',
    fontFamily: 'system-ui, sans-serif',
  },
  content: {
    textAlign: 'center',
    padding: '40px',
  },
  code: {
    fontSize: '8rem',
    margin: 0,
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  title: {
    fontSize: '2rem',
    color: '#a0a0ab',
  },
  description: {
    color: '#6b6b7b',
    marginBottom: '30px',
  },
  button: {
    display: 'inline-block',
    padding: '12px 30px',
    background: '#6366f1',
    color: '#ffffff',
    textDecoration: 'none',
    borderRadius: '8px',
    fontWeight: 'bold',
    transition: 'all 0.3s',
  },
};

export default NotFoundPage;