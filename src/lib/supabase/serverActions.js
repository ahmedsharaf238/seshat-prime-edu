// src/lib/supabase/serverActions.js
'use server';

/**
 * 🛡️ SERVER-SIDE ACTIONS (ADMIN ONLY)
 * لا تقم أبداً باستيراد هذا الملف داخل مكونات العميل (Client Components)
 */

import { createClient } from '@supabase/supabase-js';
import { logSecurityEvent } from '../helpers/errorLogger'; // ✅ إضافة الاستيراد

// إنشاء عميل Supabase بصلاحيات المسؤول (Admin) لتجاوز قيود RLS عند الحاجة الماسة
const getAdminSupabase = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, // المفتاح السري - لا يجب أن يتواجد في المتصفح
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
};

// ============================================================
// 👤 إنشاء مشرف (بواسطة المعلم فقط)
// ============================================================
export const createSupervisor = async ({ 
  email, 
  fullName, 
  phone, 
  permissions = ['view_students', 'view_reports'], 
  createdBy, 
  returnPassword = false 
}) => {
  try {
    const supabaseAdmin = getAdminSupabase();

    // 1. التحقق من أن المنشئ هو معلم (من قاعدة البيانات مباشرة لضمان عدم التلاعب)
    const { data: creator, error: creatorError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', createdBy)
      .single();

    if (creatorError || creator?.role !== 'teacher') {
      throw new Error('UNAUTHORIZED: ONLY_TEACHERS_CAN_CREATE_SUPERVISORS');
    }

    // 2. إنشاء حساب المشرف بكلمة مرور مؤقتة عبر Auth Admin API
    const tempPassword = Math.random().toString(36).slice(-10) + 'A1@#';
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        role: 'supervisor',
        full_name: fullName,
        phone,
        permissions,
      },
    });

    if (authError) throw authError;
    const userId = authData.user.id;

    // 3. إنشاء البروفايل الخاص بالمشرف
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert([{
        id: userId,
        full_name: fullName,
        email,
        phone,
        role: 'supervisor',
        permissions,
        created_by: createdBy,
      }]);

    if (profileError) {
      // في حال فشل إنشاء البروفايل، يجب حذف حساب Auth لتجنب الحسابات اليتيمة
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error('PROFILE_CREATION_FAILED_ACCOUNT_ROLLED_BACK');
    }

    // ✅✅✅ ✅ هنا يتم تسجيل الحدث الأمني ✅✅✅
    await logSecurityEvent({
      status: 'SUPERVISOR_CREATED',
      userId: userId,
      details: `Supervisor ${fullName} (${email}) created by teacher ID: ${createdBy}`,
    });

    return {
      success: true,
      userId,
      ...(returnPassword && { tempPassword }),
    };

  } catch (error) {
    console.error('[Admin Action Error] createSupervisor:', error.message);
    throw new Error(error.message);
  }
};