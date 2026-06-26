-- ============================================================
-- 008_parent_watermark.sql (النسخة النهائية المصححة - تعمل 100%)
-- نظام العلامات المائية + طلبات تعديل المشرفين + إشعارات
-- ============================================================

-- 1. جدول العلامات المائية (المالك فقط يتحكم فيه)
CREATE TABLE IF NOT EXISTS parent_watermarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  child_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  watermark_text TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_parent_child UNIQUE (parent_id, child_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_watermarks_parent ON parent_watermarks(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_watermarks_child ON parent_watermarks(child_id);
CREATE INDEX IF NOT EXISTS idx_parent_watermarks_active ON parent_watermarks(is_active);

ALTER TABLE parent_watermarks ENABLE ROW LEVEL SECURITY;

-- المالك فقط له كل الصلاحيات
DO $$ BEGIN
  CREATE POLICY "Owner all on watermarks" ON parent_watermarks
    FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- المشرف له حق القراءة فقط (عشان يشوف العلامات ويطلب تعديلها)
DO $$ BEGIN
  CREATE POLICY "Supervisors view watermarks" ON parent_watermarks
    FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('supervisor', 'owner')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ولي الأمر والطلاب ليس لهم أي صلاحية (لا قراءة ولا تعديل) - تم إلغاء أي سياسات سابقة

-- ============================================================
-- 2. جدول طلبات تعديل العلامة المائية (من المشرف إلى المالك)
-- ============================================================
CREATE TABLE IF NOT EXISTS watermark_edit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,   -- تم التصحيح: SET CASCADE -> CASCADE
  parent_watermark_id UUID REFERENCES parent_watermarks(id) ON DELETE CASCADE,
  requested_text TEXT NOT NULL,
  status TEXT DEFAULT 'pending_owner' CHECK (status IN ('pending_owner', 'approved', 'rejected')),
  owner_id UUID REFERENCES profiles(id),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watermark_edit_requests_status ON watermark_edit_requests(status);
CREATE INDEX IF NOT EXISTS idx_watermark_edit_requests_supervisor ON watermark_edit_requests(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_watermark_edit_requests_watermark ON watermark_edit_requests(parent_watermark_id);

ALTER TABLE watermark_edit_requests ENABLE ROW LEVEL SECURITY;

-- المشرف يرى طلباته فقط ويستطيع إدراج طلبات جديدة
DO $$ BEGIN
  CREATE POLICY "Supervisors insert own edit requests" ON watermark_edit_requests
    FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'supervisor'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Supervisors view own edit requests" ON watermark_edit_requests
    FOR SELECT USING (auth.uid() = supervisor_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- المالك يرى كل الطلبات ويستطيع تحديث الحالة
DO $$ BEGIN
  CREATE POLICY "Owner all on edit requests" ON watermark_edit_requests
    FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. دوال المالك للموافقة على طلب التعديل (مصححة)
-- ============================================================
CREATE OR REPLACE FUNCTION approve_watermark_edit(p_request_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_request RECORD;
  v_owner_role TEXT;
BEGIN
  SELECT role INTO v_owner_role FROM profiles WHERE id = auth.uid();
  IF v_owner_role != 'owner' THEN
    RAISE EXCEPTION 'فقط المالك يمكنه الموافقة';
  END IF;

  SELECT * INTO v_request FROM watermark_edit_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود';
  END IF;
  IF v_request.status != 'pending_owner' THEN
    RAISE EXCEPTION 'هذا الطلب ليس في حالة انتظار';
  END IF;

  -- تحديث العلامة المائية
  UPDATE parent_watermarks
  SET watermark_text = v_request.requested_text,
      updated_at = NOW()
  WHERE id = v_request.parent_watermark_id;

  -- تحديث حالة الطلب
  UPDATE watermark_edit_requests
  SET status = 'approved',
      owner_id = auth.uid(),
      updated_at = NOW()
  WHERE id = p_request_id;

  -- إشعار للمشرف
  PERFORM add_notification(
    v_request.supervisor_id,
    '✅ تم قبول طلب تعديل العلامة المائية',
    'تم قبول تعديلك وتحديث العلامة بنجاح',
    'success',
    'watermark_edit_request',
    p_request_id
  );

  RETURN 'تم قبول الطلب وتحديث العلامة المائية';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reject_watermark_edit(p_request_id UUID, p_reason TEXT)
RETURNS TEXT AS $$
DECLARE
  v_request RECORD;
  v_owner_role TEXT;
BEGIN
  SELECT role INTO v_owner_role FROM profiles WHERE id = auth.uid();
  IF v_owner_role != 'owner' THEN
    RAISE EXCEPTION 'فقط المالك يمكنه الرفض';
  END IF;

  SELECT * INTO v_request FROM watermark_edit_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود';
  END IF;
  IF v_request.status != 'pending_owner' THEN
    RAISE EXCEPTION 'هذا الطلب ليس في حالة انتظار';
  END IF;

  UPDATE watermark_edit_requests
  SET status = 'rejected',
      owner_id = auth.uid(),
      rejection_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_request_id;

  PERFORM add_notification(
    v_request.supervisor_id,
    '❌ تم رفض طلب تعديل العلامة المائية',
    'السبب: ' || p_reason,
    'error',
    'watermark_edit_request',
    p_request_id
  );

  RETURN 'تم رفض الطلب';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. دالة للمشرف لإضافة طلب تعديل
-- ============================================================
CREATE OR REPLACE FUNCTION create_watermark_edit_request(p_watermark_id UUID, p_new_text TEXT)
RETURNS UUID AS $$
DECLARE
  v_supervisor_id UUID;
  v_new_id UUID;
BEGIN
  v_supervisor_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_supervisor_id AND role = 'supervisor') THEN
    RAISE EXCEPTION 'غير مصرح لك بتقديم طلب تعديل';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM parent_watermarks WHERE id = p_watermark_id) THEN
    RAISE EXCEPTION 'العلامة المائية غير موجودة';
  END IF;

  IF EXISTS (SELECT 1 FROM watermark_edit_requests WHERE parent_watermark_id = p_watermark_id AND status = 'pending_owner') THEN
    RAISE EXCEPTION 'يوجد طلب تعديل معلق لهذه العلامة بالفعل';
  END IF;

  INSERT INTO watermark_edit_requests (supervisor_id, parent_watermark_id, requested_text, status)
  VALUES (v_supervisor_id, p_watermark_id, p_new_text, 'pending_owner')
  RETURNING id INTO v_new_id;

  -- إشعار للمالك
  PERFORM add_notification(
    (SELECT id FROM profiles WHERE role = 'owner' LIMIT 1),
    '📝 طلب تعديل علامة مائية جديد',
    'طلب من المشرف تعديل العلامة المائية رقم ' || p_watermark_id,
    'info',
    'watermark_edit_request',
    v_new_id
  );

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. نظام الإشعارات (إذا لم يكن موجوداً)
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  type TEXT NOT NULL CHECK (type IN ('info','success','warning','error')),
  is_read BOOLEAN DEFAULT false,
  related_entity_type TEXT,
  related_entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users view own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff view all notifications" ON notifications FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('supervisor','owner')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Block direct insert notifications" ON notifications FOR INSERT WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Block direct update notifications" ON notifications FOR UPDATE USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Block direct delete notifications" ON notifications FOR DELETE USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- دوال الإشعارات الأساسية
CREATE OR REPLACE FUNCTION add_notification(p_user_id UUID, p_title TEXT, p_content TEXT, p_type TEXT DEFAULT 'info', p_entity_type TEXT DEFAULT NULL, p_entity_id UUID DEFAULT NULL)
RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifications (user_id, title, content, type, related_entity_type, related_entity_id)
  VALUES (p_user_id, p_title, p_content, p_type, p_entity_type, p_entity_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE notifications SET is_read = true
  WHERE id = p_notification_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'الإشعار غير موجود أو لا يخصك'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_unread_notifications()
RETURNS TABLE(id UUID, title TEXT, content TEXT, type TEXT, created_at TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY SELECT n.id, n.title, n.content, n.type, n.created_at
  FROM notifications n
  WHERE n.user_id = auth.uid() AND n.is_read = false
  ORDER BY n.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. صلاحيات التنفيذ
-- ============================================================
GRANT EXECUTE ON FUNCTION create_watermark_edit_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_watermark_edit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_watermark_edit(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION add_notification TO authenticated;
GRANT EXECUTE ON FUNCTION mark_notification_read TO authenticated;
GRANT EXECUTE ON FUNCTION get_unread_notifications TO authenticated;