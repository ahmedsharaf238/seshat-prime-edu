-- ==============================================================================
-- 005_create_transactions.sql
-- نظام المحفظة المالية وإدارة المبيعات (نسخة الأمان المطلق والأداء العالي للمنصات المدفوعة)
-- الإصدار: 2.0 (مع تحسينات الأمان والتدقيق وإعادة الحساب)
-- ==============================================================================

-- ==========================================
-- 1. تحديد أنواع العمليات المالية
-- ==========================================
CREATE TYPE transaction_type AS ENUM (
  'wallet_recharge',
  'course_purchase',
  'unit_purchase',
  'exam_purchase',
  'admin_adjustment'
);

-- ==========================================
-- 2. تحديث جدول profiles (إضافة حقل التوقيت والتحقق)
-- ==========================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_balance DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallet_updated_at TIMESTAMPTZ DEFAULT NOW();
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positive_balance' AND conrelid = 'profiles'::regclass) THEN
        ALTER TABLE profiles ADD CONSTRAINT positive_balance CHECK (wallet_balance >= 0);
    END IF;
END $$;
-- ==========================================
-- 3. جدول المعاملات المالية الأساسي
-- ==========================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  current_balance DECIMAL(10,2) NOT NULL,
  trx_type transaction_type NOT NULL,
  reference_id UUID,
  currency TEXT DEFAULT 'EGP',           -- دعم العملات (EGP, USD, SAR, ...)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- قيود الأمان
  CONSTRAINT valid_amount CHECK (amount != 0 AND ABS(amount) <= 100000),
  CONSTRAINT valid_currency CHECK (currency ~ '^[A-Z]{3}$')
);

-- ==========================================
-- 4. الفهارس الفائقة السرعة
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions(user_id, trx_type);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC); -- جديد
CREATE INDEX IF NOT EXISTS idx_transactions_currency ON transactions(currency);

-- منع تكرار شراء نفس المرجع
CREATE UNIQUE INDEX IF NOT EXISTS idx_prevent_double_purchase 
  ON transactions (user_id, reference_id, trx_type) 
  WHERE trx_type IN ('course_purchase', 'unit_purchase', 'exam_purchase');

-- ==========================================
-- 5. جداول الأمان والتدقيق
-- ==========================================
-- تحديد معدل العمليات
CREATE TABLE IF NOT EXISTS transaction_rate_limit (
  user_id UUID PRIMARY KEY,
  last_transaction TIMESTAMPTZ,
  attempts_last_minute INT DEFAULT 1
);

-- سجل تدقيق الدوال
CREATE TABLE IF NOT EXISTS function_audit_log (
  id BIGSERIAL PRIMARY KEY,
  function_name TEXT,
  parameters JSONB,
  executed_by UUID,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- سجل الاستردادات
CREATE TABLE IF NOT EXISTS refund_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_transaction_id UUID REFERENCES transactions(id),
  refund_amount DECIMAL(10,2),
  refund_reason TEXT,
  approved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- جدول لتتبع أخطاء التطابق (للتدقيق)
CREATE TABLE IF NOT EXISTS balance_inconsistency_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  expected_balance DECIMAL,
  actual_balance DECIMAL,
  last_transaction_id UUID,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE
);

-- ==========================================
-- 6. تفعيل RLS على جميع الجداول
-- ==========================================
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_inconsistency_log ENABLE ROW LEVEL SECURITY;

-- سياسات transactions
CREATE POLICY "Users view own financial history" ON transactions 
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Supervisors and owner view financial ledger" ON transactions 
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('supervisor', 'owner')));

CREATE POLICY "Block direct insert" ON transactions FOR INSERT WITH CHECK (false);
CREATE POLICY "Block direct update" ON transactions FOR UPDATE USING (false);
CREATE POLICY "Block direct delete" ON transactions FOR DELETE USING (false);

-- سياسات refund_log (المالك فقط)
CREATE POLICY "Only owner view refund log" ON refund_log 
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- سياسات balance_inconsistency_log (المالك والمشرف)
CREATE POLICY "Owner and supervisor view inconsistency" ON balance_inconsistency_log 
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'supervisor')));

-- ==========================================
-- 7. Trigger لتحديث wallet_updated_at تلقائياً
-- ==========================================
CREATE OR REPLACE FUNCTION update_wallet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.wallet_updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_wallet_timestamp ON profiles;
CREATE TRIGGER trigger_update_wallet_timestamp
  BEFORE UPDATE OF wallet_balance ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_timestamp();

