// src/domain/quiz/QuizTimingPolicy.ts

/**
 * 職責：依優先序決定「本題的作答時限」（毫秒）。
 *
 * 優先序：學生個人 > 作業設定 > 系統預設
 *
 * 設計依據：
 *   - 剛接觸的學生需要更長時間適應（老師可調整）
 *   - 熟練後應回到標準時間（訓練反應速度）
 *   - 保留個人層級，未來特殊生可個別設定
 *
 * 邊界保護：
 *   - 下限 3000ms：低於此值會讓「寫字」變成不可能的任務
 *   - 上限 30000ms：高於此值會嚴重拖慢節奏
 *   - 無效值（undefined / NaN / 負數）一律 fallback 到系統預設
 *
 * 已知限制：
 *   studentAnalyzer 的超時分類仍使用硬編碼 8000ms 為界，
 *   因此若作業時限設為 15 秒，學生答錯且用時 10 秒的作答，
 *   會被分類為「超時」而非「拼字錯」。
 *   這個問題留待比賽後處理（需要 AttemptRecord 記錄當下時限）。
 */
export class QuizTimingPolicy {
  /** 系統預設：8 秒（對應比賽規則） */
  static readonly DEFAULT_TIME_LIMIT_MS = 8000;
  /** 下限：3 秒（再短就寫不完） */
  static readonly MIN_TIME_LIMIT_MS = 3000;
  /** 上限：30 秒（再長就拖節奏） */
  static readonly MAX_TIME_LIMIT_MS = 30000;

  /**
   * 建議選項（給 UI 下拉用，單位：秒）。
   * 這些是經過教學現場推估的「合理值」。
   */
  static readonly PRESETS_SECONDS = [5, 8, 10, 15, 20] as const;

  resolve(context: {
    studentCustomMs?: number;
    assignmentMs?: number;
  }): number {
    const raw =
      context.studentCustomMs ??
      context.assignmentMs ??
      QuizTimingPolicy.DEFAULT_TIME_LIMIT_MS;

    return this.clamp(raw);
  }

  /**
   * 驗證是否為合法時限。
   * UI 用來顯示警告，不阻擋輸入（老師有權設超範圍值）。
   */
  isValid(ms: number): boolean {
    return (
      Number.isFinite(ms) &&
      ms >= QuizTimingPolicy.MIN_TIME_LIMIT_MS &&
      ms <= QuizTimingPolicy.MAX_TIME_LIMIT_MS
    );
  }

  private clamp(ms: number): number {
    if (!Number.isFinite(ms) || ms <= 0) {
      return QuizTimingPolicy.DEFAULT_TIME_LIMIT_MS;
    }
    return Math.max(
      QuizTimingPolicy.MIN_TIME_LIMIT_MS,
      Math.min(QuizTimingPolicy.MAX_TIME_LIMIT_MS, ms)
    );
  }
}