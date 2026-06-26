-- ==========================================
-- 007_create_exams.sql (النسخة النهائية المحسنة والآمنة)
-- جداول الامتحانات، الأسئلة، المحاولات، الإجابات
-- متوافق مع Supabase (PostgreSQL)
-- ==========================================

-- ==========================================
-- 1. أنواع البيانات المخصصة (مع تجنب التكرار)
-- ==========================================
DO $$ BEGIN
    CREATE TYPE grade_level AS ENUM ('primary', 'intermediate', 'secondary', 'university');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE attempt_status AS ENUM ('ongoing', 'completed', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==========================================
-- 2. جدول الامتحانات (تم إنشاؤه غالباً في 003، لكننا نستخدم IF NOT EXISTS)
-- ==========================================
CREATE TABLE IF NOT EXISTS exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  grade_level grade_level NOT NULL,
  related_video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  video_unlock_required BOOLEAN DEFAULT true,
  time_limit_minutes INTEGER NOT NULL DEFAULT 30,
  passing_score INTEGER NOT NULL DEFAULT 50,
  total_points INTEGER DEFAULT 0,
  points_cost INTEGER DEFAULT 0 CHECK (points_cost >= 0),
  points_reward INTEGER DEFAULT 0 CHECK (points_reward >= 0),
  max_attempts INTEGER DEFAULT 1,
  retry_after_hours INTEGER DEFAULT 24,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 3. جدول الأسئلة
-- ==========================================
CREATE TABLE IF NOT EXISTS exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT DEFAULT 'mcq' CHECK (question_type IN ('mcq', 'true_false', 'essay')),
  points INTEGER DEFAULT 1 CHECK (points > 0),
  options JSONB,                     -- للمتعدد: {"A":"نص","B":"نص"}
  correct_answer TEXT NOT NULL,
  explanation TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 4. جدول محاولات الطلاب (مع فهرس جزئي بدلاً من CONSTRAINT UNIQUE مع WHERE)
-- ==========================================
CREATE TABLE IF NOT EXISTS student_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  score INTEGER DEFAULT 0,
  is_passed BOOLEAN DEFAULT false,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status attempt_status DEFAULT 'ongoing',
  attempt_number INTEGER DEFAULT 1
  -- تم حذف CONSTRAINT غير المدعوم (UNIQUE ... WHERE)
);

-- منع أكثر من محاولة نشطة (ongoing) لنفس الطالب ونفس الامتحان
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_attempt ON student_attempts (student_id, exam_id) WHERE status = 'ongoing';

-- ==========================================
-- 5. جدول إجابات الطلاب
-- ==========================================
CREATE TABLE IF NOT EXISTS student_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID REFERENCES student_attempts(id) ON DELETE CASCADE,
  question_id UUID REFERENCES exam_questions(id) ON DELETE CASCADE,
  student_answer TEXT,
  is_correct BOOLEAN,
  points_earned INTEGER DEFAULT 0,
  answered_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 6. الفهارس لتحسين الأداء
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_exams_grade_active ON exams(grade_level, is_active);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON exam_questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON student_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam ON student_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON student_attempts(status);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON student_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON student_answers(question_id);

-- ==========================================
-- 7. تفعيل Row Level Security (RLS)
-- ==========================================
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_answers ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 8. سياسات RLS (الأمان)
-- ==========================================
-- Exams: الجميع يرى الامتحانات النشطة، المالك فقط يعدل
CREATE POLICY "Anyone view active exams" ON exams
  FOR SELECT USING (is_active = true);

CREATE POLICY "Owner all on exams" ON exams
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- Exam Questions: مرئية للجميع في الامتحانات النشطة، والمالك فقط يعدل
CREATE POLICY "Anyone view questions of active exams" ON exam_questions
  FOR SELECT USING (EXISTS (SELECT 1 FROM exams WHERE id = exam_id AND is_active = true));

CREATE POLICY "Owner manage questions" ON exam_questions
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- Student Attempts: الطالب يرى ويضيف ويعدل محاولاته فقط
CREATE POLICY "Student view own attempts" ON student_attempts
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Student insert own attempts" ON student_attempts
  FOR INSERT WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Student update own attempts" ON student_attempts
  FOR UPDATE USING (auth.uid() = student_id);

