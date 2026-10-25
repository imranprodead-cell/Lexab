import { fileIconType } from '@/lib/fileKind';
import styles from './chat.module.css';

/** Размеры, в которых Microsoft рисует значки (мелкие — упрощены под пиксели). */
const ICON_SIZES = [20, 24, 32, 48] as const;

/**
 * Оригинальные значки типов файлов Microsoft Office — те же, что в OneDrive и
 * SharePoint: Word, Excel, PowerPoint, PDF, CSV, текст. Файлы — в
 * public/filetypes/<размер>/, скачаны без изменений с CDN Fluent UI
 * (res.cdn.office.net, набор item-types) и раздаются с нашего домена, как
 * флаги: IP посетителя не уходит к Microsoft.
 *
 * Условия: Microsoft Fabric Assets License — значки Office разрешены
 * приложениям, работающим с сервисами Microsoft через их API (у Lexab —
 * импорт из OneDrive через Microsoft Graph). Значки нельзя перекрашивать и
 * искажать — только масштаб. Значок PDF от Adobe не берём: Adobe разрешает
 * его лишь отдельной пометкой ссылки и без изменения размера.
 */
export function FileIcon({ name, size = 20 }: { name: string; size?: number }) {
  // Берём ближайший нарисованный размер не меньше нужного (чёткость на 1x).
  const drawn = ICON_SIZES.find((s) => s >= size) ?? 48;
  return (
    <img
      className={styles.fileGlyph}
      src={`/filetypes/${drawn}/${fileIconType(name)}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
