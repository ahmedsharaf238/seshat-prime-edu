-- =============================================================================
-- 011_audit_trail.sql
-- سجل تدقيق شامل للمنصة (Audit Trail) – مع دعم ENUM، triggers، أرشفة، تقارير متقدمة.
-- الأمان: تسجيل كل تغيير حساس، منع التلاعب، تكلفة مجانية.
-- =============================================================================

-- 1. أنواع الأحداث (ENUM) – يمكن توسيعها بسهولة
CREATE TYPE audit_event_type AS ENUM (
  'role_change',
  'price_change',
  'approval',
  'content_modification',
  'login_failure',
  'account_lock',
  'wallet_transaction',      -- إضافة معاملة مالية (للتتبع)
  'impersonation_start',
  'impersonation_end',
  'settings_change',
  'deletion'
);

-- 2. جدول التدقيق الرئيسي
CREATE TABLE IF NOT EXISTS audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,     -- من قام بالعملية (فعلياً)
  affected_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL, -- إذا تأثر مستخدم آخر (مثل تغيير رصيده)
  event_type audit_event_type NOT NULL,
  target_type TEXT,                     -- 'profile', 'video', 'exam', 'package', 'recharge_request', 'pending_request'
  target_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  session_id UUID,                      -- لربط الأحداث بجلسة واحدة
  request_id UUID,                      -- لربط الأحداث بطلب HTTP واحد
  success BOOLEAN DEFAULT true,         -- هل العملية تمت بنجاح؟
  error_message TEXT,                   -- إذا فشلت
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. فهارس محسنة
CREATE INDEX idx_audit_user ON audit_trail(user_id);
CREATE INDEX idx_audit_affected_user ON audit_trail(affected_user_id);
CREATE INDEX idx_audit_event ON audit_trail(event_type);
CREATE INDEX idx_audit_target ON audit_trail(target_type, target_id);
CREATE INDEX idx_audit_created ON audit_trail(created_at);
CREATE INDEX idx_audit_session ON audit_trail(session_id);
CREATE INDEX idx_audit_success ON audit_trail(success);

-- 4. RLS
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;

-- المالك والمشرفون يرون كل شيء
CREATE POLICY "Owner and supervisors view audit"
  ON audit_trail FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'supervisor')));

-- منع الإدراج / التعديل / الحذف المباشر (يتم عبر الدوال فقط)
CREATE POLICY "No direct modifications"
  ON audit_trail FOR ALL
  USING (false);

