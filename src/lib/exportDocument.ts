/**
 * Client-side document export helpers.
 *
 * DOCX: emits a Word-compatible HTML document (opens natively in MS Word /
 * Google Docs) with the redlines applied — no server needed. A production
 * backend can later stream a true .docx binary; the call site stays the same.
 * PDF: opens the print dialog scoped to the rendered document.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { AnalysisResult } from '@/types/domain';

/** Resolve blocks to {heading|text} sections with redline states applied. */
function resolveSections(analysis: AnalysisResult): { heading?: string; text?: string }[] {
  const byId = new Map(analysis.redlines.map((r) => [r.id, r]));
  const sections: { heading?: string; text?: string }[] = [];
  for (const block of analysis.document) {
    if (block.type === 'heading') {
      sections.push({ heading: block.text ?? '' });
      continue;
    }
    let paragraph = '';
    for (const seg of block.segments ?? []) {
      if (typeof seg === 'string') paragraph += seg;
      else {
        const rl = byId.get(seg.redlineId);
        if (rl) paragraph += rl.status === 'rejected' ? rl.delText : rl.insText;
      }
    }
    sections.push({ text: paragraph });
  }
  return sections;
}

function prettyName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
}

function resolveText(analysis: AnalysisResult): string {
  const parts: string[] = [];
  for (const block of analysis.document) {
    if (block.type === 'heading') {
      parts.push(`<h3>${block.text ?? ''}</h3>`);
      continue;
    }
    let paragraph = '';
    for (const seg of block.segments ?? []) {
      if (typeof seg === 'string') {
        paragraph += seg;
      } else {
        const rl = analysis.redlines.find((r) => r.id === seg.redlineId);
        if (!rl) continue;
        // Accepted → insertion text; rejected → original; pending → accept suggestion.
        paragraph += rl.status === 'rejected' ? rl.delText : rl.insText;
      }
    }
    parts.push(`<p>${paragraph}</p>`);
  }
  return parts.join('\n');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download the reviewed contract as a REAL .docx (built in the browser). */
export function exportDocx(analysis: AnalysisResult) {
  const sections = resolveSections(analysis);
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: prettyName(analysis.fileName), heading: HeadingLevel.HEADING_1 }),
    ...sections.map((s) =>
      s.heading !== undefined
        ? new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
        : new Paragraph({ children: [new TextRun(s.text ?? '')], spacing: { after: 160 } }),
    ),
  ];
  const file = new Document({ sections: [{ children: paragraphs }] });
  void Packer.toBlob(file).then((blob) => {
    triggerDownload(blob, analysis.fileName.replace(/\.[^.]+$/, '') + '.docx');
  });
}

/** Open a print-ready window (user chooses “Save as PDF”). */
export function exportPdf(analysis: AnalysisResult) {
  const body = resolveText(analysis);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${analysis.fileName}</title>
<style>@page{margin:2cm;} body{font-family:Georgia,serif;font-size:12pt;line-height:1.7;color:#111;} h2{text-align:center;} h3{margin-top:1.4em;}</style>
</head><body><h2>${analysis.fileName.replace(/\.[^.]+$/, '')}</h2>${body}
<script>window.onload=function(){window.print();}</script></body></html>`);
  win.document.close();
}
