// src/hooks/useRole.js
/**
 * 🔐 useRole Hook - نظام الصلاحيات الذكي (V 2050)
 * 
 * 🎯 الوظيفة: إدارة صلاحيات المستخدم بناءً على:
 * - الدور (role) من قاعدة البيانات.
 * - الصلاحيات الفردية (permissions JSONB) من جدول profiles.
 * - السياق (مثل grade_level) لعزل البيانات.
 * 
 * 🛡️ الأمان:
 * - جميع الصلاحيات تُجلب من الخادم (تجنب التلاعب من الواجهة).
 * - يتم التحقق من الصلاحيات على مستوى RLS في الخادم (الاعتماد الأساسي).
 * - هذا الـ Hook يستخدم فقط للـ UI (إخفاء/إظهار الأزرار)، وليس للأمان الفعلي.
 * - يتم تسجيل أي محاولة وصول مرفوضة في سجلات التدقيق (Audit Log).
 * 
 * ⚙️ التكلفة الصفرية: يتم جلب الصلاحيات مرة واحدة عند تسجيل الدخول،
 *    وتخزينها في React Context لتجنب الطلبات المتكررة.
 * 
 * 🧠 جاهز لـ 2050: يدعم الصلاحيات الديناميكية (من قاعدة البيانات)،
 *    والسياق (Context-Aware)، ويمكن توسيعه لدعم AI-based Permissions مستقبلاً.
 */

import { useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { securityAudit } from '../lib/security/auditLog';

// ============================================================
// 📥 دالة مساعدة لجلب الصلاحيات من قاعدة البيانات (تُستدعى من `useAuth`)
// يمكن تخزينها في Context لتجنب تكرار الطلب.
// ============================================================
const fetchPermissionsFromDB = async (userId) => {
  // هذه الدالة تُستدعى من `useAuth` عند تحميل البروفايل،
  // وتُخزن النتيجة في `profile.permissions`.
  // سنفترض أن `profile.permissions` جاهزة بالفعل.
  return null; // يتم التعامل معها في الـ Hook أدناه.
};

// ============================================================
// 📊 الخرائط الثابتة (تُستخدم كـ "Fallback" في حالة عدم وجود بيانات من الخادم)
// ============================================================
const DEFAULT_ROLE_PERMISSIONS = {
  student: ['view_content', 'take_exam', 'view_progress'],
  parent: ['view_children', 'view_reports'],
  teacher: ['all'], // ⚠️ يفضل استبدالها بصلاحيات محددة من الخادم
  supervisor: ['view_analytics', 'modify_students', 'queue_requests'],
  guest: [],
};

// تعريف الإجراءات (تُستخدم أيضاً في الخادم، لكن هنا للـ UI فقط)
const ACTION_CONFIG = {
  'view_exam': {
    allowedRoles: ['student', 'parent', 'teacher', 'supervisor'],
    requiresApproval: [],
    requiresContext: false,
  },
  'edit_content': {
    allowedRoles: ['teacher', 'supervisor'],
    requiresApproval: ['supervisor'],
    requiresContext: true, // يحتاج إلى grade_level
  },
  'delete_user': {
    allowedRoles: ['teacher'],
    requiresApproval: [],
    requiresContext: true,
  },
  'modify_profile': {
    allowedRoles: ['student', 'parent', 'teacher', 'supervisor'],
    requiresApproval: [],
    requiresContext: false,
  },
};

// ============================================================
// 🔐 الـ Hook الرئيسي
// ============================================================
export const useRole = () => {
  const { user, profile, loading } = useAuth();

  // استخراج الصلاحيات من البروفايل (من عمود `permissions` في قاعدة البيانات)
  // أو استخدام الصلاحيات الافتراضية حسب الدور
  const getPermissions = useCallback(() => {
    if (!profile) return DEFAULT_ROLE_PERMISSIONS.guest;
    
    // 1️⃣ إذا كان هناك صلاحيات مخصصة في قاعدة البيانات، استخدمها
    if (profile.permissions && Array.isArray(profile.permissions) && profile.permissions.length > 0) {
      return profile.permissions;
    }
    
    // 2️⃣ وإلا استخدم الصلاحيات الافتراضية حسب الدور
    const role = profile.role || 'guest';
    return DEFAULT_ROLE_PERMISSIONS[role] || [];
  }, [profile]);

  // التحقق من الصلاحية العامة (من القائمة المخصصة أو الافتراضية)
  const hasPermission = useCallback((permission) => {
    const permissions = getPermissions();
    return permissions.includes(permission) || permissions.includes('all');
  }, [getPermissions]);

  // التحقق من إمكانية تنفيذ إجراء (مع مراعاة السياق)
  const can = useCallback((action, context = {}) => {
    // إذا كان المستخدم معلم ويملك صلاحية 'all'، نسمح فوراً (مع تسجيل)
    if (profile?.role === 'teacher' && hasPermission('all')) {
      // تسجيل وصول المعلم الكامل (للتدقيق)
      securityAudit.logEvent('TEACHER_ACCESS', { action, context, userId: user?.id });
      return true;
    }

    const config = ACTION_CONFIG[action];
    if (!config) return false;

    // التحقق من الدور المسموح به
    const roleAllowed = config.allowedRoles.includes(profile?.role || 'guest');
    if (!roleAllowed) {
      // تسجيل محاولة وصول مرفوضة
      securityAudit.logEvent('ACCESS_DENIED', { 
        action, 
        role: profile?.role, 
        userId: user?.id, 
        context 
      });
      return false;
    }

    // التحقق من السياق (مثل grade_level)
    if (config.requiresContext) {
      const userGrade = profile?.grade_level;
      if (context.grade_level && userGrade !== context.grade_level) {
        securityAudit.logEvent('CONTEXT_ACCESS_DENIED', { 
          action, 
          requiredGrade: context.grade_level, 
          userGrade, 
          userId: user?.id 
        });
        return false;
      }
    }

    return true;
  }, [profile, user, hasPermission]);

  // التحقق مما إذا كان الإجراء يحتاج إلى موافقة
  const isApprovalRequired = useCallback((action) => {
    if (profile?.role === 'teacher') return false; // المعلم لا يحتاج موافقة
    const config = ACTION_CONFIG[action];
    return config?.requiresApproval?.includes(profile?.role) || false;
  }, [profile]);

  // دالة موحدة للتحقق من الصلاحية الكاملة (مع تسجيل الرفض)
  const isAuthorized = useCallback((action, context = {}) => {
    const authorized = can(action, context);
    if (!authorized) {
      // يمكن إضافة Toast أو رسالة للمستخدم هنا
      console.warn(`⛔ [Authorization] Action "${action}" not allowed for user ${user?.id}`);
    }
    return authorized;
  }, [can, user]);

  return useMemo(() => {
    const role = profile?.role || 'guest';
    const permissions = getPermissions();

    return {
      role,
      permissions,
      isStudent: role === 'student',
      isParent: role === 'parent',
      isTeacher: role === 'teacher',
      isSupervisor: role === 'supervisor',
      isGuest: role === 'guest',
      isAuthenticated: role !== 'guest',
      isLoading: loading,
      
      // الدوال الأساسية
      hasPermission,
      can,
      isApprovalRequired,
      isAuthorized,
      
      // دالة مساعدة للتحقق من دور محدد
      hasRole: (targetRole) => role === targetRole,
    };
  }, [profile, loading, getPermissions, hasPermission, can, isApprovalRequired, isAuthorized]);
};

export default useRole;