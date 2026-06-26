-- ==============================================================================
-- 001_create_profiles.sql (النسخة النهائية بعد التحسينات والتكامل مع نظام المحفظة)
-- ==============================================================================
-- يعتمد على: ملف 005_create_transactions.sql (يجب تنفيذه أولاً)
-- يوفر: حسابات المستخدمين، صلاحيات RLS، نظام الاعتماد (pending_requests) مع ربط آلي بالمحفظة
-- ==============================================================================

-- 1. أنواع البيانات
CREATE TYPE user_role AS ENUM ('student', 'parent', 'supervisor', 'owner');
CREATE TYPE grade_level AS ENUM ('prep_1', 'prep_2', 'prep_3', 'sec_1', 'sec_2', 'sec_3', 'none');
CREATE TYPE request_type AS ENUM ('content_modification', 'points_reward', 'balance_reward');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'modification_requested');

-- 2. جدول الحسابات (مدمج مع wallet_balance من ملف 005)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_code TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  phone_number TEXT UNIQUE,
  parent_phone TEXT,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'student',
  grade grade_level DEFAULT 'none',
  wallet_balance DECIMAL(10,2) DEFAULT 0.00,     -- الرصيد المالي الحقيقي (يُدار بواسطة 005)
  is_active BOOLEAN DEFAULT true,
  current_session_token UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT block_temp_mails CHECK (
    email !~* '@(tempmail\.com|10minutemail\.com|mailinator\.com|guerrillamail\.com|yopmail\.com|dropmail\.me|temp-mail\.org)$'
  ),
  CONSTRAINT positive_balance CHECK (wallet_balance >= 0)
);

-- 3. جدول طلبات الاعتماد
CREATE TABLE pending_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type request_type NOT NULL,
  requester_id UUID REFERENCES profiles(id) NOT NULL,
  target_table TEXT,
  target_record_id UUID,
  requested_changes JSONB,
  target_student_id UUID REFERENCES profiles(id),
  reward_points INTEGER CHECK (reward_points > 0),
  reward_amount DECIMAL(10,2) CHECK (reward_amount > 0),
  reward_reason TEXT,
  student_dashboard_snapshot JSONB,
  status approval_status DEFAULT 'pending',
  owner_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT check_reward_type CHECK (
    (reward_points IS NOT NULL AND reward_amount IS NULL) OR
    (reward_points IS NULL AND reward_amount IS NOT NULL) OR
    (reward_points IS NULL AND reward_amount IS NULL)
  )
);

-- 4. الفهارس
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_code ON profiles(user_code);
CREATE INDEX idx_profiles_phone ON profiles(phone_number);
CREATE INDEX idx_profiles_session ON profiles(current_session_token);
CREATE INDEX idx_pending_requests_requester ON pending_requests(requester_id);
CREATE INDEX idx_pending_requests_status ON pending_requests(status);
CREATE INDEX idx_pending_requests_target_student ON pending_requests(target_student_id);

-- 5. تفعيل RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_requests ENABLE ROW LEVEL SECURITY;

-- سياسات profiles
CREATE POLICY "Users view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Supervisors view students only" ON profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'supervisor') AND role = 'student'
);
CREATE POLICY "Owner has absolute access" ON profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
) WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "No direct updates unless owner" ON profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
);

-- سياسات pending_requests
CREATE POLICY "Supervisors view own requests" ON pending_requests FOR SELECT USING (
  (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'supervisor') AND requester_id = auth.uid())
  OR (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'))
);
CREATE POLICY "Supervisors and owner can insert requests" ON pending_requests FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('supervisor', 'owner'))
);
CREATE POLICY "Owner can update requests" ON pending_requests FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
);
CREATE POLICY "No deletion of requests" ON pending_requests FOR DELETE USING (false);

