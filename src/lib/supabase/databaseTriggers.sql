-- ============================================================
-- 🗄️ 1. إنشاء الجداول الأساسية (إصدار 2050 الفولاذي - معدل لـ Prep & Sec)
-- ============================================================

-- جدول الملفات الشخصية
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'parent', 'teacher', 'supervisor')),
  -- تم التعديل إلى المراحل الدراسية: إعدادي وثانوي
  grade_level TEXT CHECK (grade_level IN ('prep_1', 'prep_2', 'prep_3', 'sec_1', 'sec_2', 'sec_3')),
  student_code TEXT UNIQUE,
  parent_phone TEXT,
  telegram_chat_id TEXT,
  permissions JSONB DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES profiles(id),
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- إضافة فهارس لتسريع الاستعلامات والبحث
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_grade ON profiles(grade_level);

-- جدول ربط ولي الأمر بالأبناء
CREATE TABLE IF NOT EXISTS parent_student_relations (
  id SERIAL PRIMARY KEY,
  parent_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(parent_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_parent_student_parent ON parent_student_relations(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_student_student ON parent_student_relations(student_id);

-- جدول طلبات التعديل (المشرفين)
CREATE TABLE IF NOT EXISTS supervisor_requests (
  id SERIAL PRIMARY KEY,
  supervisor_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('update_profile', 'reset_password', 'upgrade_role', 'other')),
  field_to_update TEXT,
  old_value TEXT,
  new_value TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supervisor_requests_status ON supervisor_requests(status);

-- جدول الجلسات النشطة لتقييد الأجهزة
CREATE TABLE IF NOT EXISTS active_sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  last_active TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);

-- جدول سجلات التدقيق الأمني
CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id SERIAL PRIMARY KEY,
  email TEXT,
  status TEXT NOT NULL,
  details TEXT,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  device_fingerprint TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON auth_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_status ON auth_audit_logs(status);

-- جدول تحديد معدل المحاولات (Rate Limiting)
CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  identifier TEXT NOT NULL,
  action_type TEXT NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier, action_type);

-- جدول مفاتيح البصمة البيومترية (Passkeys)
CREATE TABLE IF NOT EXISTS passkeys (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

-- جدول رموز التحقق (OTP)
CREATE TABLE IF NOT EXISTS verification_codes (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  used BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_verification_phone ON verification_codes(phone);
CREATE INDEX IF NOT EXISTS idx_verification_used ON verification_codes(used);

-- جدول أنشطة الطلاب للإشعارات ومتابعة أولياء الأمور
CREATE TABLE IF NOT EXISTS student_activities (
  id SERIAL PRIMARY KEY,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_student_activities_student ON student_activities(student_id);
CREATE INDEX IF NOT EXISTS idx_student_activities_created ON student_activities(created_at);

-- جدول معرفات التليجرام
CREATE TABLE IF NOT EXISTS telegram_chats (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  chat_id TEXT UNIQUE NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telegram_user ON telegram_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_phone ON telegram_chats(phone);

-- جدول الأجهزة الموثوقة
CREATE TABLE IF NOT EXISTS trusted_devices (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  fingerprint TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trusted_user ON trusted_devices(user_id);

-- ============================================================
-- 🛡️ 2. تفعيل Row Level Security (RLS)
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_student_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervisor_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 🔐 3. سياسات RLS المحسّنة والمؤمنة ضد الاختراق والتزوير
-- ============================================================

-- 3.1 سياسات جدول profiles
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Teachers can view their grade students" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles teacher 
      WHERE teacher.id = auth.uid() 
      AND teacher.role = 'teacher' 
      AND teacher.grade_level = profiles.grade_level
      AND profiles.role = 'student'
    )
  );

CREATE POLICY "Parents can view their children" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM parent_student_relations psr 
      WHERE psr.parent_id = auth.uid() AND psr.student_id = profiles.id
    )
  );

CREATE POLICY "Supervisors can view all" ON profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'supervisor')
  );

