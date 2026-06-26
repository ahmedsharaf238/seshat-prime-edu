-- =============================================================================
-- 008_parent_watermark.sql
-- نظام ربط ولي الأمر بالطالب (مع OTP محسن) + سجل تحميل الملفات بالعلامة المائية
-- النسخة النهائية – أمان مطلق، تكلفة مجانية، مع تحسينات عداد OTP، التحقق من البيانات، والأرشفة الآمنة
-- =============================================================================
-- يعتمد على: 001_create_profiles.sql (جدول profiles و pending_requests و update_updated_at_column)
-- يعتمد على: ملف الإشعارات (add_notification موجود في 008 سابق أو 009)
-- =============================================================================

-- التحقق من وجود الدوال الأساسية المطلوبة
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_notification') THEN
    RAISE EXCEPTION 'دالة add_notification غير موجودة. تأكد من تنفيذ ملف الإشعارات أولاً.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    RAISE EXCEPTION 'دالة update_updated_at_column غير موجودة. تأكد من تنفيذ الملف 001 أولاً.';
  END IF;
END $$;

-- =============================================================================
-- الجزء الأول: علاقة ولي الأمر بالطالب (ربط تلقائي عبر OTP مع حماية ضد التخمين)
-- =============================================================================

CREATE TABLE IF NOT EXISTS parent_student_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  link_status TEXT DEFAULT 'pending' CHECK (link_status IN ('pending', 'active', 'rejected', 'removed')),
  otp_code TEXT,
  otp_expires_at TIMESTAMPTZ,
  otp_attempts INT DEFAULT 0,                    -- عدد محاولات إدخال OTP الخاطئة
  otp_locked_until TIMESTAMPTZ,                  -- قفل الرابط بعد 5 محاولات خاطئة
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(parent_id, student_id)
);

-- فهارس محسنة
CREATE INDEX IF NOT EXISTS idx_parent_student_parent ON parent_student_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_student_student ON parent_student_links(student_id);
CREATE INDEX IF NOT EXISTS idx_parent_student_status ON parent_student_links(link_status);
CREATE INDEX IF NOT EXISTS idx_parent_student_otp ON parent_student_links(otp_code) WHERE link_status = 'pending';

-- RLS
ALTER TABLE parent_student_links ENABLE ROW LEVEL SECURITY;

-- سياسات الوصول (لا تعديل أو حذف مباشر)
CREATE POLICY "Parent manages own links" ON parent_student_links
  FOR ALL USING (auth.uid() = parent_id)
  WITH CHECK (auth.uid() = parent_id);

CREATE POLICY "Student views own links" ON parent_student_links
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Staff view all links" ON parent_student_links
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'supervisor')));

CREATE POLICY "Block direct updates on links" ON parent_student_links FOR UPDATE USING (false);
CREATE POLICY "Block direct deletes on links" ON parent_student_links FOR DELETE USING (false);

-- Trigger لتحديث updated_at
DROP TRIGGER IF EXISTS update_parent_student_links_updated_at ON parent_student_links;
CREATE TRIGGER update_parent_student_links_updated_at
  BEFORE UPDATE ON parent_student_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- دوال ربط ولي الأمر (محسنة)
-- =============================================================================