-- 6. Triggers
-- ============================================================
-- 🆔 دالة توليد كود الطالب (النسخة المتطورة - 2050)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_student_code()
RETURNS TRIGGER AS $$
DECLARE
  v_clean_name TEXT;
  v_first_char TEXT;
  v_last_char TEXT;
  v_phone_tail TEXT;
  v_grade_text TEXT;
  v_base_code TEXT;
  v_new_code TEXT;
  v_attempts INT := 0;
  v_max_attempts INT := 10;
BEGIN
  -- تنفيذ المنطق فقط إذا كان المستخدم طالباً ولم يسبق تعيين كود له
  IF NEW.role = 'student' AND NEW.student_code IS NULL THEN
    
    -- 1️⃣ تنظيف الاسم (إزالة المسافات وتأمين الأسماء الفارغة)
    v_clean_name := REGEXP_REPLACE(COALESCE(NEW.full_name, 'ST'), '\s+', '', 'g');
    IF LENGTH(v_clean_name) < 2 THEN
      v_clean_name := RPAD(v_clean_name, 2, 'X');
    END IF;

    v_first_char := UPPER(SUBSTRING(v_clean_name, 1, 1));
    v_last_char := UPPER(SUBSTRING(v_clean_name, LENGTH(v_clean_name), 1));

    -- 2️⃣ استخراج آخر 4 أرقام من الهاتف (مع تنظيف الرموز)
    v_phone_tail := REGEXP_REPLACE(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g');
    IF LENGTH(v_phone_tail) < 4 THEN
      v_phone_tail := LPAD(v_phone_tail, 4, '0');
    ELSE
      v_phone_tail := RIGHT(v_phone_tail, 4);
    END IF;

    -- 3️⃣ التعامل الآمن مع المرحلة الدراسية (حتى لو كانت ENUM)
    v_grade_text := COALESCE(NEW.grade_level::TEXT, 'NA');

    -- 4️⃣ بناء الكود الأساسي (مثال: AH-P1-1234)
    v_base_code := v_first_char || v_last_char || '-' || v_grade_text || '-' || v_phone_tail;
    v_new_code := v_base_code;

    -- 5️⃣ معالجة التصادمات بذكاء (مع حد أقصى للمحاولات)
    WHILE EXISTS (SELECT 1 FROM profiles WHERE student_code = v_new_code) 
      AND v_attempts < v_max_attempts LOOP
        -- إضافة 3 أحرف عشوائية لتجنب التكرار
        v_new_code := v_base_code || '-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT), 1, 3));
        v_attempts := v_attempts + 1;
    END LOOP;

    -- 6️⃣ خط الدفاع الأخير (في حالة فشل جميع المحاولات)
    IF v_attempts >= v_max_attempts THEN
      v_new_code := v_base_code || '-' || LEFT(gen_random_uuid()::TEXT, 6);
    END IF;

    -- 7️⃣ تعيين الكود النهائي
    NEW.student_code := v_new_code;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ربط الـ Trigger بالجدول (قبل الإدراج)
DROP TRIGGER IF EXISTS trigger_generate_student_code ON profiles;
CREATE TRIGGER trigger_generate_student_code
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION generate_student_code();

-- 7. دوال آمنة (RPCs)

-- دالة تحديث جلسة المستخدم
CREATE OR REPLACE FUNCTION update_active_session(new_token UUID)
RETURNS void AS $$
BEGIN
  UPDATE profiles SET current_session_token = new_token WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة لترقية مستخدم موجود إلى مشرف (آمنة، لأنها لا تتعامل مع auth.users مباشرة)
CREATE OR REPLACE FUNCTION promote_to_supervisor(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك يمكنه ترقية المستخدمين';
  END IF;
  UPDATE profiles SET role = 'supervisor' WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة لإنشاء طلب مكافأة مالية (بواسطة المشرف)
CREATE OR REPLACE FUNCTION create_balance_reward_request(
  p_target_student_id UUID,
  p_reward_amount DECIMAL(10,2),
  p_reason TEXT,
  p_dashboard_snapshot JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_requester_id UUID;
  v_new_id UUID;
BEGIN
  v_requester_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_requester_id AND role = 'supervisor') THEN
    RAISE EXCEPTION 'غير مصرح لك بإنشاء طلب مكافأة (المشرفون فقط).';
  END IF;

  INSERT INTO pending_requests (request_type, requester_id, target_student_id, reward_amount, reward_reason, student_dashboard_snapshot, status)
  VALUES ('balance_reward', v_requester_id, p_target_student_id, p_reward_amount, p_reason, p_dashboard_snapshot, 'pending')
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة الموافقة على طلب المكافأة المالية (للمالك) – تستدعي process_wallet_transaction من ملف 005
CREATE OR REPLACE FUNCTION approve_balance_request(p_request_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_request RECORD;
  v_owner_id UUID;
  v_new_balance DECIMAL;
BEGIN
  v_owner_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك يمكنه الموافقة على طلبات الرصيد.';
  END IF;

  SELECT * INTO v_request FROM pending_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود.';
  END IF;
  IF v_request.status != 'pending' THEN
    RAISE EXCEPTION 'الطلب ليس معلقاً.';
  END IF;
  IF v_request.request_type != 'balance_reward' OR v_request.reward_amount IS NULL THEN
    RAISE EXCEPTION 'هذا الطلب ليس من نوع إضافة رصيد مالي.';
  END IF;

  -- استدعاء دالة المحفظة (من ملف 005)
  v_new_balance := process_wallet_transaction(
    v_request.target_student_id,
    v_request.reward_amount,
    'admin_adjustment',
    p_request_id,
    'EGP'
  );

  UPDATE pending_requests
  SET status = 'approved', owner_comment = 'تمت الموافقة وإضافة الرصيد', updated_at = NOW()
  WHERE id = p_request_id;

  RETURN format('تمت الموافقة وإضافة %s جنيه إلى رصيد الطالب. الرصيد الجديد: %s', v_request.reward_amount, v_new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة رفض أي طلب (للمالك)
CREATE OR REPLACE FUNCTION reject_pending_request(p_request_id UUID, p_reason TEXT)
RETURNS TEXT AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  v_owner_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_owner_id AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك يمكنه رفض الطلبات.';
  END IF;

  UPDATE pending_requests
  SET status = 'rejected', owner_comment = p_reason, updated_at = NOW()
  WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود أو ليس معلقاً.';
  END IF;
  RETURN 'تم رفض الطلب.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة مساعدة لجلب رصيد المستخدم
CREATE OR REPLACE FUNCTION get_user_balance(p_user_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  v_balance DECIMAL;
BEGIN
  SELECT COALESCE(wallet_balance, 0.00) INTO v_balance
  FROM profiles WHERE id = p_user_id;
  RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. صلاحيات التنفيذ
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_active_session TO authenticated;
GRANT EXECUTE ON FUNCTION promote_to_supervisor TO authenticated;
GRANT EXECUTE ON FUNCTION create_balance_reward_request TO authenticated;
GRANT EXECUTE ON FUNCTION approve_balance_request TO authenticated;
GRANT EXECUTE ON FUNCTION reject_pending_request TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance TO authenticated;

-- =============================================================================
-- 9. توثيق
-- =============================================================================
/*
🔧 التعليمات:
1. قم بتنفيذ هذا الملف بعد ملف `005_create_transactions.sql` (لأنه يعتمد على دالة process_wallet_transaction).
2. لا توجد دالة لإنشاء مشرف مباشرة عبر SQL بسبب قيود Supabase. بدلاً من ذلك:
   - أنشئ المستخدمين عبر Auth (اللوحة أو API).
   - ثم استخدم دالة `promote_to_supervisor(user_id)` بصفتك المالك لترقيتهم إلى مشرفين.
3. المشرفون يمكنهم إنشاء طلبات مكافأة مالية للطلاب باستخدام `create_balance_reward_request`.
4. المالك يوافق أو يرفض عبر `approve_balance_request` أو `reject_pending_request`.
5. عند الموافقة، تُضاف الأموال تلقائياً إلى رصيد الطالب عبر `process_wallet_transaction` من ملف 005.
*/