-- ==========================================
-- 8. الدالة الأساسية (مع قفل استشاري إضافي)
-- ==========================================
CREATE OR REPLACE FUNCTION process_wallet_transaction(
  p_user_id UUID,
  p_amount DECIMAL(10,2),
  p_type transaction_type,
  p_reference_id UUID DEFAULT NULL,
  p_currency TEXT DEFAULT 'EGP'
)
RETURNS DECIMAL(10,2) AS $$
DECLARE
  v_old_balance DECIMAL(10,2);
  v_new_balance DECIMAL(10,2);
  v_attempts INT;
  v_lock_acquired BOOLEAN;
BEGIN
  -- 1. قفل استشاري (advisory lock) لمنع deadlock في الضغط العالي جداً
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext(p_user_id::text));
  IF NOT v_lock_acquired THEN
    RAISE EXCEPTION 'تعذر قفل حساب المستخدم، حاول مرة أخرى.';
  END IF;

  -- 2. التحقق من المبلغ (منع الشراء بسعر صفر أو سالب)
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'المبلغ لا يمكن أن يكون صفراً.';
  END IF;
  IF p_type != 'wallet_recharge' AND p_amount > 0 THEN
    RAISE EXCEPTION 'المبلغ الموجب مسموح فقط للشحن.';
  END IF;

  -- 3. تحديد معدل العمليات
  INSERT INTO transaction_rate_limit (user_id, last_transaction, attempts_last_minute)
  VALUES (p_user_id, NOW(), 1)
  ON CONFLICT (user_id) DO UPDATE SET
    attempts_last_minute = CASE 
      WHEN transaction_rate_limit.last_transaction > NOW() - INTERVAL '1 minute' 
      THEN transaction_rate_limit.attempts_last_minute + 1 
      ELSE 1 
    END,
    last_transaction = NOW()
  WHERE transaction_rate_limit.user_id = p_user_id
  RETURNING attempts_last_minute INTO v_attempts;

  IF v_attempts > 10 THEN
    RAISE EXCEPTION 'عدد العمليات كبير جداً (الحد 10 عملية في الدقيقة).';
  END IF;

  -- 4. تسجيل التدقيق
  INSERT INTO function_audit_log (function_name, parameters, executed_by)
  VALUES ('process_wallet_transaction', 
          jsonb_build_object('user_id', p_user_id, 'amount', p_amount, 'type', p_type, 'reference', p_reference_id), 
          p_user_id);

  -- 5. قفل الصف وجلب الرصيد
  SELECT COALESCE(wallet_balance, 0.00) INTO v_old_balance 
  FROM profiles 
  WHERE id = p_user_id 
  FOR UPDATE;

  v_new_balance := v_old_balance + p_amount;

  -- 6. منع الرصيد السالب
  IF p_amount < 0 AND v_new_balance < 0 THEN
    RAISE EXCEPTION 'رصيد غير كافٍ. الرصيد الحالي: %', v_old_balance;
  END IF;

  -- 7. منع خصم المالك أكثر من الرصيد
  IF p_type = 'admin_adjustment' AND p_amount < 0 AND v_new_balance < 0 THEN
    RAISE EXCEPTION 'لا يمكن خصم مبلغ أكبر من الرصيد. الرصيد: %', v_old_balance;
  END IF;

  -- 8. تحديث الرصيد
  UPDATE profiles 
  SET wallet_balance = v_new_balance
  WHERE id = p_user_id;

  -- 9. تسجيل المعاملة مع العملة
  INSERT INTO transactions (user_id, amount, current_balance, trx_type, reference_id, currency)
  VALUES (p_user_id, p_amount, v_new_balance, p_type, p_reference_id, p_currency);

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 9. دوال شراء آمنة (مع التحقق من الملكية المسبقة)
-- ==========================================
CREATE OR REPLACE FUNCTION safe_purchase_course(
  p_user_id UUID,
  p_course_id UUID,
  p_price DECIMAL(10,2),
  p_currency TEXT DEFAULT 'EGP'
)
RETURNS TABLE(success BOOLEAN, message TEXT, new_balance DECIMAL) AS $$
DECLARE
  v_already_purchased BOOLEAN;
  v_new_balance DECIMAL;