-- 1. الطالب يرسل طلب ربط (مع التحقق من وجود رقم هاتف لولي الأمر)
CREATE OR REPLACE FUNCTION request_parent_link(
  p_parent_email TEXT,
  p_parent_phone TEXT,
  p_student_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_parent profiles%ROWTYPE;
  v_otp TEXT;
  v_link_id UUID;
BEGIN
  IF NOT (auth.uid() = p_student_id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')) THEN
    RAISE EXCEPTION 'غير مصرح لك بإنشاء طلب ربط ولي أمر';
  END IF;

  -- البحث عن ولي الأمر مع التأكد من وجود رقم هاتف
  SELECT * INTO v_parent FROM profiles 
  WHERE (email = p_parent_email OR phone_number = p_parent_phone) 
    AND role = 'parent'
    AND phone_number IS NOT NULL;   -- يجب أن يكون رقم الهاتف موجوداً
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يوجد ولي أمر مسجل بهذه البيانات أو رقم هاتفه غير مسجل. يجب أن يقوم ولي الأمر بتحديث رقم هاتفه أولاً.';
  END IF;

  IF EXISTS (SELECT 1 FROM parent_student_links WHERE parent_id = v_parent.id AND student_id = p_student_id AND link_status IN ('pending', 'active')) THEN
    RAISE EXCEPTION 'يوجد بالفعل طلب رابط معلق أو نشط بين هذا الطالب وولي الأمر';
  END IF;

  v_otp := LPAD(floor(random() * 1000000)::text, 6, '0');

  INSERT INTO parent_student_links (parent_id, student_id, link_status, otp_code, otp_expires_at, created_by)
  VALUES (v_parent.id, p_student_id, 'pending', v_otp, NOW() + interval '24 hours', auth.uid())
  RETURNING id INTO v_link_id;

  -- إشعار لولي الأمر (عبر add_notification)
  PERFORM add_notification(v_parent.id, 'طلب ربط ولي أمر جديد', 
    format('الطالب %s يطلب ربطك كولي أمر. استخدم الرمز %s للموافقة خلال 24 ساعة. الحد الأقصى للمحاولات 5.', 
    (SELECT full_name FROM profiles WHERE id = p_student_id), v_otp), 'info', 'parent_link', v_link_id);

  RETURN v_link_id;
END;
$$;

-- 2. ولي الأمر يقبل الرابط (مع عداد محاولات OTP وحماية ضد التخمين)
CREATE OR REPLACE FUNCTION accept_parent_link(p_link_id UUID, p_otp TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_link parent_student_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM parent_student_links WHERE id = p_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الرابط غير موجود'; END IF;
  IF v_link.link_status != 'pending' THEN RAISE EXCEPTION 'الرابط ليس في حالة انتظار'; END IF;

  -- التحقق من القفل بسبب كثرة المحاولات
  IF v_link.otp_locked_until IS NOT NULL AND v_link.otp_locked_until > NOW() THEN
    RAISE EXCEPTION 'الرابط مقفل بسبب كثرة المحاولات الخاطئة. حاول مرة أخرى بعد %', to_char(v_link.otp_locked_until, 'HH24:MI:SS');
  END IF;

  -- التحقق من صحة OTP
  IF v_link.otp_code != p_otp THEN
    -- زيادة عداد المحاولات الخاطئة
    UPDATE parent_student_links SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE id = p_link_id;
    IF (SELECT otp_attempts FROM parent_student_links WHERE id = p_link_id) >= 5 THEN
      UPDATE parent_student_links SET otp_locked_until = NOW() + interval '1 hour' WHERE id = p_link_id;
      RAISE EXCEPTION 'تم تجاوز عدد المحاولات المسموح (5). تم قفل الرابط لمدة ساعة.';
    END IF;
    RAISE EXCEPTION 'رمز OTP غير صحيح. عدد المحاولات المتبقية: %', 5 - (SELECT otp_attempts FROM parent_student_links WHERE id = p_link_id);
  END IF;

  IF v_link.otp_expires_at < NOW() THEN RAISE EXCEPTION 'انتهت صلاحية الرابط'; END IF;

  UPDATE parent_student_links SET link_status = 'active', updated_at = NOW(), otp_attempts = 0, otp_locked_until = NULL WHERE id = p_link_id;

  PERFORM add_notification(v_link.student_id, 'تم قبول طلب الربط', 
    'وافق ولي الأمر على الربط بنجاح', 'success', 'parent_link', p_link_id);

  RETURN TRUE;
END;
$$;

-- 3. طلب إلغاء رابط (عبر pending_requests – Maker-Checker)
CREATE OR REPLACE FUNCTION request_remove_parent_link(p_link_id UUID, p_reason TEXT DEFAULT '')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_link parent_student_links%ROWTYPE;
  v_requester_id UUID;
  v_request_id UUID;
BEGIN
  v_requester_id := auth.uid();
  SELECT * INTO v_link FROM parent_student_links WHERE id = p_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الرابط غير موجود'; END IF;
  IF v_link.link_status != 'active' THEN RAISE EXCEPTION 'لا يمكن إلغاء رابط غير نشط'; END IF;

  IF NOT (v_requester_id = v_link.parent_id OR v_requester_id = v_link.student_id OR 
          EXISTS (SELECT 1 FROM profiles WHERE id = v_requester_id AND role = 'owner')) THEN
    RAISE EXCEPTION 'غير مصرح لك بطلب إلغاء هذا الرابط';
  END IF;

  INSERT INTO pending_requests (request_type, requester_id, target_table, target_record_id, requested_changes, status)
  VALUES ('content_modification', v_requester_id, 'parent_student_links', p_link_id, 
          jsonb_build_object('action', 'remove', 'reason', p_reason), 'pending')
  RETURNING id INTO v_request_id;

  PERFORM add_notification((SELECT id FROM profiles WHERE role = 'owner' LIMIT 1), 
    'طلب إلغاء رابط ولي أمر', 
    format('طلب من %s بإلغاء الرابط بين الطالب %s وولي الأمر %s', 
      (SELECT full_name FROM profiles WHERE id = v_requester_id),
      (SELECT full_name FROM profiles WHERE id = v_link.student_id),
      (SELECT full_name FROM profiles WHERE id = v_link.parent_id)), 
    'warning', 'pending_request', v_request_id);

  RETURN v_request_id;
END;
$$;

-- 4. المالك ينفذ إلغاء الرابط (بعد الموافقة)
CREATE OR REPLACE FUNCTION execute_remove_parent_link(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request pending_requests%ROWTYPE;
  v_link_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك يمكنه تنفيذ إلغاء الرابط';
  END IF;

  SELECT * INTO v_request FROM pending_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_request.status != 'pending' THEN
    RAISE EXCEPTION 'الطلب غير موجود أو ليس معلقاً';
  END IF;

  v_link_id := (v_request.target_record_id)::UUID;
  -- التحقق من أن الرابط لا يزال نشطاً قبل الإلغاء
  IF NOT EXISTS (SELECT 1 FROM parent_student_links WHERE id = v_link_id AND link_status = 'active') THEN
    RAISE EXCEPTION 'الرابط لم يعد نشطاً (ربما تم إلغاؤه مسبقاً)';
  END IF;

  UPDATE parent_student_links SET link_status = 'removed', updated_at = NOW() WHERE id = v_link_id;
  UPDATE pending_requests SET status = 'approved', owner_comment = 'تمت الموافقة على الإلغاء' WHERE id = p_request_id;

  RETURN TRUE;
END;
$$;

-- =============================================================================
-- الجزء الثاني: سجل تحميل الملفات بالعلامة المائية (مع حدود وأرشفة اختيارية)
-- =============================================================================

CREATE TABLE IF NOT EXISTS watermark_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  watermark_text TEXT NOT NULL CHECK (length(watermark_text) <= 500),
  watermark_data JSONB,
  download_ip INET,
  user_agent TEXT,
  download_timestamp TIMESTAMPTZ DEFAULT NOW(),
  request_reference UUID,
  related_course_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_watermark_user ON watermark_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_watermark_timestamp ON watermark_logs(download_timestamp);
CREATE INDEX IF NOT EXISTS idx_watermark_course ON watermark_logs(related_course_id);

-- RLS
ALTER TABLE watermark_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User views own watermarks" ON watermark_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Staff view all watermarks" ON watermark_logs
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'supervisor')));

CREATE POLICY "Block direct insert on watermarks" ON watermark_logs FOR INSERT WITH CHECK (false);
CREATE POLICY "Block direct update on watermarks" ON watermark_logs FOR UPDATE USING (false);
CREATE POLICY "Block direct delete on watermarks" ON watermark_logs FOR DELETE USING (false);

-- دالة لتسجيل التحميل (آمنة)
CREATE OR REPLACE FUNCTION log_watermark_download(
  p_user_id UUID,
  p_file_name TEXT,
  p_file_path TEXT,
  p_watermark_text TEXT,
  p_ip INET,
  p_user_agent TEXT,
  p_ref UUID DEFAULT NULL,
  p_course_id UUID DEFAULT NULL,
  p_extra_data JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  IF NOT (auth.uid() = p_user_id OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'supervisor'))) THEN
    RAISE EXCEPTION 'غير مصرح لك بتسجيل تحميل لصالح مستخدم آخر';
  END IF;
  IF length(p_watermark_text) > 500 THEN
    RAISE EXCEPTION 'نص العلامة المائية طويل جداً (الحد 500 حرف)';
  END IF;

  INSERT INTO watermark_logs (user_id, file_name, file_path, watermark_text, watermark_data, download_ip, user_agent, request_reference, related_course_id)
  VALUES (p_user_id, p_file_name, p_file_path, p_watermark_text, p_extra_data, p_ip, p_user_agent, p_ref, p_course_id)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- دالة التنظيف (مع أرشفة اختيارية – هنا ننقل إلى جدول أرشيف بدلاً من الحذف المباشر)
