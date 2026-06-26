// src/hooks/useMakerChecker.js

/**
 * 🛡️ useMakerChecker Hook - نظام الموافقة المزدوجة الكمّي (V 2050.QUANTUM-INFINITY)
 * 
 * 💎 التحسينات النهائية:
 * - 🧹 Strict Timer Cleanup: تنظيف إضافي للمؤقتات في useEffect.
 * - 🛡️ Explicit Authorization Check: رمي خطأ واضح عند عدم الصلاحية.
 * - 🔄 Auto Dismiss New Items: إلغاء إشعار الطلبات الجديدة عند العودة للصفحة الأولى.
 * - 📊 Safe Total Count: التعامل مع null في كل الحالات.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { useRole } from './useRole';
import { supabase } from '../lib/supabase/supabaseClient';
import { securityAudit } from '../lib/security/auditLog';
import { queueSupervisorModification, executeSupervisorModification } from '../lib/supabase/authActions';

const DEFAULT_OPTIONS = Object.freeze({
  retryCount: 2,
  retryDelay: 1000,
  timeout: 15000,
  cacheTTL: 60000,
  pageSize: 20,
  estimatedCountThreshold: 10000,
});

const ALLOWED_FIELDS = Object.freeze([
  'full_name',
  'phone',
  'grade_level',
  'parent_phone',
  'email',
]);

const isValidUUID = (id) => {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

export const useMakerChecker = (options = {}) => {
  const { user, profile } = useAuth();
  const { isTeacher, isSupervisor } = useRole();
  
  const {
    retryCount = DEFAULT_OPTIONS.retryCount,
    retryDelay = DEFAULT_OPTIONS.retryDelay,
    timeout = DEFAULT_OPTIONS.timeout,
    cacheTTL = DEFAULT_OPTIONS.cacheTTL,
    pageSize = DEFAULT_OPTIONS.pageSize,
    estimatedCountThreshold = DEFAULT_OPTIONS.estimatedCountThreshold,
  } = options;

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [totalCount, setTotalCount] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [newItemsAvailable, setNewItemsAvailable] = useState(false);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);
  const subscriptionRef = useRef(null);
  const cacheRef = useRef({});
  const currentPageRef = useRef(currentPage);
  const pendingInsertRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // 🧹 تنظيف إضافي للمؤقتات
      if (pendingInsertRef.current) {
        clearTimeout(pendingInsertRef.current);
        pendingInsertRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // ============================================================
  // 🔄 Realtime Subscription
  // ============================================================
  useEffect(() => {
    if (!isTeacher && !isSupervisor) return;

    const channel = supabase
      .channel('maker-checker-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'supervisor_requests' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setTotalCount(prev => (prev !== null ? prev + 1 : 1));
            
            // مسح كاش الصفحات التالية
            Object.keys(cacheRef.current).forEach(key => {
              if (parseInt(key) > 0) delete cacheRef.current[key];
            });

            if (pendingInsertRef.current) clearTimeout(pendingInsertRef.current);
            pendingInsertRef.current = setTimeout(() => {
              // ✅ التحقق من التثبيت قبل تحديث State
              if (!isMountedRef.current) return;
              
              if (currentPageRef.current === 0) {
                setRequests(prev => {
                  const newRequests = [payload.new, ...prev].slice(0, pageSize);
                  if (cacheRef.current[0]) cacheRef.current[0].data = newRequests;
                  return newRequests;
                });
                setNewItemsAvailable(false);
              } else {
                setNewItemsAvailable(true);
              }
            }, 150);
          } 
          else if (payload.eventType === 'UPDATE') {
            setRequests(prev => {
              const updated = prev.map(req => req.id === payload.new.id ? payload.new : req);
              if (cacheRef.current[currentPageRef.current]) {
                 cacheRef.current[currentPageRef.current].data = updated;
              }
              return updated;
            });
          } 
          else if (payload.eventType === 'DELETE') {
            setTotalCount(prev => (prev !== null ? Math.max(0, prev - 1) : 0));
            
            Object.keys(cacheRef.current).forEach(key => {
              if (parseInt(key) > currentPageRef.current) delete cacheRef.current[key];
            });

            setRequests(prev => {
              const filtered = prev.filter(req => req.id !== payload.old.id);
              if (cacheRef.current[currentPageRef.current]) {
                 cacheRef.current[currentPageRef.current].data = filtered;
              }
              return filtered;
            });
          }
        }
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      if (subscriptionRef.current) supabase.removeChannel(subscriptionRef.current);
      if (pendingInsertRef.current) {
        clearTimeout(pendingInsertRef.current);
        pendingInsertRef.current = null;
      }
    };
  }, [isTeacher, isSupervisor, pageSize]);

  // ============================================================
  // 🧹 إدارة الإلغاء العام
  // ============================================================
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // ============================================================
  // 📊 جلب الطلبات (مع تحقق الصلاحية وإلغاء الإشعار عند الصفحة الأولى)
  // ============================================================
  const fetchPendingRequests = useCallback(async (page = 0, forceRefresh = false) => {
    // 🛡️ التحقق الصريح من الصلاحية
    if (!isTeacher && !isSupervisor) {
      const msg = 'Unauthorized: Only teachers and supervisors can fetch requests';
      console.warn(msg);
      setError(msg);
      return [];
    }

    const now = Date.now();
    const pageCache = cacheRef.current[page];

    if (!forceRefresh && pageCache && (now - pageCache.timestamp) < cacheTTL) {
      setRequests(pageCache.data);
      setCurrentPage(page);
      // ✅ عند العودة للصفحة الأولى، إلغاء الإشعار
      if (page === 0) setNewItemsAvailable(false);
      return pageCache.data;
    }

    setLoading(true);
    setError(null);

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const countStrategy = (totalCount === null || totalCount > estimatedCountThreshold) ? 'estimated' : 'exact';

      const { data, error: fetchError, count } = await supabase
        .from('supervisor_requests')
        .select('*', { count: countStrategy })
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .range(from, to)
        .abortSignal(controller.signal);

      clearTimeout(timeoutId);
      if (fetchError) throw fetchError;

      if (!isMountedRef.current) return [];

      const results = data || [];
      setRequests(results);
      setTotalCount(count || 0);
      setCurrentPage(page);
      // ✅ عند جلب الصفحة الأولى، إلغاء الإشعار
      if (page === 0) setNewItemsAvailable(false);

      cacheRef.current[page] = { data: results, timestamp: Date.now() };
      return results;

    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'CancelError') return [];
      if (isMountedRef.current) setError(err.message);
      return [];
    } finally {
      if (isMountedRef.current) setLoading(false);
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }, [isTeacher, isSupervisor, pageSize, cacheTTL, timeout, totalCount, estimatedCountThreshold]);

  // ============================================================
  // 📤 المشرف: تقديم طلب
  // ============================================================
  const createRequest = useCallback(async (targetUserId, field, newValue) => {
    if (!isSupervisor) throw new Error('Unauthorized: Only supervisors can create requests');
    if (!ALLOWED_FIELDS.includes(field)) throw new Error(`Invalid field: ${field}`);
    if (!isValidUUID(targetUserId)) throw new Error('Invalid target user ID');

    setLoading(true);
    setError(null);

    let attempt = 0;
    let lastError = null;

    while (attempt <= retryCount) {
      try {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const result = await queueSupervisorModification(
          user.id, targetUserId, field, newValue, { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        // Fire-and-Forget
        securityAudit.logEvent('MAKER_REQUEST_CREATED', {
          supervisorId: user.id, targetUserId, field, requestId: result.id, timestamp: new Date().toISOString()
        }).catch(console.error);

        if (isMountedRef.current) setLoading(false);
        return result;

      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Request cancelled');
        lastError = err;
        attempt++;
        if (attempt <= retryCount) await new Promise(res => setTimeout(res, retryDelay * attempt));
      }
    }

    if (isMountedRef.current) {
      setLoading(false);
      setError(lastError?.message || 'Failed to create request');
    }
    throw lastError || new Error('Failed to create request');
  }, [isSupervisor, user, retryCount, retryDelay, timeout]);

  // ============================================================
  // 📥 المعلم: الموافقة / الرفض (Atomic Rollback)
  // ============================================================
  const reviewRequest = useCallback(async (requestId, action) => {
    if (!isTeacher) throw new Error('Unauthorized: Only teachers can review requests');
    if (!isValidUUID(requestId)) throw new Error('Invalid request ID');
    if (!['approve', 'reject'].includes(action)) throw new Error('Action must be approve/reject');

    let itemToRollback = null;

    // Optimistic update
    setRequests(prev => {
      itemToRollback = prev.find(req => req.id === requestId);
      return prev.filter(req => req.id !== requestId);
    });
    setTotalCount(prev => (prev !== null ? Math.max(0, prev - 1) : 0));

    setLoading(true);
    setError(null);

    let attempt = 0;
    let lastError = null;

    while (attempt <= retryCount) {
      try {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const result = await executeSupervisorModification(
          user.id, requestId, action, { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        securityAudit.logEvent('MAKER_REQUEST_REVIEWED', {
          teacherId: user.id, requestId, action, timestamp: new Date().toISOString()
        }).catch(console.error);

        if (cacheRef.current[currentPageRef.current]) {
          cacheRef.current[currentPageRef.current].data = cacheRef.current[currentPageRef.current].data.filter(
            req => req.id !== requestId
          );
        }

        if (isMountedRef.current) setLoading(false);
        return result;

      } catch (err) {
        if (err.name === 'AbortError') {
          lastError = err;
          break;
        }
        lastError = err;
        attempt++;
        if (attempt <= retryCount) await new Promise(res => setTimeout(res, retryDelay * attempt));
      }
    }

    // Rollback
    if (itemToRollback && isMountedRef.current) {
      setRequests(prev => {
        const restored = [itemToRollback, ...prev].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return restored;
      });
      setTotalCount(prev => (prev !== null ? prev + 1 : 1));
      setLoading(false);
      setError(lastError?.message || 'Failed to review request');
    }
    
    throw lastError || new Error('Failed to review request');
  }, [isTeacher, user, retryCount, retryDelay, timeout]);

  // ============================================================
  // 🔄 دوال مساعدة
  // ============================================================
  const refreshRequests = useCallback(() => fetchPendingRequests(currentPage, true), [fetchPendingRequests, currentPage]);
  const goToPage = useCallback((page) => page >= 0 && fetchPendingRequests(page), [fetchPendingRequests]);
  const clearError = useCallback(() => setError(null), []);
  const clearNewItemsNotification = useCallback(() => setNewItemsAvailable(false), []);

  return {
    createRequest,
    reviewRequest,
    fetchPendingRequests,
    refreshRequests,
    clearError,
    goToPage,
    clearNewItemsNotification,
    requests,
    loading,
    error,
    totalCount: totalCount || 0, // ✅ تأمين العرض
    currentPage,
    pageSize,
    newItemsAvailable,
    canCreateRequest: isSupervisor,
    canReviewRequest: isTeacher,
    isMaker: isSupervisor,
    isChecker: isTeacher,
  };
};

export default useMakerChecker;