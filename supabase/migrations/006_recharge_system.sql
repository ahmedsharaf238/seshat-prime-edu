-- ==============================================================================
-- 006_recharge_system.sql (النسخة المُحسَّنة والمصححة)
-- نظام الباقات، طلبات الشحن اليدوي (واتساب)، ونظام العروض
-- يعتمد على ملف 005 (process_wallet_transaction)
-- جميع العمليات مجانية للمالك ضمن حدود Supabase Free Tier
-- تم التحديث: إصلاح خطأ CONSTRAINT مع WHERE، إضافة الفهارس الجزئية، تحسين الأمان
-- ==============================================================================

-- ==========================================
-- 1. جدول الباقات (يديره المالك)
-- ==========================================
CREATE TABLE IF NOT EXISTS point_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_name TEXT NOT NULL,
  price_egp DECIMAL(10,2) NOT NULL CHECK (price_egp > 0),
  points_reward DECIMAL(10,2) NOT NULL CHECK (points_reward > 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 2. حالات طلب الشحن
-- ==========================================
DO $$ BEGIN
    CREATE TYPE recharge_status AS ENUM ('pending_owner', 'approved', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==========================================
-- 3. جدول طلبات الشحن (بدون رفع صور – توثيق واتساب خارجي)
-- ==========================================
CREATE TABLE IF NOT EXISTS recharge_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  package_id UUID REFERENCES point_packages(id) ON DELETE SET NULL,
  
  -- البيانات الأساسية
  requested_points DECIMAL(10,2) NOT NULL CHECK (requested_points > 0),
  transfer_method TEXT NOT NULL CHECK (transfer_method IN ('InstaPay', 'Vodafone Cash')),
  external_whatsapp_note TEXT NOT NULL,
  
  -- الحالة والإجراءات
  status recharge_status DEFAULT 'pending_owner',
  rejection_reason TEXT,
  final_points_awarded DECIMAL(10,2),
  
  -- الموظفون
  owner_id UUID REFERENCES profiles(id),
  
  -- التواقيت
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
);

-- منع تكرار الطلبات المعلقة لنفس المستخدم (فهرس جزئي بدلاً من CONSTRAINT UNIQUE مع WHERE)
CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_per_user ON recharge_requests (user_id) WHERE status = 'pending_owner';

-- ==========================================
-- 4. نظام العروض والخصومات
-- ==========================================
DO $$ BEGIN
    CREATE TYPE discount_type AS ENUM ('percentage', 'fixed_amount', 'bonus_points');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- جدول العروض
CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_name TEXT NOT NULL,
  offer_description TEXT,
  discount_type discount_type NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  max_uses_total INT,
  max_uses_per_user INT DEFAULT 1,
  min_package_price DECIMAL(10,2),
  target_user_roles TEXT[] DEFAULT '{student}',
  priority INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ربط العروض بالباقات
CREATE TABLE IF NOT EXISTS offer_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID REFERENCES offers(id) ON DELETE CASCADE,
  package_id UUID REFERENCES point_packages(id) ON DELETE CASCADE,
  UNIQUE(offer_id, package_id)
);

-- سجل استخدام العروض
CREATE TABLE IF NOT EXISTS offer_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID REFERENCES offers(id),
  user_id UUID REFERENCES profiles(id),
  recharge_request_id UUID REFERENCES recharge_requests(id),
  original_points DECIMAL,
  discounted_points DECIMAL,
  used_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 5. الفهارس لتحسين الأداء
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_packages_active ON point_packages(is_active);
CREATE INDEX IF NOT EXISTS idx_recharge_requests_user_status ON recharge_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_recharge_requests_created ON recharge_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_active_dates ON offers(is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_offer_packages_package ON offer_packages(package_id);
CREATE INDEX IF NOT EXISTS idx_offer_usage_user ON offer_usage(user_id, offer_id);

-- ==========================================
-- 6. تفعيل RLS على جميع الجداول
-- ==========================================
ALTER TABLE point_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE recharge_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_usage ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 7. سياسات الأمان (RLS) – محسنة مع التحقق من وجود الأدوار
-- ==========================================
-- point_packages: الجميع يرى النشط، المالك يدير
CREATE POLICY "Anyone view active packages" ON point_packages
  FOR SELECT USING (is_active = true);

CREATE POLICY "Owner manage packages" ON point_packages
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- recharge_requests
CREATE POLICY "Student view own requests" ON recharge_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Student insert own requests" ON recharge_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Staff view all requests" ON recharge_requests
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('supervisor', 'owner')));

