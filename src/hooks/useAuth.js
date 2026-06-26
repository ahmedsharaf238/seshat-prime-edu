// src/hooks/useAuth.js

import { useEffect, useState, useContext, createContext, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase/supabaseClient';
import { performanceMonitor } from '../lib/helpers/performanceMonitor';
import { securityAudit } from '../lib/security/auditLog';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);

  // 🛡️ المراجع المتزامنة لحماية الذاكرة والسباق الشبكي
  const fetchAbortController = useRef(null);
  const lastFetchedUserId = useRef(null);
  const cachedProfileRef = useRef(null); // حل مشكلة الـ Asynchronous State Closure
  const isMounted = useRef(false);

  // ------------------- دالة جلب البروفايل الفولاذية -------------------
  const fetchProfile = useCallback(async (userId, signal = null) => {
    if (!userId) return null;
    
    // 🎯 Guard حديدي متزامن تماماً باستخدام الـ Ref لمنع الـ Double Fetch نهائياً
    if (lastFetchedUserId.current === userId && cachedProfileRef.current) {
      return cachedProfileRef.current;
    }
    lastFetchedUserId.current = userId;

    // إلغاء أي طلب شبكة معلق ومفتوح حالياً لنفس المكون
    if (fetchAbortController.current) {
      fetchAbortController.current.abort();
    }

    const controller = new AbortController();
    fetchAbortController.current = controller;
    const effectiveSignal = signal || controller.signal;

    try {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
        .abortSignal(effectiveSignal);

      if (profileError) throw profileError;
      
      // تحديث الـ Ref فوراً بشكل متزامن قبل تحديث الـ State
      cachedProfileRef.current = data;
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('🔄 [Auth] تم إلغاء جلب البروفايل المكرر بأمان.');
        return null;
      }
      console.error('❌ [Auth Hook] خطأ أثناء جلب بيانات البروفايل:', err);
      setError(err.message);
      return null;
    } finally {
      if (fetchAbortController.current === controller) {
        fetchAbortController.current = null;
      }
    }
  }, []); // ⚡ تم إزالة الـ profile من هنا لكسر الـ Circular Dependency نهائياً

  // ------------------- إدارة الجلسة والـ Listeners -------------------
  useEffect(() => {
    let mounted = true;
    isMounted.current = true;
    let authSubscription = null;

    const initializeAuth = async () => {
      try {
        performanceMonitor.start('auth-init');

        // 1️⃣ استرداد الحالة الأولية فوراً لسرعة التحميل الإستراتيجية
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (session?.user && mounted) {
          setUser(session.user);
          const initialProfile = await fetchProfile(session.user.id);
          if (mounted && initialProfile) {
            setProfile(initialProfile);
          }
        } else {
          setUser(null);
          setProfile(null);
          cachedProfileRef.current = null;
        }
        
        if (mounted) {
          setLoading(false);
          setInitialized(true);
        }

        // 2️⃣ الاستماع للتغيرات اللاحقة والتعامل مع الأحداث الذكية
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, newSession) => {
            if (!mounted) return;
            console.log(`🔐 [Auth Event]: ${event}`);

            if (event === 'SIGNED_OUT') {
              setUser(null);
              setProfile(null);
              cachedProfileRef.current = null;
              lastFetchedUserId.current = null;
              setLoading(false);
              return;
            }

            if (newSession?.user) {
              setUser(newSession.user);

              // 🛡️ التعامل الآمن مع تحديث التوكن دون الخروج المبكر الكاسر للـ Loading
              if (event === 'TOKEN_REFRESHED') {
                setLoading(false);
                return;
              }

              // في حالات SIGNED_IN أو USER_UPDATED
              const updatedProfile = await fetchProfile(newSession.user.id);
              if (mounted && updatedProfile) {
                setProfile(updatedProfile);
              }
              setLoading(false);
            } else {
              setUser(null);
              setProfile(null);
              cachedProfileRef.current = null;
              lastFetchedUserId.current = null;
              setLoading(false);
            }
          }
        );

        authSubscription = subscription;
        performanceMonitor.end('auth-init');

      } catch (err) {
        console.error('❌ [Auth Init Critical Error]:', err);
        if (mounted) {
          setError(err.message);
          setLoading(false);
          setInitialized(true);
        }
      }
    };

    initializeAuth();

    // ------------------- تنظيف المكون (Cleanup) -------------------
    return () => {
      mounted = false;
      isMounted.current = false;
      
      if (fetchAbortController.current) {
        fetchAbortController.current.abort();
        fetchAbortController.current = null;
      }
      
      if (authSubscription) {
        authSubscription.unsubscribe();
        console.log('🗑️ [Auth Listener] تم إنهاء اشتراك الجلسة وتنظيف الذاكرة.');
      }
    };
  }, [fetchProfile]); // ⚡ دالة fetchProfile الآن مستقرة وعمرها ما هتتغير، الـ useEffect هيشتغل مرة واحدة فقط!

  // ------------------- تسجيل الخروج الآمن -------------------
  const signOut = useCallback(async () => {
    try {
      setLoading(true);
      
      if (fetchAbortController.current) {
        fetchAbortController.current.abort();
        fetchAbortController.current = null;
      }

      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      cachedProfileRef.current = null;
      lastFetchedUserId.current = null;
      setError(null);
      
      try {
        await securityAudit.logEvent('USER_LOGOUT', { method: 'manual' });
      } catch (auditError) {
        console.warn('⚠️ [Security] فشل تسجيل حدث الخروج:', auditError);
      }
    } catch (err) {
      console.error('❌ [Auth] خطأ أثناء تسجيل الخروج:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ------------------- الـ Memoized Value المصدرة -------------------
  const value = useMemo(() => ({
    user,
    profile,
    loading: loading || !initialized,
    error,
    signOut,
    isAuthenticated: !!user,
    role: profile?.role || null,
    fullName: profile?.full_name || user?.user_metadata?.full_name || null,
  }), [user, profile, loading, initialized, error, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default useAuth;