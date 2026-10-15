export const NPS_SURVEY_COLUMNS =
  "id,created_at,expires_at,cancelled_at,score,comment,answered_at,created_by_user_id";
export function npsClass(score: number): "Promotor" | "Neutro" | "Detrator" {
  return score >= 9 ? "Promotor" : score >= 7 ? "Neutro" : "Detrator";
}
export interface NpsSurvey {
  id: string;
  created_at: string;
  expires_at: string;
  cancelled_at: string | null;
  score: number | null;
  comment: string | null;
  answered_at: string | null;
  created_by_user_id: string | null;
}