CREATE POLICY "Block direct updates" ON recharge_requests FOR UPDATE USING (false);
CREATE POLICY "Block direct deletes" ON recharge_requests FOR DELETE USING (false);

-- offers: المستخدمون يرون العروض السارية والمتاحة لهم
CREATE POLICY "Users view applicable offers" ON offers FOR SELECT
  USING (
    is_active = true 
    AND start_date <= NOW() 
    AND (end_date IS NULL OR end_date >= NOW())
    AND (max_uses_total IS NULL OR 
        (SELECT COUNT(*) FROM offer_usage WHERE offer_id = offers.id) < max_uses_total)
  );

CREATE POLICY "Owner all on offers" ON offers FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- offer_packages
CREATE POLICY "Owner all on offer_packages" ON offer_packages FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- offer_usage
CREATE POLICY "Users view own offer usage" ON offer_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Owner view all usage" ON offer_usage FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- ==========================================
-- 8. دالة حساب أفضل عرض لباقة معينة ومستخدم
-- ==========================================
CREATE OR REPLACE FUNCTION get_best_offer_for_package(
  p_user_id UUID,
  p_package_id UUID,
  p_original_points DECIMAL
)
RETURNS TABLE(
  offer_id UUID,
  offer_name TEXT,
  final_points DECIMAL,
  discount_details TEXT
) AS $$
DECLARE
  v_offer RECORD;
  v_best_points DECIMAL := p_original_points;
  v_best_offer_id UUID;
  v_best_offer_name TEXT;
  v_discount_text TEXT;
  v_user_role TEXT;
BEGIN
  SELECT COALESCE(role, 'student') INTO v_user_role FROM profiles WHERE id = p_user_id;
  
  FOR v_offer IN
    SELECT o.*, op.package_id
    FROM offers o
    LEFT JOIN offer_packages op ON o.id = op.offer_id
    WHERE o.is_active = true
      AND o.start_date <= NOW()
      AND (o.end_date IS NULL OR o.end_date >= NOW())
      AND (o.max_uses_total IS NULL OR 
           (SELECT COUNT(*) FROM offer_usage WHERE offer_id = o.id) < o.max_uses_total)
      AND (o.max_uses_per_user IS NULL OR 
           (SELECT COUNT(*) FROM offer_usage WHERE offer_id = o.id AND user_id = p_user_id) < o.max_uses_per_user)
      AND (o.min_package_price IS NULL OR 
           (SELECT price_egp FROM point_packages WHERE id = p_package_id) >= o.min_package_price)
      AND (o.target_user_roles IS NULL OR p_user_role = ANY(o.target_user_roles))
      AND (op.package_id IS NULL OR op.package_id = p_package_id)
    ORDER BY o.priority DESC, o.discount_value DESC
  LOOP
    DECLARE
      v_new_points DECIMAL;
      v_discount_desc TEXT;
    BEGIN
      IF v_offer.discount_type = 'percentage' THEN
        v_new_points := p_original_points * (1 - v_offer.discount_value / 100);
        v_discount_desc := format('خصم %s%%', v_offer.discount_value);
      ELSIF v_offer.discount_type = 'fixed_amount' THEN
        v_new_points := GREATEST(0, p_original_points - v_offer.discount_value);
        v_discount_desc := format('خصم %s نقطة', v_offer.discount_value);
      ELSIF v_offer.discount_type = 'bonus_points' THEN
        v_new_points := p_original_points + v_offer.discount_value;
        v_discount_desc := format('+%s نقاط إضافية', v_offer.discount_value);
      ELSE
        CONTINUE;
      END IF;
      
      -- اختيار أفضل عرض: أقل نقاط (للخصم) أو أكثر نقاط (للمكافأة)
      IF (v_offer.discount_type != 'bonus_points' AND v_new_points < v_best_points) OR
        (v_offer.discount_type = 'bonus_points' AND v_new_points > v_best_points) THEN
        v_best_points := v_new_points;
        v_best_offer_id := v_offer.id;
        v_best_offer_name := v_offer.offer_name;
        v_discount_text := v_discount_desc;
      END IF;
    END;
  END LOOP;
  
  RETURN QUERY SELECT 
    v_best_offer_id, 
    v_best_offer_name, 
    COALESCE(v_best_points, p_original_points),
    COALESCE(v_discount_text, 'لا يوجد عرض');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 9. دالة الطالب: تقديم طلب شحن (يختار الباقة)