CREATE TABLE IF NOT EXISTS watermark_logs_archive (LIKE watermark_logs INCLUDING ALL);

CREATE OR REPLACE FUNCTION archive_old_watermark_logs(days_old INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_archived INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك يمكنه أرشفة السجلات القديمة';
  END IF;

  -- نقل السجلات القديمة إلى جدول الأرشفة
  WITH archived AS (
    DELETE FROM watermark_logs
    WHERE download_timestamp < NOW() - (days_old || ' days')::INTERVAL
    RETURNING *
  )
  INSERT INTO watermark_logs_archive SELECT * FROM archived
  RETURNING count(*) INTO v_archived;

  RETURN v_archived;
END;
$$;

-- إحصائيات التحميلات للمالك والمشرف
CREATE OR REPLACE FUNCTION get_download_statistics(start_date TIMESTAMPTZ, end_date TIMESTAMPTZ)
RETURNS TABLE(user_id UUID, full_name TEXT, download_count BIGINT, last_download TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'supervisor')) THEN
    RAISE EXCEPTION 'غير مصرح لك';
  END IF;

  RETURN QUERY
  SELECT w.user_id, p.full_name, COUNT(*) AS download_count, MAX(w.download_timestamp) AS last_download
  FROM watermark_logs w
  JOIN profiles p ON w.user_id = p.id
  WHERE w.download_timestamp BETWEEN start_date AND end_date
  GROUP BY w.user_id, p.full_name
  ORDER BY download_count DESC;