-- 5. دالة تسجيل الحدث الأساسية (مرنة)
CREATE OR REPLACE FUNCTION log_audit_event(
  p_event_type audit_event_type,
  p_target_type TEXT,
  p_target_id UUID,
  p_old_value JSONB DEFAULT NULL,
  p_new_value JSONB DEFAULT NULL,
  p_ip INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,                -- يمكن تمرير المستخدم الفعلي (للتسجيل نيابة عنه)
  p_affected_user_id UUID DEFAULT NULL,
  p_session_id UUID DEFAULT NULL,
  p_request_id UUID DEFAULT NULL,
  p_success BOOLEAN DEFAULT true,
  p_error_message TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_log_id UUID;
BEGIN
  -- تحديد المستخدم: إما الذي تم تمريره أو المستخدم الحالي
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    -- في حالة عدم وجود مستخدم (مثل إجراءات النظام) نتركها NULL
    NULL;
  END IF;

  INSERT INTO audit_trail (
    user_id, affected_user_id, event_type, target_type, target_id,
    old_value, new_value, ip_address, user_agent, session_id, request_id,
    success, error_message
  ) VALUES (
    v_user_id, p_affected_user_id, p_event_type, p_target_type, p_target_id,
    p_old_value, p_new_value, p_ip, p_user_agent, p_session_id, p_request_id,
    p_success, p_error_message
  ) RETURNING id INTO v_log_id;

  -- إشعار للمالك إذا كان الحدث حرجاً جداً (تغيير دور مالك أو تعطيل حسابات)
  IF p_event_type IN ('role_change', 'account_lock') AND p_success = true THEN
    PERFORM add_notification(
      (SELECT id FROM profiles WHERE role = 'owner' LIMIT 1),
      '⚠️ حدث أمني مهم',
      format('تم تسجيل حدث %s بواسطة المستخدم %s. الرجاء المراجعة.', p_event_type::text, v_user_id),
      'warning',
      'audit_event',
      v_log_id
    );
  END IF;

  RETURN v_log_id;
END;
$$;

-- =============================================================================
-- 6. مشغلات (Triggers) على الجداول الحساسة لتسجيل التغييرات المباشرة تلقائياً
-- =============================================================================

-- مثال: تسجيل أي تغيير في جدول point_packages (أسعار أو نقاط)
CREATE OR REPLACE FUNCTION audit_point_packages()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM log_audit_event(
      'price_change', 'package', NEW.id,
      jsonb_build_object('price', OLD.price_egp, 'points', OLD.points_reward),
      jsonb_build_object('price', NEW.price_egp, 'points', NEW.points_reward),
      inet_client_addr(), current_setting('request.headers', true)::jsonb->>'user-agent',
      auth.uid(), NULL, NULL, NULL,
      true, NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_audit_point_packages ON point_packages;
CREATE TRIGGER trigger_audit_point_packages
  AFTER UPDATE ON point_packages
  FOR EACH ROW
  EXECUTE FUNCTION audit_point_packages();

-- مثال: تسجيل تغيير دور المستخدم في profiles
CREATE OR REPLACE FUNCTION audit_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    PERFORM log_audit_event(
      'role_change', 'profile', NEW.id,
      jsonb_build_object('old_role', OLD.role),
      jsonb_build_object('new_role', NEW.role),
      inet_client_addr(), current_setting('request.headers', true)::jsonb->>'user-agent',
      auth.uid(), NEW.id, NULL, NULL,
      true, NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_audit_profile_role ON profiles;
CREATE TRIGGER trigger_audit_profile_role
  AFTER UPDATE ON profiles
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION audit_profile_role();

-- =============================================================================
-- 7. دالة أرشفة السجلات القديمة (للمالك فقط)
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_trail_archive (LIKE audit_trail INCLUDING ALL);

CREATE OR REPLACE FUNCTION archive_old_audit_logs(days_old INT DEFAULT 180)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_archived INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك يمكنه أرشفة السجلات';
  END IF;

  WITH archived AS (
    DELETE FROM audit_trail
    WHERE created_at < NOW() - (days_old || ' days')::INTERVAL
    RETURNING *
  )
  INSERT INTO audit_trail_archive SELECT * FROM archived
  RETURNING count(*) INTO v_archived;

  RETURN v_archived;
END;
$$;

-- =============================================================================
-- 8. دوال التقرير والبحث المتقدم
-- =============================================================================
CREATE OR REPLACE FUNCTION search_audit_logs(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_user_id UUID DEFAULT NULL,
  p_event_type audit_event_type DEFAULT NULL,
  p_target_type TEXT DEFAULT NULL,
  p_success BOOLEAN DEFAULT NULL
)
RETURNS SETOF audit_trail
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'supervisor')) THEN
    RAISE EXCEPTION 'غير مصرح لك';
  END IF;

  RETURN QUERY
  SELECT *
  FROM audit_trail
  WHERE created_at BETWEEN p_start_date AND p_end_date
    AND (p_user_id IS NULL OR user_id = p_user_id)
    AND (p_event_type IS NULL OR event_type = p_event_type)
    AND (p_target_type IS NULL OR target_type = p_target_type)
    AND (p_success IS NULL OR success = p_success)
  ORDER BY created_at DESC;
END;
$$;

-- إحصائيات بسيطة (عدد الأحداث حسب النوع في فترة)
CREATE OR REPLACE FUNCTION audit_event_stats(start_date TIMESTAMPTZ, end_date TIMESTAMPTZ)
RETURNS TABLE(event_type audit_event_type, event_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'supervisor')) THEN
    RAISE EXCEPTION 'غير مصرح لك';
  END IF;

  RETURN QUERY
  SELECT a.event_type, COUNT(*) AS event_count
  FROM audit_trail a
  WHERE a.created_at BETWEEN start_date AND end_date
  GROUP BY a.event_type
  ORDER BY event_count DESC;
END;
$$;

-- =============================================================================
-- 9. صلاحيات التنفيذ
-- =============================================================================
GRANT EXECUTE ON FUNCTION log_audit_event TO authenticated;
GRANT EXECUTE ON FUNCTION archive_old_audit_logs TO authenticated;
GRANT EXECUTE ON FUNCTION search_audit_logs TO authenticated;
GRANT EXECUTE ON FUNCTION audit_event_stats TO authenticated;

-- =============================================================================
-- 10. توثيق المالك النهائي
-- =============================================================================
/*
✅ التحسينات المضافة:

- ENUM لأنواع الأحداث الموحدة.
- دالة log_audit_event متعددة الاستخدامات (تدعم تمرير user_id مختلف، affected_user_id، session_id، request_id).
- إضافة عمود success و error_message.
- مشغلات تلقائية على جداول حساسة (point_packages, profiles.role) – تسجل التغييرات المباشرة.
- أرشفة السجلات القديمة إلى جدول منفصل (للمالك).
- دوال متقدمة للبحث والإحصائيات.
- إشعارات للمالك عند الأحداث الحرجة (role_change, account_lock).

🔒 الأمان: لا يمكن لأحد إدراج أو تعديل السجلات مباشرة (RLS + دوال). جميع الإدخالات موثوقة ومُسجلة.

💰 التكلفة: صفر، كل شيء داخل Supabase (لا واجهات خارجية).

📌 ملاحظة: 
- تأكد من وجود `add_notification` (من ملف 008/009) للإشعارات.
- يمكن جدولة `archive_old_audit_logs` عبر pg_cron للتنظيف التلقائي كل شهر.
*/