BEGIN
  IF p_price <= 0 THEN
    RETURN QUERY SELECT false, 'سعر الكورس غير صالح.', 0.00;
    RETURN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM transactions 
    WHERE user_id = p_user_id 
      AND reference_id = p_course_id 
      AND trx_type = 'course_purchase'
  ) INTO v_already_purchased;
  
  IF v_already_purchased THEN
    RETURN QUERY SELECT false, 'الكورس مشترى مسبقاً.', 0.00;
    RETURN;
  END IF;
  
  BEGIN
    v_new_balance := process_wallet_transaction(p_user_id, -p_price, 'course_purchase', p_course_id, p_currency);
    RETURN QUERY SELECT true, 'تم الشراء بنجاح.', v_new_balance;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM, 0.00;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة شراء وحدة
CREATE OR REPLACE FUNCTION safe_purchase_unit(
  p_user_id UUID,
  p_unit_id UUID,
  p_price DECIMAL(10,2),
  p_currency TEXT DEFAULT 'EGP'
)
RETURNS TABLE(success BOOLEAN, message TEXT, new_balance DECIMAL) AS $$
DECLARE
  v_already_purchased BOOLEAN;
  v_new_balance DECIMAL;
BEGIN
  IF p_price <= 0 THEN
    RETURN QUERY SELECT false, 'سعر الوحدة غير صالح.', 0.00;
    RETURN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM transactions 
    WHERE user_id = p_user_id 
      AND reference_id = p_unit_id 
      AND trx_type = 'unit_purchase'
  ) INTO v_already_purchased;
  
  IF v_already_purchased THEN
    RETURN QUERY SELECT false, 'الوحدة مشتراة مسبقاً.', 0.00;
    RETURN;
  END IF;
  
  BEGIN
    v_new_balance := process_wallet_transaction(p_user_id, -p_price, 'unit_purchase', p_unit_id, p_currency);
    RETURN QUERY SELECT true, 'تم شراء الوحدة بنجاح.', v_new_balance;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM, 0.00;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 10. دالة الشحن
-- ==========================================
CREATE OR REPLACE FUNCTION recharge_wallet(
  p_user_id UUID,
  p_amount DECIMAL(10,2),
  p_recharge_code_id UUID DEFAULT NULL,
  p_currency TEXT DEFAULT 'EGP'
)
RETURNS DECIMAL AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ الشحن يجب أن يكون أكبر من صفر.';
  END IF;
  
  RETURN process_wallet_transaction(p_user_id, p_amount, 'wallet_recharge', p_recharge_code_id, p_currency);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 11. دالة استرداد الأموال (مطورة)
-- ==========================================
CREATE OR REPLACE FUNCTION safe_refund_transaction(
  p_transaction_id UUID,
  p_admin_id UUID,
  p_reason TEXT
)
RETURNS DECIMAL AS $$
DECLARE
  v_user_id UUID;
  v_amount DECIMAL;
  v_trx_type transaction_type;
  v_new_balance DECIMAL;
BEGIN
  INSERT INTO function_audit_log (function_name, parameters, executed_by)
  VALUES ('safe_refund_transaction', jsonb_build_object('transaction_id', p_transaction_id, 'reason', p_reason), p_admin_id);

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND role IN ('supervisor', 'owner')) THEN
    RAISE EXCEPTION 'غير مصرح لك بعملية استرداد.';
  END IF;

  SELECT user_id, ABS(amount), trx_type INTO v_user_id, v_amount, v_trx_type
  FROM transactions WHERE id = p_transaction_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المعاملة غير موجودة.';
  END IF;

  IF EXISTS (SELECT 1 FROM refund_log WHERE original_transaction_id = p_transaction_id) THEN
    RAISE EXCEPTION 'المعاملة مستردة مسبقاً.';
  END IF;

  v_new_balance := process_wallet_transaction(v_user_id, v_amount, 'admin_adjustment', p_transaction_id);
  
  INSERT INTO refund_log (original_transaction_id, refund_amount, refund_reason, approved_by)
  VALUES (p_transaction_id, v_amount, p_reason, p_admin_id);
  
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 12. دوال التدقيق المالي وإعادة الحساب
-- ==========================================
-- دالة للتحقق من اتساق سجل المعاملات (عدم وجود قفزات)
CREATE OR REPLACE FUNCTION audit_transaction_consistency(p_user_id UUID)
RETURNS TABLE(
  transaction_id UUID,
  expected_balance DECIMAL,
  actual_balance DECIMAL,
  difference DECIMAL
) AS $$
DECLARE
  v_running_balance DECIMAL := 0;
  v_rec RECORD;