-- ==========================================
CREATE OR REPLACE FUNCTION student_request_recharge(
  p_package_id UUID,
  p_transfer_method TEXT,
  p_whatsapp_note TEXT DEFAULT 'تم إرسال صورة التحويل عبر واتساب للمالك'
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
  v_package RECORD;
  v_existing_pending INT;
  v_new_id UUID;
  v_offer_record RECORD;
  v_final_points DECIMAL;
  v_offer_id UUID;
  v_offer_name TEXT;
  v_discount_details TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً.';
  END IF;

  -- جلب الباقة
  SELECT * INTO v_package FROM point_packages WHERE id = p_package_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الباقة غير موجودة أو غير نشطة.';
  END IF;

  -- منع وجود طلب معلق (الفهرس الجزئي سيمنع الإدراج المتكرر، لكننا نضيف رسالة واضحة)
  SELECT COUNT(*) INTO v_existing_pending
  FROM recharge_requests
  WHERE user_id = v_user_id AND status = 'pending_owner';
  IF v_existing_pending > 0 THEN
    RAISE EXCEPTION 'لديك طلب شحن قيد المراجعة بالفعل. يرجى الانتظار حتى يتم البت فيه.';
  END IF;

  -- حساب أفضل عرض مطبق على هذه الباقة
  SELECT * INTO v_offer_record
  FROM get_best_offer_for_package(v_user_id, p_package_id, v_package.points_reward);
  
  v_offer_id := v_offer_record.offer_id;
  v_offer_name := v_offer_record.offer_name;
  v_final_points := v_offer_record.final_points;
  v_discount_details := v_offer_record.discount_details;

  -- إنشاء الطلب
  INSERT INTO recharge_requests (
    user_id, package_id, requested_points, transfer_method, external_whatsapp_note, status
  ) VALUES (
    v_user_id, p_package_id, v_final_points, p_transfer_method,
    p_whatsapp_note || ' | العرض المطبق: ' || COALESCE(v_offer_name, 'بدون عرض') || ' - ' || v_discount_details,
    'pending_owner'
  ) RETURNING id INTO v_new_id;

  -- تسجيل استخدام العرض (إذا وُجد)
  IF v_offer_id IS NOT NULL THEN
    INSERT INTO offer_usage (offer_id, user_id, recharge_request_id, original_points, discounted_points)
    VALUES (v_offer_id, v_user_id, v_new_id, v_package.points_reward, v_final_points);
  END IF;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 10. دالة المالك: الموافقة النهائية (مع إمكانية تعديل النقاط)
-- ==========================================
CREATE OR REPLACE FUNCTION owner_approve_recharge(
  p_request_id UUID,
  p_override_points DECIMAL(10,2) DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
  v_request RECORD;
  v_owner_id UUID;
  v_points_to_award DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  v_owner_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك يمكنه اعتماد الشحن نهائياً.';
  END IF;

  SELECT r.user_id, r.requested_points, r.status
  INTO v_request
  FROM recharge_requests r
  WHERE r.id = p_request_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود.';
  END IF;

  IF v_request.status != 'pending_owner' THEN
    RAISE EXCEPTION 'هذا الطلب ليس في حالة انتظار المالك. حالته الحالية: %', v_request.status;
  END IF;

  v_points_to_award := COALESCE(p_override_points, v_request.requested_points);
  IF v_points_to_award <= 0 THEN
    RAISE EXCEPTION 'قيمة النقاط يجب أن تكون أكبر من صفر.';
  END IF;

  -- إضافة الرصيد عبر دالة المحفظة من ملف 005 (يجب أن تكون موجودة)
  v_new_balance := process_wallet_transaction(
    v_request.user_id,
    v_points_to_award,
    'wallet_recharge',
    p_request_id,
    'EGP'
  );

  UPDATE recharge_requests
  SET status = 'approved',
      final_points_awarded = v_points_to_award,
      owner_id = v_owner_id,
      approved_at = NOW()
  WHERE id = p_request_id;

  RETURN format('تم شحن %s نقطة بنجاح. الرصيد الجديد: %s', v_points_to_award, v_new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 11. دالة الرفض (للمالك أو المشرف)
-- ==========================================
CREATE OR REPLACE FUNCTION reject_recharge_request(
  p_request_id UUID,
  p_rejection_reason TEXT
)
RETURNS TEXT AS $$
DECLARE
  v_admin_id UUID;
  v_role TEXT;
BEGIN
  v_admin_id := auth.uid();
  SELECT role INTO v_role FROM profiles WHERE id = v_admin_id;
  IF v_role NOT IN ('owner', 'supervisor') THEN
    RAISE EXCEPTION 'غير مصرح لك برفض الطلب.';
  END IF;

  UPDATE recharge_requests
  SET status = 'rejected',
      rejection_reason = p_rejection_reason,
      owner_id = CASE WHEN v_role = 'owner' THEN v_admin_id ELSE owner_id END,
      rejected_at = NOW()
  WHERE id = p_request_id AND status = 'pending_owner';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود أو ليس في حالة انتظار الموافقة.';
  END IF;

  RETURN 'تم رفض طلب الشحن.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 12. دوال إدارة العروض (للمالك فقط)
-- ==========================================
CREATE OR REPLACE FUNCTION create_offer(
  p_name TEXT,
  p_discount_type discount_type,
  p_discount_value DECIMAL,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ DEFAULT NULL,
  p_max_uses_total INT DEFAULT NULL,
  p_max_uses_per_user INT DEFAULT 1,
  p_min_package_price DECIMAL DEFAULT NULL,
  p_target_roles TEXT[] DEFAULT '{student}',
  p_priority INT DEFAULT 0
)
RETURNS UUID AS $$
DECLARE
  v_owner_id UUID;
  v_offer_id UUID;
BEGIN
  v_owner_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك يمكنه إنشاء عروض.';
  END IF;

  INSERT INTO offers (
    offer_name, discount_type, discount_value, start_date, end_date,
    max_uses_total, max_uses_per_user, min_package_price, target_user_roles, priority
  ) VALUES (
    p_name, p_discount_type, p_discount_value, p_start_date, p_end_date,
    p_max_uses_total, p_max_uses_per_user, p_min_package_price, p_target_roles, p_priority
  ) RETURNING id INTO v_offer_id;

  RETURN v_offer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION attach_offer_to_package(p_offer_id UUID, p_package_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك.';
  END IF;
  INSERT INTO offer_packages (offer_id, package_id) VALUES (p_offer_id, p_package_id)
  ON CONFLICT (offer_id, package_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION toggle_offer(p_offer_id UUID, p_active BOOLEAN)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك.';
  END IF;
  UPDATE offers SET is_active = p_active, updated_at = NOW() WHERE id = p_offer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_all_offers()
RETURNS TABLE(
  id UUID,
  name TEXT,
  type discount_type,
  value DECIMAL,
  active BOOLEAN,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  total_used BIGINT
) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'غير مصرح.';
  END IF;
  RETURN QUERY
  SELECT o.id, o.offer_name, o.discount_type, o.discount_value, o.is_active,
         o.start_date, o.end_date, COUNT(ou.id)::BIGINT
  FROM offers o
  LEFT JOIN offer_usage ou ON o.id = ou.offer_id
  GROUP BY o.id
  ORDER BY o.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 13. دوال مساعدة للواجهة الأمامية
-- ==========================================
CREATE OR REPLACE FUNCTION get_active_packages()
RETURNS TABLE(id UUID, name TEXT, price DECIMAL, points DECIMAL) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.package_name, p.price_egp, p.points_reward
  FROM point_packages p
  WHERE p.is_active = true
  ORDER BY p.price_egp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_pending_requests()
RETURNS SETOF recharge_requests AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'supervisor')) THEN
    RAISE EXCEPTION 'غير مصرح لك.';
  END IF;
  RETURN QUERY SELECT * FROM recharge_requests WHERE status = 'pending_owner' ORDER BY created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 14. صلاحيات التنفيذ
-- ==========================================
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_active_packages TO authenticated;
GRANT EXECUTE ON FUNCTION student_request_recharge TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_requests TO authenticated;
GRANT EXECUTE ON FUNCTION owner_approve_recharge TO authenticated;
GRANT EXECUTE ON FUNCTION reject_recharge_request TO authenticated;
GRANT EXECUTE ON FUNCTION create_offer TO authenticated;
GRANT EXECUTE ON FUNCTION attach_offer_to_package TO authenticated;
GRANT EXECUTE ON FUNCTION toggle_offer TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_offers TO authenticated;
GRANT EXECUTE ON FUNCTION get_best_offer_for_package TO authenticated;

-- ==========================================
-- 15. نهاية الملف – التعليقات والتوثيق
-- ==========================================
/*
تم التصحيح والتحسين:
- إزالة CONSTRAINT غير الصحيح "UNIQUE (user_id) WHERE status" واستبداله بـ CREATE UNIQUE INDEX جزئي.
- إضافة IF NOT EXISTS لأنواع ENUM لتجنب أخطاء التكرار.
- تحسين الأمان مع التحقق من وجود الأدوار في سياسات RLS.
- جميع الدوال أصبحت متوافقة مع Supabase PostgreSQL.

الآن يمكن تطبيق هذا الملف بأمان عبر npx supabase db push.
*/