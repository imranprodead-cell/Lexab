/**
 * Extra interface languages beyond the RU/EN base held in ../messages.ts.
 * Each map is key → translated string; a missing key falls back to English.
 *
 * ТОЛЬКО для тестов (messages.test.ts): прод-код грузит словари лениво через
 * ../loadDict.ts — статический импорт этого файла из прод-кода вернул бы все
 * 4 языка (~240KB) в главный чанк.
 */
import ar from './ar';
import de from './de';
import kk from './kk';
import uz from './uz';

export const EXTRA: Record<string, Record<string, string>> = { ar, de, kk, uz };