BEGIN
  FOR v_rec IN 
    SELECT id, amount, current_balance, created_at 
    FROM transactions 
    WHERE user_id = p_user_id 
    ORDER BY created_at
  LOOP
    v_running_balance := v_running_balance + v_rec.amount;
    IF v_running_balance <> v_rec.current_balance THEN
      transaction_id := v_rec.id;
      expected_balance := v_running_balance;
      actual_balance := v_rec.current_balance;
      difference := v_running_balance - v_rec.current_balance;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة إصلاح رصيد المستخدم (للطوارئ، بصلاحية المالك فقط)
CREATE OR REPLACE FUNCTION recalculate_user_balance(p_user_id UUID, p_admin_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  v_calculated_balance DECIMAL;
  v_current_balance DECIMAL;
BEGIN
  -- التحقق من صلاحية المالك
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_admin_id AND role = 'owner') THEN
    RAISE EXCEPTION 'فقط المالك يمكنه إعادة حساب الرصيد.';
  END IF;

  -- حساب الرصيد الصحيح من المعاملات
  SELECT COALESCE(SUM(amount), 0) INTO v_calculated_balance
  FROM transactions
  WHERE user_id = p_user_id;

  -- جلب الرصيد الحالي
  SELECT wallet_balance INTO v_current_balance
  FROM profiles WHERE id = p_user_id;

  -- تسجيل التناقض إذا وجد
  IF v_calculated_balance != v_current_balance THEN
    INSERT INTO balance_inconsistency_log (user_id, expected_balance, actual_balance, resolved)
    VALUES (p_user_id, v_calculated_balance, v_current_balance, FALSE);
    
    -- تصحيح الرصيد
    UPDATE profiles SET wallet_balance = v_calculated_balance WHERE id = p_user_id;
    
    -- تسجيل معاملة تصحيحية
    PERFORM process_wallet_transaction(
      p_user_id, 
      v_calculated_balance - v_current_balance, 
      'admin_adjustment', 
      NULL
    );
  END IF;

  RETURN v_calculated_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 13. التقارير المالية (مطورة)
-- ==========================================
CREATE OR REPLACE FUNCTION daily_financial_report(p_date DATE, p_currency TEXT DEFAULT 'EGP')
RETURNS TABLE(
  total_recharges DECIMAL,
  total_sales DECIMAL,
  net_revenue DECIMAL,
  transaction_count BIGINT,
  unique_users INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COUNT(DISTINCT user_id)
  FROM transactions
  WHERE DATE(created_at) = p_date AND currency = p_currency;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION monthly_financial_report(p_year INT, p_month INT, p_currency TEXT DEFAULT 'EGP')
RETURNS TABLE(
  day DATE,
  daily_recharges DECIMAL,
  daily_sales DECIMAL,
  daily_net DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(created_at) AS day,
    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0),
    COALESCE(SUM(amount), 0)
  FROM transactions
  WHERE EXTRACT(YEAR FROM created_at) = p_year 
    AND EXTRACT(MONTH FROM created_at) = p_month
    AND currency = p_currency
  GROUP BY day
  ORDER BY day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 14. دوال مساعدة
-- ==========================================
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

CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS VOID AS $$
BEGIN
  DELETE FROM transaction_rate_limit 
  WHERE last_transaction < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 15. صلاحيات التنفيذ
-- ==========================================
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_wallet_transaction TO authenticated;
GRANT EXECUTE ON FUNCTION safe_purchase_course TO authenticated;
GRANT EXECUTE ON FUNCTION safe_purchase_unit TO authenticated;
GRANT EXECUTE ON FUNCTION recharge_wallet TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_balance TO authenticated;
GRANT EXECUTE ON FUNCTION daily_financial_report TO authenticated;
GRANT EXECUTE ON FUNCTION monthly_financial_report TO authenticated;
GRANT EXECUTE ON FUNCTION safe_refund_transaction TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_rate_limits TO postgres;
GRANT EXECUTE ON FUNCTION audit_transaction_consistency TO authenticated;
GRANT EXECUTE ON FUNCTION recalculate_user_balance TO authenticated;

-- ==========================================
-- 16. مهمة مجدولة (إذا كان pg_cron متاحاً)
-- ==========================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('cleanup-rate-limit', '0 */6 * * *', 'SELECT cleanup_old_rate_limits();');
  END IF;
END $$;

-- ==========================================
-- 17. ملاحظات الإصدار 2.0
-- ==========================================