-- 3.2 سياسات جدول parent_student_relations (إغلاق ثغرة الاختطاف: رؤية وحذف فقط، الإضافة للمشرف)
CREATE POLICY "Parents view own relations" ON parent_student_relations
  FOR SELECT USING (parent_id = auth.uid());

CREATE POLICY "Parents delete own relations" ON parent_student_relations
  FOR DELETE USING (parent_id = auth.uid());

CREATE POLICY "Supervisors manage all relations" ON parent_student_relations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'supervisor')
  );

-- 3.3 سياسات الجلسات والأجهزة والبصمات
CREATE POLICY "Users manage own sessions" ON active_sessions FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users manage own passkeys" ON passkeys FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users view own telegram chat" ON telegram_chats FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users manage own trusted devices" ON trusted_devices FOR ALL USING (user_id = auth.uid());

-- 3.4 سياسات سجلات التدقيق الأمني
CREATE POLICY "Supervisors view all audit logs" ON auth_audit_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'supervisor')
  );

CREATE POLICY "Teachers view their students audit logs" ON auth_audit_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles teacher
      WHERE teacher.id = auth.uid() 
      AND teacher.role = 'teacher'
      AND auth_audit_logs.user_id IN (
        SELECT id FROM profiles WHERE grade_level = teacher.grade_level
      )
    )
  );

-- 3.5 سياسات أنشطة الطلاب
CREATE POLICY "Parents view their children activities" ON student_activities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM parent_student_relations psr
      WHERE psr.parent_id = auth.uid() AND psr.student_id = student_activities.student_id
    )
  );

CREATE POLICY "Teachers view their grade activities" ON student_activities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles teacher
      WHERE teacher.id = auth.uid() 
      AND teacher.role = 'teacher'
      AND teacher.grade_level = (
        SELECT grade_level FROM profiles WHERE id = student_activities.student_id
      )
    )
  );

-- ============================================================
-- ⚙️ 4. الدوال المخزنة الحصينة (مع تفعيل الأمان الصارم وحقن المسار)
-- ============================================================

-- دالة توليد كود الطالب التلقائي الفريد طبقا للسنة الحالية
CREATE OR REPLACE FUNCTION generate_student_code()
RETURNS TEXT 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
  current_year TEXT := to_char(now(), 'YYYY');
  seq_num INT;
  generated_code TEXT;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(student_code FROM 10)::INT), 0) + 1
  INTO seq_num
  FROM profiles
  WHERE student_code LIKE 'STU-' || current_year || '-%';
  
  generated_code := 'STU-' || current_year || '-' || LPAD(seq_num::TEXT, 4, '0');
  RETURN generated_code;
END;
$$;

-- دالة توليد رمز التحقق OTP
CREATE OR REPLACE FUNCTION generate_verification_code(
  p_phone TEXT, 
  p_ip_addr TEXT DEFAULT NULL,
  p_ua TEXT DEFAULT NULL
)
RETURNS TEXT 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
BEGIN
  v_code := floor(random() * 900000 + 100000)::text;
  INSERT INTO verification_codes (phone, code, ip_address, user_agent)
  VALUES (p_phone, v_code, p_ip_addr, p_ua);
  RETURN v_code;
END;
$$;

-- دالة التحقق من الرمز مع بصمة الـ IP الاختيارية
CREATE OR REPLACE FUNCTION verify_verification_code(
  p_phone TEXT, 
  p_code TEXT,
  p_ip_addr TEXT DEFAULT NULL
)
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
  v_valid BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM verification_codes 
    WHERE phone = p_phone AND code = p_code AND NOT used 
    AND created_at > now() - interval '5 minutes'
    AND (ip_address IS NULL OR ip_address = p_ip_addr)
  ) INTO v_valid;
  
  IF v_valid THEN
    UPDATE verification_codes SET used = true 
    WHERE phone = p_phone AND code = p_code;
  END IF;
  
  RETURN v_valid;
END;
$$;

