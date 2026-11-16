import type { Deck } from '@/lib/deck';
import { ArtifactCard } from './ArtifactCards';

/**
 * Ответ на /slides — карточка презентации, как у документа и таблицы. Слайды
 * смотрят и скачивают (.pptx) в боковой панели; пока ИИ пишет, карточка уже
 * есть («Создаётся…»), а панель показывает готовые слайды по ходу.
 */
export function DeckCard({ deck, streaming, onOpen }: { deck: Deck; streaming?: boolean; onOpen: () => void }) {
  return <ArtifactCard kind="slides" title={deck.title} writing={streaming} onOpen={onOpen} />;
}
