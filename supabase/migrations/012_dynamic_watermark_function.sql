-- ============================================================
-- 014_dynamic_watermark_function.sql
-- دالة تجلب بيانات المستخدم الحالي (اسمه، رقمه، ورقم ولي الأمر إن وجد)
-- لاستخدامها في عرض علامة مائية ديناميكية على الفيديو
-- ============================================================

-- دالة ترجع بيانات المستخدم الحالي + رقم ولي الأمر إذا كان المستخدم طالباً وله ولي أمر
CREATE OR REPLACE FUNCTION get_current_user_watermark_data()
RETURNS TABLE(
  user_name TEXT,
  user_phone TEXT,
  parent_phone TEXT
) AS $$
DECLARE
  v_user_id UUID;
  v_user_role TEXT;
  v_user_name TEXT;
  v_user_phone TEXT;
  v_parent_phone TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  -- جلب اسم المستخدم ودوره ورقم هاتفه
  SELECT full_name, role, phone INTO v_user_name, v_user_role, v_user_phone
  FROM profiles WHERE id = v_user_id;

  -- إذا كان المستخدم طالباً، نحاول إيجاد رقم ولي أمره من جدول parent_watermarks
  IF v_user_role = 'student' THEN
    SELECT parent.phone INTO v_parent_phone
    FROM parent_watermarks pw
    JOIN profiles parent ON pw.parent_id = parent.id
    WHERE pw.child_id = v_user_id
    LIMIT 1;
  END IF;

  RETURN QUERY SELECT v_user_name, v_user_phone, v_parent_phone;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- منح حق التنفيذ للمستخدمين المصادقين
GRANT EXECUTE ON FUNCTION get_current_user_watermark_data() TO authenticated;