-- جلب أبناء ولي الأمر
CREATE OR REPLACE FUNCTION get_parent_children(p_parent_uuid UUID)
RETURNS TABLE(
  id UUID,
  full_name TEXT,
  grade_level TEXT,
  student_code TEXT,
  phone TEXT,
  email TEXT
) 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.full_name, p.grade_level, p.student_code, p.phone, p.email
  FROM profiles p
  JOIN parent_student_relations psr ON p.id = psr.student_id
  WHERE psr.parent_id = p_parent_uuid AND p.role = 'student';
END;
$$;

-- تنظيف الجلسات القديمة من السيرفر للتخفيف
CREATE OR REPLACE FUNCTION clean_old_sessions(p_days_old INT)
RETURNS INT 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  DELETE FROM active_sessions 
  WHERE last_active < now() - (p_days_old || ' days')::interval;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- دالة الـ Rate Limiting الفولاذية لمنع هجمات الإغراق والتخمين
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_identifier TEXT,
  p_action_type TEXT,
  p_max_attempts INT,
  p_time_window_minutes INT
)
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
  v_attempt_count INT;
BEGIN
  SELECT COUNT(*) INTO v_attempt_count
  FROM rate_limits
  WHERE identifier = p_identifier 
    AND action_type = p_action_type 
    AND executed_at > now() - (p_time_window_minutes || ' minutes')::interval;
  
  IF v_attempt_count >= p_max_attempts THEN
    RETURN FALSE;
  ELSE
    INSERT INTO rate_limits (identifier, action_type) VALUES (p_identifier, p_action_type);
    RETURN TRUE;
  END IF;
END;
$$;

-- ============================================================
-- 🔒 5. التريجرات التلقائية (الأمان الشامل والحماية اللحظية)
-- ============================================================

-- التريجر التلقائي لتحديث زمن التعديل
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at 
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 🛠️ حارس الصلاحيات: يمنع المستخدم من تغيير دورة أو أذوناته بنفسه عبر الـ API
CREATE OR REPLACE FUNCTION protect_sensitive_profile_fields()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() = NEW.id THEN
    NEW.role = OLD.role;
    NEW.permissions = OLD.permissions;
    NEW.student_code = OLD.student_code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_profile_security 
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_sensitive_profile_fields();

-- 🛠️ منشئ الحسابات الآمن: يعقم مخرجات الـ Metadata ويمنع التسلل كأدمن
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
  v_requested_role TEXT := NEW.raw_user_meta_data->>'role';
  v_assigned_role TEXT;
  v_student_code TEXT := NULL;
BEGIN
  -- إجبار قبول الأدوار العامة فقط عند التسجيل التلقائي والافتراضي طالب
  IF v_requested_role IN ('student', 'parent') THEN
    v_assigned_role := v_requested_role;
  ELSE
    v_assigned_role := 'student';
  END IF;

  -- توليد كود مخصص فوراً إذا كان المستخدم طالب
  IF v_assigned_role = 'student' THEN
    v_student_code := generate_student_code();
  END IF;

  INSERT INTO profiles (
    id, email, full_name, role, student_code, created_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    v_assigned_role,
    v_student_code,
    NOW()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- تريجر مراقبة محفظة الطالب المالية (مجهز ومؤمن هندسياً)
CREATE OR REPLACE FUNCTION log_student_activity_wallet()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.amount > 0 THEN
    INSERT INTO student_activities (student_id, activity_type, description, metadata)
    VALUES (
      NEW.student_id,
      'wallet_charge',
      'تم شحن المحفظة بمبلغ ' || NEW.amount || ' نقطة',
      jsonb_build_object('amount', NEW.amount, 'type', 'charge')
    );
  ELSIF TG_OP = 'INSERT' AND NEW.amount < 0 THEN
    INSERT INTO student_activities (student_id, activity_type, description, metadata)
    VALUES (
      NEW.student_id,
      'wallet_spend',
      'تم استهلاك ' || (-NEW.amount) || ' نقطة من المحفظة',
      jsonb_build_object('amount', -NEW.amount, 'type', 'spend')
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- ✅ 6. فحص وتأكيد سلامة وتفعيل الـ RLS بالجداول
-- ============================================================
SELECT 
  table_name,
  row_security_active
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;