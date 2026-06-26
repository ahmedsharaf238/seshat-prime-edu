// src/App.jsx (نسخة بسيطة جداً)
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage3D from './pages/LandingPage3D';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage3D />} />
        <Route path="/login" element={<LandingPage3D />} />
        <Route path="/register" element={<div>Register Page</div>} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
        <Route path="*" element={<div>404 Not Found</div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;