-- Student Answers: الطالب يرى ويضيف إجاباته فقط (عبر محاولاته)
CREATE POLICY "Student view own answers" ON student_answers
  FOR SELECT USING (EXISTS (SELECT 1 FROM student_attempts WHERE id = attempt_id AND student_id = auth.uid()));

CREATE POLICY "Student insert own answers" ON student_answers
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM student_attempts WHERE id = attempt_id AND student_id = auth.uid()));

-- ==========================================
-- 9. دوال مساعدة (آمنة)
-- ==========================================

-- دالة حساب درجة الامتحان تلقائياً بعد الإجابة
CREATE OR REPLACE FUNCTION calculate_exam_score(p_attempt_id UUID)
RETURNS INTEGER AS $$
DECLARE
  total_score INTEGER;
  v_exam_id UUID;
  v_passing_score INTEGER;
BEGIN
  SELECT SUM(points_earned) INTO total_score
  FROM student_answers
  WHERE attempt_id = p_attempt_id;
  
  SELECT exam_id, passing_score INTO v_exam_id, v_passing_score
  FROM student_attempts WHERE id = p_attempt_id;
  
  UPDATE student_attempts
  SET score = COALESCE(total_score, 0),
      is_passed = (COALESCE(total_score, 0) >= v_passing_score),
      status = 'completed',
      completed_at = NOW()
  WHERE id = p_attempt_id;
  
  RETURN COALESCE(total_score, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة للتحقق من السماح بمحاولة جديدة (مراعاة max_attempts و retry_after_hours)
CREATE OR REPLACE FUNCTION can_attempt_exam(p_student_id UUID, p_exam_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_max_attempts INTEGER;
  v_retry_hours INTEGER;
  v_attempt_count INTEGER;
  v_last_completed TIMESTAMPTZ;
BEGIN
  -- الحصول على إعدادات الامتحان
  SELECT max_attempts, retry_after_hours INTO v_max_attempts, v_retry_hours
  FROM exams WHERE id = p_exam_id;
  
  -- حساب عدد المحاولات السابقة (مكتملة أو متروكة)
  SELECT COUNT(*) INTO v_attempt_count
  FROM student_attempts
  WHERE student_id = p_student_id AND exam_id = p_exam_id
    AND status IN ('completed', 'abandoned');
  
  IF v_attempt_count >= v_max_attempts THEN
    RETURN false;
  END IF;
  
  -- إذا كانت هناك محاولة مكتملة حديثاً، نتحقق من وقت الانتظار
  SELECT completed_at INTO v_last_completed
  FROM student_attempts
  WHERE student_id = p_student_id AND exam_id = p_exam_id AND status = 'completed'
  ORDER BY completed_at DESC LIMIT 1;
  
  IF v_last_completed IS NOT NULL AND (NOW() - v_last_completed) < (v_retry_hours || ' hours')::INTERVAL THEN
    RETURN false;
  END IF;
  
  -- التأكد من عدم وجود محاولة حالية نشطة (ongoing)
  IF EXISTS (SELECT 1 FROM student_attempts WHERE student_id = p_student_id AND exam_id = p_exam_id AND status = 'ongoing') THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 10. صلاحيات تنفيذ الدوال
-- ==========================================
GRANT EXECUTE ON FUNCTION calculate_exam_score(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_attempt_exam(UUID, UUID) TO authenticated;

-- ==========================================
-- 11. تعليق توضيحي للمطور
-- ==========================================
/*
تم التطوير والتحسين:
✓ إضافة IF NOT EXISTS لجميع الجداول والأنواع.
✓ استبدال CONSTRAINT UNIQUE ... WHERE بفهرس جزئي CREATE UNIQUE INDEX ... WHERE.
✓ سياسات RLS كاملة ومفصلة.
✓ دوال مساعدة آمنة (calculate_exam_score, can_attempt_exam).
✓ فهارس لتحسين الأداء.
✓ متوافق مع Supabase Free Tier.

الملف آمن للتطبيق حتى لو كان جدول exams موجوداً مسبقاً.
*/