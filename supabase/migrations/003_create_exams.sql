-- ==============================================================================
-- 003_create_exams.sql
-- نظام الاختبارات الشامل: بنك الأسئلة، مكافحة الغش، وغرفة انتظار التعديلات
-- ==============================================================================

-- ==========================================
-- 1. الأنواع (Enums)
-- ==========================================
CREATE TYPE exam_type AS ENUM ('lesson', 'unit', 'monthly');
CREATE TYPE action_type AS ENUM ('UPDATE', 'DELETE');
DO $$ BEGIN
    CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
-- ==========================================
-- 2. جدول الاختبارات (Exams Table)
-- ==========================================
CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  exam_type exam_type NOT NULL,
  related_video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  grade_level grade_level NOT NULL,
  passing_score INTEGER DEFAULT 70 CHECK (passing_score BETWEEN 0 AND 100),
  points_reward INTEGER DEFAULT 20,
  time_limit_minutes INTEGER DEFAULT 30,
  is_free BOOLEAN DEFAULT true,
  points_cost INTEGER DEFAULT 0 CHECK (points_cost >= 0),
  video_unlock_required BOOLEAN DEFAULT true,
  max_attempts INTEGER DEFAULT 1,
  is_strict_mode BOOLEAN DEFAULT true,        -- تفعيل مكافحة الغش
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- التحقق المالي للاختبار
ALTER TABLE exams ADD CONSTRAINT exams_cost_check
  CHECK ( (is_free = true AND points_cost = 0) OR (is_free = false AND points_cost > 0) );

-- ==========================================
-- 3. بنك الأسئلة (Question Bank) - المخزن المستقل
-- (هنا يتم تفريغ ملف الـ Excel/CSV الذي ترفعه أنت)
-- ==========================================
CREATE TABLE question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_level grade_level NOT NULL,
  topic TEXT,                                  -- موضوع السؤال (مثال: الجبر، الهندسة)
  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT,
  option_d TEXT,
  correct_option CHAR(1) NOT NULL CHECK (correct_option IN ('A','B','C','D')),
  difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 4. أسئلة الاختبار (Exam Questions Mapping)
-- (يربط الاختبار بالأسئلة المسحوبة من البنك)
-- ==========================================
CREATE TABLE exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  bank_question_id UUID REFERENCES question_bank(id) ON DELETE CASCADE,
  points INTEGER DEFAULT 1,                    -- وزن السؤال في هذا الاختبار تحديداً
  order_index INTEGER DEFAULT 0                -- ترتيب الظهور للطالب
);

-- ==========================================
-- 5. المحاولات ومكافحة الغش (Exam Attempts)
-- ==========================================
CREATE TABLE exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  passed BOOLEAN DEFAULT false,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- مكافحة الغش
  tab_switches_count INTEGER DEFAULT 0,
  screenshot_attempts INTEGER DEFAULT 0,
  is_flagged BOOLEAN DEFAULT false,
  cheating_log JSONB DEFAULT '[]'
);

-- ==========================================
-- 6. نظام الموافقة (Maker-Checker) للطلبات المعلقة
-- ==========================================
CREATE TABLE pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID REFERENCES profiles(id) ON DELETE CASCADE,
  target_table TEXT NOT NULL,
  record_id UUID NOT NULL,
  action_type action_type NOT NULL,
  proposed_data JSONB,
  status approval_status DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- ==========================================
-- 7. الفهارس (Indexes) - قلب الأداء والسرعة ⚡
-- ==========================================
CREATE INDEX idx_exams_grade ON exams(grade_level);
CREATE INDEX idx_exams_video_id ON exams(related_video_id);
CREATE INDEX idx_qbank_grade ON question_bank(grade_level);
CREATE INDEX idx_exam_questions_exam_id ON exam_questions(exam_id);
CREATE INDEX idx_exam_attempts_user ON exam_attempts(user_id);
CREATE INDEX idx_exam_attempts_exam ON exam_attempts(exam_id);
CREATE INDEX idx_pending_status ON pending_approvals(status);

-- منع محاولات متزامنة لنفس الاختبار
CREATE UNIQUE INDEX idx_unique_active_attempt 
ON exam_attempts(user_id, exam_id) 
WHERE completed_at IS NULL;

-- ==========================================
-- 8. سياسات الأمان (RLS - Row Level Security)
-- ==========================================
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_approvals ENABLE ROW LEVEL SECURITY;

-- صلاحيات الطلاب
CREATE POLICY "Students view active exams" ON exams FOR SELECT USING (is_active = true);
CREATE POLICY "Students view exam questions" ON exam_questions FOR SELECT 
  USING (EXISTS (SELECT 1 FROM exams WHERE exams.id = exam_questions.exam_id AND is_active = true));
CREATE POLICY "Students view bank questions via exam" ON question_bank FOR SELECT
  USING (id IN (SELECT bank_question_id FROM exam_questions WHERE exam_id IN (SELECT id FROM exams WHERE is_active = true)));
CREATE POLICY "Students manage own attempts" ON exam_attempts FOR ALL USING (auth.uid() = user_id);

-- صلاحيات المشرفين (قراءة فقط + إضافة طلبات التعديل)
CREATE POLICY "Supervisors view all" ON exams FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('supervisor', 'owner')));
CREATE POLICY "Supervisors view bank" ON question_bank FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('supervisor', 'owner')));
CREATE POLICY "Supervisors manage own requests" ON pending_approvals FOR ALL USING (auth.uid() = requested_by);

-- صلاحيات المالك المطلقة (God Mode)
CREATE POLICY "Owner god mode exams" ON exams FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner god mode bank" ON question_bank FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner god mode mappings" ON exam_questions FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner manages all requests" ON pending_approvals FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- ==========================================
-- 9. الدوال والمشغلات (Functions & Triggers)
-- ==========================================

-- دالة الموافقة والتنفيذ التلقائي (RPC للمالك)
CREATE OR REPLACE FUNCTION approve_and_execute_request(request_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  req RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner') THEN
    RAISE EXCEPTION 'Access Denied: Only owner can approve requests.';
  END IF;

  SELECT * INTO req FROM pending_approvals WHERE id = request_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already processed.'; END IF;

  IF req.action_type = 'DELETE' THEN
    EXECUTE format('DELETE FROM %I WHERE id = %L', req.target_table, req.record_id);
  ELSIF req.action_type = 'UPDATE' THEN
    -- دمج التعديلات الجديدة بشكل آمن
    EXECUTE format(
      'UPDATE %I SET (title, description, points_cost, is_free) = (SELECT title, description, points_cost, is_free FROM jsonb_populate_record(NULL::%I, %L::jsonb)) WHERE id = %L',
      req.target_table, req.target_table, req.proposed_data, req.record_id
    );
  END IF;

  UPDATE pending_approvals SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = NOW() WHERE id = request_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- تحديث الوقت تلقائياً
CREATE TRIGGER update_exams_updated_at BEFORE UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();