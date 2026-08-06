/**
 * Тонкая обёртка: контент-данные + общий рендерер.
 *
 * Такой файл на каждую публичную страницу нужен ровно для одного — чтобы
 * контент страницы и её чанк были одним ленивым модулем: текст на шести языках
 * приезжает только тому, кто эту страницу открыл, и не попадает ни в главный
 * чанк, ни в чанки приложения.
 */
import { PublicPage } from '../PublicPage';
import { contractAnalysis } from '@/content/pages/contract-analysis';

export function ContractAnalysisPage() {
  return <PublicPage content={contractAnalysis} />;
}