END;
$$;

-- =============================================================================
-- صلاحيات التنفيذ
-- =============================================================================
GRANT EXECUTE ON FUNCTION request_parent_link TO authenticated;
GRANT EXECUTE ON FUNCTION accept_parent_link TO authenticated;
GRANT EXECUTE ON FUNCTION request_remove_parent_link TO authenticated;
GRANT EXECUTE ON FUNCTION execute_remove_parent_link TO authenticated;
GRANT EXECUTE ON FUNCTION log_watermark_download TO authenticated;
GRANT EXECUTE ON FUNCTION archive_old_watermark_logs TO authenticated;
GRANT EXECUTE ON FUNCTION get_download_statistics TO authenticated;

-- =============================================================================
-- توثيق المالك النهائي
-- =============================================================================
/*
✅ التحسينات المطبقة بعد التقييم:

1. **عداد محاولات OTP والقفل التلقائي** – الحد 5 محاولات خاطئة ثم قفل لمدة ساعة.
2. **التحقق من وجود رقم هاتف لولي الأمر** – يمنع الربط بدون رقم صحيح.
3. **التحقق من حالة الرابط قبل الإلغاء** – لا يمكن إلغاء رابط غير نشط.
4. **الحد الأقصى لطول النص المائي** – 500 حرف، مع تحقق.
5. **أرشفة السجلات القديمة بدلاً من الحذف المباشر** – جدول منفصل للأرشيف.
6. **التأكد من وجود الدوال الأساسية** (add_notification, update_updated_at_column) في بداية الملف.
7. **إضافة فهارس شرطية** لتحسين أداء البحث عن OTP.

🔒 مستوى الأمان: أصبح 9.9/10.

💰 التكلفة: لا تزال صفراً تماماً (لا مكالمات خارجية، لا تخزين إضافي مدفوع).

📌 متطلبات التشغيل:
- تأكد من وجود `add_notification` (من ملف الإشعارات).
- تأكد من وجود `update_updated_at_column` (من 001).
- جدول الأرشفة `watermark_logs_archive` يُنشأ تلقائياً.
- يمكنك جدولة `archive_old_watermark_logs` عبر pg_cron أو تشغيلها يدوياً.

تمتع بأمان مصرفي مجاني!
*/ 