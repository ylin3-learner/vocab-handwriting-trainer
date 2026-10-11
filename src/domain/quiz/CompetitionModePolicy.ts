// src/domain/quiz/CompetitionModePolicy.ts

/**
 * 比賽模式策略。
 *
 * 當比賽模式啟用時：
 *   1. DDA 等級評估完全凍結（evaluationGuard 直接返回 false）
 *   2. 出題 100% 從目標等級抽取，不混入當前等級或 probe 題
 *   3. 學生只會看到目標等級範圍的單字
 *
 * 設計依據：
 *   - 學術上 CAT 的 Freeze-and-Refresh 機制（Choi & van der Linden, 2018）
 *   - 工業界 Exam Mode 與 Adaptive Mode 互斥的標準做法
 *     （W.W. Norton Smartwork, DataClassroom, BenchPrep 等）
 *
 * 自動過期：
 *   比賽模式不需要獨立的過期機制。Assignment.endDate 過期後，
 *   selectActiveAssignment 會自動排除該作業，QuizOrchestrator
 *   會回到一般模式，DDA 自然恢復。解凍後的重新評估由
 *   MIN_ATTEMPTS_BETWEEN_EVALUATIONS = 30 與 WINDOW_SIZE = 30 對齊
 *   保證——下一次評估用的是完全刷新的 30 題窗口。
 *
 * 優先序：學生個人覆蓋 > 作業設定 > 系統預設
 * 與 QuizTimingPolicy、HandwritingLockPolicy 對稱。
 */
export interface CompetitionModeConfig {
  /** 是否啟用比賽模式 */
  enabled: boolean;
  /** 凍結在哪個等級（啟用時必填） */
  targetLevel: number;
}

export class CompetitionModePolicy {
  static readonly DEFAULT: CompetitionModeConfig = {
    enabled: false,
    targetLevel: 1,
  };

  static readonly MIN_LEVEL = 1;
  static readonly MAX_LEVEL = 6;

  resolve(context: {
    studentOverride?: boolean;
    assignmentMode?: boolean;
    targetLevel?: number;
  }): CompetitionModeConfig {
    const enabled =
      context.studentOverride ??
      context.assignmentMode ??
      CompetitionModePolicy.DEFAULT.enabled;

    if (!enabled) {
      return { ...CompetitionModePolicy.DEFAULT };
    }

    const rawLevel = context.targetLevel ?? CompetitionModePolicy.DEFAULT.targetLevel;
    const level = Math.max(
      CompetitionModePolicy.MIN_LEVEL,
      Math.min(CompetitionModePolicy.MAX_LEVEL, rawLevel)
    );

    return { enabled: true, targetLevel: level };
  }

  /**
   * 驗證是否為合法配置。
   * UI 用來顯示警告，不阻擋輸入。
   */
  isValid(config: CompetitionModeConfig): boolean {
    if (typeof config.enabled !== 'boolean') return false;
    if (config.enabled) {
      if (
        !Number.isFinite(config.targetLevel) ||
        config.targetLevel < CompetitionModePolicy.MIN_LEVEL ||
        config.targetLevel > CompetitionModePolicy.MAX_LEVEL
      ) {
        return false;
      }
    }
    return true;
  }
}